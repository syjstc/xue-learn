import type { GoalMapPlan } from "../../llm/schemas.js";

export const PLANNING_OUTCOME_REF = /^o_[1-9]\d*$/;
export const PLAN_AREA_REF = /^a_[1-9]\d*$/;

export type GoalPlanOutcome = {
  ref: string;
  label: string;
};

export type GoalPlanArea = {
  ref: string;
  title: string;
  description: string;
};

export function goalPlanOutcomes(plan: GoalMapPlan): GoalPlanOutcome[] {
  return plan.whatYouWillLearn.map((label, index) => ({
    ref: `o_${index + 1}`,
    label,
  }));
}

export function goalPlanAreas(plan: GoalMapPlan): GoalPlanArea[] {
  return plan.majorAreas.map((area, index) => ({
    ref: `a_${index + 1}`,
    title: area.title,
    description: area.description,
  }));
}

export function parsePlanningOutcomeRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.flatMap((item) =>
        typeof item === "string" && PLANNING_OUTCOME_REF.test(item.trim())
          ? [item.trim()]
          : [],
      ),
    ),
  ];
}

export function canonicalGoalPlanCoverage(plan: GoalMapPlan): {
  outcomes: GoalPlanOutcome[];
  areas: GoalPlanArea[];
} {
  return {
    outcomes: goalPlanOutcomes(plan),
    areas: goalPlanAreas(plan),
  };
}
