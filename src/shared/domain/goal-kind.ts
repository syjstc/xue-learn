export type GoalKind = "full" | "micro";

type GoalUnitRef = { id: string; unitKind: string };

export function isMicroGoal(goal: { goalKind?: string | null }): boolean {
  return goal.goalKind === "micro";
}

export function resolveMicroLessonUnit(
  goal: {
    units?: GoalUnitRef[];
    overviewCourse?: { units?: Array<{ id: string }> } | null;
  },
): GoalUnitRef | null {
  const overviewUnit = goal.overviewCourse?.units?.[0];
  if (overviewUnit?.id) {
    return { id: overviewUnit.id, unitKind: "overview" };
  }
  const units = goal.units ?? [];
  return (
    units.find((u) => u.unitKind === "overview") ??
    units.find((u) => u.unitKind === "lesson") ??
    units[0] ??
    null
  );
}

export function microGoalNavigatePath(
  goalId: string,
  unit: { id: string; unitKind: string } | null,
  isOverview?: boolean,
): string {
  if (!unit) return `/goals/${goalId}`;
  if (isOverview || unit.unitKind === "overview") {
    return `/goals/${goalId}/overview`;
  }
  return `/goals/${goalId}/units/${unit.id}`;
}

export function lessonPerformanceReturnPath(
  goalId: string,
  unitId: string,
  goal?: {
    goalKind?: string | null;
    units?: GoalUnitRef[];
    overviewCourse?: { units?: Array<{ id: string }> } | null;
    overviewCourseStatus?: string | null;
  },
): string {
  if (!goal || !isMicroGoal(goal)) {
    return `/goals/${goalId}/units/${unitId}`;
  }
  const unit = resolveMicroLessonUnit(goal);
  const isOverview =
    goal.overviewCourseStatus === "ready" ||
    unit?.unitKind === "overview" ||
    Boolean(goal.overviewCourse);
  return microGoalNavigatePath(
    goalId,
    unit ?? { id: unitId, unitKind: "lesson" },
    isOverview,
  );
}
