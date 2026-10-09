import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { tBackend } from "../../../../common/src/index.js";
import { healDemotedUnitStatuses } from "../../domain/heal-demoted-unit-status.js";
import { enqueueInitialModuleKacomOnGoalOpen } from "../../goals/sequential-modules.js";
import { reconcileReadySequentialModules } from "../../goals/module-state.js";
import { handleTrackedStreamPost } from "../../generation/tracked-sse.js";
import { createTrackedTokenHandler } from "../../generation/token-handler.js";
import { planGoalMapStream } from "../../llm/plan-goal-map.js";
import { resolveGoalContentLanguage } from "../../llm/content-language.js";
import { parseJson } from "../../utils.js";
import { getModuleMasterySummary } from "../../cognitive-model/index.js";
import {
  ensureModuleEntryFoundationsQueued,
  getModuleEntryReadiness,
} from "../../assessment/index.js";
import {
  loadTeachingSkillPrompt,
  resolveTeachingSkillForGoal,
} from "../../teaching-skills/index.js";
import { getUnitSectionManifest } from "../../sections/index.js";
import {
  pickModuleCapabilityPracticeUnit,
  presentModuleCapability,
  type ExplorationCurriculumReadyRepository,
  type ModuleGenerationRetryRepository,
  type ModuleEntryReadinessReadRepository,
} from "../../../../domain/src/index.js";
import { MODULE_GENERATION_RETRY_REPOSITORY } from "../../learning-spaces/module-generation-retry-token.js";
import { EXPLORATION_CURRICULUM_READY_REPOSITORY } from "../../learning-spaces/exploration-curriculum-ready-token.js";
import { MODULE_ENTRY_READINESS_READ_REPOSITORY } from "../../learning-spaces/module-entry-readiness-read-token.js";
import { LearningSpaceOrmProvider } from "./learning-space-orm.provider.js";

function parseCapabilityRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => (typeof item === "string" ? [item] : []));
}

function pickPracticeUnit(
  units: Array<{
    id: string;
    title: string;
    orderIndex: number;
    moduleCapabilityRefs: unknown;
    moduleMilestoneRole?: string | null;
  }>,
  capabilityIndex: number,
): { practiceUnitId: string; practiceUnitTitle: string } | null {
  return pickModuleCapabilityPracticeUnit(
    units.map((unit) => ({
      ...unit,
      moduleCapabilityRefs: parseCapabilityRefs(unit.moduleCapabilityRefs),
    })),
    capabilityIndex,
  );
}

const LEARNED_UNIT_STATUSES = new Set([
  "completed",
  "completed_needs_reinforcement",
]);

const STARTABLE_MODEL_STATUSES = new Set(["expanded", "building"]);

function journeyStatus(module: {
  unlockStatus: string;
  generationStatus: string;
}) {
  if (module.unlockStatus === "completed") return "completed";
  if (module.unlockStatus === "locked") return "locked";
  if (module.generationStatus === "failed") return "failed";
  if (module.generationStatus !== "ready") return "generating";
  return "active";
}

function isStartableUnit(
  unit: {
    unitKind: string;
    cognitiveModelStatus?: string | null;
  },
  requiresCognitiveModel = true,
) {
  return (
    unit.unitKind === "lesson" &&
    (!requiresCognitiveModel ||
      STARTABLE_MODEL_STATUSES.has(unit.cognitiveModelStatus ?? ""))
  );
}

function serializeModule(
  module: {
    id: string;
    curriculumKey: string;
    planRef: string;
    orderIndex: number;
    title: string;
    summary: string;
    objective: string;
    plannedOutcomes: unknown;
    entryFoundationBriefs: unknown;
    entryFoundationStatus: string;
    entryFoundationError: string;
    exitCapabilityBriefs: unknown;
    unitPlanningBrief: unknown;
    estimatedUnitCount: number;
    unlockStatus: string;
    generationStatus: string;
    generationError: string;
    completionMethod: string | null;
    unlockedAt: Date | null;
    generatedAt: Date | null;
    completedAt: Date | null;
    units: Array<{
      id?: string;
      title?: string;
      contentSummary?: string;
      difficulty?: string;
      status: string;
      requiredForModuleCompletion: boolean;
      unitKind: string;
      cognitiveModelStatus?: string | null;
      orderIndex?: number;
    }>;
  },
  learningMode: string,
) {
  const requiresCognitiveModel = learningMode !== "exploration";
  const units = module.units ?? [];
  const required = units.filter(
    (unit) => unit.unitKind === "lesson" && unit.requiredForModuleCompletion,
  );
  const lessonUnits = units.filter((unit) => unit.unitKind === "lesson");
  const completedRequiredUnits = required.filter((unit) =>
    LEARNED_UNIT_STATUSES.has(unit.status),
  ).length;
  const structureUnitCount = lessonUnits.length;
  const readyUnitCount = lessonUnits.filter((unit) =>
    isStartableUnit(unit, requiresCognitiveModel),
  ).length;
  const firstReadyUnit =
    [...lessonUnits]
      .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))
      .find(
        (unit) => isStartableUnit(unit, requiresCognitiveModel) && unit.id,
      ) ?? null;
  return {
    id: module.id,
    curriculumKey: module.curriculumKey,
    planRef: module.planRef,
    orderIndex: module.orderIndex,
    title: module.title,
    summary: module.summary,
    objective: module.objective,
    plannedOutcomes: module.plannedOutcomes,
    entryFoundationBriefs: module.entryFoundationBriefs,
    entryFoundationStatus: module.entryFoundationStatus,
    entryFoundationError: module.entryFoundationError || null,
    exitCapabilityBriefs: module.exitCapabilityBriefs,
    unitPlanningBrief: module.unitPlanningBrief,
    estimatedUnitCount: module.estimatedUnitCount,
    unlockStatus: module.unlockStatus,
    generationStatus: module.generationStatus,
    status: journeyStatus(module),
    // Keep the persisted diagnostic available to operators, but expose only a
    // stable recovery message through the learner API.
    generationError:
      module.generationStatus === "failed"
        ? tBackend("error.generation.failedFriendly")
        : null,
    completionMethod: module.completionMethod,
    completedRequiredUnits,
    requiredUnitCount: required.length,
    structureUnitCount,
    readyUnitCount,
    firstReadyUnitId: firstReadyUnit?.id ?? null,
    unitOutline: [...lessonUnits]
      .sort((left, right) => (left.orderIndex ?? 0) - (right.orderIndex ?? 0))
      .map((unit) => ({
        id: unit.id ?? null,
        title: unit.title ?? "",
        contentSummary: unit.contentSummary ?? "",
        difficulty: unit.difficulty ?? "medium",
        orderIndex: unit.orderIndex ?? 0,
      })),
    learningMode: learningMode === "exploration" ? "exploration" : "mastery",
    requiresCognitiveModel,
    unlockedAt: module.unlockedAt?.toISOString() ?? null,
    generatedAt: module.generatedAt?.toISOString() ?? null,
    completedAt: module.completedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class GoalModulesService {
  constructor(
    @Inject(MODULE_GENERATION_RETRY_REPOSITORY)
    private readonly moduleGenerationRetry: ModuleGenerationRetryRepository,
    @Inject(EXPLORATION_CURRICULUM_READY_REPOSITORY)
    private readonly explorationCurriculumReady: ExplorationCurriculumReadyRepository,
    @Inject(MODULE_ENTRY_READINESS_READ_REPOSITORY)
    private readonly moduleEntryReadinessRead: ModuleEntryReadinessReadRepository,
    private readonly learningSpaceOrm: LearningSpaceOrmProvider,
  ) {}

  private async requireGoal(userId: string, goalId: string) {
    const goal = await this.learningSpaceOrm.learningGoal.findOwnedById(
      userId,
      goalId,
    );
    if (!goal) throw new NotFoundException(tBackend("error.goal.notFound"));
    return goal;
  }

  async getMasterySummary(userId: string, goalId: string, moduleId: string) {
    await this.requireGoal(userId, goalId);
    const module = await this.learningSpaceOrm.goalModuleRead.findModule(
      goalId,
      moduleId,
    );
    if (!module)
      throw new NotFoundException(tBackend("error.goal.unitNotFound"));
    return getModuleMasterySummary(
      this.learningSpaceOrm.masterySummaryRead,
      userId,
      goalId,
      moduleId,
    );
  }

  async getJourney(userId: string, goalId: string) {
    const goal = await this.requireGoal(userId, goalId);
    if (goal.learningMode === "exploration") {
      await this.explorationCurriculumReady!.ensureOwned({ userId, goalId });
    } else {
      await enqueueInitialModuleKacomOnGoalOpen(
        goalId,
        this.learningSpaceOrm!.moduleStructureQueue,
        this.learningSpaceOrm!.cognitiveModelInvalidation,
      );
    }
    const modules =
      await this.learningSpaceOrm.goalModuleRead.listJourney(goalId);
    for (const module of modules) {
      await healDemotedUnitStatuses(
        module.units,
        this.learningSpaceOrm!.learningUnit,
      );
    }
    const serialized = modules.map((module) =>
      serializeModule(module, goal.learningMode),
    );
    const completedModuleCount = serialized.filter(
      (module) => module.status === "completed",
    ).length;
    const current =
      serialized.find((module) =>
        ["active", "generating", "failed"].includes(module.status),
      ) ?? null;
    return {
      curriculumVersion: goal.curriculumVersion,
      modules: serialized,
      currentModuleId: current?.id ?? null,
      journeyProgress: {
        completedModuleCount,
        totalModuleCount: serialized.length,
        progressPercent:
          serialized.length > 0
            ? Math.round((completedModuleCount / serialized.length) * 100)
            : 0,
      },
    };
  }

  async getModule(
    userId: string,
    goalId: string,
    moduleId: string,
  ): Promise<{ module: Record<string, unknown> }> {
    const goal = await this.requireGoal(userId, goalId);
    if (goal.learningMode === "exploration") {
      await this.explorationCurriculumReady!.ensureOwned({ userId, goalId });
    } else {
      await enqueueInitialModuleKacomOnGoalOpen(
        goalId,
        this.learningSpaceOrm!.moduleStructureQueue,
        this.learningSpaceOrm!.cognitiveModelInvalidation,
      );
    }
    let module = await this.learningSpaceOrm.goalModuleRead.findDetail(
      goalId,
      moduleId,
    );
    if (!module)
      throw new NotFoundException(tBackend("error.goal.unitNotFound"));
    if (
      goal.learningMode !== "exploration" &&
      module.unlockStatus !== "locked" &&
      module.generationStatus === "building"
    ) {
      const lessonUnits = (module.units ?? []).filter(
        (unit: { unitKind: string }) => unit.unitKind === "lesson",
      );
      const allLessonsExpanded =
        lessonUnits.length > 0 &&
        lessonUnits.every(
          (unit: { cognitiveModelStatus?: string | null }) =>
            unit.cognitiveModelStatus === "expanded",
        );
      if (allLessonsExpanded) {
        await reconcileReadySequentialModules(
          this.learningSpaceOrm!.goalModuleRead,
          goalId,
        );
        module = await this.learningSpaceOrm.goalModuleRead.findDetail(
          goalId,
          moduleId,
        );
        if (!module)
          throw new NotFoundException(tBackend("error.goal.unitNotFound"));
      }
    }
    await healDemotedUnitStatuses(
      module.units ?? [],
      this.learningSpaceOrm!.learningUnit,
    );
    const requiresCognitiveModel = goal.learningMode !== "exploration";
    const foundationQueued = requiresCognitiveModel
      ? await ensureModuleEntryFoundationsQueued(
          { userId, goalId, moduleId },
          this.learningSpaceOrm!.moduleEntryFoundationQueue,
        )
      : false;
    if (foundationQueued) return this.getModule(userId, goalId, moduleId);
    const summary = serializeModule(module, goal.learningMode);
    const entryReadiness = requiresCognitiveModel
      ? await getModuleEntryReadiness(
          {
            userId,
            goalId,
            moduleId,
          },
          this.moduleEntryReadinessRead,
        )
      : {
          status: "not_applicable" as const,
          checkAvailable: false,
          bridgeUnitId: null,
          foundations: [],
        };
    // Structure + lesson list become visible as soon as the module is unlocked;
    // full capability coverage still waits for generationStatus === "ready".
    const exposeUnits = module.unlockStatus !== "locked";
    const exposeCapabilities =
      exposeUnits && module.generationStatus === "ready";
    const sectionManifests = new Map(
      exposeUnits
        ? await Promise.all(
            (module.units ?? [])
              .filter((unit: any) => unit.unitKind === "lesson")
              .map(
                async (unit: any) =>
                  [
                    unit.id,
                    await getUnitSectionManifest(userId, unit.id),
                  ] as const,
              ),
          )
        : [],
    );
    return {
      module: {
        ...summary,
        capabilities: exposeCapabilities
          ? module.learningTargets
              .filter((mapping: any) => mapping.role === "exit")
              .map((mapping: any, index: number) => {
                const practice = pickPracticeUnit(module.units ?? [], index);
                return {
                  id: mapping.learningTargetId,
                  localRef: mapping.localRef,
                  title: mapping.learningTarget.title,
                  objective: mapping.learningTarget.learningObjective,
                  required: mapping.required,
                  practiceUnitId: practice?.practiceUnitId ?? null,
                  practiceUnitTitle: practice?.practiceUnitTitle ?? null,
                };
              })
          : [],
        entryReadiness,
        units: exposeUnits
          ? (module.units ?? []).map((unit: any) => ({
              id: unit.id,
              moduleId: unit.moduleId,
              title: unit.title,
              status: unit.status,
              unitKind: unit.unitKind,
              parentUnitId: unit.parentUnitId,
              orderIndex: unit.orderIndex,
              difficulty: unit.difficulty,
              prerequisites: unit.prerequisites,
              contentSummary: unit.contentSummary,
              moduleCapabilityRefs: unit.moduleCapabilityRefs,
              moduleMilestoneRole: unit.moduleMilestoneRole,
              requiredForModuleCompletion: unit.requiredForModuleCompletion,
              supportKind: unit.supportKind,
              supportForUnitId: unit.supportForUnitId,
              cognitiveModelStatus: unit.cognitiveModelStatus,
              learnable: isStartableUnit(unit, requiresCognitiveModel),
              completionMethod: unit.completionMethod,
              completedAt: unit.completedAt?.toISOString() ?? null,
              skippedAt: unit.skippedAt?.toISOString() ?? null,
              nextReviewAt:
                unit.reviewCard?.nextReviewAt?.toISOString() ?? null,
              reviewIntervalDays: unit.reviewCard?.intervalDays ?? null,
              sections: sectionManifests.get(unit.id) ?? [],
            }))
          : [],
      },
    };
  }

  async getCognitiveModel(
    userId: string,
    goalId: string,
    moduleId: string,
    view: "capabilities" | "targets" | "full",
  ) {
    await this.requireGoal(userId, goalId);
    const module = await this.learningSpaceOrm.goalModuleRead.findCognitive(
      userId,
      goalId,
      moduleId,
    );
    if (!module)
      throw new NotFoundException(tBackend("error.goal.unitNotFound"));
    if (
      module.unlockStatus === "locked" ||
      module.generationStatus !== "ready"
    ) {
      throw new ConflictException({
        code:
          module.unlockStatus === "locked"
            ? "MODULE_LOCKED"
            : "MODULE_GENERATING",
        message:
          module.unlockStatus === "locked"
            ? tBackend("error.goal.moduleLocked")
            : tBackend("error.goal.moduleBuilding"),
      });
    }

    const presentRequirement = (requirement: {
      dimension: string;
      threshold: number;
      required: boolean;
      gate: boolean;
      weight: number;
      cognitiveEntity: {
        id: string;
        stableKey: string;
        kind: string;
        title: string;
        description: string;
        atom: unknown;
        construct: unknown;
        learnerStates: Array<{
          estimate: number | null;
          evidenceSufficiency: number;
          status: string;
          dimensions: Array<{
            dimension: string;
            estimate: number | null;
            evidenceSufficiency: number;
            status: string;
          }>;
        }>;
      };
    }) => {
      const entityState = requirement.cognitiveEntity.learnerStates[0] ?? null;
      const state =
        entityState?.dimensions.find(
          (candidate) => candidate.dimension === requirement.dimension,
        ) ?? null;
      return {
        cognitiveEntityId: requirement.cognitiveEntity.id,
        dimension: requirement.dimension,
        threshold: requirement.threshold,
        required: requirement.required,
        gate: requirement.gate,
        weight: requirement.weight,
        estimate: state?.estimate ?? null,
        evidenceSufficiency: state?.evidenceSufficiency ?? 0,
        stateStatus: state?.status ?? "unobserved",
      };
    };
    const presentTarget = (
      mapping: (typeof module.learningTargets)[number],
      capabilityIndex: number,
    ) => {
      const practice = pickPracticeUnit(module.units ?? [], capabilityIndex);
      return presentModuleCapability({
        id: mapping.learningTargetId,
        localRef: mapping.localRef,
        title: mapping.learningTarget.title,
        description: mapping.learningTarget.explanation,
        learningObjective: mapping.learningTarget.learningObjective,
        assessmentCriteria: mapping.learningTarget.assessmentCriteria,
        importance: mapping.learningTarget.importance,
        targetCognitiveLevel: mapping.learningTarget.targetCognitiveLevel,
        required: mapping.required,
        requirements: (mapping.learningTarget.requirements ?? []).map(
          presentRequirement,
        ),
        practiceUnitId: practice?.practiceUnitId ?? null,
        practiceUnitTitle: practice?.practiceUnitTitle ?? null,
      });
    };
    const capabilities = module.learningTargets
      .filter((mapping: any) => mapping.role === "exit")
      .map(presentTarget);
    if (view === "capabilities") {
      return {
        goalId,
        moduleId,
        view,
        capabilities,
      };
    }

    const unitTargets = (module.units ?? []).flatMap((unit: any) =>
      (unit.learningTargets ?? []).map((mapping: any) => ({
        unitId: unit.id,
        unitTitle: unit.title,
        mapping,
      })),
    );
    const targets = unitTargets.map(({ unitId, unitTitle, mapping }: any) => {
      const requirements = (mapping.learningTarget.requirements ?? []).map(
        presentRequirement,
      );
      return {
        id: mapping.learningTargetId,
        unitId,
        unitTitle,
        localRef: mapping.localRef,
        title: mapping.learningTarget.title,
        learningObjective: mapping.learningTarget.learningObjective,
        role: mapping.role,
        isEntry: mapping.isEntry,
        isExit: mapping.isExit,
        requirements,
      };
    });
    if (view === "targets") {
      return { goalId, moduleId, view, capabilities, targets };
    }

    const entityById = new Map<
      string,
      {
        id: string;
        stableKey: string;
        kind: string;
        title: string;
        description: string;
        atom: unknown;
        construct: unknown;
        state: unknown;
      }
    >();
    for (const target of [
      ...module.learningTargets.map((mapping: any) => mapping.learningTarget),
      ...unitTargets.map(({ mapping }: any) => mapping.learningTarget),
    ]) {
      for (const requirement of target.requirements ?? []) {
        const entity = requirement.cognitiveEntity;
        entityById.set(entity.id, {
          id: entity.id,
          stableKey: entity.stableKey,
          kind: entity.kind,
          title: entity.title,
          description: entity.description,
          atom: entity.atom,
          construct: entity.construct,
          state: entity.learnerStates[0] ?? null,
        });
      }
    }
    const entityIds = [...entityById.keys()];
    const relations =
      await this.learningSpaceOrm.goalModuleRead.listActiveRelations(entityIds);
    return {
      goalId,
      moduleId,
      view,
      capabilities,
      targets,
      entities: [...entityById.values()],
      relations,
    };
  }

  async retryGeneration(userId: string, goalId: string, moduleId: string) {
    await this.requireGoal(userId, goalId);
    try {
      const entryFoundationQueued = await ensureModuleEntryFoundationsQueued(
        {
          userId,
          goalId,
          moduleId,
        },
        this.learningSpaceOrm!.moduleEntryFoundationQueue,
      );
      const generation = await this.moduleGenerationRetry!.retryOwned({
        userId,
        goalId,
        moduleId,
      });
      return { ...generation, entryFoundationQueued };
    } catch (error) {
      if (error instanceof Error && error.message === "MODULE_LOCKED") {
        throw new ConflictException({
          code: "MODULE_LOCKED",
          message: tBackend("error.goal.moduleLocked"),
        });
      }
      throw error;
    }
  }

  async replanLockedModules(
    userId: string,
    goalId: string,
    moduleId: string,
    body: { adjustment?: string; runId?: string },
  ) {
    const goal = await this.requireGoal(userId, goalId);
    const selected = await this.learningSpaceOrm.goalModuleRead.findModule(
      goalId,
      moduleId,
    );
    if (!selected)
      throw new NotFoundException(tBackend("error.goal.unitNotFound"));
    if (selected.unlockStatus !== "locked") {
      throw new ConflictException({
        code: "MODULE_LOCKED",
        message: tBackend("error.goal.futureModulesOnly"),
      });
    }
    return handleTrackedStreamPost(
      { runId: body.runId },
      {
        scope: "goal",
        scopeId: goalId,
        operation: "goal.curriculum.replan",
      },
      async (ctx) => {
        const modules =
          await this.learningSpaceOrm.goalModuleRead.listForReplan(goalId);
        const prefix = modules.filter(
          (module) => module.orderIndex < selected.orderIndex,
        );
        const suffix = modules.filter(
          (module) => module.orderIndex >= selected.orderIndex,
        );
        if (suffix.some((module) => module.unlockStatus !== "locked")) {
          throw new ConflictException({
            code: "MODULE_LOCKED",
            message: tBackend("error.goal.approvedModuleReadonly"),
          });
        }
        await ctx.send({
          type: "status",
          phase: "plan",
          message: tBackend("status.goal.replanningModules"),
        });
        const generationOptions = [
          goal.generationOptions,
          `Immutable prefix (copy its dependency assumptions; never alter):\n${prefix
            .map(
              (module, index) =>
                `${index + 1}. ${module.title}: ${module.objective}\nEntry foundations: ${JSON.stringify(module.entryFoundationBriefs)}`,
            )
            .join("\n")}`,
          `Replan exactly ${suffix.length} future module stubs beginning at module ${selected.orderIndex + 1}.`,
          body.adjustment?.trim()
            ? `Learner adjustment: ${body.adjustment.trim()}`
            : "",
        ]
          .filter(Boolean)
          .join("\n\n");
        await resolveTeachingSkillForGoal({
          goalId,
          title: goal.title,
          level: goal.level,
          generationOptions,
        });
        const teachingSkill = await loadTeachingSkillPrompt(
          goalId,
          "goal_plan",
          `${goal.title} ${generationOptions}`,
        );
        const plan = await planGoalMapStream({
          operation: "goal.curriculum.replan",
          title: goal.title,
          level: goal.level,
          pathSource:
            goal.pathSource === "rag" || goal.pathSource === "search"
              ? goal.pathSource
              : "generic",
          contentLanguage: resolveGoalContentLanguage(
            goal.contentLanguage,
            goal.title,
          ),
          generationOptions,
          teachingSkillBlock: teachingSkill?.promptBlock,
          onToken: createTrackedTokenHandler(ctx),
          signal: ctx.signal,
        });
        const replacements = plan.modules?.slice(-suffix.length) ?? [];
        if (replacements.length !== suffix.length) {
          throw new Error("Future module plan count mismatch");
        }
        const stored = parseJson<Record<string, unknown>>(goal.mapPlanJson, {});
        const mapPlanJson = JSON.stringify({
          ...stored,
          schemaVersion: 2,
          modules: [
            ...prefix.map((module) => ({
              title: module.title,
              summary: module.summary,
              objective: module.objective,
              plannedOutcomes: module.plannedOutcomes,
              entryFoundationBriefs: module.entryFoundationBriefs,
              exitCapabilityBriefs: module.exitCapabilityBriefs,
              unitPlanningBrief: module.unitPlanningBrief,
              estimatedUnitCount: module.estimatedUnitCount,
              dependsOnPrevious: "",
            })),
            ...replacements,
          ],
        });
        const replacementsById = Object.fromEntries(
          suffix.map((current, index) => {
            const replacement = replacements[index];
            return [
              current.id,
              {
                title: replacement.title,
                summary: replacement.summary,
                objective: replacement.objective,
                plannedOutcomes: replacement.plannedOutcomes,
                entryFoundationBriefs: replacement.entryFoundationBriefs,
                exitCapabilityBriefs: replacement.exitCapabilityBriefs,
                unitPlanningBrief: replacement.unitPlanningBrief,
                estimatedUnitCount: replacement.estimatedUnitCount,
              },
            ];
          }),
        );
        const result =
          await this.learningSpaceOrm.lockedModuleReplanning.replanOwned({
            userId,
            goalId,
            replacements: replacementsById,
            mapPlanJson,
          });
        if (result.status === "goal_not_found") {
          throw new NotFoundException(tBackend("error.goal.notFound"));
        }
        if (result.status === "module_not_found") {
          throw new NotFoundException(tBackend("error.goal.unitNotFound"));
        }
        if (result.status === "module_not_locked") {
          throw new ConflictException({
            code: "MODULE_LOCKED",
            message: tBackend("error.goal.approvedModuleReadonly"),
          });
        }
        if (result.status !== "updated") {
          throw new Error("Future module replacement set is empty");
        }
        await ctx.send({
          type: "done",
          moduleId,
          modules: replacements,
        });
      },
    );
  }
}
