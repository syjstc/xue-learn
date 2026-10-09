export type EnsureExplorationCurriculumReadyInput = Readonly<{
  userId: string;
  goalId: string;
}>;

/** Owner-scoped healing of already-materialized exploration curriculum rows. */
export interface ExplorationCurriculumReadyRepository {
  ensureOwned(input: EnsureExplorationCurriculumReadyInput): Promise<boolean>;
}
