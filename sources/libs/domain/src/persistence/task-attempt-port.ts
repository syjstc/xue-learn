export type TaskAttemptPersistenceRecord = {
  id: string;
  taskId: string;
  userId: string;
  unitId: string | null;
  attemptNumber: number;
  status: string;
  context: unknown;
  response: unknown;
  artifactRefs: unknown;
  artifactVersionRefs: unknown;
  processLog: unknown;
  assistanceTrace: unknown;
  assistanceLevel: number;
  hintCount: number;
  durationMs: number | null;
  idempotencyKey: string | null;
  startedAt: Date;
  submittedAt: Date | null;
  completedAt: Date | null;
};

export type StartTaskAttemptPersistenceInput = {
  taskId: string;
  userId: string;
  unitId?: string;
  idempotencyKey: string;
  context: Record<string, unknown>;
  response: Record<string, unknown>;
  artifactRefs: readonly string[];
  artifactVersionRefs: readonly Record<string, unknown>[];
  processLog: readonly Record<string, unknown>[];
  assistanceTrace: readonly Record<string, unknown>[];
  assistanceLevel: number;
  hintCount: number;
  durationMs?: number;
  status: "started" | "submitted" | "evaluated" | "abandoned";
  startedAt?: Date;
  submittedAt?: Date;
  completedAt?: Date;
};

export type StartTaskAttemptPersistenceResult = {
  attempt: TaskAttemptPersistenceRecord;
  replayed: boolean;
};

export type AdaptiveAssessmentSubmissionTask = Readonly<{
  id: string;
  goalId: string;
  moduleId: string | null;
  unitId: string | null;
  title: string;
  instructions: string;
  context: Readonly<Record<string, unknown>>;
  rubric: Readonly<Record<string, unknown>>;
  goalTitle: string;
  requirements: readonly Readonly<{
    id: string;
    learningTargetId: string | null;
    cognitiveEntityId: string;
    dimension: string;
    rubricCriterion: Readonly<Record<string, unknown>>;
  }>[];
}>;

export type ExistingTaskObservation = Readonly<{
  score: number;
}>;

/**
 * Transaction-neutral attempt start boundary. The implementation owns task
 * ownership/status checks, attempt numbering, and idempotent creation; the
 * runtime adapter owns the transaction around it.
 */
export interface TaskAttemptRepository {
  findAdaptiveAssessmentTask(input: {
    userId: string;
    taskId: string;
  }): Promise<AdaptiveAssessmentSubmissionTask | null>;
  findObservation(input: {
    attemptId: string;
    requirementId: string;
  }): Promise<ExistingTaskObservation | null>;
  start(
    input: StartTaskAttemptPersistenceInput,
  ): Promise<StartTaskAttemptPersistenceResult>;
}
