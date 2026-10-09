/** Ownership checks for private media and learner-authored exports. */
export interface MediaAccessRepository {
  ownsGoal(userId: string, goalId: string): Promise<boolean>;
  ownsUnit(userId: string, unitId: string): Promise<boolean>;
}
