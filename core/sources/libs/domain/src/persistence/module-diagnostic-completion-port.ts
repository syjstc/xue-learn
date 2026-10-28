import type { TaskAttemptPersistenceRecord } from "./task-attempt-port.js";
import type { CognitiveDimension } from "../module-objective-authority.js";
import type {
  VerifiedEvidenceContextDistance,
  VerifiedEvidenceAppendResult,
  VerifiedEvidenceJsonObject,
  VerifiedEvidenceLearnerStateRecord,
  VerifiedEvidenceTaskKind,
  VerifiedObservationCandidate,
  VerifiedObservationEvaluatorPolicy,
} from "./verified-evidence-append-port.js";

export type ModuleDiagnosticTaskRequirement = Readonly<{
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

export type ModuleDiagnosticTaskDefinition = Readonly<{
  goalId: string;
  moduleId: string;
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
  requirements: readonly ModuleDiagnosticTaskRequirement[];
}>;

export type ModuleDiagnosticCompletionItem = Readonly<{
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

export type ModuleDiagnosticFinalization = Readonly<{
  responseJson: string;
  overallScore: number;
  passed: boolean;
  perCapabilityResultsJson: string;
  submittedAt: Date;
}>;

export type CompleteModuleDiagnosticInput = Readonly<{
  userId: string;
  goalId: string;
  moduleId: string;
  mainTaskId: string;
  legacyAttemptId?: string;
  mainAttemptIdempotencyKey: string;
  mainResponseContext: VerifiedEvidenceJsonObject;
  tasks: readonly ModuleDiagnosticTaskDefinition[];
  completions: readonly ModuleDiagnosticCompletionItem[];
  submittedAt: Date;
  startedAt: Date;
  /** Pure deterministic decision over the post-evidence state. */
  finalize: (
    input: Readonly<{
      states: ReadonlyMap<string, VerifiedEvidenceLearnerStateRecord | null>;
    }>,
  ) => Promise<ModuleDiagnosticFinalization>;
}>;

export type ModuleDiagnosticCompletionResult = Readonly<{
  attempt: TaskAttemptPersistenceRecord;
  evidence: readonly VerifiedEvidenceAppendResult[];
  finalization: ModuleDiagnosticFinalization;
  replayed: boolean;
}>;

/**
 * Atomic module diagnostic submission. The module task attempt, all verified
 * evidence/state replay, and its final response share one ORM transaction.
 */
export interface ModuleDiagnosticCompletionRepository {
  publishMainTask(input: {
    userId: string;
    goalId: string;
    moduleId: string;
    stableKey: string;
    title: string;
    instructions: string;
    context: VerifiedEvidenceJsonObject;
    rubric: VerifiedEvidenceJsonObject;
  }): Promise<{ id: string }>;
  complete(
    input: CompleteModuleDiagnosticInput,
  ): Promise<ModuleDiagnosticCompletionResult>;
}
