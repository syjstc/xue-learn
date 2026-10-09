export type PublishOwnedMicroUnitInput = Readonly<{
  userId: string;
  goalId: string;
  goalTitle: string;
  contentLanguage: string;
  topicOverview: string;
  pathSource: string;
  unitTitle: string;
  difficulty: string;
  contentSummary: string;
}>;

export type PublishOwnedMicroUnitResult =
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "published"; unitId: string; title: string; contentSummary: string }>;

export type OwnedMicroUnitCreationContext = Readonly<{
  goal: Readonly<{ id: string; userId: string; title: string; level: string; contentLanguage: string; generationOptions: string }>;
  unit: Readonly<{ id: string; title: string; contentSummary: string; unitKind: string; sq3rData: string | null; hasLearningMaterial: boolean }> | null;
}>;

export type UpgradeOwnedOverviewToLessonInput = Readonly<{
  userId: string;
  goalId: string;
  unitId: string;
  title: string;
}>;

export type UpgradeOwnedOverviewToLessonResult =
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "upgraded"; unitId: string }>;

export type BeginOwnedMicroGoalConversionInput = Readonly<{
  userId: string;
  goalId: string;
  title: string;
  contentLanguage?: string;
}>;

export type BeginOwnedMicroGoalConversionResult =
  Readonly<{ status: "not_found" }> | Readonly<{ status: "started" }>;

export type RestoreOwnedMicroGoalInput = Readonly<{
  userId: string;
  goalId: string;
  unitId: string;
  originalUnit: Readonly<{
    title: string;
    contentSummary: string;
    unitKind: "lesson" | "overview";
    difficulty: string;
    prerequisites: string;
    status: string;
  }>;
  title: string;
  mapPlanStatus: string;
  detailedPlanStatus: string;
  contentLanguage?: string | null;
  restoreContentLanguage: boolean;
}>;

export type RestoreOwnedMicroGoalResult =
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "restored"; unitId: string }>;

export type OwnedMicroGoalConversionContext = Readonly<{
  goal: Readonly<{
    id: string;
    userId: string;
    title: string;
    level: string;
    contentLanguage: string;
    generationOptions: string;
    topicOverview: string;
    mapPlanStatus: string;
    detailedPlanStatus: string;
  }>;
  unit: Readonly<{
    id: string;
    title: string;
    contentSummary: string | null;
    unitKind: string;
    difficulty: string;
    prerequisites: string;
    status: string;
    childCount: number;
  }>;
}>;

/**
 * Atomic owner-scoped persistence for micro-unit publication and legacy
 * overview conversion. Content, SQ, and session generation stay outside this
 * boundary.
 */
export interface MicroUnitPublicationRepository {
  findOwnedCreationContext(userId: string, goalId: string): Promise<OwnedMicroUnitCreationContext | null>;
  findOwnedConversionContext(
    userId: string,
    goalId: string,
  ): Promise<OwnedMicroGoalConversionContext | null>;
  publishOwnedMicroUnit(
    input: PublishOwnedMicroUnitInput,
  ): Promise<PublishOwnedMicroUnitResult>;
  upgradeOwnedOverviewToLesson(
    input: UpgradeOwnedOverviewToLessonInput,
  ): Promise<UpgradeOwnedOverviewToLessonResult>;
  beginOwnedMicroGoalConversion(
    input: BeginOwnedMicroGoalConversionInput,
  ): Promise<BeginOwnedMicroGoalConversionResult>;
  restoreOwnedMicroGoal(
    input: RestoreOwnedMicroGoalInput,
  ): Promise<RestoreOwnedMicroGoalResult>;
}
