import type {
  PersistOwnedSequentialCurriculumInput,
  PersistOwnedSequentialCurriculumResult,
  SequentialCurriculumApprovalRepository,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Transaction-owning runtime adapter for sequential curriculum approval. */
export class MikroOrmSequentialCurriculumApprovalRuntimeAdapter implements SequentialCurriculumApprovalRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  persistOwned(
    input: PersistOwnedSequentialCurriculumInput,
  ): Promise<PersistOwnedSequentialCurriculumResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.sequentialCurriculumApproval.persistOwned(input),
    );
  }
}
