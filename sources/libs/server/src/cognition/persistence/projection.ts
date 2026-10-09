import {
  DEFAULT_DIMENSION_INFERENCE_THRESHOLDS,
  inferDimensionState,
} from "../inference.js";
import {
  COGNITIVE_DIMENSIONS,
  EVIDENCE_SUFFICIENCY_REASONS,
  LEARNER_COGNITIVE_STATES,
  type CognitiveDimension,
  type CognitiveEntityKind,
  type EvidenceClaim as DomainEvidenceClaim,
  type EvidenceSufficiencyReason,
  type LearnerCognitiveState,
  isCognitiveDimension,
} from "../types.js";
import { CognitionPersistenceError } from "./error.js";
import { positiveInteger } from "./shared.js";
import type {
  LearnerDimensionProjection,
  LearnerEntityProjection,
} from "./types.js";

function sufficiencyRatio(
  inference: ReturnType<typeof inferDimensionState>,
): number {
  if (inference.evidenceCount === 0) return 0;
  const { policy, metrics } = inference.sufficiency;
  const ratios = [
    policy.minimumClaims > 0 ? metrics.claimCount / policy.minimumClaims : 1,
    policy.minimumEffectiveWeight > 0
      ? metrics.effectiveWeight / policy.minimumEffectiveWeight
      : 1,
    policy.minimumSources > 0 ? metrics.sourceCount / policy.minimumSources : 1,
    policy.minimumTaskKinds > 0
      ? metrics.taskKindCount / policy.minimumTaskKinds
      : 1,
    policy.minimumContexts > 0
      ? metrics.contextCount / policy.minimumContexts
      : 1,
    policy.minimumTimeSpanDays > 0
      ? metrics.timeSpanDays / policy.minimumTimeSpanDays
      : 1,
    policy.minimumIndependentClaims > 0
      ? metrics.independentClaimCount / policy.minimumIndependentClaims
      : 1,
    policy.requireFarContext ? (metrics.hasFarContext ? 1 : 0) : 1,
  ];
  return Math.max(0, Math.min(1, Math.min(...ratios)));
}

function emptyDimensionProjection(
  dimension: CognitiveDimension,
): LearnerDimensionProjection {
  return {
    dimension,
    estimate: null,
    evidenceSufficiency: 0,
    evidenceSufficiencyReasons: ["no_evidence"],
    status: "unobserved",
    alpha: 1,
    beta: 1,
    effectiveEvidenceWeight: 0,
    observationCount: 0,
    lastObservedAt: null,
  };
}

export function buildLearnerDimensionProjection(
  userId: string,
  entityId: string,
  entityKind: CognitiveEntityKind,
  definitionVersion: number,
  dimension: CognitiveDimension,
  claims: readonly DomainEvidenceClaim[],
  asOf = new Date(),
): LearnerDimensionProjection {
  if (!positiveInteger(definitionVersion) || !isCognitiveDimension(dimension)) {
    throw new CognitionPersistenceError(
      "invalid_declaration",
      "dimension projection requires a controlled dimension and positive definition version",
    );
  }
  const currentClaims = claims.filter(
    (claim) =>
      claim.target.id === entityId &&
      claim.target.kind === entityKind &&
      claim.target.definitionVersion === definitionVersion &&
      claim.dimension === dimension,
  );
  const inference = inferDimensionState(
    currentClaims,
    { learnerId: userId, entityId, entityKind, dimension },
    { asOf: asOf.toISOString() },
  );
  return {
    dimension,
    estimate: inference.evidenceCount === 0 ? null : inference.posteriorMean,
    evidenceSufficiency: sufficiencyRatio(inference),
    evidenceSufficiencyReasons: [...inference.sufficiency.reasons],
    status: inference.state,
    alpha: inference.alpha,
    beta: inference.beta,
    effectiveEvidenceWeight: inference.effectiveWeight,
    observationCount: inference.evidenceCount,
    lastObservedAt: inference.latestEvidenceAt,
  };
}

export function materializedDimensionProjection(
  dimension: CognitiveDimension,
  stored: {
    estimate: number | null;
    evidenceSufficiency: number;
    evidenceSufficiencyReasons?: unknown;
    status: string;
    alpha: number;
    beta: number;
    evidenceWeight: number;
    observationCount: number;
    lastObservedAt: Date | null;
  } | null,
  asOf: Date,
): LearnerDimensionProjection {
  if (!stored) return emptyDimensionProjection(dimension);
  const controlledStatus = LEARNER_COGNITIVE_STATES.includes(
    stored.status as LearnerCognitiveState,
  )
    ? (stored.status as LearnerCognitiveState)
    : "unobserved";
  const lastObservedAt = stored.lastObservedAt?.toISOString() ?? null;
  const stale = Boolean(
    lastObservedAt &&
    stored.evidenceSufficiency >= 1 &&
    (controlledStatus === "demonstrated" || controlledStatus === "robust") &&
    (asOf.getTime() - Date.parse(lastObservedAt)) / 86_400_000 >=
      DEFAULT_DIMENSION_INFERENCE_THRESHOLDS.revalidateAfterDays,
  );
  const storedReasons = Array.isArray(stored.evidenceSufficiencyReasons)
    ? stored.evidenceSufficiencyReasons.filter(
        (reason): reason is EvidenceSufficiencyReason =>
          typeof reason === "string" &&
          EVIDENCE_SUFFICIENCY_REASONS.includes(
            reason as EvidenceSufficiencyReason,
          ),
      )
    : [];
  return {
    dimension,
    estimate: stored.estimate,
    evidenceSufficiency: stored.evidenceSufficiency,
    evidenceSufficiencyReasons:
      storedReasons.length > 0 || stored.evidenceSufficiency >= 1
        ? storedReasons
        : stored.estimate === null
          ? ["no_evidence"]
          : ["low_effective_weight"],
    status: stale ? "revalidate" : controlledStatus,
    alpha: stored.alpha,
    beta: stored.beta,
    effectiveEvidenceWeight: stored.evidenceWeight,
    observationCount: stored.observationCount,
    lastObservedAt,
  };
}

export function summarizeLearnerDimensionProjections(
  dimensions: readonly LearnerDimensionProjection[],
  requiredDimensions: readonly CognitiveDimension[] = COGNITIVE_DIMENSIONS,
): Omit<LearnerEntityProjection, "dimensions"> {
  const byDimension = new Map(
    dimensions.map((dimension) => [dimension.dimension, dimension]),
  );
  if (
    byDimension.size !== COGNITIVE_DIMENSIONS.length ||
    COGNITIVE_DIMENSIONS.some((dimension) => !byDimension.has(dimension))
  ) {
    throw new CognitionPersistenceError(
      "invalid_declaration",
      "entity summary requires exactly one materialized state for every dimension",
    );
  }
  const ordered = COGNITIVE_DIMENSIONS.map(
    (dimension) => byDimension.get(dimension)!,
  );
  const required = new Set(requiredDimensions);
  if (
    required.size !== requiredDimensions.length ||
    requiredDimensions.some((dimension) => !isCognitiveDimension(dimension))
  ) {
    throw new CognitionPersistenceError(
      "invalid_declaration",
      "entity summary required dimensions must be unique controlled dimensions",
    );
  }
  const observed = ordered.filter(
    (
      dimension,
    ): dimension is LearnerDimensionProjection & { estimate: number } =>
      dimension.estimate !== null,
  );
  const requiredUnobserved = requiredDimensions.some(
    (dimension) => byDimension.get(dimension)!.estimate === null,
  );
  const estimate =
    observed.length === 0 || requiredUnobserved
      ? null
      : Math.exp(
          observed.reduce(
            (sum, dimension) =>
              sum + Math.log(Math.max(dimension.estimate, 1e-12)),
            0,
          ) / observed.length,
        );
  const sufficiencyDimensions =
    requiredDimensions.length > 0
      ? requiredDimensions.map((dimension) => byDimension.get(dimension)!)
      : observed;
  const evidenceSufficiency =
    sufficiencyDimensions.length === 0
      ? 0
      : sufficiencyDimensions.reduce(
          (sum, dimension) => sum + dimension.evidenceSufficiency,
          0,
        ) / sufficiencyDimensions.length;
  const status: LearnerCognitiveState =
    observed.length === 0 || requiredUnobserved
      ? "unobserved"
      : observed.some((dimension) => dimension.status === "revalidate")
        ? "revalidate"
        : observed.every((dimension) => dimension.status === "robust")
          ? "robust"
          : observed.every((dimension) =>
                ["demonstrated", "robust"].includes(dimension.status),
              )
            ? "demonstrated"
            : "forming";
  const latest = observed
    .flatMap((dimension) =>
      dimension.lastObservedAt ? [new Date(dimension.lastObservedAt)] : [],
    )
    .sort((left, right) => right.getTime() - left.getTime())[0];
  return {
    estimate,
    evidenceSufficiency,
    status,
    lastObservedAt: latest ?? null,
  };
}

/** Only direct claims for this entity enter this projection. */
export function buildLearnerEntityProjection(
  userId: string,
  entityId: string,
  entityKind: CognitiveEntityKind,
  definitionVersion: number,
  claims: readonly DomainEvidenceClaim[],
  asOf = new Date(),
): LearnerEntityProjection {
  if (!positiveInteger(definitionVersion)) {
    throw new CognitionPersistenceError(
      "invalid_declaration",
      "entity projection requires a positive definition version",
    );
  }
  const dimensions = COGNITIVE_DIMENSIONS.map((dimension) =>
    buildLearnerDimensionProjection(
      userId,
      entityId,
      entityKind,
      definitionVersion,
      dimension,
      claims,
      asOf,
    ),
  );
  const summary = summarizeLearnerDimensionProjections(dimensions);
  return {
    ...summary,
    dimensions,
  };
}
