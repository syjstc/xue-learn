export type DeleteOwnedLearningGoalTreeInput = Readonly<{
  userId: string;
  goalId: string;
}>;

export type DeleteOwnedLearningGoalTreeResult = Readonly<{
  deletedGoalIds: readonly string[];
  deletedResourceStorageKeys: readonly string[];
}>;

/**
 * Atomically removes an owned full-goal tree and its goal-scoped cleanup.
 *
 * The adapter owns child discovery, destructive-cascade authorization, memory
 * cleanup, and RAG cleanup outbox writes so callers cannot delete only the
 * parent and leave a foundation-support child behind.
 */
export interface LearningGoalTreeDeletionRepository {
  deleteOwnedGoalTree(
    input: DeleteOwnedLearningGoalTreeInput,
  ): Promise<DeleteOwnedLearningGoalTreeResult>;
}
