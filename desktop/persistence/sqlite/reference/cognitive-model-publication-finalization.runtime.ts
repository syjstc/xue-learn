import type {
  CognitiveModelPublicationFinalizationRepository,
  CognitiveModelPublicationFinalizationResult,
  FinalizeCognitiveModelPublicationInput,
} from "@xue-learn/core/domain";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Transaction-owning composition adapter for cognitive-model finalization. */
export class MikroOrmCognitiveModelPublicationFinalizationRuntimeAdapter implements CognitiveModelPublicationFinalizationRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  finalize(
    input: FinalizeCognitiveModelPublicationInput,
  ): Promise<CognitiveModelPublicationFinalizationResult | null> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.cognitiveModelPublicationFinalization.finalize(input),
    );
  }

  promoteExisting(input: { goalId: string; unitId: string; inputHash: string }): Promise<CognitiveModelPublicationFinalizationResult | null> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.cognitiveModelPublicationFinalization.promoteExisting(input),
    );
  }
}
