// @ts-nocheck -- unbound compatibility implementation; hosted callers use repositories.
import type { PersistenceClient } from "../persistence/persistence-compat.js";
import type {
  AssessmentTargetRecord,
  AssessmentTargetRepository,
  AdaptiveAssessmentEvidenceRecord,
  AdaptiveAssessmentEvidenceRepository,
  AdaptiveAssessmentTaskDeclaration,
  AdaptiveAssessmentTaskRepository,
} from "../../../domain/src/index.js";
import {
  ensureLearningTask,
  type EvidenceTaskKind,
} from "../cognition/index.js";
import {
  loadGoalAssessmentTargets,
  loadModuleAssessmentTargets,
  loadUnitAssessmentTargets,
  type UnitAssessmentTarget,
} from "./activities.js";
import {
  assessmentEvidenceKey,
  type AdaptiveAssessmentTarget,
  type AssessmentEvidenceKey,
  type AssessmentBlueprint,
  type AssessmentScope,
  type ExistingRequirementEvidence,
} from "./adaptive-blueprint.js";
import { prepareAdaptiveAssessmentPlan } from "./adaptive-assessment-application.js";
import { learningTargetWorkload } from "../cognitive-model/workload.js";

export type AdaptiveAssessmentRolloutMode =
  "off" | "shadow" | "internal" | "production";

export type AdaptiveAssessmentPlan = {
  purpose: "mastery" | "readiness";
  rolloutMode: AdaptiveAssessmentRolloutMode;
  evidenceWritesEnabled: boolean;
  blueprint: AssessmentBlueprint;
  items: AdaptiveAssessmentItem[];
  nextEvidenceAction: {
    itemKind: string;
    purpose: string;
    learningTargetId: string;
    cognitiveEntityId: string;
    dimension: string;
  } | null;
};

export type AdaptiveAssessmentItem = {
  id: string;
  taskId: string | null;
  type:
    | "selected_response"
    | "constructed_response"
    | "performance_case"
    | "integrated_challenge"
    | "synthesis_challenge"
    | "delayed_retention";
  primaryLearningTargetId: string;
  relatedLearningTargetIds: string[];
  primaryCognitiveEntityId: string;
  evidenceDimension: string;
  criterionRef: string;
  evidencePurpose: string;
  estimatedMinutes: number;
  responseType: "selected" | "text" | "structured";
  prompt: string;
  sections?: Array<"decision" | "output" | "verification" | "reflection">;
  generationRequired?: boolean;
  availableNow: boolean;
};

type ScopeIds = {
  goalId: string;
  moduleId?: string;
  unitId?: string;
};

export function adaptiveAssessmentRolloutMode(): AdaptiveAssessmentRolloutMode {
  const value = (process.env.KACOM_ADAPTIVE_ASSESSMENT_V2 ?? "shadow")
    .trim()
    .toLowerCase();
  if (value === "production" || value === "enabled" || value === "true") {
    return "production";
  }
  if (value === "internal") return "internal";
  if (value === "off" || value === "false" || value === "0") return "off";
  return "shadow";
}

export function adaptiveAssessmentEvidenceWritesEnabled() {
  const mode = adaptiveAssessmentRolloutMode();
  return mode === "internal" || mode === "production";
}

function adaptiveTarget(
  target: UnitAssessmentTarget,
): AdaptiveAssessmentTarget {
  return {
    id: target.id,
    localRef: target.localRef,
    title: target.title,
    importance: target.importance,
    importanceWeight: target.importanceWeight,
    difficulty: target.difficulty,
    targetCognitiveLevel: target.targetCognitiveLevel,
    assessmentCriteria: target.assessmentCriteria,
    requirements: target.requirements.map((requirement) => ({
      cognitiveEntityId: requirement.cognitiveEntityId,
      entityKind: requirement.entityKind,
      dimension: requirement.dimension,
      required: requirement.required,
      gate: requirement.gate,
      weight: requirement.weight,
      threshold: requirement.threshold,
    })),
  };
}

function evidenceTaskKind(
  dimension: AdaptiveAssessmentItem["evidenceDimension"],
): EvidenceTaskKind {
  if (dimension === "memory") return "recall";
  if (dimension === "understanding") return "explanation";
  if (dimension === "application") return "routine_application";
  if (dimension === "transfer") return "novel_application";
  if (dimension === "stability") return "retention";
  return "integration";
}

function adaptiveTaskDeclaration(input: {
  goalId: string;
  moduleId?: string;
  unitId?: string;
  purpose: "mastery" | "readiness";
  blueprint: AssessmentBlueprint;
  item: AdaptiveAssessmentItem;
  slot: AssessmentBlueprint["slots"][number];
  target: UnitAssessmentTarget;
  requirement: UnitAssessmentTarget["requirements"][number];
}): AdaptiveAssessmentTaskDeclaration {
  const { blueprint, item, slot, target, requirement } = input;
  return {
    slotId: slot.id,
    goalId: input.goalId,
    moduleId: input.moduleId,
    unitId: input.unitId,
    stableKey: [
      "adaptive",
      "v2",
      input.purpose,
      slot.id,
      `e${requirement.entityDefinitionVersion}`,
      slot.criterionRef,
    ].join(":"),
    taskType: "diagnostic",
    title: target.title,
    instructions: item.prompt,
    context: {
      assessmentPolicyVersion: blueprint.policyVersion,
      assessmentPurpose: input.purpose,
      assessmentBlueprint: blueprint,
      assessmentEvidenceSlot: slot,
      assessmentItem: item,
    },
    rubric: {
      criterionRef: slot.criterionRef,
      targetTitle: target.title,
      assessmentCriteria: target.assessmentCriteria,
    },
    difficulty: slot.tier,
    definitionVersion: 1,
    origin: "adaptive_assessment_v2",
    evidencePolicy: {
      source: "diagnostic",
      taskKind: evidenceTaskKind(slot.dimension),
      contextKey: slot.id,
      contextDistance: slot.contextDistance,
      ...(slot.minimumTimeSpanDays > 0
        ? { delayedDays: slot.minimumTimeSpanDays }
        : {}),
      rubricId: slot.criterionRef,
      ...(slot.dimension === "fluency"
        ? {
            fluency: {
              taskFamily: `${slot.learningTargetId}:${slot.criterionRef}`,
              qualityThreshold: requirement.threshold,
              targetDurationMs: slot.estimatedMinutes * 60_000,
              minimumDurationMs: 1_000,
            },
          }
        : {}),
    },
    requirements: [
      {
        cognitiveEntityId: slot.cognitiveEntityId,
        learningTargetId: slot.learningTargetId,
        dimension: slot.dimension,
        criterionRef: slot.criterionRef,
        definitionVersion: requirement.entityDefinitionVersion,
        required: slot.required || slot.gate,
        weight: requirement.weight,
        orderIndex: 0,
        rubricCriterion: {
          ref: slot.criterionRef,
          purpose: slot.purpose,
          itemKind: slot.itemKind,
          tier: slot.tier,
        },
      },
    ],
  };
}

async function loadTargets(
  persistence: PersistenceClient | undefined,
  userId: string,
  scope: AssessmentScope,
  ids: ScopeIds,
  purpose: "mastery" | "readiness",
  targetRepository?: AssessmentTargetRepository,
): Promise<UnitAssessmentTarget[]> {
  if (targetRepository) {
    const records: readonly AssessmentTargetRecord[] =
      scope === "unit"
        ? ids.unitId
          ? await targetRepository.findForUnit({ userId, unitId: ids.unitId })
          : (() => {
              throw new Error("Unit assessment requires unitId");
            })()
        : scope === "module"
          ? ids.moduleId
            ? await targetRepository.findForModule({
                userId,
                moduleId: ids.moduleId,
                role: purpose === "readiness" ? "entry" : "exit",
              })
            : (() => {
                throw new Error("Module assessment requires moduleId");
              })()
          : await targetRepository.findForGoal({
              userId,
              goalId: ids.goalId,
            });
    return records.map((record) => ({
      ...record,
      assessmentCriteria: record.assessmentCriteria.map((criterion) => ({
        ...criterion,
      })),
      estimatedMinutes: learningTargetWorkload(record).teachingMinutes,
      requirements: record.requirements.map((requirement) => ({
        ...requirement,
      })),
    }));
  }
  if (scope === "unit") {
    if (!ids.unitId) throw new Error("Unit assessment requires unitId");
    return loadUnitAssessmentTargets(persistence!, ids.unitId, userId);
  }
  if (scope === "module") {
    if (!ids.moduleId) throw new Error("Module assessment requires moduleId");
    return loadModuleAssessmentTargets(persistence!, ids.moduleId, userId, {
      role: purpose === "readiness" ? "entry" : "exit",
    });
  }
  return loadGoalAssessmentTargets(persistence!, ids.goalId, userId);
}

async function existingEvidence(
  persistence: PersistenceClient | undefined,
  userId: string,
  targetIds: readonly string[],
  evidenceRepository?: AdaptiveAssessmentEvidenceRepository,
): Promise<ReadonlyMap<AssessmentEvidenceKey, ExistingRequirementEvidence>> {
  const claims: readonly AdaptiveAssessmentEvidenceRecord[] = evidenceRepository
    ? await evidenceRepository.findActive({
        userId,
        learningTargetIds: targetIds,
      })
    : targetIds.length
      ? await persistence!.evidenceClaim.findMany({
          where: {
            userId,
            status: "active",
            learningTargetId: { in: [...targetIds] },
            OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }],
          },
          select: {
            learningTargetId: true,
            cognitiveEntityId: true,
            dimension: true,
            contextKey: true,
            createdAt: true,
            evaluatorReliability: true,
            groundingReliability: true,
            observation: {
              select: {
                observedAt: true,
                metadata: true,
                attempt: {
                  select: {
                    assistanceLevel: true,
                    task: { select: { taskType: true, origin: true } },
                  },
                },
              },
            },
          },
        })
      : [];
  const grouped = new Map<
    string,
    {
      contexts: Set<string>;
      timestamps: number[];
      independent: number;
      constructed: number;
      far: boolean;
    }
  >();
  for (const claim of claims) {
    if (
      !claim.learningTargetId ||
      claim.evaluatorReliability <= 0 ||
      claim.groundingReliability <= 0
    ) {
      continue;
    }
    const key = assessmentEvidenceKey(
      claim.learningTargetId,
      claim.cognitiveEntityId,
      claim.dimension as Parameters<typeof assessmentEvidenceKey>[2],
    );
    const current = grouped.get(key) ?? {
      contexts: new Set<string>(),
      timestamps: [],
      independent: 0,
      constructed: 0,
      far: false,
    };
    current.contexts.add(claim.contextKey);
    current.timestamps.push(claim.observation.observedAt.getTime());
    if (claim.observation.attempt.assistanceLevel <= 0.05) {
      current.independent += 1;
    }
    if (
      claim.observation.attempt.task.taskType === "explanation" ||
      claim.observation.attempt.task.origin === "feynman" ||
      (claim.observation.metadata &&
        typeof claim.observation.metadata === "object" &&
        !Array.isArray(claim.observation.metadata) &&
        (claim.observation.metadata as Record<string, unknown>)
          .assessmentItemKind === "constructed_response")
    ) {
      current.constructed += 1;
    }
    if (
      claim.observation.metadata &&
      typeof claim.observation.metadata === "object" &&
      !Array.isArray(claim.observation.metadata) &&
      (claim.observation.metadata as Record<string, unknown>)
        .contextDistance === "far"
    ) {
      current.far = true;
    }
    grouped.set(key, current);
  }
  return new Map<AssessmentEvidenceKey, ExistingRequirementEvidence>(
    [...grouped.entries()].map(([key, value]) => {
      const sorted = value.timestamps.sort((left, right) => left - right);
      const spanDays =
        sorted.length > 1
          ? (sorted[sorted.length - 1]! - sorted[0]!) / 86_400_000
          : 0;
      return [
        key as AssessmentEvidenceKey,
        {
          claimCount: sorted.length,
          contextCount: value.contexts.size,
          independentClaimCount: value.independent,
          constructedResponseCount: value.constructed,
          hasFarContext: value.far,
          timeSpanDays: spanDays,
        } satisfies ExistingRequirementEvidence,
      ];
    }),
  );
}

export async function getAdaptiveAssessmentPlan(
  persistence: PersistenceClient | undefined,
  userId: string,
  scope: AssessmentScope,
  ids: ScopeIds,
  options: {
    purpose?: "mastery" | "readiness";
    targetRepository?: AssessmentTargetRepository;
    evidenceRepository?: AdaptiveAssessmentEvidenceRepository;
    taskRepository?: AdaptiveAssessmentTaskRepository;
  } = {},
): Promise<AdaptiveAssessmentPlan> {
  const purpose = options.purpose ?? "mastery";
  if (purpose === "readiness" && scope !== "module") {
    throw new Error("Readiness assessment is module-scoped");
  }
  if (scope === "module" && !options.targetRepository) {
    const ownedModule = await persistence!.learningModule.findFirst({
      where: {
        id: ids.moduleId,
        goalId: ids.goalId,
        goal: { userId },
      },
      select: { id: true },
    });
    if (!ownedModule) throw new Error("Module not found");
  }
  const mode = adaptiveAssessmentRolloutMode();
  const targets = await loadTargets(
    persistence,
    userId,
    scope,
    ids,
    purpose,
    options.targetRepository,
  );
  const evidence = await existingEvidence(
    persistence,
    userId,
    targets.map((target) => target.id),
    options.evidenceRepository,
  );
  const prepared = prepareAdaptiveAssessmentPlan({
    scope,
    targets: targets.map(adaptiveTarget),
    existingEvidence: evidence,
    purpose,
  });
  const { blueprint, items: itemsWithoutTasks } = prepared;
  const evidenceWritesEnabled = mode === "internal" || mode === "production";
  const targetById = new Map(targets.map((target) => [target.id, target]));
  const declarations = itemsWithoutTasks.flatMap((item, index) => {
    const slot = blueprint.slots[index]!;
    if (item.type === "selected_response") return [];
    const target = targetById.get(slot.learningTargetId);
    const requirement = target?.requirements.find(
      (candidate) =>
        candidate.cognitiveEntityId === slot.cognitiveEntityId &&
        candidate.dimension === slot.dimension,
    );
    if (!target || !requirement) {
      throw new Error("Adaptive assessment slot lost its target binding");
    }
    return [
      adaptiveTaskDeclaration({
        goalId: ids.goalId,
        moduleId: ids.moduleId,
        unitId: ids.unitId,
        purpose,
        blueprint,
        item,
        slot,
        target,
        requirement,
      }),
    ];
  });
  const taskRecords = evidenceWritesEnabled
    ? options.taskRepository
      ? await options.taskRepository.publishTasks({
          userId,
          goalId: ids.goalId,
          moduleId: ids.moduleId,
          unitId: ids.unitId,
          purpose,
          tasks: declarations,
        })
      : await Promise.all(
          declarations.map(async (declaration) => ({
            slotId: declaration.slotId,
            taskId: (
              await ensureLearningTask(
                persistence!,
                declaration as unknown as Parameters<
                  typeof ensureLearningTask
                >[1],
              )
            ).id,
          })),
        )
    : [];
  const taskBySlot = new Map(
    taskRecords.map((record) => [record.slotId, record.taskId]),
  );
  const items = evidenceWritesEnabled
    ? itemsWithoutTasks.map((item, index) => {
        const slot = blueprint.slots[index]!;
        const taskId = taskBySlot.get(slot.id);
        return taskId ? { ...item, taskId } : item;
      })
    : itemsWithoutTasks;
  return {
    purpose,
    rolloutMode: mode,
    evidenceWritesEnabled,
    blueprint,
    items,
    nextEvidenceAction: prepared.nextEvidenceAction,
  };
}
