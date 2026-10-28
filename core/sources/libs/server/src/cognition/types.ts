export const COGNITIVE_DIMENSIONS = [
  "memory",
  "understanding",
  "application",
  "transfer",
  "fluency",
  "stability",
  "independence",
] as const;

export type CognitiveDimension = (typeof COGNITIVE_DIMENSIONS)[number];

export const COGNITIVE_ENTITY_KINDS = [
  "atom",
  "concept",
  "skill",
  "competency",
] as const;

export type CognitiveEntityKind = (typeof COGNITIVE_ENTITY_KINDS)[number];

export const EVIDENCE_SOURCES = [
  "quiz",
  "diagnostic",
  "review_quiz",
  "flashcard",
  "feynman",
  "socratic",
  "practice",
  "project",
  "teaching",
  "human_observation",
] as const;

export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

export const EVIDENCE_TASK_KINDS = [
  "recall",
  "explanation",
  "routine_application",
  "novel_application",
  "integration",
  "project",
  "teaching",
  "retention",
] as const;

export type EvidenceTaskKind = (typeof EVIDENCE_TASK_KINDS)[number];

export const CONTEXT_DISTANCES = ["same", "near", "far"] as const;

export type ContextDistance = (typeof CONTEXT_DISTANCES)[number];

export const EVIDENCE_EVALUATORS = [
  "deterministic",
  "llm",
  "human",
  "self",
] as const;

export type EvidenceEvaluator = (typeof EVIDENCE_EVALUATORS)[number];

export const EVIDENCE_STRENGTHS = [
  "weak",
  "moderate",
  "strong",
  "decisive",
] as const;

export type EvidenceStrength = (typeof EVIDENCE_STRENGTHS)[number];

export const ASSISTANCE_LEVELS = [
  "independent",
  "light_hint",
  "guided",
  "worked_example",
  "answer_revealed",
] as const;

export type AssistanceLevel = (typeof ASSISTANCE_LEVELS)[number];

export const LEARNER_COGNITIVE_STATES = [
  "unobserved",
  "forming",
  "demonstrated",
  "robust",
  "revalidate",
] as const;

export type LearnerCognitiveState = (typeof LEARNER_COGNITIVE_STATES)[number];

export const LEARNER_GAP_TYPES = [
  "knowledge",
  "relation",
  "combination",
  "strategy",
  "transfer",
  "stability",
] as const;

export type LearnerGapType = (typeof LEARNER_GAP_TYPES)[number];

export const EVIDENCE_SIGNALS = [
  "unobserved",
  "failure",
  "mixed",
  "success",
] as const;

export type EvidenceSignal = (typeof EVIDENCE_SIGNALS)[number];

export const EVIDENCE_SUFFICIENCY_STATES = [
  "unobserved",
  "insufficient",
  "sufficient",
] as const;

export type EvidenceSufficiencyState =
  (typeof EVIDENCE_SUFFICIENCY_STATES)[number];

export const EVIDENCE_SUFFICIENCY_REASONS = [
  "no_evidence",
  "too_few_claims",
  "low_effective_weight",
  "low_source_diversity",
  "low_task_diversity",
  "low_context_diversity",
  "short_time_span",
  "insufficient_independent_evidence",
  "missing_far_context",
] as const;

export type EvidenceSufficiencyReason =
  (typeof EVIDENCE_SUFFICIENCY_REASONS)[number];

export const COMBINATION_GAP_KINDS = [
  "none",
  "unobserved",
  "insufficient_evidence",
  "component_gap",
  "combination_gap",
  "transfer_gap",
  "independence_gap",
  "fluency_gap",
  "stability_gap",
  "mixed_gap",
] as const;

export type CombinationGapKind = (typeof COMBINATION_GAP_KINDS)[number];

export type CognitiveEntityRef = {
  id: string;
  kind: CognitiveEntityKind;
  definitionVersion?: number;
};

export type EvidenceTargetRef = CognitiveEntityRef;

export type EvidenceTaskRef = {
  id: string;
  kind: EvidenceTaskKind;
  contextId: string;
  contextDistance: ContextDistance;
  durationMs?: number;
  delayedDays?: number;
  artifactId?: string;
  rubricId?: string;
};

export type EvidenceAssistance = {
  level: AssistanceLevel;
  hintCount: number;
  answerRevealed: boolean;
};

/**
 * One atomic, auditable observation about one learner, target, and dimension.
 * Absence of a claim means unobserved; a score of zero is an observed failure.
 */
export type EvidenceClaim = {
  id: string;
  learnerId: string;
  target: EvidenceTargetRef;
  task: EvidenceTaskRef;
  source: EvidenceSource;
  dimension: CognitiveDimension;
  score: number;
  evaluator: EvidenceEvaluator;
  evaluatorReliability: number;
  strength: EvidenceStrength;
  assistance: EvidenceAssistance;
  /** Repeated observations summarized by this claim; normally one. */
  observations?: number;
  observedAt: string;
};

export type EvidenceLifecycleEvent =
  | {
      kind: "recorded";
      eventId: string;
      recordedAt: string;
      claim: EvidenceClaim;
    }
  | {
      kind: "retracted";
      eventId: string;
      recordedAt: string;
      claimId: string;
      reason: string;
    }
  | {
      kind: "superseded";
      eventId: string;
      recordedAt: string;
      claimId: string;
      replacement: EvidenceClaim;
      reason: string;
    };

function includesLiteral<const T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

export const isCognitiveDimension = (
  value: unknown,
): value is CognitiveDimension => includesLiteral(COGNITIVE_DIMENSIONS, value);

export const isCognitiveEntityKind = (
  value: unknown,
): value is CognitiveEntityKind =>
  includesLiteral(COGNITIVE_ENTITY_KINDS, value);

export const isEvidenceSource = (value: unknown): value is EvidenceSource =>
  includesLiteral(EVIDENCE_SOURCES, value);

export const isEvidenceTaskKind = (value: unknown): value is EvidenceTaskKind =>
  includesLiteral(EVIDENCE_TASK_KINDS, value);

export const isContextDistance = (value: unknown): value is ContextDistance =>
  includesLiteral(CONTEXT_DISTANCES, value);

export const isEvidenceEvaluator = (
  value: unknown,
): value is EvidenceEvaluator => includesLiteral(EVIDENCE_EVALUATORS, value);

export const isEvidenceStrength = (value: unknown): value is EvidenceStrength =>
  includesLiteral(EVIDENCE_STRENGTHS, value);

export const isLearnerGapType = (value: unknown): value is LearnerGapType =>
  includesLiteral(LEARNER_GAP_TYPES, value);

export const isAssistanceLevel = (value: unknown): value is AssistanceLevel =>
  includesLiteral(ASSISTANCE_LEVELS, value);
