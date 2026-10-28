export type UnitCompletionContext = Readonly<{
  unitId: string;
  goalId: string;
  userId: string;
  nextReviewAt: Date | null;
}>;

/** Owner-scoped context required by the completion application before commit. */
export interface UnitCompletionReadRepository {
  findOwnedContext(
    userId: string,
    unitId: string,
  ): Promise<UnitCompletionContext | null>;
}
