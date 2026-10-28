import type { DomainEventOutboxRecord } from "./domain-event-port.js";
import type { TaskAttemptPersistenceRecord } from "./task-attempt-port.js";
import type {
  VerifiedEvidenceAppendResult,
  VerifiedEvidenceContextDistance,
  VerifiedEvidenceJsonObject,
  VerifiedEvidenceSource,
  VerifiedEvidenceTaskKind,
  VerifiedObservationCandidate,
  VerifiedObservationEvaluatorPolicy,
} from "./verified-evidence-append-port.js";

export type MaterialCheckTaskRequirement = Readonly<{
  learningTargetId: string | null;
  cognitiveEntityId: string;
  dimension: string;
  criterionRef: string;
  definitionVersion: number;
  required: boolean;
  weight: number;
  orderIndex: number;
  rubricCriterion?: VerifiedEvidenceJsonObject;
}>;

export type MaterialCheckTaskDefinition = Readonly<{
  goalId: string;
  unitId: string;
  stableKey: string;
  taskType: "quiz" | "interaction";
  title: string;
  instructions: string;
  context: VerifiedEvidenceJsonObject;
  rubric: VerifiedEvidenceJsonObject;
  difficulty: string;
  definitionVersion: number;
  origin: "material_check" | "material_interaction";
  evidencePolicy: Readonly<{
    source: VerifiedEvidenceSource;
    taskKind: VerifiedEvidenceTaskKind;
    contextKey: string;
    contextDistance: VerifiedEvidenceContextDistance;
    rubricId: string;
  }>;
  requirements: readonly MaterialCheckTaskRequirement[];
}>;

export type MaterialCheckCompletionItem = Readonly<{
  stableKey: string;
  requirementIndex: number;
  idempotencyKey: string;
  response: VerifiedEvidenceJsonObject;
  submittedAt: Date;
  completedAt: Date;
  candidate: Omit<VerifiedObservationCandidate, "requirementId">;
  evaluator: VerifiedObservationEvaluatorPolicy;
}>;

export type CompleteMaterialCheckBatchInput = Readonly<{
  expectedUnitRevision?: number;
  expectedSection?: Readonly<{id:string;revision:number}>;
  userId: string;
  goalId: string;
  unitId: string;
  tasks: readonly MaterialCheckTaskDefinition[];
  completions: readonly MaterialCheckCompletionItem[];
  domainEvent: Readonly<{
    type: string;
    schemaVersion?: number;
    idempotencyKey: string;
    payload: Readonly<Record<string, unknown>>;
  }>;
}>;

export type MaterialCheckCompletionItemResult = Readonly<{
  attempt: TaskAttemptPersistenceRecord;
  evidence: VerifiedEvidenceAppendResult;
  replayed: boolean;
}>;

export type MaterialCheckCompletionResult = Readonly<{
  items: readonly MaterialCheckCompletionItemResult[];
  domainEvent: DomainEventOutboxRecord;
  replayed: boolean;
}>;

/**
 * Atomic persistence for published inline material checks and section
 * mini-tests. Task declarations, evaluated attempts, evidence/state replay,
 * and the completed domain fact share one caller-owned ORM transaction.
 * Learner-memory and Agenda invalidation remain application-owned after the
 * commit.
 */
export interface MaterialCheckCompletionRepository {
  completeInteraction(input: {
    userId: string;
    goalId: string;
    unitId: string;
    task: MaterialCheckTaskDefinition;
    idempotencyKey: string;
    response: unknown;
    score: number;
    outcome: "correct" | "incorrect";
    evaluatorRunId: string;
  }): Promise<{ observationCount: number; replayed: boolean }>;
  publishTasksIfMaterialMatches(input: {
    userId: string;
    goalId: string;
    unitId: string;
    expectedMaterial: Readonly<{
      introduction: string;
      sections: string;
      keyTakeaways: string;
    }>;
    tasks: readonly MaterialCheckTaskDefinition[];
  }): Promise<boolean>;
  listAttempts(input: {
    userId: string;
    unitId: string;
    checkIds?: readonly string[];
  }): Promise<readonly { response: unknown; submittedAt: Date | null }[]>;
  publishTasks(input: { userId: string; goalId: string; unitId: string; tasks: readonly MaterialCheckTaskDefinition[] }): Promise<{ publishedCheckIds: readonly string[]; deprecatedCount: number }>;
  complete(
    input: CompleteMaterialCheckBatchInput,
  ): Promise<MaterialCheckCompletionResult>;
}
