import type {
  SequentialCurriculumFoundationBrief,
  SequentialCurriculumUnitPlanningBrief,
} from "./sequential-curriculum-approval-port.js";

export type LockedModuleReplacement = Readonly<{
  title: string;
  summary: string;
  objective: string;
  plannedOutcomes: readonly string[];
  entryFoundationBriefs: readonly SequentialCurriculumFoundationBrief[];
  exitCapabilityBriefs: readonly string[];
  unitPlanningBrief: SequentialCurriculumUnitPlanningBrief;
  estimatedUnitCount: number;
}>;

export type ReplanOwnedLockedModulesInput = Readonly<{
  userId: string;
  goalId: string;
  /** Replacement records keyed by the immutable LearningModule id. */
  replacements: Readonly<Record<string, LockedModuleReplacement>>;
  mapPlanJson: string;
}>;

export type ReplanOwnedLockedModulesResult =
  | Readonly<{ status: "updated"; moduleIds: readonly string[] }>
  | Readonly<{ status: "goal_not_found" }>
  | Readonly<{ status: "replacement_required" }>
  | Readonly<{ status: "module_not_found"; moduleId: string }>
  | Readonly<{ status: "module_not_locked"; moduleId: string }>;

/** Atomic owner-scoped replacement of still-locked curriculum module stubs. */
export interface LockedModuleReplanningRepository {
  replanOwned(
    input: ReplanOwnedLockedModulesInput,
  ): Promise<ReplanOwnedLockedModulesResult>;
}
