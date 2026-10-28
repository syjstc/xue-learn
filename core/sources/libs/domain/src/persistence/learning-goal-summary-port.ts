export type LearningGoalSummaryRecord = Readonly<{
  goalId: string;
  title: string;
  topicOverview: string;
  mapSummaryJson: string;
  mapSummaryStatus: string;
}>;

export type LearningGoalSummaryContext = Readonly<{
  id: string;
  userId: string;
  title: string;
  level: string;
  contentLanguage: string;
  generationOptions: string;
  goalKind: string;
  topicOverview: string;
  mapSummaryJson: string;
  mapSummaryStatus: string;
  unitCount: number;
  firstUnit: Readonly<{
    id: string;
    unitKind: string;
  }> | null;
}>;

export type UpdateOwnedLearningGoalSummaryInput = Readonly<{
  userId: string;
  goalId: string;
  title: string;
  topicOverview: string;
  mapSummaryJson: string;
}>;

export type PublishOwnedLearningGoalSummaryInput = Readonly<{
  userId: string;
  goalId: string;
  title: string;
  topicOverview: string;
  mapSummaryJson: string;
  pathSource: string;
  contentLanguage?: string;
  resetIcon?: boolean;
}>;

export type BeginOwnedLearningGoalSummaryResult =
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "locked" }>
  | Readonly<{ status: "started" }>;

export type LearningGoalSummaryMutationResult =
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "locked" }>
  | Readonly<{
      status: "updated";
      summary: LearningGoalSummaryRecord;
    }>;

export type LearningGoalSummaryApprovalResult =
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "locked" }>
  | Readonly<{ status: "summary_required" }>
  | Readonly<{ status: "approved" }>;

/** Owner-scoped map-summary writes for legacy goal planning. */
export interface LearningGoalSummaryRepository {
  findOwnedContext(
    userId: string,
    goalId: string,
  ): Promise<LearningGoalSummaryContext | null>;
  beginOwnedSummary(
    userId: string,
    goalId: string,
    pathSource: string,
  ): Promise<BeginOwnedLearningGoalSummaryResult>;
  updateOwnedSummary(
    input: UpdateOwnedLearningGoalSummaryInput,
  ): Promise<LearningGoalSummaryMutationResult>;
  publishOwnedSummary(
    input: PublishOwnedLearningGoalSummaryInput,
  ): Promise<LearningGoalSummaryMutationResult>;
  approveOwnedSummary(
    userId: string,
    goalId: string,
  ): Promise<LearningGoalSummaryApprovalResult>;
}
