import type { DomainEventOutboxRecord } from "./domain-event-port.js";
import type {
  VerifiedEvidenceAppendResult,
  VerifiedObservationCandidate,
  VerifiedObservationEvaluatorPolicy,
} from "./verified-evidence-append-port.js";

export type CompleteVerifiedAssessmentInput = Readonly<{
  userId: string;
  goalId: string;
  unitId?: string;
  taskId: string;
  attemptId: string;
  completedAt: Date;
  candidate: VerifiedObservationCandidate;
  evaluator: VerifiedObservationEvaluatorPolicy;
  domainEvent: Readonly<{
    type: string;
    schemaVersion?: number;
    idempotencyKey: string;
    payload: Readonly<Record<string, unknown>>;
  }>;
}>;

export type VerifiedAssessmentCompletionResult = Readonly<{
  evidence: VerifiedEvidenceAppendResult;
  attemptStatus: "evaluated";
  domainEvent: DomainEventOutboxRecord;
  replayed: boolean;
}>;

/**
 * Atomic completion boundary for a verified assessment.
 *
 * The implementation must finalize the attempt, append verified evidence, and
 * append the completed domain fact in one caller-owned transaction. Learner
 * memory and agenda invalidation remain application-owned after this commit.
 */
export interface VerifiedAssessmentCompletionRepository {
  complete(
    input: CompleteVerifiedAssessmentInput,
  ): Promise<VerifiedAssessmentCompletionResult>;
}
