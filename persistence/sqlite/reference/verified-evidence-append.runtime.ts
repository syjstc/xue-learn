import type {
  AppendVerifiedEvidenceInput,
  VerifiedEvidenceAppendRepository,
  VerifiedEvidenceAppendResult,
} from "@xue-learn/core/domain";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Transaction-owning runtime adapter for the verified evidence append. */
export class MikroOrmVerifiedEvidenceAppendRuntimeAdapter implements VerifiedEvidenceAppendRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  recordVerifiedObservation(
    input: AppendVerifiedEvidenceInput,
  ): Promise<VerifiedEvidenceAppendResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.verifiedEvidenceAppend.recordVerifiedObservation(input),
    );
  }
}
