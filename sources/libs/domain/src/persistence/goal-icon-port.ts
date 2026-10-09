export type GoalIconScope = Readonly<{
  userId: string;
  goalId: string;
}>;

export type GoalIconMetadata = Readonly<{
  id: string;
  title: string;
  iconSvg: string;
  iconTint: string;
}>;

export type SaveOwnedGoalIconInput = GoalIconScope &
  Readonly<{
    iconSvg: string;
    iconTint: string;
  }>;

/**
 * Owner-scoped persistence for generated goal-icon metadata.
 *
 * Generation happens outside this boundary. The conditional save is the
 * single writer and must never replace an icon that another request already
 * published while the model was running.
 */
export interface GoalIconRepository {
  findOwned(input: GoalIconScope): Promise<GoalIconMetadata | null>;
  saveOwnedIfEmpty(
    input: SaveOwnedGoalIconInput,
  ): Promise<GoalIconMetadata | null>;
}
