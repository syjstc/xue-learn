import { projectPathModule } from "../goal-creation/path-module-projection.js";
// @ts-nocheck -- unbound compatibility implementation; hosted callers use repositories.
import { createHash, randomUUID } from "node:crypto";
import type { Persistence, PersistenceClient } from "../persistence/persistence-compat.js";
import {
  COGNITIVE_MODEL_EXPAND_NEXT_EVENT,
  invalidateCognitiveModelForGoal,
} from "../cognitive-model/index.js";
import { gatherGoalPathContext } from "./goal-path-context.js";
import {
  MAX_MODULE_UNITS,
  MIN_MODULE_UNITS,
  type GoalMapPlan,
  type ModuleUnitPlanningBrief,
} from "../llm/schemas.js";
import {
  generateExplorationModuleStructure,
  generateModuleCapabilities,
  generateModuleStructure,
  moduleCapabilityProposalSchema,
  moduleCognitiveEntityBudget,
  moduleStructureProposalSchema,
  type ModuleCapabilityProposal,
} from "../llm/module-curriculum.js";
import { resolveGoalContentLanguage } from "../llm/content-language.js";
import { parseJson } from "../utils.js";
import { gatherDeepPlanningResearch } from "./deep-planning-research.js";
import { withOperationReasoning } from "../providers/llm/index.js";
import {
  mapPreparedMasteryPublication,
  normalizeModuleEntryFoundationBriefs,
  type ModuleGenerationLeaseRepository,
  type DeepPlanningResearchRepository,
  type PreparedModulePublicationRepository,
  type ExplorationModulePublicationRepository,
  type ModuleSliceReconciliationRepository,
  type CognitiveModelInvalidationRepository,
  type PlanningMode,
  type ModuleStructureQueueRepository,
} from "../../../domain/src/index.js";
import { withDeepPlanningResearchLease } from "../generation/deep-planning-research-concurrency.js";
import {
  loadTeachingSkillPrompt,
  resolveTeachingSkillForGoal,
} from "../teaching-skills/index.js";
import { goalCreationWorkGate } from "../agents/goal-creation/work-gate.js";

export const COURSE_MODULE_GENERATE_EVENT = "course.module.generate";
const MODULE_BUILD_LEASE_MS = 15 * 60 * 1000;
/** Match unit expansion lease in lifecycle.ts — stale building rows are re-armed. */
const UNIT_EXPANSION_LEASE_MS = 15 * 60 * 1000;

function invalidateGoalCognitiveModel(
  persistence: PersistenceClient,
  goalId: string,
  options: { reason?: string; enqueue?: boolean; force?: boolean },
  repository?: CognitiveModelInvalidationRepository,
) {
  return repository
    ? invalidateCognitiveModelForGoal(persistence, goalId, options, repository)
    : invalidateCognitiveModelForGoal(persistence, goalId, options);
}

function inputJson(value: unknown): Persistence.InputJsonValue {
  return value as Persistence.InputJsonValue;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) =>
      typeof item === "string" && item.trim() ? [item.trim()] : [],
    );
  }
  return [];
}

export function resolveMapOutcomeCount(mapPlanJson: unknown): number {
  const plan = parseJson<Partial<GoalMapPlan> | null>(mapPlanJson, null);
  return Math.max(1, stringArray(plan?.whatYouWillLearn).length);
}

function moduleUnitPlanningBrief(
  value: unknown,
  estimatedUnitCount: number,
  plannedOutcomes: string[],
  objective: string,
): ModuleUnitPlanningBrief {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const progression = stringArray(raw.progression).slice(0, 8);
  return {
    scopeSize:
      estimatedUnitCount >= 9
        ? "large"
        : estimatedUnitCount >= 4
          ? "standard"
          : "compact",
    rationale:
      typeof raw.rationale === "string" && raw.rationale.trim()
        ? raw.rationale.trim()
        : `Use ${estimatedUnitCount} focused lessons to reach: ${objective}`,
    progression:
      progression.length > 0
        ? progression
        : plannedOutcomes.length > 0
          ? plannedOutcomes.slice(0, 8)
          : [objective],
  };
}

async function persistGeneratedExplorationLessons(
  tx: Persistence.TransactionClient,
  module: { id: string; goalId: string; orderIndex: number },
  units: Array<{
    title: string;
    contentSummary: string;
    difficulty: "easy" | "medium" | "hard";
    milestoneRole: "introduce" | "practice" | "integrate" | "verify";
  }>,
) {
  let previousUnitId: string | null = null;
  for (const [index, unit] of units.entries()) {
    const created: { id: string } = await tx.learningUnit.create({
      data: {
        goalId: module.goalId,
        moduleId: module.id,
        parentUnitId: null,
        unitKind: "lesson",
        title: unit.title,
        orderIndex: index,
        difficulty: unit.difficulty,
        contentSummary: unit.contentSummary,
        planAreaRef: `a_${module.orderIndex + 1}`,
        planningOutcomeRefs: inputJson([]),
        moduleCapabilityRefs: inputJson([]),
        moduleMilestoneRole: unit.milestoneRole,
        prerequisites: JSON.stringify(previousUnitId ? [previousUnitId] : []),
        status: "available",
        cognitiveModelStatus: "expanded",
        requiredForModuleCompletion: true,
      },
      select: { id: true },
    });
    previousUnitId = created.id;
  }
  return units.length;
}

type PreparedMasteryModule = {
  capabilities: ModuleCapabilityProposal["capabilities"];
  structure: {
    units: Array<{
      title: string;
      contentSummary: string;
      difficulty: "easy" | "medium" | "hard";
      capabilityRefs: string[];
      milestoneRole: "introduce" | "practice" | "integrate" | "verify";
    }>;
    coverageRationale: string;
  };
};

function preparedMasteryModule(value: unknown): PreparedMasteryModule | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const prepared = (value as Record<string, unknown>).preparedMasteryModule;
  if (!prepared || typeof prepared !== "object" || Array.isArray(prepared)) {
    return null;
  }
  const raw = prepared as Record<string, unknown>;
  const capabilities = moduleCapabilityProposalSchema.safeParse({
    capabilities: raw.capabilities,
  });
  const structure = moduleStructureProposalSchema.safeParse(raw.structure);
  if (!capabilities.success || !structure.success) return null;
  return {
    capabilities: capabilities.data.capabilities,
    structure: structure.data,
  };
}

async function persistPreparedMasteryLessons(
  tx: Persistence.TransactionClient,
  module: { id: string; goalId: string; orderIndex: number },
  structure: PreparedMasteryModule["structure"],
) {
  let previousUnitId: string | null = null;
  for (const [index, unit] of structure.units.entries()) {
    const created: { id: string } = await tx.learningUnit.create({
      data: {
        goalId: module.goalId,
        moduleId: module.id,
        parentUnitId: null,
        unitKind: "lesson",
        title: unit.title,
        orderIndex: index,
        difficulty: unit.difficulty,
        contentSummary: unit.contentSummary,
        planAreaRef: `a_${module.orderIndex + 1}`,
        planningOutcomeRefs: inputJson([]),
        moduleCapabilityRefs: inputJson(unit.capabilityRefs),
        moduleMilestoneRole: unit.milestoneRole,
        prerequisites: JSON.stringify(previousUnitId ? [previousUnitId] : []),
        status: "available",
        cognitiveModelStatus: "pending",
        requiredForModuleCompletion: true,
      },
      select: { id: true },
    });
    previousUnitId = created.id;
  }
}

async function moduleSliceInputHash(
  persistence: PersistenceClient,
  module: {
    id: string;
    goalId: string;
    curriculumKey: string;
    orderIndex: number;
    title: string;
    objective: string;
    plannedOutcomes: unknown;
    unitPlanningBrief: unknown;
    entryFoundationBriefs: unknown;
    exitCapabilityBriefs: unknown;
  },
  goalInputHash: string,
): Promise<string> {
  const upstream = await persistence.learningModule.findMany({
    where: {
      goalId: module.goalId,
      orderIndex: { lt: module.orderIndex },
    },
    orderBy: { orderIndex: "asc" },
    select: {
      curriculumKey: true,
      generationVersion: true,
      generationInputHash: true,
      learningTargets: {
        orderBy: { orderIndex: "asc" },
        select: {
          localRef: true,
          learningTargetId: true,
          required: true,
          weight: true,
          learningTarget: {
            select: {
              definitionVersion: true,
              requirements: {
                orderBy: { orderIndex: "asc" },
                select: {
                  cognitiveEntityId: true,
                  dimension: true,
                  required: true,
                  gate: true,
                  threshold: true,
                  cognitiveEntity: {
                    select: { definitionVersion: true },
                  },
                },
              },
            },
          },
        },
      },
      units: {
        where: { unitKind: "lesson" },
        orderBy: { orderIndex: "asc" },
        select: {
          curriculumKey: true,
          learningTargets: {
            orderBy: { orderIndex: "asc" },
            select: {
              localRef: true,
              learningTargetId: true,
              required: true,
              weight: true,
              role: true,
            },
          },
        },
      },
    },
  });
  return moduleSliceInputHashFromUpstream(module, goalInputHash, upstream);
}

function moduleSliceInputHashFromUpstream(
  module: {
    curriculumKey: string;
    title: string;
    objective: string;
    plannedOutcomes: unknown;
    unitPlanningBrief: unknown;
    entryFoundationBriefs: unknown;
    exitCapabilityBriefs: unknown;
  },
  goalInputHash: string,
  upstream: readonly unknown[],
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        goalInputHash,
        module: {
          curriculumKey: module.curriculumKey,
          title: module.title,
          objective: module.objective,
          plannedOutcomes: module.plannedOutcomes,
          unitPlanningBrief: module.unitPlanningBrief,
          entryFoundationBriefs: module.entryFoundationBriefs,
          exitCapabilityBriefs: module.exitCapabilityBriefs,
        },
        upstream,
      }),
    )
    .digest("hex");
}

async function finalizePortableModuleGenerationHashes(params: {
  moduleGenerationLease: ModuleGenerationLeaseRepository;
  moduleSliceReconciliation: ModuleSliceReconciliationRepository;
  claimed: any;
  goalInputHash: string;
}): Promise<void> {
  const contexts = [...await params.moduleGenerationLease.loadGenerationHashContexts(params.claimed.goalId)]
    .sort((left, right) => Number(left.orderIndex) - Number(right.orderIndex));
  const source = contexts.find((module) => module.id === params.claimed.id);
  if (!source) throw new Error("Published module hash context is unavailable");
  const hashFor = (module: any) => moduleSliceInputHashFromUpstream(
    module,
    params.goalInputHash,
    contexts.filter((candidate) => Number(candidate.orderIndex) < Number(module.orderIndex)),
  );
  await params.moduleGenerationLease.setGenerationInputHash(source.id, hashFor(source));
  const downstream = contexts
    .filter((module) => Number(module.orderIndex) > Number(source.orderIndex))
    .map((module) => ({
      moduleId: String(module.id),
      expectedGenerationInputHash: module.generationInputHash == null ? null : String(module.generationInputHash),
      nextGenerationInputHash: hashFor(module),
    }))
    .filter((module) => module.expectedGenerationInputHash !== module.nextGenerationInputHash);
  if (downstream.length === 0) return;
  await params.moduleSliceReconciliation.reconcile({
    userId: String(params.claimed.goal.userId),
    goalId: String(params.claimed.goalId),
    goalInputHash: params.goalInputHash,
    modules: downstream,
    updatedAt: new Date(),
  });
}

/**
 * An upstream rebuild changes the identity context available to every later
 * module. Preserve the last-good published goal snapshot, but re-arm affected
 * downstream lesson slices so the candidate snapshot is rebuilt in order.
 */
export async function reconcileDownstreamModuleSlices(
  persistence: PersistenceClient,
  source: { goalId: string; orderIndex: number; userId?: string | null },
  goalInputHash: string,
  repository?: ModuleSliceReconciliationRepository,
): Promise<string[]> {
  const downstream = await persistence.learningModule.findMany({
    where: {
      goalId: source.goalId,
      orderIndex: { gt: source.orderIndex },
    },
    orderBy: { orderIndex: "asc" },
    select: {
      id: true,
      goalId: true,
      curriculumKey: true,
      orderIndex: true,
      title: true,
      objective: true,
      plannedOutcomes: true,
      unitPlanningBrief: true,
      entryFoundationBriefs: true,
      exitCapabilityBriefs: true,
      generationInputHash: true,
      generationStatus: true,
    },
  });
  const affected: Array<{
    module: (typeof downstream)[number];
    nextGenerationInputHash: string;
  }> = [];
  for (const module of downstream) {
    const expectedHash = await moduleSliceInputHash(
      persistence,
      module,
      goalInputHash,
    );
    if (module.generationInputHash === expectedHash) continue;
    affected.push({ module, nextGenerationInputHash: expectedHash });
  }
  if (repository && source.userId && affected.length > 0) {
    const result = await repository.reconcile({
      userId: source.userId,
      goalId: source.goalId,
      goalInputHash,
      modules: affected.map(({ module, nextGenerationInputHash }) => ({
        moduleId: module.id,
        expectedGenerationInputHash: module.generationInputHash,
        nextGenerationInputHash,
      })),
      updatedAt: new Date(),
    });
    return [...result.reconciledModuleIds];
  }
  for (const { module, nextGenerationInputHash } of affected) {
    await persistence.learningModule.update({
      where: { id: module.id },
      data: {
        generationInputHash: nextGenerationInputHash,
        generationStatus:
          module.generationStatus === "ready"
            ? "building"
            : module.generationStatus,
        generationError: "",
      },
    });
    await persistence.learningUnit.updateMany({
      where: { moduleId: module.id, unitKind: "lesson" },
      data: {
        cognitiveModelStatus: "pending",
        cognitiveModelBuildStartedAt: null,
        cognitiveModelBuildToken: null,
        cognitiveModelBuildInputHash: null,
      },
    });
  }
  return affected.map(({ module }) => module.id);
}

export async function persistSequentialModuleStubs(
  persistence: PersistenceClient,
  params: {
    goalId: string;
    plan: GoalMapPlan;
    /**
     * The interactive approval flow prepares every module before navigation
     * and therefore owns dispatch itself. Background/legacy callers retain
     * the original first-module enqueue behaviour.
     */
    enqueueFirst?: boolean;
  },
) {
  if (params.plan.schemaVersion !== 2 || !params.plan.modules?.length) {
    throw new Error("Sequential curriculum plan is missing module contracts");
  }
  const modules = params.plan.modules;
  const now = new Date();
  return persistence.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "LearningGoal" WHERE "id" = ${params.goalId} FOR UPDATE
    `;
    const goal = await tx.learningGoal.findUnique({
      where: { id: params.goalId },
      select: { learningMode: true },
    });
    if (!goal) throw new Error("Goal not found");
    const existingCount = await tx.learningModule.count({
      where: { goalId: params.goalId },
    });
    if (existingCount > 0) {
      const first = await tx.learningModule.findFirst({
        where: { goalId: params.goalId },
        orderBy: { orderIndex: "asc" },
      });
      return { created: false as const, firstModuleId: first?.id ?? null };
    }
    let firstModuleId: string | null = null;
    for (const [index, modulePlan] of modules.entries()) {
      const created = await tx.learningModule.create({
        data: {
          goalId: params.goalId,
          planRef: `m_${index + 1}`,
          orderIndex: index,
          title: modulePlan.title,
          summary: modulePlan.summary,
          objective: modulePlan.objective,
          plannedOutcomes: inputJson(modulePlan.plannedOutcomes),
          entryFoundationBriefs: inputJson(modulePlan.entryFoundationBriefs),
          entryFoundationStatus:
            modulePlan.entryFoundationBriefs.length > 0
              ? "pending"
              : "not_applicable",
          exitCapabilityBriefs: inputJson(modulePlan.exitCapabilityBriefs),
          estimatedUnitCount: modulePlan.estimatedUnitCount,
          unitPlanningBrief: inputJson(modulePlan.unitPlanningBrief),
          unlockStatus:
            goal.learningMode === "exploration" || index === 0
              ? "unlocked"
              : "locked",
          generationStatus: "pending",
          unlockedAt:
            goal.learningMode === "exploration" || index === 0 ? now : null,
          generatedAt: null,
        },
        select: { id: true },
      });
      if (index === 0) firstModuleId = created.id;
    }
    await tx.learningGoal.update({
      where: { id: params.goalId },
      data: {
        curriculumVersion: 2,
        mapPlanStatus: "approved",
        detailedPlanStatus: "ready",
      },
    });
    if (firstModuleId && params.enqueueFirst !== false) {
      await tx.eventOutbox.create({
        data: {
          type: COURSE_MODULE_GENERATE_EVENT,
          payload: JSON.stringify({
            goalId: params.goalId,
            moduleId: firstModuleId,
            reason: "plan_approved",
          }),
        },
      });
    }
    return { created: true as const, firstModuleId };
  });
}

/**
 * Queue every approved module for independent structure preparation. This is
 * deliberately separate from KACOM authorization: exploration modules become
 * directly learnable, while mastery modules only persist their lesson outline
 * and prepared capability contract until the learner opens the goal journey.
 */
export async function enqueueSequentialModuleStructures(
  persistence: PersistenceClient,
  goalId: string,
) {
  return persistence.$transaction(async (tx) => {
    const modules = await tx.learningModule.findMany({
      where: { goalId },
      orderBy: { orderIndex: "asc" },
      select: { id: true },
    });
    if (modules.length === 0) return { enqueuedCount: 0 };
    await tx.eventOutbox.createMany({
      data: modules.map((module) => ({
        type: COURSE_MODULE_GENERATE_EVENT,
        payload: JSON.stringify({
          goalId,
          moduleId: module.id,
          reason: "pre_goal_structure",
        }),
      })),
    });
    return { enqueuedCount: modules.length };
  });
}

/**
 * Opening the goal journey is the authorization boundary for the initial
 * mastery KACOM build. Structure preparation may still be queued or running;
 * the outbox ordering and module lease make the follow-up event idempotent.
 */
export async function enqueueInitialModuleKacomOnGoalOpen(
  goalId: string,
  repository: ModuleStructureQueueRepository,
  invalidation: CognitiveModelInvalidationRepository,
) {
  const result = await repository.enqueueInitialKacom(goalId);
  if (result.authorizeExpansion) {
    await invalidation.invalidate({
      goalId,
      reason: "goal_page_open",
      force: true,
    });
  }
  return result;
}

export async function ensureExplorationCurriculumReady(
  persistence: PersistenceClient,
  goalId: string,
): Promise<boolean> {
  return persistence.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "LearningGoal" WHERE "id" = ${goalId} FOR UPDATE
    `;
    const goal = await tx.learningGoal.findUnique({
      where: { id: goalId },
      select: { learningMode: true },
    });
    if (goal?.learningMode !== "exploration") return false;
    const modules = await tx.learningModule.findMany({
      where: { goalId },
      orderBy: { orderIndex: "asc" },
      include: {
        units: {
          where: { unitKind: "lesson" },
          select: { id: true, cognitiveModelStatus: true },
        },
      },
    });
    let changed = false;
    for (const module of modules) {
      if (
        module.units.length > 0 &&
        module.units.some((unit) => unit.cognitiveModelStatus !== "expanded")
      ) {
        await tx.learningUnit.updateMany({
          where: { moduleId: module.id, unitKind: "lesson" },
          data: {
            cognitiveModelStatus: "expanded",
            cognitiveModelBuildStartedAt: null,
            cognitiveModelBuildToken: null,
            cognitiveModelBuildInputHash: null,
          },
        });
        changed = true;
      }
      // Legacy exploration curricula may already have lesson rows but still
      // carry mastery-era generation state. Heal only those materialized
      // modules. Empty/locked stubs now remain lazy and are owned by the same
      // sequential module worker used for mastery goals.
      if (module.units.length > 0 && module.generationStatus !== "ready") {
        await tx.learningModule.update({
          where: { id: module.id },
          data: {
            generationStatus: "ready",
            generationBuildStartedAt: null,
            generationBuildToken: null,
            generationError: "",
            generatedAt: module.generatedAt ?? new Date(),
          },
        });
        changed = true;
      }
    }
    return changed;
  });
}

type ModuleGenerationPayload = {
  goalId?: string;
  moduleId?: string;
  reason?: string;
};

function parseModuleGenerationPayload(value: string): ModuleGenerationPayload {
  return parseJson<ModuleGenerationPayload>(value, {});
}

/**
 * Learner-facing recover for an unlocked module:
 * - `generationStatus === "failed"` → re-queue structure generation
 * - otherwise, re-arm failed / lease-stale lesson expands and enqueue expand_next
 *   (covers dead-lettered outbox work that left units locked as 准备中).
 *   Learner retry also nudges an unpublished expand that is not actively
 *   building, instead of returning a silent no-op.
 */
export async function enqueueModuleGenerationRetry(
  persistence: PersistenceClient,
  params: { goalId: string; moduleId: string },
) {
  return persistence.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "LearningModule" WHERE "id" = ${params.moduleId} FOR UPDATE
    `;
    const module = await tx.learningModule.findFirst({
      where: { id: params.moduleId, goalId: params.goalId },
      include: { goal: { select: { learningMode: true } } },
    });
    if (!module) throw new Error("Module not found");
    if (module.unlockStatus === "locked") {
      throw new Error("MODULE_LOCKED");
    }
    if (module.generationStatus === "failed") {
      await tx.learningModule.update({
        where: { id: module.id },
        data: {
          generationStatus: "pending",
          generationBuildStartedAt: null,
          generationBuildToken: null,
          generationError: "",
        },
      });
      await tx.eventOutbox.create({
        data: {
          type: COURSE_MODULE_GENERATE_EVENT,
          payload: JSON.stringify({
            goalId: params.goalId,
            moduleId: params.moduleId,
            reason: "manual_retry",
          }),
        },
      });
      return { enqueued: true as const, status: "pending" as const };
    }

    const lessons = await tx.learningUnit.findMany({
      where: { moduleId: module.id, unitKind: "lesson" },
      select: {
        id: true,
        cognitiveModelStatus: true,
        cognitiveModelBuildStartedAt: true,
      },
    });
    if (lessons.length === 0) {
      return { enqueued: false as const, status: module.generationStatus };
    }
    if (module.goal?.learningMode === "exploration") {
      await tx.learningUnit.updateMany({
        where: { moduleId: module.id, unitKind: "lesson" },
        data: {
          cognitiveModelStatus: "expanded",
          cognitiveModelBuildStartedAt: null,
          cognitiveModelBuildToken: null,
          cognitiveModelBuildInputHash: null,
        },
      });
      await tx.learningModule.update({
        where: { id: module.id },
        data: {
          generationStatus: "ready",
          generationBuildStartedAt: null,
          generationBuildToken: null,
          generationError: "",
        },
      });
      return { enqueued: false as const, status: "ready" as const };
    }

    const now = Date.now();
    const rearmIds = lessons
      .filter((unit) => {
        if (unit.cognitiveModelStatus === "failed") return true;
        if (unit.cognitiveModelStatus !== "building") return false;
        const started = unit.cognitiveModelBuildStartedAt?.getTime() ?? 0;
        return now - started >= UNIT_EXPANSION_LEASE_MS;
      })
      .map((unit) => unit.id);
    const incomplete = lessons.some(
      (unit) => unit.cognitiveModelStatus !== "expanded",
    );
    if (!incomplete && rearmIds.length === 0) {
      return { enqueued: false as const, status: module.generationStatus };
    }

    const activelyBuilding = lessons.some((unit) => {
      if (unit.cognitiveModelStatus !== "building") return false;
      const started = unit.cognitiveModelBuildStartedAt?.getTime() ?? 0;
      return now - started < UNIT_EXPANSION_LEASE_MS;
    });
    const liveExpand = await tx.eventOutbox.findFirst({
      where: {
        type: COGNITIVE_MODEL_EXPAND_NEXT_EVENT,
        publishedAt: null,
        deadLetteredAt: null,
        payload: { contains: `"goalId":"${params.goalId}"` },
      },
      select: { id: true, payload: true },
    });

    // Structure is already published. Drop a leftover publication lease so
    // recovery is not swallowed for 15 minutes with no LLM work.
    await tx.learningModule.update({
      where: { id: module.id },
      data: {
        generationBuildToken: null,
        generationBuildStartedAt: null,
      },
    });

    // Re-arm failed/stale rows for UI, but never stack a second expand_next on
    // top of an in-flight expand (that re-runs LLM prefix after a green
    // structured-output span when publish/outbox retry is active).
    if (rearmIds.length > 0) {
      await tx.learningUnit.updateMany({
        where: { id: { in: rearmIds } },
        data: {
          cognitiveModelStatus: "pending",
          cognitiveModelBuildStartedAt: null,
          cognitiveModelBuildToken: null,
          cognitiveModelBuildInputHash: null,
        },
      });
    }
    if (activelyBuilding) {
      return {
        enqueued: false as const,
        status: module.generationStatus,
        rearmed: rearmIds.length > 0,
      };
    }

    const goal = await tx.learningGoal.findUnique({
      where: { id: params.goalId },
      select: {
        cognitiveModelInputHash: true,
        cognitiveModelPublishedHash: true,
        cognitiveModelVersion: true,
      },
    });
    if (!goal) throw new Error("Goal not found");
    if (liveExpand) {
      const livePayload = parseJson<{
        inputHash?: string;
        baseModelVersion?: number;
      }>(
        typeof liveExpand.payload === "string"
          ? liveExpand.payload
          : JSON.stringify(liveExpand.payload ?? {}),
        {},
      );
      const stale =
        livePayload.inputHash !== goal.cognitiveModelInputHash ||
        livePayload.baseModelVersion !== goal.cognitiveModelVersion;
      await tx.eventOutbox.update({
        where: { id: liveExpand.id },
        data: {
          nextAttemptAt: new Date(),
          lastError: null,
          ...(stale
            ? {
                payload: JSON.stringify({
                  goalId: params.goalId,
                  inputHash: goal.cognitiveModelInputHash,
                  baseModelVersion: goal.cognitiveModelVersion,
                  reason: "manual_module_unit_recovery",
                }),
              }
            : {}),
        },
      });
      return {
        enqueued: true as const,
        status: "pending" as const,
        rearmed: rearmIds.length > 0,
        nudged: true as const,
      };
    }

    const goalStatus =
      goal.cognitiveModelPublishedHash === goal.cognitiveModelInputHash
        ? "building"
        : "needs_reconciliation";
    await tx.learningGoal.update({
      where: { id: params.goalId },
      data: { cognitiveModelStatus: goalStatus },
    });
    if (module.generationStatus === "ready") {
      // Keep capability views gated until the recovered lesson expands again.
      await tx.learningModule.update({
        where: { id: module.id },
        data: {
          generationStatus: "building",
          generationError: "",
        },
      });
    }
    await tx.eventOutbox.create({
      data: {
        type: COGNITIVE_MODEL_EXPAND_NEXT_EVENT,
        payload: JSON.stringify({
          goalId: params.goalId,
          inputHash: goal.cognitiveModelInputHash,
          baseModelVersion: goal.cognitiveModelVersion,
          reason: "manual_module_unit_recovery",
        }),
      },
    });
    return { enqueued: true as const, status: "pending" as const };
  });
}

export type CourseModuleGenerationResult = {
  goalId: string;
  moduleId: string;
  status: "deferred" | "ignored" | "structure_ready";
};

export async function processCourseModuleGenerationEvent(params: {
  /** @deprecated Unbound compatibility only; hosted workers omit it. */
  persistence?: PersistenceClient;
  payloadJson: string;
  allowExpensiveWork?: boolean;
  moduleGenerationLease: ModuleGenerationLeaseRepository;
  deepPlanningResearch: DeepPlanningResearchRepository;
  preparedModulePublication: PreparedModulePublicationRepository;
  explorationModulePublication: ExplorationModulePublicationRepository;
  moduleSliceReconciliation: ModuleSliceReconciliationRepository;
  cognitiveModelInvalidation: CognitiveModelInvalidationRepository;
}): Promise<CourseModuleGenerationResult> {
  const payload = parseModuleGenerationPayload(params.payloadJson);
  if (!payload.goalId || !payload.moduleId) {
    throw new Error("Module generation event is missing goalId/moduleId");
  }
  const creationGate = await goalCreationWorkGate(payload.goalId);
  if (creationGate === "stopped") {
    return {
      goalId: payload.goalId,
      moduleId: payload.moduleId,
      status: "ignored",
    };
  }
  if (params.allowExpensiveWork === false) {
    return {
      goalId: payload.goalId,
      moduleId: payload.moduleId,
      status: "deferred",
    };
  }
  const token = randomUUID();
  const now = new Date();
  const preparingBeforeNavigation = payload.reason === "pre_goal_structure";
  const lease = await params.moduleGenerationLease.claim({
          goalId: payload.goalId,
          moduleId: payload.moduleId,
          token,
          startedAt: now,
          allowLockedBeforeNavigation: preparingBeforeNavigation,
        });
  const claimed:any = lease.claimed
    ? await params.moduleGenerationLease.loadContext({goalId:payload.goalId,moduleId:payload.moduleId,priorEntityLimit:64})
    : null;
  if (!claimed) {
    const context = await params.moduleGenerationLease.loadContext({
      goalId: payload.goalId,
      moduleId: payload.moduleId,
      priorEntityLimit: 1,
    });
    return {
      goalId: payload.goalId,
      moduleId: payload.moduleId,
      status:
        String(context?.generationStatus ?? "") === "building"
          ? "deferred"
          : "ignored",
    };
  }

  try {
    const existingUnitCount = claimed.existingUnitCount;
    const plannedModule = projectPathModule(
      claimed.unitPlanningBrief,
      claimed.goal.contentLanguage || "en",
    );
    const preparedMastery = plannedModule ?? preparedMasteryModule(claimed.unitPlanningBrief);
    const moduleTargetCount =
      existingUnitCount > 0 && claimed.goal.learningMode !== "exploration"
        ? claimed.moduleTargetCount
        : 0;
    if (
      existingUnitCount > 0 &&
      !(preparedMastery && moduleTargetCount === 0)
    ) {
      if (claimed.goal.learningMode === "exploration") {
        await params.moduleGenerationLease.markExistingExplorationReady(claimed.id);
        return {
          goalId: claimed.goalId,
          moduleId: claimed.id,
          status: "structure_ready",
        };
      }
      await params.moduleGenerationLease.rearmFailedUnits(claimed.id);
      const invalidation = await params.cognitiveModelInvalidation.invalidate({goalId:claimed.goalId,reason:"sequential_module_generation_retry",force:true});
      await finalizePortableModuleGenerationHashes({moduleGenerationLease:params.moduleGenerationLease,moduleSliceReconciliation:params.moduleSliceReconciliation,claimed,goalInputHash:invalidation.inputHash});
      return {
        goalId: claimed.goalId,
        moduleId: claimed.id,
        status: "structure_ready",
      };
    }
    const moduleEntityBudget = moduleCognitiveEntityBudget(
      claimed.estimatedUnitCount,
    );
    const planningMode =
      (claimed.goal as { planningMode?: PlanningMode }).planningMode ?? "fast";
    const [priorModules, priorEntities, pathContext] = await Promise.all([
      Promise.resolve(claimed.priorModules),
      Promise.resolve(claimed.priorEntities.slice(0,moduleEntityBudget.maximumWorkingSet-moduleEntityBudget.maximumNew)),
      gatherGoalPathContext({
        goalId: claimed.goalId,
        title: claimed.goal.title,
        allowWebSearch: false,
        uploadedDocumentsOnly: planningMode === "docs_first",
        searchPurpose: "map",
      }),
    ]);
    const priorModuleSummary = priorModules
      .map(
        (module: any, index: number) =>
          `${index + 1}. ${module.title}: ${module.objective || module.summary}`,
      )
      .join("\n");
    const priorCognitiveContext = priorEntities
      .map(
        (entity: any) =>
          `${entity.kind} | ${entity.stableKey} | ${entity.title}: ${entity.description}`,
      )
      .join("\n");
    const contentLanguage = resolveGoalContentLanguage(
      claimed.goal.contentLanguage,
      claimed.goal.title,
    );
    await resolveTeachingSkillForGoal({
      goalId: claimed.goalId,
      title: claimed.goal.title,
      level: claimed.goal.level,
      generationOptions: claimed.goal.generationOptions,
      sourceSummary: pathContext.context,
    });
    const teachingSkill = await loadTeachingSkillPrompt(
      claimed.goalId,
      "module_units",
      `${claimed.goal.title} ${claimed.title} ${claimed.objective}`,
    );
    const moduleUserId = claimed.goal.userId;
    let moduleSourceContext = pathContext.context;
    if (planningMode === "deep" && moduleUserId && !preparedMastery) {
      if (!params.deepPlanningResearch) {
        throw new Error("Deep planning research persistence is unavailable");
      }
      const research = await withDeepPlanningResearchLease(
        params.deepPlanningResearch,
        {
          ownerKey: `module-build:${claimed.id}`,
          goalId: claimed.goalId,
          moduleKey: claimed.curriculumKey,
        },
        () =>
          gatherDeepPlanningResearch({
            userId: moduleUserId,
            goalId: claimed.goalId,
            title: claimed.goal.title,
            scope: "module",
            moduleTitle: claimed.title,
            moduleRef: claimed.curriculumKey,
          }),
      );
      moduleSourceContext = [moduleSourceContext, research.context]
        .filter(Boolean)
        .join("\n\n---\n\n");
    }
    if (claimed.goal.learningMode === "exploration") {
      const generateExplorationStructure = () =>
        generateExplorationModuleStructure({
          goalTitle: claimed.goal.title,
          goalLevel: claimed.goal.level,
          moduleTitle: claimed.title,
          moduleSummary: claimed.summary,
          moduleObjective: claimed.objective,
          priorModuleSummary,
          sourceContext: moduleSourceContext,
          generationOptions: claimed.goal.generationOptions,
          contentLanguage,
          teachingSkillBlock: teachingSkill?.promptBlock,
        });
      const explorationStructure =
        plannedModule ? plannedModule.structure : planningMode === "deep"
          ? await withOperationReasoning(true, generateExplorationStructure)
          : await generateExplorationStructure();
      if (moduleUserId) {
        await params.explorationModulePublication.publish({
          userId: moduleUserId,
          goalId: claimed.goalId,
          moduleId: claimed.id,
          generationBuildToken: token,
          orderIndex: claimed.orderIndex,
          units: explorationStructure.units,
          publishedAt: new Date(),
        });
      } else if (params.persistence) {
        await params.persistence.$transaction(async (tx) => {
          await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "LearningModule" WHERE "id" = ${claimed.id} FOR UPDATE
          `;
          const current = await tx.learningModule.findUnique({
            where: { id: claimed.id },
            select: { generationBuildToken: true },
          });
          if (current?.generationBuildToken !== token) {
            throw new Error("Module generation lease was superseded");
          }
          const currentUnitCount = await tx.learningUnit.count({
            where: { moduleId: claimed.id },
          });
          if (currentUnitCount > 0) {
            throw new Error("Module retry requires candidate cleanup");
          }
          await persistGeneratedExplorationLessons(
            tx,
            claimed,
            explorationStructure.units,
          );
          await tx.learningModule.update({
            where: { id: claimed.id },
            data: {
              generationStatus: "ready",
              generationVersion: { increment: 1 },
              entryFoundationStatus: "not_applicable",
              entryFoundationError: "",
              generationBuildToken: null,
              generationBuildStartedAt: null,
              generationError: "",
              generatedAt: new Date(),
            },
          });
        });
      }
      return {
        goalId: claimed.goalId,
        moduleId: claimed.id,
        status: "structure_ready",
      };
    }
    const generateCapabilities = () =>
      generateModuleCapabilities({
        goalTitle: claimed.goal.title,
        moduleTitle: claimed.title,
        moduleObjective: claimed.objective,
        moduleSummary: claimed.summary,
        priorModuleSummary,
        contentLanguage,
        teachingSkillBlock: teachingSkill?.promptBlock,
      });
    const capabilityResult = preparedMastery
      ? { capabilities: preparedMastery.capabilities }
      : planningMode === "deep"
        ? await withOperationReasoning(true, generateCapabilities)
        : await generateCapabilities();
    const generateStructure = () =>
      generateModuleStructure({
        goalTitle: claimed.goal.title,
        goalLevel: claimed.goal.level,
        moduleTitle: claimed.title,
        moduleSummary: claimed.summary,
        moduleObjective: claimed.objective,
        capabilities: capabilityResult.capabilities,
        priorModuleSummary,
        priorCognitiveContext,
        sourceContext: moduleSourceContext,
        generationOptions: claimed.goal.generationOptions,
        contentLanguage,
        teachingSkillBlock: teachingSkill?.promptBlock,
      });
    const structure = preparedMastery
      ? preparedMastery.structure
      : planningMode === "deep"
        ? await withOperationReasoning(true, generateStructure)
        : await generateStructure();
    const published = mapPreparedMasteryPublication({
      moduleCurriculumKey: claimed.curriculumKey,
      entryFoundationBriefs: claimed.entryFoundationBriefs,
      capabilities: capabilityResult.capabilities,
      units: structure.units,
      coverageRationale: structure.coverageRationale,
    });
    const moduleObjectiveAuthority = published.authority;

    if (preparingBeforeNavigation) {
      const originalBrief =
        claimed.unitPlanningBrief &&
        typeof claimed.unitPlanningBrief === "object" &&
        !Array.isArray(claimed.unitPlanningBrief)
          ? (claimed.unitPlanningBrief as Record<string, unknown>)
          : {};
      if (claimed.goal.userId) {
        await params.preparedModulePublication.publish({
          userId: claimed.goal.userId,
          goalId: claimed.goalId,
          moduleId: claimed.id,
          generationBuildToken: token,
          capabilities: capabilityResult.capabilities,
          structure,
          baseUnitPlanningBrief: originalBrief,
          publishedAt: new Date(),
        });
      } else if (params.persistence) {
        await params.persistence.$transaction(async (tx) => {
          await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "LearningModule" WHERE "id" = ${claimed.id} FOR UPDATE
          `;
          const current = await tx.learningModule.findUnique({
            where: { id: claimed.id },
            select: { generationBuildToken: true },
          });
          if (current?.generationBuildToken !== token) {
            throw new Error("Module generation lease was superseded");
          }
          const currentUnitCount = await tx.learningUnit.count({
            where: { moduleId: claimed.id },
          });
          if (currentUnitCount === 0) {
            await persistPreparedMasteryLessons(tx, claimed, structure);
          }
          await tx.learningModule.update({
            where: { id: claimed.id },
            data: {
              unitPlanningBrief: inputJson({
                ...originalBrief,
                preparedMasteryModule: {
                  capabilities: capabilityResult.capabilities,
                  structure,
                },
              }),
              generationStatus: "pending",
              generationVersion: { increment: 1 },
              generationBuildToken: null,
              generationBuildStartedAt: null,
              generationError: "",
              generatedAt: new Date(),
            },
          });
        });
      }
      return {
        goalId: claimed.goalId,
        moduleId: claimed.id,
        status: "structure_ready",
      };
    }

    if (!claimed.goal.userId) throw new Error("Module owner is unavailable");
    await params.preparedModulePublication.publishMastery({
      userId: claimed.goal.userId,
      goalId: claimed.goalId,
      moduleId: claimed.id,
      generationBuildToken: token,
      orderIndex: claimed.orderIndex,
      curriculumKey: claimed.curriculumKey,
      contentLanguage,
      mapOutcomeCount: resolveMapOutcomeCount(claimed.goal.mapPlanJson),
      preparedExisting: Boolean(preparedMastery),
      publishedAt: now,
      units: published.units,
      foundations: published.foundations,
      capabilities: published.capabilities,
    });
    const portableInvalidation = await params.cognitiveModelInvalidation.invalidate({
      goalId: claimed.goalId,
      reason: "sequential_module_structure_ready",
      force: Boolean(preparedMastery),
    });
    await finalizePortableModuleGenerationHashes({
      moduleGenerationLease: params.moduleGenerationLease,
      moduleSliceReconciliation: params.moduleSliceReconciliation,
      claimed,
      goalInputHash: portableInvalidation.inputHash,
    });
    return {
      goalId: claimed.goalId,
      moduleId: claimed.id,
      status: "structure_ready",
    };

    await params.persistence!.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "LearningModule" WHERE "id" = ${claimed.id} FOR UPDATE
      `;
      const current = await tx.learningModule.findUnique({
        where: { id: claimed.id },
        select: { generationBuildToken: true },
      });
      if (current?.generationBuildToken !== token) {
        throw new Error("Module generation lease was superseded");
      }
      const existingUnits = await tx.learningUnit.count({
        where: { moduleId: claimed.id },
      });
      if (existingUnits > 0 && !preparedMastery) {
        throw new Error("Module retry requires candidate cleanup");
      }

      const foundationTargets: Array<{
        id: string;
        entityId: string;
        localRef: string;
        critical: boolean;
      }> = [];
      const foundations = normalizeModuleEntryFoundationBriefs(
        claimed.entryFoundationBriefs,
      );
      for (const [index, foundation] of foundations.entries()) {
        const localRef = `entry_${index + 1}`;
        const entityAuthority = moduleObjectiveAuthority.entities[index]!;
        const targetAuthority = moduleObjectiveAuthority.targets[index]!;
        const entityStableKey = entityAuthority.stableKey;
        const entity = await tx.cognitiveEntity.upsert({
          where: {
            goalId_stableKey: {
              goalId: claimed.goalId,
              stableKey: entityStableKey,
            },
          },
          create: {
            goalId: claimed.goalId,
            scopeKey: `goal:${claimed.goalId}`,
            stableKey: entityStableKey,
            kind: "atom",
            title: foundation.title,
            description: foundation.rationale,
            language: contentLanguage,
            provenance: inputJson({
              source: "module.entry_foundation",
              moduleCurriculumKey: claimed.curriculumKey,
              planningRef: foundation.ref,
              unverifiedPlanningAssumption: true,
            }),
          },
          update: {
            title: foundation.title,
            description: foundation.rationale,
            status: "active",
          },
        });
        await tx.knowledgeAtom.upsert({
          where: { entityId: entity.id },
          create: {
            entityId: entity.id,
            atomType: "conditional",
            statement: foundation.title,
            explanation: foundation.rationale,
            assessmentHints: inputJson([
              `Verify ${foundation.verificationDimensions.join(", ")}`,
            ]),
          },
          update: {
            statement: foundation.title,
            explanation: foundation.rationale,
            assessmentHints: inputJson([
              `Verify ${foundation.verificationDimensions.join(", ")}`,
            ]),
          },
        });
        const target = await tx.learningTarget.upsert({
          where: {
            goalId_stableKey: {
              goalId: claimed.goalId,
              stableKey: targetAuthority.stableKey,
            },
          },
          create: {
            goalId: claimed.goalId,
            stableKey: targetAuthority.stableKey,
            title: foundation.title,
            explanation: foundation.rationale,
            learningObjective: `Independently demonstrate the entry foundation: ${foundation.title}`,
            assessmentCriteria: inputJson([
              {
                ref: `${localRef}:c1`,
                text: foundation.rationale,
              },
            ]),
            language: contentLanguage,
            importance:
              foundation.criticality === "critical" ? "core" : "supporting",
            importanceWeight: foundation.criticality === "critical" ? 5 : 2,
            difficulty: "medium",
            targetCognitiveLevel: foundation.verificationDimensions.includes(
              "application",
            )
              ? "apply"
              : foundation.verificationDimensions.includes("understanding")
                ? "understand"
                : "remember",
            rationale: foundation.rationale,
            origin: "curated",
          },
          update: {
            title: foundation.title,
            explanation: foundation.rationale,
            learningObjective: `Independently demonstrate the entry foundation: ${foundation.title}`,
            assessmentCriteria: inputJson([
              {
                ref: `${localRef}:c1`,
                text: foundation.rationale,
              },
            ]),
            status: "active",
          },
        });
        await tx.learningTargetRequirement.deleteMany({
          where: { learningTargetId: target.id },
        });
        await tx.learningTargetRequirement.createMany({
          data: targetAuthority.requirements.map(
            (requirement, requirementIndex) => ({
              learningTargetId: target.id,
              cognitiveEntityId: entity.id,
              dimension: requirement.dimension,
              required: requirement.required,
              threshold: requirement.threshold,
              gate: requirement.gate,
              weight: requirement.weight,
              orderIndex: requirementIndex,
              rationale: requirement.rationale,
            }),
          ),
        });
        foundationTargets.push({
          id: target.id,
          entityId: entity.id,
          localRef,
          critical: foundation.criticality === "critical",
        });
      }

      const capabilityTargets: Array<{
        id: string;
        entityId: string;
        localRef: string;
      }> = [];
      for (const [
        index,
        capability,
      ] of capabilityResult.capabilities.entries()) {
        const localRef = `lt_${index + 1}`;
        const authorityIndex = foundations.length + index;
        const entityAuthority =
          moduleObjectiveAuthority.entities[authorityIndex]!;
        const targetAuthority =
          moduleObjectiveAuthority.targets[authorityIndex]!;
        const entityStableKey = entityAuthority.stableKey;
        const entity = await tx.cognitiveEntity.upsert({
          where: {
            goalId_stableKey: {
              goalId: claimed.goalId,
              stableKey: entityStableKey,
            },
          },
          create: {
            goalId: claimed.goalId,
            scopeKey: `goal:${claimed.goalId}`,
            stableKey: entityStableKey,
            kind: "competency",
            title: capability.title,
            description: capability.objective,
            language: contentLanguage,
            provenance: inputJson({
              source: "module.capabilities",
              moduleCurriculumKey: claimed.curriculumKey,
              ownerCurriculumKey: claimed.curriculumKey,
              semanticKey: `capability:${index + 1}`,
            }),
          },
          update: {
            title: capability.title,
            description: capability.objective,
            status: "active",
          },
        });
        await tx.cognitiveConstruct.upsert({
          where: { entityId: entity.id },
          create: {
            entityId: entity.id,
            constructType: "competency",
            objective: capability.objective,
            performanceCriteria: inputJson(capability.assessmentCriteria),
            outputs: inputJson([capability.objective]),
            qualityCriteria: inputJson(capability.assessmentCriteria),
            compositionStrategy: inputJson({
              source: "module_exit_capability",
            }),
          },
          update: {
            objective: capability.objective,
            performanceCriteria: inputJson(capability.assessmentCriteria),
            outputs: inputJson([capability.objective]),
            qualityCriteria: inputJson(capability.assessmentCriteria),
          },
        });
        const targetStableKey = targetAuthority.stableKey;
        const target = await tx.learningTarget.upsert({
          where: {
            goalId_stableKey: {
              goalId: claimed.goalId,
              stableKey: targetStableKey,
            },
          },
          create: {
            goalId: claimed.goalId,
            stableKey: targetStableKey,
            title: capability.title,
            explanation: capability.objective,
            learningObjective: capability.objective,
            assessmentCriteria: inputJson(
              capability.assessmentCriteria.map((text, criterionIndex) => ({
                ref: `${localRef}:c${criterionIndex + 1}`,
                text,
              })),
            ),
            language: contentLanguage,
            importance: capability.criticalCompletionGate
              ? "core"
              : "supporting",
            importanceWeight: capability.criticalCompletionGate ? 5 : 3,
            difficulty: capability.difficulty,
            targetCognitiveLevel: capability.cognitiveLevel,
            rationale: "Required module exit capability",
          },
          update: {
            title: capability.title,
            explanation: capability.objective,
            learningObjective: capability.objective,
            assessmentCriteria: inputJson(
              capability.assessmentCriteria.map((text, criterionIndex) => ({
                ref: `${localRef}:c${criterionIndex + 1}`,
                text,
              })),
            ),
            status: "active",
          },
        });
        await tx.learningTargetRequirement.deleteMany({
          where: { learningTargetId: target.id },
        });
        await tx.learningTargetRequirement.createMany({
          data: targetAuthority.requirements.map(
            (requirement, requirementIndex) => ({
              learningTargetId: target.id,
              cognitiveEntityId: entity.id,
              dimension: requirement.dimension,
              required: requirement.required,
              threshold: requirement.threshold,
              gate: requirement.gate,
              weight: requirement.weight,
              orderIndex: requirementIndex,
              rationale: requirement.rationale,
            }),
          ),
        });
        capabilityTargets.push({
          id: target.id,
          entityId: entity.id,
          localRef,
        });
      }
      await tx.moduleLearningTarget.deleteMany({
        where: { moduleId: claimed.id },
      });
      await tx.moduleLearningTarget.createMany({
        data: [
          ...foundationTargets.map((target) => {
            const mapping = moduleObjectiveAuthority.moduleMappings.find(
              (mapping) => mapping.localRef === target.localRef,
            );
            if (!mapping) throw new Error("Missing entry target authority");
            return {
              moduleId: claimed.id,
              learningTargetId: target.id,
              localRef: mapping.localRef,
              required: mapping.required,
              weight: mapping.weight,
              orderIndex: mapping.orderIndex,
              role: mapping.role,
            };
          }),
          ...capabilityTargets.map((target) => {
            const mapping = moduleObjectiveAuthority.moduleMappings.find(
              (mapping) => mapping.localRef === target.localRef,
            );
            if (!mapping) throw new Error("Missing exit target authority");
            return {
              moduleId: claimed.id,
              learningTargetId: target.id,
              localRef: mapping.localRef,
              required: mapping.required,
              weight: mapping.weight,
              orderIndex: mapping.orderIndex,
              role: mapping.role,
            };
          }),
        ],
      });

      let previousUnitId: string | null = null;
      let firstUnitCurriculumKey: string | null =
        existingUnits > 0
          ? ((
              await tx.learningUnit.findFirst({
                where: { moduleId: claimed.id, unitKind: "lesson" },
                orderBy: { orderIndex: "asc" },
                select: { curriculumKey: true },
              })
            )?.curriculumKey ?? null)
          : null;
      for (const [index, unit] of (existingUnits > 0
        ? []
        : structure.units
      ).entries()) {
        const created: { id: string; curriculumKey: string } =
          await tx.learningUnit.create({
            data: {
              goalId: claimed.goalId,
              moduleId: claimed.id,
              parentUnitId: null,
              unitKind: "lesson",
              title: unit.title,
              orderIndex: index,
              difficulty: unit.difficulty,
              contentSummary: unit.contentSummary,
              planAreaRef: `a_${claimed.orderIndex + 1}`,
              planningOutcomeRefs: inputJson([
                `o_${Math.min(
                  claimed.orderIndex + 1,
                  resolveMapOutcomeCount(claimed.goal.mapPlanJson),
                )}`,
              ]),
              moduleCapabilityRefs: inputJson(unit.capabilityRefs),
              moduleMilestoneRole: unit.milestoneRole,
              prerequisites: JSON.stringify(
                previousUnitId ? [previousUnitId] : [],
              ),
              status: "available",
              cognitiveModelStatus: "pending",
              requiredForModuleCompletion: true,
            },
            select: { id: true, curriculumKey: true },
          });
        firstUnitCurriculumKey ??= created.curriculumKey;
        previousUnitId = created.id;
      }
      if (firstUnitCurriculumKey) {
        for (const foundation of foundationTargets) {
          for (const capability of capabilityTargets) {
            await tx.cognitiveRelation.upsert({
              where: {
                sourceEntityId_targetEntityId_relationType: {
                  sourceEntityId: foundation.entityId,
                  targetEntityId: capability.entityId,
                  relationType: "prerequisite",
                },
              },
              create: {
                ownerCurriculumKey: firstUnitCurriculumKey,
                sourceEntityId: foundation.entityId,
                targetEntityId: capability.entityId,
                relationType: "prerequisite",
                strength: foundation.critical ? 1 : 0.6,
                required: foundation.critical,
                rationale: "Verified entry readiness for the module capability",
              },
              update: {
                status: "active",
                required: foundation.critical,
                strength: foundation.critical ? 1 : 0.6,
              },
            });
          }
        }
      }
      await tx.learningModule.update({
        where: { id: claimed.id },
        data: {
          generationVersion: { increment: 1 },
          entryFoundationStatus:
            foundationTargets.length > 0 ? "ready" : "not_applicable",
          entryFoundationError: "",
          generationBuildStartedAt: now,
          generationError: "",
        },
      });
    });

    const invalidation = await invalidateGoalCognitiveModel(
      params.persistence!,
      claimed.goalId,
      {
        reason: "sequential_module_structure_ready",
        // Prepared locked units already participate in the curriculum hash.
        // Unlocking one adds its deferred capability/KACOM contracts without
        // changing those unit fingerprints, so explicitly start expansion.
        force: Boolean(preparedMastery),
      },
      params.cognitiveModelInvalidation,
    );
    await params.persistence!.learningModule.update({
      where: { id: claimed.id },
      data: {
        generationInputHash: await moduleSliceInputHash(
          params.persistence!,
          claimed,
          invalidation.inputHash,
        ),
      },
    });
    await reconcileDownstreamModuleSlices(
      params.persistence!,
      { ...claimed, userId: claimed.goal.userId },
      invalidation.inputHash,
      params.moduleSliceReconciliation,
    );
    return {
      goalId: claimed.goalId,
      moduleId: claimed.id,
      status: "structure_ready",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (claimed) {
      await params.moduleGenerationLease.fail({
        goalId: claimed.goalId,
        moduleId: claimed.id,
        token,
        message,
      });
    }
    throw error;
  }
}
