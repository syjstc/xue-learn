import type {
  AssistanceLevel,
  CognitiveDimension,
  CognitiveEntityKind,
  ContextDistance,
  EvidenceClaim as DomainEvidenceClaim,
  EvidenceEvaluator,
  EvidenceSource,
  EvidenceStrength,
  EvidenceSufficiencyReason,
  EvidenceTaskKind,
  LearnerCognitiveState,
} from "../types.js";

export type JsonObject = Record<string, unknown>;

export type TaskEvidencePolicy = {
  source: EvidenceSource;
  taskKind: EvidenceTaskKind;
  contextKey: string;
  contextDistance: ContextDistance;
  delayedDays?: number;
  rubricId?: string;
  assessmentFormat?: "mcq" | "mcq_multi" | "true_false";
  fluency?: {
    taskFamily: string;
    qualityThreshold: number;
    targetDurationMs: number;
    minimumDurationMs: number;
  };
};

export type TaskRequirementDeclaration = {
  cognitiveEntityId: string;
  learningTargetId?: string;
  dimension: CognitiveDimension;
  criterionRef: string;
  definitionVersion: number;
  role?: "primary" | "supporting";
  required?: boolean;
  weight?: number;
  orderIndex?: number;
  rubricCriterion?: JsonObject;
};

export type LearningTaskDeclaration = {
  goalId: string;
  moduleId?: string;
  unitId?: string;
  stableKey: string;
  taskType:
    | "quiz"
    | "diagnostic"
    | "explanation"
    | "interaction"
    | "project"
    | "review";
  title: string;
  instructions?: string;
  context?: JsonObject;
  rubric?: JsonObject;
  difficulty?: string;
  definitionVersion: number;
  origin?: string;
  evidencePolicy: TaskEvidencePolicy;
  requirements: readonly TaskRequirementDeclaration[];
};

export type TaskAttemptInput = {
  taskId: string;
  userId: string;
  unitId?: string;
  idempotencyKey: string;
  context?: JsonObject;
  response?: JsonObject;
  artifactRefs?: readonly string[];
  artifactVersionRefs?: readonly JsonObject[];
  processLog?: readonly JsonObject[];
  assistanceTrace?: readonly JsonObject[];
  assistance: {
    level: AssistanceLevel;
    hintCount: number;
    answerRevealed: boolean;
  };
  durationMs?: number;
  status?: "started" | "submitted" | "evaluated" | "abandoned";
  startedAt?: Date;
  submittedAt?: Date;
  completedAt?: Date;
  /** False for terminal guided flows (for example Socratic round limits). */
  positiveEvidenceEligible?: boolean;
};

/**
 * The only evaluator-facing write shape. Identity, dimension, rubric criterion,
 * definition version and evidence source are assertions, never authorities.
 */
export type TaskObservationCandidate = {
  requirementId: string;
  score: number;
  outcome?: string;
  rawResult?: JsonObject;
  metadata?: JsonObject;
  observedAt?: Date;
  /** Stable evaluator invocation id; the server scopes and hashes it. */
  evaluatorRunId: string;
  assertedCognitiveEntityId?: string;
  assertedLearningTargetId?: string;
  assertedDimension?: CognitiveDimension;
  assertedCriterionRef?: string;
  assertedDefinitionVersion?: number;
};

/** Trusted server configuration, never accepted from a learner or an LLM. */
export type ObservationEvaluatorPolicy = {
  evaluatorType: EvidenceEvaluator;
  evaluatorRef?: string;
  /** Server-derived lineage for an authority-validated observed context. */
  contextLineageKey?: string;
  evaluatorReliability: number;
  groundingReliability: number;
  evidenceStrength?: EvidenceStrength;
};

export type LearnerDimensionStateDto = {
  dimension: CognitiveDimension;
  estimate: number | null;
  evidenceSufficiency: number;
  evidenceSufficiencyReasons: EvidenceSufficiencyReason[];
  status: LearnerCognitiveState;
  effectiveEvidenceWeight: number;
  lastObservedAt: string | null;
};

export type LearnerEntityStateDto = {
  overallEstimate: number | null;
  evidenceSufficiency: number;
  status: LearnerCognitiveState;
  inferencePolicyVersion: number;
  stateRevision: number;
  evidenceCutoffAt: string | null;
  lifecycleCutoffAt: string | null;
  dimensions: LearnerDimensionStateDto[];
};

export type EvidenceClaimDto = {
  id: string;
  entityId: string;
  dimension: CognitiveDimension;
  source: EvidenceSource;
  taskKind: EvidenceTaskKind;
  taskTitle: string;
  contextDistance: ContextDistance;
  assistanceLevel: AssistanceLevel;
  evaluator: EvidenceEvaluator;
  criterionRef: string;
  definitionVersion: number;
  outcome: number;
  effectiveWeight: number;
  lifecycleStatus: "active" | "retracted" | "superseded" | "invalidated";
  taskId: string;
  attemptId: string;
  observedAt: string;
  explanation?: string;
};

export type LearnerEntityEvidenceDto = {
  claims: EvidenceClaimDto[];
};

export type RequirementRecord = {
  id: string;
  taskId: string;
  learningTargetId: string | null;
  cognitiveEntityId: string | null;
  dimension: string;
  rubricCriterion: unknown;
  cognitiveEntity: {
    id: string;
    goalId: string | null;
    kind: string;
    title: string;
    definitionVersion: number;
    status: string;
  } | null;
  learningTarget: {
    id: string;
    goalId: string;
    definitionVersion: number;
    status: string;
  } | null;
};

export type AttemptDeclarationRecord = {
  id: string;
  taskId: string;
  userId: string;
  status: string;
  context: unknown;
  artifactRefs: unknown;
  assistanceLevel: number;
  hintCount: number;
  durationMs: number | null;
  startedAt: Date;
  submittedAt?: Date | null;
  task: {
    id: string;
    goalId: string;
    taskType: string;
    status: string;
    context: unknown;
    rubric: unknown;
    definitionVersion: number;
    goal: { userId: string | null };
  };
};

export type ValidatedObservationDeclaration = {
  requirement: RequirementRecord;
  policy: TaskEvidencePolicy;
  assistance: {
    level: AssistanceLevel;
    hintCount: number;
    answerRevealed: boolean;
  };
  entityKind: CognitiveEntityKind;
  definitionVersion: number;
  criterionRef: string;
  independence: number;
  domainClaim: DomainEvidenceClaim;
};

export type EvidenceLifecycleProjectionStatus =
  | "active"
  | "retracted"
  | "superseded"
  | "invalidated";

export type LifecycleEventProjection = {
  id: string;
  eventType: string;
  createdAt: Date;
  reason?: string;
  replacementClaimId?: string | null;
};

export type LearnerDimensionProjection = LearnerDimensionStateDto & {
  alpha: number;
  beta: number;
  observationCount: number;
};

export type LearnerEntityProjection = {
  estimate: number | null;
  evidenceSufficiency: number;
  status: LearnerCognitiveState;
  lastObservedAt: Date | null;
  dimensions: LearnerDimensionProjection[];
};
