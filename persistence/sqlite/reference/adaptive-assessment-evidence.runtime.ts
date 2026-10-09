import type {
  AdaptiveAssessmentEvidenceRecord,
  AdaptiveAssessmentEvidenceRepository,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Transaction-owning runtime adapter for adaptive evidence reads. */
export class MikroOrmAdaptiveAssessmentEvidenceRuntimeAdapter implements AdaptiveAssessmentEvidenceRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  findActive(input: {
    userId: string;
    learningTargetIds: readonly string[];
    asOf?: Date;
  }): Promise<readonly AdaptiveAssessmentEvidenceRecord[]> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.adaptiveAssessmentEvidence.findActive(input),
    );
  }
}
