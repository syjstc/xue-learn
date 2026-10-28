import type {
  LearnerStateMemoryInvalidationRepository,
  UnitLearningProgressReset,
  UnitLearningProgressResetRepository,
} from "../../../domain/src/index.js";

/**
 * Apply post-commit effects for a completed-unit reset.
 *
 * The reset write set, evidence replay, and rebuildable gap cleanup are owned
 * by UnitLearningProgressResetRepository.  This helper deliberately keeps
 * only the application-level cache invalidation outside that transaction.
 */
export async function refreshUnitLearningProgressReset(
  result: UnitLearningProgressReset,
  learnerStateMemoryInvalidation?: LearnerStateMemoryInvalidationRepository,
): Promise<void> {
  if (!result.reset || !result.userId || !learnerStateMemoryInvalidation) {
    return;
  }
  await learnerStateMemoryInvalidation.invalidate({
    userId: result.userId,
    reason: "unit_evidence_reset",
  });
}

export async function resetUnitLearningProgress(
  unitId: string,
  repository: UnitLearningProgressResetRepository,
  learnerStateMemoryInvalidation?: LearnerStateMemoryInvalidationRepository,
): Promise<boolean> {
  const result = await repository.resetOwned({ unitId });
  await refreshUnitLearningProgressReset(
    result,
    learnerStateMemoryInvalidation,
  );
  return result.reset;
}
