import type {
  MaterialCheckCompletionRepository,
  CompleteMaterialCheckBatchInput,
  MaterialCheckCompletionResult,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

export class MikroOrmMaterialCheckCompletionRuntimeAdapter implements MaterialCheckCompletionRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  listAttempts(input: Parameters<MaterialCheckCompletionRepository["listAttempts"]>[0]) {
    return this.runtime.repositories.materialCheckCompletion.listAttempts(input);
  }
  publishTasksIfMaterialMatches(input: Parameters<MaterialCheckCompletionRepository["publishTasksIfMaterialMatches"]>[0]) {
    return this.runtime.runInTransaction((repositories) =>
      repositories.materialCheckCompletion.publishTasksIfMaterialMatches(input),
    );
  }

  publishTasks(input: Parameters<MaterialCheckCompletionRepository["publishTasks"]>[0]) {
    return this.runtime.runInTransaction(repositories => repositories.materialCheckCompletion.publishTasks(input));
  }

  complete(
    input: CompleteMaterialCheckBatchInput,
  ): Promise<MaterialCheckCompletionResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.materialCheckCompletion.complete(input),
    );
  }
  completeInteraction(input: Parameters<MaterialCheckCompletionRepository["completeInteraction"]>[0]) {
    return this.runtime.runInTransaction((repositories) =>
      repositories.materialCheckCompletion.completeInteraction(input),
    );
  }
}
