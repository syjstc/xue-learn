export type LearningModuleRecord = Readonly<{
  id: string;
  curriculumKey: string;
  goalId: string;
  planRef: string;
  orderIndex: number;
  title: string;
  summary: string;
  objective: string;
  plannedOutcomes: readonly string[];
  unlockStatus: string;
  generationStatus: string;
  generationVersion: number;
  createdAt: Date;
  updatedAt: Date;
}>;

/** Narrow owner-scoped module projection; generation and task writes follow later. */
export interface LearningModuleRepository {
  listOwnedForGoal(
    userId: string,
    goalId: string,
  ): Promise<readonly LearningModuleRecord[]>;
}
