export type LegacyMapReplacementTargetBinding = Readonly<{
  learningTargetId: string;
  localRef: string;
  required: boolean;
  weight: number;
  orderIndex: number;
  role: string;
  isEntry: boolean;
  isExit: boolean;
}>;

export type LegacyMapReplacementUnit = Readonly<{
  ref: string;
  parentRef: string | null;
  prerequisiteRefs: readonly string[];
  unitKind: "lesson" | "module";
  title: string;
  orderIndex: number;
  difficulty: string;
  contentSummary: string;
  planAreaRef: string;
  planningOutcomeRefs: readonly string[];
  curriculumKey: string | null;
  cognitiveModelStatus: "pending" | "expanded";
  learningTargets: readonly LegacyMapReplacementTargetBinding[];
}>;

export type PersistOwnedLegacyMapReplacementInput = Readonly<{
  userId: string;
  goalId: string;
  title: string;
  level: string;
  domainTag: string;
  pathSource: string;
  contentLanguage: string;
  goalKind?: "full" | "micro";
  mapPlanStatus?: "pending";
  mapSummaryStatus?: "approved" | "skipped";
  detailedPlanStatus?: "ready";
  units: readonly LegacyMapReplacementUnit[];
}>;

export type LegacyMapReplacementGoalRecord = Readonly<{
  id: string;
  userId: string | null;
  title: string;
  level: string;
  domainTag: string;
  pathSource: string;
  contentLanguage: string;
}>;

export type LegacyMapReplacementUnitRecord = Readonly<{
  id: string;
  title: string;
  unitKind: string;
  parentUnitId: string | null;
  orderIndex: number;
  difficulty: string;
  contentSummary: string;
  prerequisites: string;
}>;

export type PersistOwnedLegacyMapReplacementResult =
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "invalid_input"; reason: string }>
  | Readonly<{
      status: "replaced";
      goal: LegacyMapReplacementGoalRecord;
      units: readonly LegacyMapReplacementUnitRecord[];
    }>;

export type LegacyMapReconciliationUnit = Readonly<{
  id: string;
  parentUnitId: string | null;
  title: string;
  contentSummary: string;
  curriculumKey: string;
  planAreaRef: string;
  planningOutcomeRefs: readonly string[];
  learningTargets: readonly LegacyMapReplacementTargetBinding[];
}>;

/** Atomic owner-scoped replacement of a legacy goal's generated map. */
export interface LegacyMapReplacementRepository {
  listOwnedReconciliationUnits(
    userId: string,
    goalId: string,
  ): Promise<readonly LegacyMapReconciliationUnit[] | null>;
  replaceOwned(
    input: PersistOwnedLegacyMapReplacementInput,
  ): Promise<PersistOwnedLegacyMapReplacementResult>;
}
