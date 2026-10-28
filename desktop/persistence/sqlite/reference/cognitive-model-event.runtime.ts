import type {
  CognitiveModelEventRepository,
  EnqueueCognitiveModelExpansionInput,
  EnqueueCognitiveModelExpansionResult,
  RecoverFailedCognitiveModelUnitInput,
  RecoverFailedCognitiveModelUnitResult,
} from "@xue-learn/core/domain";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Transaction-owning composition adapter for cognitive-model readiness events. */
export class MikroOrmCognitiveModelEventRuntimeAdapter implements CognitiveModelEventRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  enqueueNext(
    input: EnqueueCognitiveModelExpansionInput,
  ): Promise<EnqueueCognitiveModelExpansionResult | null> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.cognitiveModelEvent.enqueueNext(input),
    );
  }

  inspectGoal(goalId: string) {
    return this.runtime.runInTransaction((repositories) =>
      repositories.cognitiveModelEvent.inspectGoal(goalId),
    );
  }

  recoverFailedUnit(
    input: RecoverFailedCognitiveModelUnitInput,
  ): Promise<RecoverFailedCognitiveModelUnitResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.cognitiveModelEvent.recoverFailedUnit(input),
    );
  }
}
