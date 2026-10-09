import type {
  ResetUnitLearningProgressInput,
  UnitLearningProgressReset,
  UnitLearningProgressResetRepository,
} from "@xue-learn/core/domain";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Transaction-owning runtime adapter for completed-unit reset. */
export class MikroOrmUnitLearningProgressResetRuntimeAdapter implements UnitLearningProgressResetRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  resetOwned(
    input: ResetUnitLearningProgressInput,
  ): Promise<UnitLearningProgressReset> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.unitLearningProgressReset.resetOwned(input),
    );
  }
}
