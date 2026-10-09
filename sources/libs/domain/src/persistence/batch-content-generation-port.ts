export type BatchContentGoalRecord = Readonly<{
  id: string;
  userId: string;
  title: string;
  level: string;
  contentLanguage: string;
  generationOptions: string;
  goalKind: string;
  topicCategory: string;
  mapPlanJson: string;
  lessons: readonly Readonly<{
    id: string;
    title: string;
    contentSummary: string;
    contentRevision: number;
    sq3rData: string;
    hasMaterial: boolean;
  }>[];
}>;

export interface BatchContentGenerationRepository {
  findGoal(goalId: string): Promise<BatchContentGoalRecord | null>;
}
