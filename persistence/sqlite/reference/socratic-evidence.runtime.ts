import type {
  RecordSocraticEvidenceInput,
  RecordSocraticEvidenceResult,
  SocraticEvidenceRepository,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Runtime adapter for atomic hosted Socratic evidence writes. */
export class MikroOrmSocraticEvidenceRuntimeAdapter implements SocraticEvidenceRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  record(
    input: RecordSocraticEvidenceInput,
  ): Promise<RecordSocraticEvidenceResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.socraticEvidence.record(input),
    );
  }
}
