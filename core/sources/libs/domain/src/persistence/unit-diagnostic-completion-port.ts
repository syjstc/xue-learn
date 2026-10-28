import type { CognitiveDimension } from "../module-objective-authority.js";
import type { TaskAttemptPersistenceRecord } from "./task-attempt-port.js";
import type {
  VerifiedEvidenceAppendResult,
  VerifiedEvidenceContextDistance,
  VerifiedEvidenceJsonObject,
  VerifiedEvidenceLearnerStateRecord,
  VerifiedEvidenceSource,
  VerifiedEvidenceTaskKind,
  VerifiedObservationCandidate,
  VerifiedObservationEvaluatorPolicy,
} from "./verified-evidence-append-port.js";

export type UnitDiagnosticTaskRequirement = Readonly<{
  learningTargetId: string;
  cognitiveEntityId: string;
  dimension: CognitiveDimension;
  criterionRef: string;
  definitionVersion: number;
  required: boolean;
  weight: number;
  orderIndex: number;
  rubricCriterion?: VerifiedEvidenceJsonObject;
}>;

export type UnitDiagnosticTaskDefinition = Readonly<{
  goalId: string;
  unitId: string;
  stableKey: string;
  taskType: "diagnostic";
  title: string;
  instructions: string;
  context: VerifiedEvidenceJsonObject;
  rubric: VerifiedEvidenceJsonObject;
  difficulty: string;
  definitionVersion: number;
  origin: "generated_quiz";
  evidencePolicy: Readonly<{
    source: "diagnostic";
    taskKind: VerifiedEvidenceTaskKind;
    contextKey: string;
    contextDistance: VerifiedEvidenceContextDistance;
    rubricId: string;
    assessmentFormat: "mcq" | "mcq_multi" | "true_false";
  }>;
  requirements: readonly UnitDiagnosticTaskRequirement[];
}>;

export type UnitDiagnosticCompletionItem = Readonly<{
  stableKey: string;
  idempotencyKey: string;
  response: VerifiedEvidenceJsonObject;
  submittedAt: Date;
  completedAt: Date;
  candidates: readonly Readonly<{
    requirementIndex: number;
    candidate: Omit<VerifiedObservationCandidate, "requirementId">;
    evaluator: VerifiedObservationEvaluatorPolicy;
  }>[];
}>;

export type UnitDiagnosticFinalization = Readonly<{
  answersJson: string;
  resultsJson: string;
  perLearningTargetResultsJson: string;
  overallScore: number;
  passed: boolean;
  submittedAt: Date;
}>;

export type CompleteUnitDiagnosticInput = Readonly<{
  userId: string;
  goalId: string;
  unitId: string;
  diagnosticAttemptId: string;
  entityIds: readonly string[];
  tasks: readonly UnitDiagnosticTaskDefinition[];
  completions: readonly UnitDiagnosticCompletionItem[];
  /** Pure deterministic decision; it must not perform persistence. */
  finalize: (
    input: Readonly<{
      states: ReadonlyMap<string, VerifiedEvidenceLearnerStateRecord | null>;
    }>,
  ) => Promise<UnitDiagnosticFinalization>;
}>;

export type UnitDiagnosticCompletionItemResult = Readonly<{
  attempt: TaskAttemptPersistenceRecord;
  evidence: readonly VerifiedEvidenceAppendResult[];
  replayed: boolean;
}>;

export type UnitDiagnosticCompletionResult = Readonly<{
  attemptId: string;
  finalization: UnitDiagnosticFinalization;
  items: readonly UnitDiagnosticCompletionItemResult[];
  replayed: boolean;
}>;

/**
 * Atomic unit-diagnostic submission. Task publication, evaluated attempts,
 * evidence/state replay, and the DiagnosticAttempt snapshot share one ORM
 * transaction. Learner memory, Agenda, and progression remain after commit.
 */
export interface UnitDiagnosticCompletionRepository {
  complete(
    input: CompleteUnitDiagnosticInput,
  ): Promise<UnitDiagnosticCompletionResult>;
}
