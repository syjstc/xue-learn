export type GoalKind = "full" | "micro";

export function isMicroGoal(goal: { goalKind?: string | null }): boolean {
  return goal.goalKind === "micro";
}

export function usesCognitiveModel(goal: {
  goalKind?: string | null;
  learningMode?: string | null;
}): boolean {
  return goal.goalKind !== "micro" && goal.learningMode !== "exploration";
}

export function isOverviewUnitKind(unitKind?: string | null): boolean {
  return unitKind === "overview";
}

export function resolveGoalKind(isSmallCourse?: boolean): GoalKind {
  return isSmallCourse ? "micro" : "full";
}
