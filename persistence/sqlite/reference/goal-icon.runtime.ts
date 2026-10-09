import type {
  GoalIconRepository,
  GoalIconScope,
  SaveOwnedGoalIconInput,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Transaction-owning runtime adapter for goal-icon metadata. */
export class MikroOrmGoalIconRuntimeAdapter implements GoalIconRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  findOwned(input: GoalIconScope) {
    return this.runtime.runInTransaction((repositories) =>
      repositories.goalIcon.findOwned(input),
    );
  }

  saveOwnedIfEmpty(input: SaveOwnedGoalIconInput) {
    return this.runtime.runInTransaction((repositories) =>
      repositories.goalIcon.saveOwnedIfEmpty(input),
    );
  }
}
