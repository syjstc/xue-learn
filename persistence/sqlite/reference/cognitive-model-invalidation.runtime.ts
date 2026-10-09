import type {
  CognitiveModelInvalidationRepository,
  InvalidateCognitiveModelInput,
  InvalidateCognitiveModelResult,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Transaction-owning composition adapter for curriculum invalidation. */
export class MikroOrmCognitiveModelInvalidationRuntimeAdapter implements CognitiveModelInvalidationRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  invalidate(
    input: InvalidateCognitiveModelInput,
  ): Promise<InvalidateCognitiveModelResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.cognitiveModelInvalidation.invalidate(input),
    );
  }
}
