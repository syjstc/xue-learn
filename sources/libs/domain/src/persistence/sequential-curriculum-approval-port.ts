export type SequentialCurriculumFoundationBrief = Readonly<{
  ref: string;
  title: string;
  rationale: string;
  criticality: "critical" | "recommended";
  verificationDimensions: readonly (
    "memory" | "understanding" | "application"
  )[];
}>;

export type SequentialCurriculumUnitPlanningBrief = Readonly<{
  scopeSize: "compact" | "standard" | "large";
  rationale: string;
  progression: readonly string[];
}>;

/** Normalized primitive module contract owned by the sequential curriculum capability. */
export type SequentialCurriculumModulePlan = Readonly<{
  title: string;
  summary: string;
  objective: string;
  plannedOutcomes: readonly string[];
  entryFoundationBriefs: readonly SequentialCurriculumFoundationBrief[];
  exitCapabilityBriefs: readonly string[];
  estimatedUnitCount: number;
  unitPlanningBrief: SequentialCurriculumUnitPlanningBrief;
}>;

export type PersistOwnedSequentialCurriculumInput = Readonly<{
  userId: string;
  goalId: string;
  modules: readonly SequentialCurriculumModulePlan[];
  /** Dispatch the first module generation event in the same transaction. */
  enqueueFirst?: boolean;
}>;

export type PersistOwnedSequentialCurriculumResult =
  | Readonly<{ status: "not_found" }>
  | Readonly<{
      status: "created" | "existing";
      firstModuleId: string | null;
    }>;

/** Owner-scoped approval/publication boundary for sequential curriculum stubs. */
export interface SequentialCurriculumApprovalRepository {
  persistOwned(
    input: PersistOwnedSequentialCurriculumInput,
  ): Promise<PersistOwnedSequentialCurriculumResult>;
}
