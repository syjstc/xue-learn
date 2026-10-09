import type { CognitiveDimension } from "../module-objective-authority.js";

export type CognitiveEntityEvidenceSource =
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

export type CognitiveEntityEvidenceTaskKind =
  | "recall"
  | "explanation"
  | "routine_application"
  | "novel_application"
  | "integration"
  | "project"
  | "teaching"
  | "retention";

export type CognitiveEntityEvidenceContextDistance = "same" | "near" | "far";

export type CognitiveEntityEvidenceAssistanceLevel =
  | "independent"
  | "light_hint"
  | "guided"
  | "worked_example"
  | "answer_revealed";

export type CognitiveEntityEvidenceEvaluator =
  "deterministic" | "llm" | "human" | "self";

export type CognitiveEntityEvidenceLifecycleStatus =
  "active" | "retracted" | "superseded" | "invalidated";

/** Stable learner-facing audit record for one cognitive-entity evidence claim. */
export type CognitiveEntityEvidenceClaimRecord = Readonly<{
  id: string;
  entityId: string;
  dimension: CognitiveDimension;
  source: CognitiveEntityEvidenceSource;
  taskKind: CognitiveEntityEvidenceTaskKind;
  taskTitle: string;
  contextDistance: CognitiveEntityEvidenceContextDistance;
  assistanceLevel: CognitiveEntityEvidenceAssistanceLevel;
  evaluator: CognitiveEntityEvidenceEvaluator;
  criterionRef: string;
  definitionVersion: number;
  outcome: number;
  effectiveWeight: number;
  lifecycleStatus: CognitiveEntityEvidenceLifecycleStatus;
  taskId: string;
  attemptId: string;
  observedAt: string;
  explanation?: string;
}>;

export type CognitiveEntityEvidenceReadRecord = Readonly<{
  claims: readonly CognitiveEntityEvidenceClaimRecord[];
}>;

/** Learner-scoped, read-only audit access for one cognitive entity. */
export interface CognitiveEntityEvidenceReadRepository {
  findForEntity(input: {
    userId: string;
    cognitiveEntityId: string;
  }): Promise<CognitiveEntityEvidenceReadRecord | null>;
}
