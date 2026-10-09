import type { PlanningMode } from "./planning-mode.js";

export type PlannedGoalLevel = "zero" | "basic" | "advanced";
export type PlannedGoalLearningMode = "exploration" | "mastery";

/**
 * Non-authoritative seed retained by a roadmap placeholder. Activating the
 * placeholder treats this as complete intake, asks no interview questions,
 * and still requires learner confirmation before normal planning begins.
 */
export type PlannedGoalBriefV1 = Readonly<{
  schemaVersion: 1;
  originalRequest: string;
  intendedOutcome: string;
  scopeIncluded: readonly string[];
  scopeExcluded: readonly string[];
  prerequisites: readonly string[];
  desiredOutputs: readonly string[];
  suggestedLevel: PlannedGoalLevel;
  suggestedLearningMode: PlannedGoalLearningMode;
  suggestedPlanningMode: PlanningMode;
  suggestedContentLanguage: string;
}>;

export type PlannedGoalBrief = PlannedGoalBriefV1;

export const PLANNED_GOAL_ACTIVATION_CONTEXT_START =
  "Planned-goal activation context (server-owned):";
export const PLANNED_GOAL_ACTIVATION_CONTEXT_END =
  "End planned-goal activation context (server-owned).";

/**
 * Remove server-owned placeholder metadata before presenting custom
 * instructions to a learner. Older checkpoints did not have an end marker, so
 * their internal block necessarily consumes the remainder of the field.
 */
export function learnerFacingGoalInstructions(value: unknown): string {
  if (typeof value !== "string") return "";

  const start = value.indexOf(PLANNED_GOAL_ACTIVATION_CONTEXT_START);
  if (start < 0) return value.trim();

  const end = value.indexOf(
    PLANNED_GOAL_ACTIVATION_CONTEXT_END,
    start + PLANNED_GOAL_ACTIVATION_CONTEXT_START.length,
  );
  const before = value.slice(0, start);
  const after =
    end < 0
      ? ""
      : value.slice(end + PLANNED_GOAL_ACTIVATION_CONTEXT_END.length);

  return [before.trim(), after.trim()].filter(Boolean).join("\n\n");
}
