import type {
  CompleteVerifiedAssessmentInput,
  VerifiedAssessmentCompletionRepository,
  VerifiedAssessmentCompletionResult,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Transaction-owning runtime adapter for adaptive-assessment completion. */
export class MikroOrmVerifiedAssessmentCompletionRuntimeAdapter implements VerifiedAssessmentCompletionRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  complete(
    input: CompleteVerifiedAssessmentInput,
  ): Promise<VerifiedAssessmentCompletionResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.verifiedAssessmentCompletion.complete(input),
    );
  }
}
