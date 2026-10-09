export type LearningGoalSettingsPatch = Readonly<{
  title?: string;
  contentLanguage?: string;
  generationOptions?: string;
}>;

export type UpdateOwnedLearningGoalSettingsInput = Readonly<{
  userId: string;
  goalId: string;
  patch: LearningGoalSettingsPatch;
}>;

export type LearningGoalSettingsRecord = Readonly<{
  goalId: string;
  title: string;
  contentLanguage: string;
  generationOptions: string;
}>;

/** Owner-scoped settings mutation with no lifecycle side effects. */
export interface LearningGoalSettingsRepository {
  updateOwned(
    input: UpdateOwnedLearningGoalSettingsInput,
  ): Promise<LearningGoalSettingsRecord | null>;
}
