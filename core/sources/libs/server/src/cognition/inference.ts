import { assertEvidenceClaim } from "./evidence.js";
import {
  type AssistanceLevel,
  type CognitiveEntityKind,
  type CognitiveDimension,
  type EvidenceClaim,
  type EvidenceEvaluator,
  type EvidenceSource,
  type EvidenceStrength,
  type EvidenceSignal,
  type EvidenceSufficiencyReason,
  type EvidenceSufficiencyState,
  type EvidenceTaskKind,
  type LearnerCognitiveState,
  isCognitiveDimension,
  isCognitiveEntityKind,
} from "./types.js";

export const EVIDENCE_SOURCE_WEIGHTS: Readonly<Record<EvidenceSource, number>> =
  {
    quiz: 1,
    diagnostic: 1.3,
    review_quiz: 1.15,
    flashcard: 0.55,
    feynman: 0.9,
    socratic: 0.6,
    practice: 1,
    project: 1.5,
    teaching: 1.3,
    human_observation: 1.4,
  };

export const EVIDENCE_TASK_WEIGHTS: Readonly<Record<EvidenceTaskKind, number>> =
  {
    recall: 0.75,
    explanation: 1,
    routine_application: 0.95,
    novel_application: 1.2,
    integration: 1.35,
    project: 1.6,
    teaching: 1.35,
    retention: 1.2,
  };

export const EVIDENCE_EVALUATOR_WEIGHTS: Readonly<
  Record<EvidenceEvaluator, number>
> = {
  deterministic: 1,
  llm: 0.85,
  human: 1,
  // Self-report is useful audit/context, never performance evidence.
  self: 0,
};

export const EVIDENCE_STRENGTH_WEIGHTS: Readonly<
  Record<EvidenceStrength, number>
> = {
  weak: 0.5,
  moderate: 1,
  strong: 1.5,
  decisive: 2,
};

/**
 * Successful assisted work is discounted. Failure despite assistance remains
 * diagnostic and is slightly amplified, so hints cannot hide a real gap.
 */
export const ASSISTED_SUCCESS_WEIGHTS: Readonly<
  Record<AssistanceLevel, number>
> = {
  independent: 1,
  light_hint: 0.8,
  guided: 0.55,
  worked_example: 0.25,
  answer_revealed: 0.1,
};

export type EvidenceContribution = {
  baseWeight: number;
  successWeight: number;
  failureWeight: number;
  effectiveWeight: number;
};

export function calculateEvidenceContribution(
  claim: EvidenceClaim,
): EvidenceContribution {
  assertEvidenceClaim(claim);
  const baseWeight =
    EVIDENCE_SOURCE_WEIGHTS[claim.source] *
    EVIDENCE_TASK_WEIGHTS[claim.task.kind] *
    EVIDENCE_EVALUATOR_WEIGHTS[claim.evaluator] *
    EVIDENCE_STRENGTH_WEIGHTS[claim.strength] *
    claim.evaluatorReliability *
    (claim.observations ?? 1);
  const assistedSuccessWeight =
    ASSISTED_SUCCESS_WEIGHTS[claim.assistance.level];
  const successWeight = claim.score * baseWeight * assistedSuccessWeight;
  const failureMultiplier = 1 + (1 - assistedSuccessWeight) * 0.5;
  const failureWeight = (1 - claim.score) * baseWeight * failureMultiplier;

  return {
    baseWeight,
    successWeight,
    failureWeight,
    effectiveWeight: successWeight + failureWeight,
  };
}

export type EvidenceSufficiencyPolicy = {
  minimumClaims: number;
  minimumEffectiveWeight: number;
  minimumSources: number;
  minimumTaskKinds: number;
  minimumContexts: number;
  minimumTimeSpanDays: number;
  minimumIndependentClaims: number;
  requireFarContext: boolean;
};

export const DEFAULT_EVIDENCE_SUFFICIENCY_POLICIES: Readonly<
  Record<CognitiveDimension, EvidenceSufficiencyPolicy>
> = {
  memory: {
    minimumClaims: 2,
    minimumEffectiveWeight: 1.5,
    minimumSources: 1,
    minimumTaskKinds: 1,
    minimumContexts: 1,
    minimumTimeSpanDays: 0,
    minimumIndependentClaims: 1,
    requireFarContext: false,
  },
  understanding: {
    minimumClaims: 2,
    minimumEffectiveWeight: 2,
    minimumSources: 1,
    minimumTaskKinds: 1,
    minimumContexts: 1,
    minimumTimeSpanDays: 0,
    minimumIndependentClaims: 1,
    requireFarContext: false,
  },
  application: {
    minimumClaims: 2,
    minimumEffectiveWeight: 2.25,
    minimumSources: 1,
    minimumTaskKinds: 1,
    minimumContexts: 2,
    minimumTimeSpanDays: 0,
    minimumIndependentClaims: 1,
    requireFarContext: false,
  },
  transfer: {
    minimumClaims: 3,
    minimumEffectiveWeight: 3,
    minimumSources: 1,
    minimumTaskKinds: 1,
    minimumContexts: 2,
    minimumTimeSpanDays: 0,
    minimumIndependentClaims: 1,
    requireFarContext: true,
  },
  fluency: {
    minimumClaims: 2,
    minimumEffectiveWeight: 2,
    minimumSources: 1,
    minimumTaskKinds: 1,
    minimumContexts: 1,
    minimumTimeSpanDays: 0,
    minimumIndependentClaims: 1,
    requireFarContext: false,
  },
  stability: {
    minimumClaims: 3,
    minimumEffectiveWeight: 2.5,
    minimumSources: 1,
    minimumTaskKinds: 1,
    minimumContexts: 1,
    minimumTimeSpanDays: 7,
    minimumIndependentClaims: 1,
    requireFarContext: false,
  },
  independence: {
    minimumClaims: 2,
    minimumEffectiveWeight: 2,
    minimumSources: 1,
    minimumTaskKinds: 1,
    minimumContexts: 1,
    minimumTimeSpanDays: 0,
    minimumIndependentClaims: 2,
    requireFarContext: false,
  },
};

export type EvidenceSufficiencyMetrics = {
  claimCount: number;
  effectiveWeight: number;
  sourceCount: number;
  taskKindCount: number;
  contextCount: number;
  timeSpanDays: number;
  independentClaimCount: number;
  hasFarContext: boolean;
};

export type EvidenceSufficiencyAssessment = {
  state: EvidenceSufficiencyState;
  reasons: readonly EvidenceSufficiencyReason[];
  policy: EvidenceSufficiencyPolicy;
  metrics: EvidenceSufficiencyMetrics;
};

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative finite number`);
  }
}

export function assertEvidenceSufficiencyPolicy(
  policy: EvidenceSufficiencyPolicy,
): void {
  const integerFields: Array<keyof EvidenceSufficiencyPolicy> = [
    "minimumClaims",
    "minimumSources",
    "minimumTaskKinds",
    "minimumContexts",
    "minimumIndependentClaims",
  ];
  for (const field of integerFields) {
    const value = policy[field];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      throw new RangeError(`${field} must be a non-negative integer`);
    }
  }
  assertNonNegativeFinite(
    policy.minimumEffectiveWeight,
    "minimumEffectiveWeight",
  );
  assertNonNegativeFinite(policy.minimumTimeSpanDays, "minimumTimeSpanDays");
  if (typeof policy.requireFarContext !== "boolean") {
    throw new TypeError("requireFarContext must be boolean");
  }
}

function differenceInDays(first: string, last: string): number {
  return Math.max(0, (Date.parse(last) - Date.parse(first)) / 86_400_000);
}

export function assessEvidenceSufficiency(
  claims: readonly EvidenceClaim[],
  dimension: CognitiveDimension,
  policy?: EvidenceSufficiencyPolicy,
): EvidenceSufficiencyAssessment {
  if (!isCognitiveDimension(dimension)) {
    throw new TypeError("dimension must be a controlled cognitive dimension");
  }
  const resolvedPolicy =
    policy ?? DEFAULT_EVIDENCE_SUFFICIENCY_POLICIES[dimension];
  assertEvidenceSufficiencyPolicy(resolvedPolicy);
  for (const claim of claims) {
    assertEvidenceClaim(claim);
    if (claim.dimension !== dimension) {
      throw new TypeError(
        `expected ${dimension} evidence, received ${claim.dimension}`,
      );
    }
  }

  // A persisted claim can be fully discounted when a validator has no
  // reliability/grounding. Such a row remains part of the immutable audit
  // trail, but it is not an observation for inference or sufficiency.
  const effectiveClaims = claims.filter(
    (claim) => calculateEvidenceContribution(claim).effectiveWeight > 0,
  );

  const timestamps = effectiveClaims
    .map((claim) => claim.observedAt)
    .sort((left, right) => Date.parse(left) - Date.parse(right));
  const metrics: EvidenceSufficiencyMetrics = {
    claimCount: effectiveClaims.length,
    effectiveWeight: effectiveClaims.reduce(
      (sum, claim) =>
        sum + calculateEvidenceContribution(claim).effectiveWeight,
      0,
    ),
    sourceCount: new Set(effectiveClaims.map((claim) => claim.source)).size,
    taskKindCount: new Set(effectiveClaims.map((claim) => claim.task.kind))
      .size,
    contextCount: new Set(effectiveClaims.map((claim) => claim.task.contextId))
      .size,
    timeSpanDays:
      timestamps.length > 1
        ? differenceInDays(timestamps[0], timestamps[timestamps.length - 1])
        : 0,
    independentClaimCount: effectiveClaims.filter(
      (claim) => claim.assistance.level === "independent",
    ).length,
    hasFarContext: effectiveClaims.some(
      (claim) => claim.task.contextDistance === "far",
    ),
  };

  if (effectiveClaims.length === 0) {
    return {
      state: "unobserved",
      reasons: ["no_evidence"],
      policy: resolvedPolicy,
      metrics,
    };
  }

  const reasons: EvidenceSufficiencyReason[] = [];
  if (metrics.claimCount < resolvedPolicy.minimumClaims) {
    reasons.push("too_few_claims");
  }
  if (metrics.effectiveWeight < resolvedPolicy.minimumEffectiveWeight) {
    reasons.push("low_effective_weight");
  }
  if (metrics.sourceCount < resolvedPolicy.minimumSources) {
    reasons.push("low_source_diversity");
  }
  if (metrics.taskKindCount < resolvedPolicy.minimumTaskKinds) {
    reasons.push("low_task_diversity");
  }
  if (metrics.contextCount < resolvedPolicy.minimumContexts) {
    reasons.push("low_context_diversity");
  }
  if (metrics.timeSpanDays < resolvedPolicy.minimumTimeSpanDays) {
    reasons.push("short_time_span");
  }
  if (metrics.independentClaimCount < resolvedPolicy.minimumIndependentClaims) {
    reasons.push("insufficient_independent_evidence");
  }
  if (resolvedPolicy.requireFarContext && !metrics.hasFarContext) {
    reasons.push("missing_far_context");
  }

  return {
    state: reasons.length === 0 ? "sufficient" : "insufficient",
    reasons,
    policy: resolvedPolicy,
    metrics,
  };
}

export type DimensionInferenceQuery = {
  learnerId: string;
  entityId: string;
  entityKind?: CognitiveEntityKind;
  dimension: CognitiveDimension;
};

export type BetaPrior = {
  alpha: number;
  beta: number;
};

export type DimensionInferenceThresholds = {
  observedFailureMaximum: number;
  observedSuccessMinimum: number;
  demonstratedMinimum: number;
  robustMinimum: number;
  revalidateAfterDays: number;
};

export const DEFAULT_DIMENSION_INFERENCE_THRESHOLDS: DimensionInferenceThresholds =
  {
    observedFailureMaximum: 0.35,
    observedSuccessMinimum: 0.7,
    demonstratedMinimum: 0.7,
    robustMinimum: 0.85,
    revalidateAfterDays: 90,
  };

export type InferDimensionOptions = {
  prior?: BetaPrior;
  sufficiencyPolicy?: EvidenceSufficiencyPolicy;
  thresholds?: DimensionInferenceThresholds;
  /** Enables deterministic staleness evaluation; omitted means no time decay. */
  asOf?: string;
};

export type DimensionInference = {
  learnerId: string;
  entityId: string;
  entityKind?: CognitiveEntityKind;
  dimension: CognitiveDimension;
  state: LearnerCognitiveState;
  evidenceSignal: EvidenceSignal;
  revalidationDue: boolean;
  latestEvidenceAt: string | null;
  alpha: number;
  beta: number;
  posteriorMean: number;
  observedMean: number | null;
  variance: number;
  evidenceCount: number;
  successWeight: number;
  failureWeight: number;
  effectiveWeight: number;
  sufficiency: EvidenceSufficiencyAssessment;
};

function assertNonEmpty(value: string, name: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function assertPrior(prior: BetaPrior): void {
  if (!Number.isFinite(prior.alpha) || prior.alpha <= 0) {
    throw new RangeError("prior.alpha must be greater than zero");
  }
  if (!Number.isFinite(prior.beta) || prior.beta <= 0) {
    throw new RangeError("prior.beta must be greater than zero");
  }
}

function assertThresholds(thresholds: DimensionInferenceThresholds): void {
  const {
    observedFailureMaximum,
    observedSuccessMinimum,
    demonstratedMinimum,
    robustMinimum,
    revalidateAfterDays,
  } = thresholds;
  if (
    ![
      observedFailureMaximum,
      observedSuccessMinimum,
      demonstratedMinimum,
      robustMinimum,
    ].every((value) => Number.isFinite(value) && value >= 0 && value <= 1) ||
    observedFailureMaximum >= observedSuccessMinimum ||
    demonstratedMinimum >= robustMinimum ||
    !Number.isFinite(revalidateAfterDays) ||
    revalidateAfterDays < 0
  ) {
    throw new RangeError(
      "inference thresholds must be ordered within [0, 1] and revalidation days non-negative",
    );
  }
}

export function claimsForTargetDimension(
  claims: readonly EvidenceClaim[],
  query: DimensionInferenceQuery,
): EvidenceClaim[] {
  assertNonEmpty(query.learnerId, "learnerId");
  assertNonEmpty(query.entityId, "entityId");
  if (!isCognitiveDimension(query.dimension)) {
    throw new TypeError("dimension must be a controlled cognitive dimension");
  }
  if (
    query.entityKind !== undefined &&
    !isCognitiveEntityKind(query.entityKind)
  ) {
    throw new TypeError(
      "entityKind must be atom, concept, skill, or competency",
    );
  }
  return claims.filter(
    (claim) =>
      claim.learnerId === query.learnerId &&
      claim.target.id === query.entityId &&
      (query.entityKind === undefined ||
        claim.target.kind === query.entityKind) &&
      claim.dimension === query.dimension,
  );
}

export function inferDimensionState(
  claims: readonly EvidenceClaim[],
  query: DimensionInferenceQuery,
  options: InferDimensionOptions = {},
): DimensionInference {
  const prior = options.prior ?? { alpha: 1, beta: 1 };
  const thresholds =
    options.thresholds ?? DEFAULT_DIMENSION_INFERENCE_THRESHOLDS;
  assertPrior(prior);
  assertThresholds(thresholds);
  if (
    options.asOf !== undefined &&
    !Number.isFinite(Date.parse(options.asOf))
  ) {
    throw new TypeError("asOf must be an ISO timestamp");
  }

  const selected = claimsForTargetDimension(claims, query);
  for (const claim of selected) assertEvidenceClaim(claim);
  const effectiveClaims = selected.filter(
    (claim) => calculateEvidenceContribution(claim).effectiveWeight > 0,
  );

  const sufficiency = assessEvidenceSufficiency(
    effectiveClaims,
    query.dimension,
    options.sufficiencyPolicy ??
      DEFAULT_EVIDENCE_SUFFICIENCY_POLICIES[query.dimension],
  );
  const contribution = effectiveClaims.reduce(
    (total, claim) => {
      const current = calculateEvidenceContribution(claim);
      return {
        successWeight: total.successWeight + current.successWeight,
        failureWeight: total.failureWeight + current.failureWeight,
      };
    },
    { successWeight: 0, failureWeight: 0 },
  );
  const effectiveWeight =
    contribution.successWeight + contribution.failureWeight;
  const alpha = prior.alpha + contribution.successWeight;
  const beta = prior.beta + contribution.failureWeight;
  const posteriorMean = alpha / (alpha + beta);
  const observedMean =
    effectiveWeight > 0 ? contribution.successWeight / effectiveWeight : null;
  const variance = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));

  const performance = observedMean;
  const evidenceSignal: EvidenceSignal =
    performance === null
      ? "unobserved"
      : performance <= thresholds.observedFailureMaximum
        ? "failure"
        : performance >= thresholds.observedSuccessMinimum
          ? "success"
          : "mixed";
  const latestEvidenceAt =
    effectiveClaims.length === 0
      ? null
      : effectiveClaims.reduce(
          (latest, claim) =>
            Date.parse(claim.observedAt) > Date.parse(latest)
              ? claim.observedAt
              : latest,
          effectiveClaims[0].observedAt,
        );
  const revalidationDue = Boolean(
    options.asOf &&
    latestEvidenceAt &&
    sufficiency.state === "sufficient" &&
    posteriorMean >= thresholds.demonstratedMinimum &&
    differenceInDays(latestEvidenceAt, options.asOf) >=
      thresholds.revalidateAfterDays,
  );

  let state: LearnerCognitiveState;
  if (effectiveClaims.length === 0) state = "unobserved";
  else if (revalidationDue) state = "revalidate";
  else if (
    sufficiency.state !== "sufficient" ||
    posteriorMean < thresholds.demonstratedMinimum
  ) {
    state = "forming";
  } else if (posteriorMean >= thresholds.robustMinimum) state = "robust";
  else state = "demonstrated";

  return {
    learnerId: query.learnerId,
    entityId: query.entityId,
    ...(query.entityKind === undefined ? {} : { entityKind: query.entityKind }),
    dimension: query.dimension,
    state,
    evidenceSignal,
    revalidationDue,
    latestEvidenceAt,
    alpha,
    beta,
    posteriorMean,
    observedMean,
    variance,
    evidenceCount: effectiveClaims.length,
    successWeight: contribution.successWeight,
    failureWeight: contribution.failureWeight,
    effectiveWeight,
    sufficiency,
  };
}
