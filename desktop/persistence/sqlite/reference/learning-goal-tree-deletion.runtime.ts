import type {
  DeleteOwnedLearningGoalTreeInput,
  DeleteOwnedLearningGoalTreeResult,
  LearningGoalTreeDeletionRepository,
} from "@xue-learn/core/domain";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Transaction-owning composition adapter for whole goal-tree deletion. */
export class MikroOrmLearningGoalTreeDeletionRuntimeAdapter implements LearningGoalTreeDeletionRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  deleteOwnedGoalTree(
    input: DeleteOwnedLearningGoalTreeInput,
  ): Promise<DeleteOwnedLearningGoalTreeResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.goalTreeDeletion.deleteOwnedGoalTree(input),
    );
  }
}
