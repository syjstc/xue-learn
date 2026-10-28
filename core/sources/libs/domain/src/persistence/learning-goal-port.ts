export type LearningGoalRecord = Readonly<{
  id: string;
  userId: string | null;
  parentGoalId: string | null;
  title: string;
  level: string;
  domainTag: string;
  topicCategory: string;
  contentLanguage: string;
  teachingPersonaRef: string | null;
  generationOptions: string;
  goalKind: string;
  learningMode: string;
  learningModeTransitionStatus: string;
  learningModeTransitionToken: string | null;
  learningModeTransitionStartedAt: Date | null;
  learningModeTransitionError: string;
  learningModeTransitionArtifacts: Record<string, unknown>;
  planningMode: string;
  curriculumVersion: number;
  status: string;
  pathSource: string;
  topicOverview: string;
  mapSummaryJson: string;
  mapSummaryStatus: string;
  mapPlanJson: string;
  mapPlanStatus: string;
  detailedPlanStatus: string;
  cognitiveModelEnabled: boolean;
  cognitiveModelStatus: string;
  cognitiveModelVersion: number;
  cognitiveModelInputHash: string;
  cognitiveModelPublishedHash: string;
  iconSvg: string;
  iconTint: string;
  goalRelationType: string | null;
  goalRelationContextJson: Record<string, unknown> | null;
  overviewCourseStatus: string;
  shareVisibility: string;
  activeShareId: string | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type CreateLearningGoalInput = Readonly<
  Pick<LearningGoalRecord, "id" | "title" | "level"> &
    Partial<
      Omit<
        LearningGoalRecord,
        "id" | "title" | "level" | "createdAt" | "updatedAt"
      >
    >
>;

export type UpdateLearningGoalInput = Readonly<
  Partial<
    Omit<
      LearningGoalRecord,
      "id" | "userId" | "parentGoalId" | "createdAt" | "updatedAt"
    >
  > & {
    parentGoalId?: string | null;
  }
>;

export type LastLearnedUnitRecord = Readonly<{
  goalId: string;
  id: string;
  title: string;
  status: string;
  updatedAt: Date;
}>;

/** Capability-specific persistence for owned goal metadata and lifecycle fields. */
export interface LearningGoalRepository {
  listLastLearnedUnits(
    goalIds: readonly string[],
  ): Promise<readonly LastLearnedUnitRecord[]>;
  sumLearningSecondsByGoalIds(
    goalIds: readonly string[],
  ): Promise<ReadonlyMap<string, number>>;
  listOwned(userId: string): Promise<readonly LearningGoalRecord[]>;
  findOwnedById(
    userId: string,
    goalId: string,
  ): Promise<LearningGoalRecord | null>;
  create(input: CreateLearningGoalInput): Promise<LearningGoalRecord>;
  updateOwned(
    userId: string,
    goalId: string,
    patch: UpdateLearningGoalInput,
  ): Promise<LearningGoalRecord | null>;
  deleteOwned(userId: string, goalId: string): Promise<boolean>;
}
