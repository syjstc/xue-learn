import type {
  AdaptiveAssessmentSubmissionTask,
  ExistingTaskObservation,
  StartTaskAttemptPersistenceInput,
  StartTaskAttemptPersistenceResult,
  TaskAttemptRepository,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Transaction-owning composition adapter for task-attempt starts. */
export class MikroOrmTaskAttemptRuntimeAdapter implements TaskAttemptRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  findAdaptiveAssessmentTask(input: {
    userId: string;
    taskId: string;
  }): Promise<AdaptiveAssessmentSubmissionTask | null> {
    return this.runtime.repositories.taskAttempt.findAdaptiveAssessmentTask(
      input,
    );
  }

  findObservation(input: {
    attemptId: string;
    requirementId: string;
  }): Promise<ExistingTaskObservation | null> {
    return this.runtime.repositories.taskAttempt.findObservation(input);
  }

  start(
    input: StartTaskAttemptPersistenceInput,
  ): Promise<StartTaskAttemptPersistenceResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.taskAttempt.start(input),
    );
  }
}
