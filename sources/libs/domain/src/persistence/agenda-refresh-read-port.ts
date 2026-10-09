export type AgendaActiveRevisionRecord = Readonly<{
  id: string;
  contentHash: string;
  generationSource: string;
}>;

export type AgendaPlanningSectionRecord = Readonly<{
  id: string;
  unitId: string;
  title: string;
  orderIndex: number;
  baseEstimatedMinutes: number;
  progress: readonly Readonly<{
    status: string;
    activeSeconds: number;
    completedAt: Date | null;
  }>[];
}>;

export type AgendaPlanningUnitRecord = Readonly<{
  id: string;
  goalId: string;
  title: string;
  status: string;
  unitKind: string;
  parentUnitId: string | null;
  orderIndex: number;
  prerequisites: string;
  completedAt: Date | null;
  completionMethod: string | null;
  module: Readonly<{ unlockStatus: string }> | null;
  remediationSourceUnitId: string | null;
  supportKind: string | null;
  sections: readonly AgendaPlanningSectionRecord[];
}>;

export type AgendaPlanningGoalRecord = Readonly<{
  id: string;
  title: string;
  contentLanguage: string;
  units: readonly AgendaPlanningUnitRecord[];
}>;

export type AgendaPlanningReviewRecord = Readonly<{
  id: string;
  nextReviewAt: Date;
  unitId: string;
  unitTitle: string;
  unitStatus: string;
  goalId: string;
  goalTitle: string;
  cognitiveEntityIds: readonly string[];
}>;

export type AgendaPlanningGapRecord = Readonly<{
  id: string;
  status: string;
  gapType: string;
  primaryEntityId: string;
  supportingEntityIds: readonly string[];
  recommendedAction: Readonly<Record<string, unknown>>;
  severity: number;
  confidence: number;
  unit: Readonly<{
    id: string;
    goalId: string;
    title: string;
    status: string;
    goalTitle: string;
  }> | null;
}>;

export type AgendaPlanningInputs = Readonly<{
  goals: readonly AgendaPlanningGoalRecord[];
  learningSecondsByGoal: ReadonlyMap<string, number>;
  recentDailyActiveSeconds: readonly number[];
  previous: Readonly<{
    capacityMinutes: number;
    contentHash: string;
    planningDate: string;
  }> | null;
  reviews: readonly AgendaPlanningReviewRecord[];
  gaps: readonly AgendaPlanningGapRecord[];
}>;

export interface AgendaRefreshReadRepository {
  readPlanningInputs(
    input: Readonly<{
      userId: string;
      activityStart: string;
      planningDate: string;
      windowEnd: Date;
    }>,
  ): Promise<AgendaPlanningInputs>;
  listOwnedUnitSections(
    userId: string,
    unitIds: readonly string[],
  ): Promise<readonly AgendaPlanningSectionRecord[]>;
  listInvalidatedUsers(
    limit: number,
  ): Promise<readonly { userId: string; timezone: string }[]>;
  listRecentActiveGoalOwners(limit: number): Promise<readonly string[]>;
  findActiveRevision(
    userId: string,
    planningDate: string,
  ): Promise<AgendaActiveRevisionRecord | null>;
}
