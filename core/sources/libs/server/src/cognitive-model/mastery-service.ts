import type { MasterySummaryReadRepository } from "../../../domain/src/index.js";
import {
  ADAPTIVE_ASSESSMENT_POLICY_VERSION,
  assessmentDemandTier,
  requiredEvidenceCount,
  type AdaptiveAssessmentRequirement,
  type AdaptiveAssessmentTarget,
} from "../assessment/adaptive-blueprint.js";
import {
  COGNITIVE_DIMENSIONS,
  COGNITIVE_ENTITY_KINDS,
  LEARNER_COGNITIVE_STATES,
  type CognitiveDimension,
  type CognitiveEntityKind,
  type LearnerCognitiveState,
} from "../cognition/index.js";
import { DEFAULT_DIMENSION_INFERENCE_THRESHOLDS } from "../cognition/inference.js";
import {
  projectMasterySummary,
  type MasteryRequirementProjectionInput,
  type MasterySummary,
  type MasteryTargetProjectionInput,
} from "./mastery-summary.js";
import {
  masteryCacheKey,
  readMasteryCache,
  writeMasteryCache,
} from "./mastery-cache.js";

type Scope = { goalId: string; moduleId?: string };

type LoadedTarget = {
  id: string;
  title: string;
  importance: string;
  importanceWeight: number;
  difficulty: string;
  targetCognitiveLevel: string;
  assessmentCriteria: unknown;
  required: boolean;
  mappingWeight: number;
  requirements: Array<{
    cognitiveEntityId: string;
    dimension: string;
    required: boolean;
    gate: boolean;
    weight: number;
    threshold: number;
    cognitiveEntity: {
      kind: string;
      learnerStates: Array<{
        inferenceVersion: number;
        dimensions: Array<{
          dimension: string;
          estimate: number | null;
          evidenceSufficiency: number;
          status: string;
          lastObservedAt: Date | null;
        }>;
      }>;
    };
  }>;
};

type ClaimRow = {
  learningTargetId: string | null;
  cognitiveEntityId: string;
  dimension: string;
  contextKey: string;
  evaluatorReliability: number;
  groundingReliability: number;
  createdAt: Date;
  observation: {
    observedAt: Date;
    metadata: unknown;
    attempt: {
      assistanceLevel: number;
      task: { taskType: string; origin: string };
    };
  };
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function criteria(value: unknown): Array<{ ref: string; text: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = record(item);
    return typeof row.ref === "string" && typeof row.text === "string"
      ? [{ ref: row.ref, text: row.text }]
      : [];
  });
}

function entityKind(value: string): CognitiveEntityKind {
  return COGNITIVE_ENTITY_KINDS.includes(value as CognitiveEntityKind)
    ? (value as CognitiveEntityKind)
    : "atom";
}

function dimension(value: string): CognitiveDimension | null {
  return COGNITIVE_DIMENSIONS.includes(value as CognitiveDimension)
    ? (value as CognitiveDimension)
    : null;
}

function cognitiveState(value: string): LearnerCognitiveState {
  return LEARNER_COGNITIVE_STATES.includes(value as LearnerCognitiveState)
    ? (value as LearnerCognitiveState)
    : "unobserved";
}

function targetShape(target: LoadedTarget): AdaptiveAssessmentTarget {
  return {
    id: target.id,
    localRef: target.id,
    title: target.title,
    importance:
      target.importance === "supporting" || target.importance === "enrichment"
        ? target.importance
        : "core",
    importanceWeight: target.importanceWeight,
    difficulty:
      target.difficulty === "easy" || target.difficulty === "hard"
        ? target.difficulty
        : "medium",
    targetCognitiveLevel: [
      "remember",
      "understand",
      "apply",
      "analyze",
      "evaluate",
      "create",
    ].includes(target.targetCognitiveLevel)
      ? (target.targetCognitiveLevel as AdaptiveAssessmentTarget["targetCognitiveLevel"])
      : "understand",
    assessmentCriteria: criteria(target.assessmentCriteria),
    requirements: target.requirements.flatMap((requirement) => {
      const controlledDimension = dimension(requirement.dimension);
      return controlledDimension
        ? [
            {
              cognitiveEntityId: requirement.cognitiveEntityId,
              entityKind: entityKind(requirement.cognitiveEntity.kind),
              dimension: controlledDimension,
              required: requirement.required,
              gate: requirement.gate,
              weight: requirement.weight,
              threshold: requirement.threshold,
            },
          ]
        : [];
    }),
  };
}

function contextMinimum(
  requirement: AdaptiveAssessmentRequirement,
  tier: ReturnType<typeof assessmentDemandTier>,
): number {
  if (requirement.dimension === "transfer") return 3;
  if (requirement.dimension === "application") {
    return tier === "advanced" ? 3 : 2;
  }
  if (requirement.dimension === "memory" && tier === "advanced") return 2;
  return 1;
}

function constructedMinimum(
  requirement: AdaptiveAssessmentRequirement,
  tier: ReturnType<typeof assessmentDemandTier>,
): number {
  if (requirement.dimension !== "understanding") return 0;
  return tier === "advanced" ? 2 : tier === "standard" ? 1 : 0;
}

function evidenceCoverage(params: {
  target: AdaptiveAssessmentTarget;
  requirement: AdaptiveAssessmentRequirement;
  claims: readonly ClaimRow[];
}): number {
  const tier = assessmentDemandTier(params.target, params.requirement);
  const requiredClaims = requiredEvidenceCount(
    params.requirement.dimension,
    tier,
  );
  const effectiveClaims = params.claims.filter(
    (claim) => claim.evaluatorReliability > 0 && claim.groundingReliability > 0,
  );
  if (effectiveClaims.length === 0) return 0;
  const ratios = [
    effectiveClaims.length / requiredClaims,
    new Set(
      effectiveClaims.map(
        (claim) =>
          claim.contextKey || claim.observation.observedAt.toISOString(),
      ),
    ).size / contextMinimum(params.requirement, tier),
  ];
  const constructedRequired = constructedMinimum(params.requirement, tier);
  if (constructedRequired > 0) {
    const constructed = effectiveClaims.filter(
      (claim) =>
        claim.observation.attempt.task.taskType === "explanation" ||
        claim.observation.attempt.task.origin === "feynman" ||
        record(claim.observation.metadata).assessmentItemKind ===
          "constructed_response",
    ).length;
    ratios.push(constructed / constructedRequired);
  }
  if (params.requirement.dimension === "transfer") {
    ratios.push(
      effectiveClaims.some(
        (claim) => record(claim.observation.metadata).contextDistance === "far",
      )
        ? 1
        : 0,
    );
  }
  if (params.requirement.dimension === "independence") {
    const independent = effectiveClaims.filter(
      (claim) => claim.observation.attempt.assistanceLevel <= 0.05,
    ).length;
    ratios.push(independent / (tier === "advanced" ? 3 : 2));
  }
  if (params.requirement.dimension === "stability") {
    const timestamps = effectiveClaims
      .map((claim) => claim.observation.observedAt.getTime())
      .sort((left, right) => left - right);
    const spanDays =
      timestamps.length > 1
        ? (timestamps[timestamps.length - 1] - timestamps[0]) / 86_400_000
        : 0;
    ratios.push(spanDays / 7);
  }
  return Math.max(0, Math.min(1, ...ratios));
}

function currentState(
  value: {
    estimate: number | null;
    evidenceSufficiency: number;
    status: string;
    lastObservedAt: Date | null;
  } | null,
  now: Date,
): Pick<
  MasteryRequirementProjectionInput,
  "estimate" | "entityEvidenceSufficiency" | "stateStatus"
> {
  if (!value) {
    return {
      estimate: null,
      entityEvidenceSufficiency: 0,
      stateStatus: "unobserved",
    };
  }
  const storedStatus = cognitiveState(value.status);
  const stale =
    value.lastObservedAt != null &&
    ["demonstrated", "robust"].includes(storedStatus) &&
    (now.getTime() - value.lastObservedAt.getTime()) / 86_400_000 >=
      DEFAULT_DIMENSION_INFERENCE_THRESHOLDS.revalidateAfterDays;
  return {
    estimate: value.estimate,
    entityEvidenceSufficiency: value.evidenceSufficiency,
    stateStatus: stale ? "revalidate" : storedStatus,
  };
}

async function computeMasterySummary(
  repository: MasterySummaryReadRepository,
  userId: string,
  scope: Scope,
): Promise<MasterySummary> {
  const loaded = await repository.load({ userId, ...scope });
  if (!loaded) throw new Error("Goal not found");
  const targets = loaded.targets as LoadedTarget[];
  const now = new Date();
  const inferencePolicyVersion = Math.max(
    1,
    ...targets.flatMap((target) =>
      target.requirements.flatMap((requirement) =>
        requirement.cognitiveEntity.learnerStates.map(
          (state) => state.inferenceVersion,
        ),
      ),
    ),
  );
  const cacheKey = masteryCacheKey({
    userId,
    scope: scope.moduleId ? "module" : "goal",
    scopeId: scope.moduleId ?? scope.goalId,
    modelVersion: loaded.modelVersion,
    assessmentPolicyVersion: ADAPTIVE_ASSESSMENT_POLICY_VERSION,
    inferencePolicyVersion,
    evidenceCutoffAt: loaded.evidenceCutoffAt,
    lifecycleCutoffAt: loaded.lifecycleCutoffAt,
  });
  const cached = await readMasteryCache(cacheKey);
  if (cached) return cached;
  const claims = loaded.claims as ClaimRow[];
  const shapedTargets: MasteryTargetProjectionInput[] = targets.map(
    (target) => {
      const shaped = targetShape(target);
      return {
        id: target.id,
        title: target.title,
        importance: shaped.importance,
        importanceWeight: target.importanceWeight,
        required:
          target.required ||
          target.requirements.some((requirement) => requirement.gate),
        mappingWeight: target.mappingWeight,
        requirements: target.requirements.flatMap((requirement) => {
          const controlledDimension = dimension(requirement.dimension);
          if (!controlledDimension) return [];
          const adaptiveRequirement = shaped.requirements.find(
            (candidate) =>
              candidate.cognitiveEntityId === requirement.cognitiveEntityId &&
              candidate.dimension === controlledDimension,
          );
          if (!adaptiveRequirement) return [];
          const learnerState =
            requirement.cognitiveEntity.learnerStates[0] ?? null;
          const dimensionState =
            learnerState?.dimensions.find(
              (candidate) => candidate.dimension === controlledDimension,
            ) ?? null;
          const requirementClaims = (claims as ClaimRow[]).filter(
            (claim) =>
              claim.learningTargetId === target.id &&
              claim.cognitiveEntityId === requirement.cognitiveEntityId &&
              claim.dimension === controlledDimension,
          );
          return [
            {
              cognitiveEntityId: requirement.cognitiveEntityId,
              dimension: controlledDimension,
              required: requirement.required,
              gate: requirement.gate,
              weight: requirement.weight,
              threshold: requirement.threshold,
              ...currentState(dimensionState, now),
              targetEvidenceCoverage: evidenceCoverage({
                target: shaped,
                requirement: adaptiveRequirement,
                claims: requirementClaims,
              }),
            },
          ];
        }),
      };
    },
  );
  const summary = projectMasterySummary({
    scope: scope.moduleId ? "module" : "goal",
    scopeId: scope.moduleId ?? scope.goalId,
    targets: shapedTargets,
    modelVersion: loaded.modelVersion,
    inferencePolicyVersion,
    evidenceCutoffAt: loaded.evidenceCutoffAt,
    lifecycleCutoffAt: loaded.lifecycleCutoffAt,
    computedAt: now,
  });
  await writeMasteryCache(cacheKey, summary);
  return summary;
}

export function getGoalMasterySummary(
  repository: MasterySummaryReadRepository,
  userId: string,
  goalId: string,
): Promise<MasterySummary> {
  return computeMasterySummary(repository, userId, { goalId });
}

export function getModuleMasterySummary(
  repository: MasterySummaryReadRepository,
  userId: string,
  goalId: string,
  moduleId: string,
): Promise<MasterySummary> {
  return computeMasterySummary(repository, userId, { goalId, moduleId });
}
