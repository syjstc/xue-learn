/**
 * The durable memory trigger has one goal-scoped cleanup operation: when an
 * owned learning goal is deleted, remove memory candidates and records whose
 * scope is that goal. Revisions and evidence follow the record cascade.
 *
 * Keep this boundary narrower than the general memory repository. It does not
 * expose product selection, arbitrary scope types, filters, or a persistence
 * client. Adapters are responsible for validating ownership and preserving
 * the cleanup in the same unit of work as the goal deletion.
 */
export type DeleteOwnedGoalScopedMemoryInput = Readonly<{
  userId: string;
  goalId: string;
}>;

/** Direct rows removed by goal-scoped cleanup; dependent rows are cascaded. */
export type GoalScopedMemoryCleanupResult = Readonly<{
  recordsDeleted: number;
  candidatesDeleted: number;
}>;

/** Persistence boundary for cleanup of one learner-owned goal memory scope. */
export interface ScopedMemoryPort {
  deleteOwnedGoalScope(
    input: DeleteOwnedGoalScopedMemoryInput,
  ): Promise<GoalScopedMemoryCleanupResult>;
}
