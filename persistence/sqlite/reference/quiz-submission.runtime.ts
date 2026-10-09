import type {
  QuizSubmissionRepository,
  RecordQuizSubmissionInput,
  RecordQuizSubmissionResult,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Runtime adapter for the atomic active-recall quiz submission boundary. */
export class MikroOrmQuizSubmissionRuntimeAdapter implements QuizSubmissionRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  record(
    input: RecordQuizSubmissionInput,
  ): Promise<RecordQuizSubmissionResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.quizSubmission.record(input),
    );
  }
}
