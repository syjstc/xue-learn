export type GoalTextbookReadRecord = Readonly<{
  id: string;
  title: string;
  level: string;
  topicOverview: string;
  mapPlanJson: string;
  createdAt: Date;
  units: readonly Readonly<{
    id: string;
    title: string;
    unitKind: string;
    parentUnitId: string | null;
    orderIndex: number;
    contentSummary: string;
    status: string;
    sq3rData: string | null;
    cornell: null | Readonly<{ notes: string; cues: string; summary: string }>;
  }>[];
}>;

export interface GoalTextbookReadRepository {
  find(goalId: string): Promise<GoalTextbookReadRecord | null>;
}
