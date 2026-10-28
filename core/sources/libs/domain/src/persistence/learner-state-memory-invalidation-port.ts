/** Post-commit invalidation of the rebuildable global learner-state cache. */
export interface LearnerStateMemoryInvalidationRepository {
  invalidate(input: {
    userId: string;
    reason: string;
    invalidatedAt?: Date;
  }): Promise<void>;
}
