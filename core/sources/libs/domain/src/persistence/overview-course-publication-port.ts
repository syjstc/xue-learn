export type OverviewCourseMaterialInput = Readonly<{
  introduction: string;
  sections: string;
  keyTakeaways: string;
}>;

export type PublishOwnedOverviewCourseInput = Readonly<{
  userId: string;
  goalId: string;
  title: string;
  difficulty: string;
  contentSummary: string;
  note: string;
  material: OverviewCourseMaterialInput;
  topicOverview?: string;
}>;

export type PublishOwnedOverviewCourseResult =
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "published"; unitId: string }>;

export type EnsureOwnedOverviewCourseShellInput = Readonly<{
  userId: string;
  goalId: string;
  title: string;
  difficulty: string;
  contentSummary: string;
  note: string;
  topicOverview?: string;
}>;

export type EnsureOwnedOverviewCourseShellResult =
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "ready"; unitId: string; created: boolean }>;

export type BeginOwnedOverviewCourseResult =
  Readonly<{ status: "not_found" }> | Readonly<{ status: "started" }>;

export type CompleteOwnedOverviewUnitInput = Readonly<{
  userId: string;
  goalId: string;
  unitId: string;
  completedAt: Date | null;
}>;

export type CompletedOverviewUnitRecord = Readonly<{
  id: string;
  title: string;
  contentSummary: string;
  note: string;
  orderIndex: number;
  status: string;
  learningMaterial: OverviewCourseMaterialInput | null;
}>;

export type CompleteOwnedOverviewUnitResult =
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "updated"; unit: CompletedOverviewUnitRecord }>;

/** Owner-scoped publication of the single overview course for a goal. */
export interface OverviewCoursePublicationRepository {
  beginOwnedOverviewCourse(
    userId: string,
    goalId: string,
  ): Promise<BeginOwnedOverviewCourseResult>;
  ensureOwnedOverviewCourseShell(
    input: EnsureOwnedOverviewCourseShellInput,
  ): Promise<EnsureOwnedOverviewCourseShellResult>;
  publishOwnedOverviewCourse(
    input: PublishOwnedOverviewCourseInput,
  ): Promise<PublishOwnedOverviewCourseResult>;
  completeOwnedOverviewUnit(
    input: CompleteOwnedOverviewUnitInput,
  ): Promise<CompleteOwnedOverviewUnitResult>;
  updateOwnedOverviewMaterial(
    input: Readonly<{
      userId: string;
      goalId: string;
      unitId: string;
      material: OverviewCourseMaterialInput;
    }>,
  ): Promise<Readonly<{ status: "updated" | "not_found" }>>;
}
