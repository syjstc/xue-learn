export type LearningGoalPlanRecord = Readonly<{
  goalId: string;
  topicOverview: string;
  mapPlanJson: string;
  mapPlanStatus: string;
}>;

export type LearningGoalPlanContext = Readonly<{
  id: string;
  userId: string;
  title: string;
  level: string;
  goalKind: string;
  learningMode: string;
  parentGoalId: string | null;
  goalRelationType: string;
  goalRelationContextJson: unknown;
  planningMode: string;
  pathSource: string;
  contentLanguage: string;
  generationOptions: string;
  topicOverview: string;
  mapSummaryJson: string;
  mapSummaryStatus: string;
  mapPlanJson: string;
  mapPlanStatus: string;
  detailedPlanStatus: string;
  curriculumVersion: number;
  cognitiveModelEnabled: boolean;
  cognitiveModelInputHash: string | null;
  unitCount: number;
  moduleCount: number;
  documentCount: number;
  boundUnitCount: number;
  units: readonly Readonly<{
    id: string;
    title: string;
    unitKind: string;
    difficulty: string;
    contentSummary: string;
    orderIndex: number;
    parentUnitId: string | null;
    mapOrigin: string;
    mapEdited: boolean;
  }>[];
}>;

export type UpdateOwnedLearningGoalPlanInput = Readonly<{
  userId: string;
  goalId: string;
  topicOverview: string;
  mapPlanJson: string;
}>;

export type PublishOwnedLearningGoalPlanInput = Readonly<{
  userId: string;
  goalId: string;
  title: string;
  topicOverview: string;
  mapPlanJson: string;
  pathSource: string;
  domainTag: string;
  topicCategory: string;
  contentLanguage?: string;
  resetIcon?: boolean;
  /** Explicit revision requirements persisted atomically with the revised plan. */
  generationOptions?: string;
}>;

export type BeginOwnedLearningGoalPlanResult =
  Readonly<{ status: "not_found" }> | Readonly<{ status: "started" }>;

export type PublishOwnedLearningGoalDetailedPlanInput = Readonly<{
  userId: string;
  goalId: string;
  topicOverview: string;
  mapPlanJson: string;
  pathSource?: string;
  domainTag?: string;
  topicCategory?: string;
}>;

export type BeginOwnedLearningGoalDetailedPlanRefreshResult =
  Readonly<{ status: "not_found" }> | Readonly<{ status: "started" }>;

export type LearningGoalDetailedPlanFailureResult =
  Readonly<{ status: "not_found" }> | Readonly<{ status: "updated" }>;

export type LearningGoalPlanMutationResult =
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "locked" }>
  | Readonly<{
      status: "updated";
      plan: LearningGoalPlanRecord;
    }>;

export type LearningGoalPlanApprovalResult =
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "locked" }>
  | Readonly<{ status: "approved" }>;

export type LearningGoalPlanningModeMutationResult =
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "locked" }>
  | Readonly<{ status: "updated" }>;

/** Owner-scoped legacy goal-plan patching. */
export interface LearningGoalPlanRepository {
  findOwnedContext(
    userId: string,
    goalId: string,
  ): Promise<LearningGoalPlanContext | null>;
  countOwnedLessons(userId: string, goalId: string): Promise<number | null>;
  listOwnedOverviewBranches(
    userId: string,
    goalId: string,
  ): Promise<readonly Readonly<{ title: string; contentSummary: string }>[]>;
  listOwnedModules(
    userId: string,
    goalId: string,
  ): Promise<readonly Readonly<Record<string, unknown>>[]>;
  beginOwnedPlan(
    userId: string,
    goalId: string,
    pathSource: string,
  ): Promise<BeginOwnedLearningGoalPlanResult>;
  beginOwnedDetailedPlanRefresh(
    userId: string,
    goalId: string,
  ): Promise<BeginOwnedLearningGoalDetailedPlanRefreshResult>;
  publishOwnedDetailedPlan(
    input: PublishOwnedLearningGoalDetailedPlanInput,
  ): Promise<LearningGoalPlanMutationResult>;
  markOwnedDetailedPlanRefreshFailed(
    userId: string,
    goalId: string,
  ): Promise<LearningGoalDetailedPlanFailureResult>;
  updateOwnedPlan(
    input: UpdateOwnedLearningGoalPlanInput,
  ): Promise<LearningGoalPlanMutationResult>;
  publishOwnedPlan(
    input: PublishOwnedLearningGoalPlanInput,
  ): Promise<LearningGoalPlanMutationResult>;
  approveOwnedPlan(
    userId: string,
    goalId: string,
  ): Promise<LearningGoalPlanApprovalResult>;
  updateOwnedPlanningMode(
    userId: string,
    goalId: string,
    planningMode: string,
  ): Promise<LearningGoalPlanningModeMutationResult>;
}
