export type CompleteUnitSectionInput = Readonly<{
  userId: string;
  unitId: string;
  sectionId: string;
  expectedUnitRevision?: number;
  expectedSectionRevision?: number;
  status: "in_progress" | "completed" | "skipped";
  startedAt: Date;
  contentCompletedAt: Date;
  completedAt: Date | null;
  skippedAt: Date | null;
  skipReason: string | null;
}>;

export type UnitSectionProgressRecord = Readonly<{
  id: string;
  userId: string;
  sectionId: string;
  status: string;
  activeSeconds: number;
  startedAt: Date | null;
  contentCompletedAt: Date | null;
  completedAt: Date | null;
  skippedAt: Date | null;
  skipReason: string | null;
  updatedAt: Date;
}>;

/** Owner-scoped final section-progress state transition. */
export interface UnitSectionProgressRepository {
  completeOwned(
    input: CompleteUnitSectionInput,
  ): Promise<UnitSectionProgressRecord>;
}
