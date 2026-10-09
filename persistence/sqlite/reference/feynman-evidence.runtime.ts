import type {
  FeynmanEvidenceRepository,
  RecordFeynmanEvidenceInput,
  RecordFeynmanEvidenceResult,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Runtime adapter for atomic hosted Feynman evidence writes. */
export class MikroOrmFeynmanEvidenceRuntimeAdapter implements FeynmanEvidenceRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  record(
    input: RecordFeynmanEvidenceInput,
  ): Promise<RecordFeynmanEvidenceResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.feynmanEvidence.record(input),
    );
  }
}
