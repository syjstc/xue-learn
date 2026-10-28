import type { CognitiveDimension } from "../module-objective-authority.js";

/** JSON object values remain opaque to the persistence boundary. */
export type VerifiedEvidenceJsonObject = Readonly<Record<string, unknown>>;

export type VerifiedEvidenceEvaluatorType =
  "deterministic" | "llm" | "human" | "self";

export type VerifiedEvidenceSource =
  | "quiz"
  | "diagnostic"
  | "review_quiz"
  | "flashcard"
  | "feynman"
  | "socratic"
  | "practice"
  | "project"
  | "teaching"
  | "human_observation";

export type VerifiedEvidenceTaskKind =
  | "recall"
  | "explanation"
  | "routine_application"
  | "novel_application"
  | "integration"
  | "project"
  | "teaching"
  | "retention";

export type VerifiedEvidenceContextDistance = "same" | "near" | "far";

export type VerifiedEvidenceStrength =
  "weak" | "moderate" | "strong" | "decisive";

export type VerifiedEvidenceAssistanceLevel =
  | "independent"
  | "light_hint"
  | "guided"
  | "worked_example"
  | "answer_revealed";

/** The evaluator-facing candidate; declarations are checked by the adapter. */
export type VerifiedObservationCandidate = Readonly<{
  requirementId: string;
  score: number;
  outcome?: string;
  rawResult?: VerifiedEvidenceJsonObject;
  metadata?: VerifiedEvidenceJsonObject;
  observedAt?: Date;
  /** Stable evaluator invocation id used to derive the idempotency key. */
  evaluatorRunId: string;
  assertedCognitiveEntityId?: string;
  assertedLearningTargetId?: string;
  assertedDimension?: CognitiveDimension;
  assertedCriterionRef?: string;
  assertedDefinitionVersion?: number;
}>;

/** Server-derived policy; none of these fields are learner-authoritative. */
export type VerifiedObservationEvaluatorPolicy = Readonly<{
  source: VerifiedEvidenceSource;
  taskKind: VerifiedEvidenceTaskKind;
  contextKey: string;
  contextDistance: VerifiedEvidenceContextDistance;
  delayedDays?: number;
  rubricId?: string;
  evaluatorType: VerifiedEvidenceEvaluatorType;
  evaluatorRef?: string;
  contextLineageKey?: string;
  evaluatorReliability: number;
  groundingReliability: number;
  evidenceStrength?: VerifiedEvidenceStrength;
}>;

export type AppendVerifiedEvidenceInput = Readonly<{
  userId: string;
  attemptId: string;
  candidate: VerifiedObservationCandidate;
  evaluator: VerifiedObservationEvaluatorPolicy;
}>;

export type VerifiedObservationRecord = Readonly<{
  id: string;
  attemptId: string;
  requirementId: string;
  learningTargetId: string | null;
  cognitiveEntityId: string;
  dimension: CognitiveDimension;
  outcome: string;
  score: number;
  evaluatorReliability: number;
  groundingReliability: number;
  independence: number;
  transferDistance: number;
  subjectDefinitionVersion: number;
  evaluatorType: VerifiedEvidenceEvaluatorType;
  evaluatorRef: string | null;
  rawResult: VerifiedEvidenceJsonObject;
  metadata: VerifiedEvidenceJsonObject;
  observedAt: Date;
}>;

/** The active claim created by the verified observation append. */
export type VerifiedEvidenceClaimRecord = Readonly<{
  id: string;
  userId: string;
  observationId: string;
  cognitiveEntityId: string;
  learningTargetId: string | null;
  misconceptionPatternId: string | null;
  dimension: CognitiveDimension;
  criterionRef: string;
  polarity: "supports" | "refutes";
  score: number;
  strength: number;
  evaluatorReliability: number;
  groundingReliability: number;
  definitionVersion: number;
  contextKey: string;
  status: "active";
  idempotencyKey: string;
  validFrom: Date;
  validUntil: null;
  createdAt: Date;
}>;

/** Created is the only lifecycle event emitted by this append operation. */
export type CreatedEvidenceLifecycleEventRecord = Readonly<{
  id: string;
  evidenceClaimId: string;
  eventType: "created";
  reason: string;
  actorUserId: string | null;
  replacementClaimId: null;
  payload: VerifiedEvidenceJsonObject;
  createdAt: Date;
}>;

export type VerifiedEvidenceLearnerDimensionStateRecord = Readonly<{
  id: string;
  learnerEntityStateId: string;
  dimension: CognitiveDimension;
  estimate: number | null;
  evidenceSufficiency: number;
  evidenceSufficiencyReasons: readonly string[];
  status: "unobserved" | "forming" | "demonstrated" | "robust" | "revalidate";
  alpha: number;
  beta: number;
  evidenceWeight: number;
  observationCount: number;
  lastObservedAt: Date | null;
  inferenceVersion: number;
  createdAt: Date;
  updatedAt: Date;
}>;

export type VerifiedEvidenceLearnerStateRecord = Readonly<{
  id: string;
  userId: string;
  cognitiveEntityId: string;
  estimate: number | null;
  evidenceSufficiency: number;
  status: "unobserved" | "forming" | "demonstrated" | "robust" | "revalidate";
  lastObservedAt: Date | null;
  lastEvidenceClaimId: string | null;
  inferenceVersion: number;
  createdAt: Date;
  updatedAt: Date;
  dimensions: readonly VerifiedEvidenceLearnerDimensionStateRecord[];
}>;

/** Immutable revision emitted when the learner state projection changes. */
export type VerifiedEvidenceLearnerStateRevisionRecord = Readonly<{
  id: string;
  userId: string;
  cognitiveEntityId: string;
  revision: number;
  evidenceCutoffAt: Date | null;
  evidenceCutoffClaimId: string | null;
  lifecycleCutoffAt: Date | null;
  inferenceVersion: number;
  estimate: number | null;
  evidenceSufficiency: number;
  status: "unobserved" | "forming" | "demonstrated" | "robust" | "revalidate";
  summarySnapshot: unknown;
  dimensionSnapshot: unknown;
  createdAt: Date;
}>;

export type VerifiedEvidenceAppendResult = Readonly<{
  observation: VerifiedObservationRecord;
  claim: VerifiedEvidenceClaimRecord;
  lifecycleEvent: CreatedEvidenceLifecycleEventRecord;
  state: VerifiedEvidenceLearnerStateRecord;
  revision: VerifiedEvidenceLearnerStateRevisionRecord;
  replayed: boolean;
}>;

/**
 * Atomic persistence for one validated learner observation.
 *
 * Implementations own declaration/ownership validation, the observation,
 * claim, append-only `created` lifecycle event, deterministic state replay,
 * and immutable state revision in one transaction. A retry identified by the
 * evaluator invocation must return the canonical complete result with
 * `replayed: true`; gap hypotheses and global-memory invalidation are outside
 * this capability boundary.
 */
export interface VerifiedEvidenceAppendRepository {
  recordVerifiedObservation(
    input: AppendVerifiedEvidenceInput,
  ): Promise<VerifiedEvidenceAppendResult>;
}
