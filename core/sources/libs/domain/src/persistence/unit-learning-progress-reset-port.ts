export type UnitLearningProgressReset = Readonly<{
  reset: boolean;
  userId: string | null;
  affectedEntityIds: readonly string[];
}>;

export type ResetUnitLearningProgressInput = Readonly<{
  unitId: string;
}>;

/** Atomic learner-owned reset of completed-unit progress and evidence. */
export interface UnitLearningProgressResetRepository {
  resetOwned(
    input: ResetUnitLearningProgressInput,
  ): Promise<UnitLearningProgressReset>;
}
