import type {
  CognitiveEntityEvidenceReadRecord,
  CognitiveEntityEvidenceReadRepository,
} from "@xue-learn/core/domain";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Runtime adapter for learner-owned cognitive-entity evidence audit reads. */
export class MikroOrmCognitiveEntityEvidenceReadRuntimeAdapter implements CognitiveEntityEvidenceReadRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  findForEntity(input: {
    userId: string;
    cognitiveEntityId: string;
  }): Promise<CognitiveEntityEvidenceReadRecord | null> {
    return this.runtime.repositories.cognitiveEntityEvidenceRead.findForEntity(
      input,
    );
  }
}
