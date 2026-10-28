export type ModuleTestOutRecord = Readonly<{
  moduleId: string;
  completionMethod: "test_out";
  nextModuleId: string | null;
}>;

export type CompleteModuleTestOutInput = Readonly<{
  userId: string;
  goalId: string;
  moduleId: string;
  attemptId: string;
  completedAt?: Date;
}>;

/** Owner-scoped module diagnostic/test-out transition. */
export interface ModuleTestOutRepository {
  completeOwned(
    input: CompleteModuleTestOutInput,
  ): Promise<ModuleTestOutRecord>;
}
