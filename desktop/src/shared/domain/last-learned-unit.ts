import type { GoalListItem, LastLearnedUnit } from "@/shared/api/types";

type UnitWithSession = {
  id: string;
  title: string;
  status: string;
  unitKind: string;
  moduleId?: string | null;
  sessionState?: { updatedAt?: string | Date } | null;
};

function sessionLearnedAt(unit: UnitWithSession): string | null {
  const updatedAt = unit.sessionState?.updatedAt;
  if (!updatedAt) return null;
  return typeof updatedAt === "string" ? updatedAt : updatedAt.toISOString();
}

export function resolveLastLearnedUnitFromUnits(
  units: readonly UnitWithSession[],
): LastLearnedUnit | null {
  let best: { unit: UnitWithSession; learnedAt: string } | null = null;

  for (const unit of units) {
    if (unit.unitKind !== "lesson") continue;
    const learnedAt = sessionLearnedAt(unit);
    if (!learnedAt) continue;
    if (!best || learnedAt > best.learnedAt) {
      best = { unit, learnedAt };
    }
  }

  if (!best) return null;

  return {
    id: best.unit.id,
    title: best.unit.title,
    status: best.unit.status,
    learnedAt: best.learnedAt,
  };
}

export function resolveGoalLastLearnedUnit(goal: {
  lastLearnedUnit?: LastLearnedUnit | null;
  units?: readonly UnitWithSession[];
}): LastLearnedUnit | null {
  return goal.lastLearnedUnit ?? resolveLastLearnedUnitFromUnits(goal.units ?? []);
}

export function resolveModuleLastLearnedUnit(
  goal: {
    lastLearnedUnit?: LastLearnedUnit | null;
    units?: readonly UnitWithSession[];
  },
  moduleId: string,
): LastLearnedUnit | null {
  const inModule = (goal.units ?? []).filter((unit) => unit.moduleId === moduleId);
  const fromSessions = resolveLastLearnedUnitFromUnits(inModule);
  if (fromSessions) return fromSessions;
  const last = resolveGoalLastLearnedUnit(goal);
  if (last && inModule.some((unit) => unit.id === last.id)) return last;
  return null;
}

export function resolveListItemLastLearnedUnit(
  goal: Pick<GoalListItem, "lastLearnedUnit">,
): LastLearnedUnit | null {
  return goal.lastLearnedUnit ?? null;
}

function goalListItemLastStudiedSortKey(goal: GoalListItem): string {
  return (
    goal.lastLearnedUnit?.learnedAt ??
    goal.createdAt ??
    goal.updatedAt ??
    ""
  );
}

export function sortGoalListItemsByLastStudied(
  goals: GoalListItem[],
): GoalListItem[] {
  return [...goals].sort((a, b) =>
    goalListItemLastStudiedSortKey(b).localeCompare(
      goalListItemLastStudiedSortKey(a),
    ),
  );
}

/** Most recently studied goal by `lastLearnedUnit.learnedAt`. */
export function findMostRecentGoalByLastLearned(
  goals: readonly GoalListItem[],
): GoalListItem | null {
  let best: GoalListItem | null = null;
  for (const goal of goals) {
    const learnedAt = goal.lastLearnedUnit?.learnedAt;
    if (!learnedAt) continue;
    if (
      !best?.lastLearnedUnit ||
      learnedAt > best.lastLearnedUnit.learnedAt
    ) {
      best = goal;
    }
  }
  return best;
}

export type GoalListContinueTarget = {
  href: string;
  unitId: string;
  unitTitle: string;
  goalTitle: string;
  /** Last session activity when available (for “上次学习” copy). */
  learnedAt: string | null;
  mode: "continue" | "review";
};

/**
 * Space / home continue target from a goal list item.
 * Prefers `nextLearningUnit` for an incomplete path; review when the goal is done.
 */
export function resolveGoalListContinueTarget(
  goal: GoalListItem,
): GoalListContinueTarget | null {
  const last = goal.lastLearnedUnit ?? null;
  const next = goal.nextLearningUnit;

  if (next) {
    return {
      href: `/goals/${goal.id}/units/${next.id}`,
      unitId: next.id,
      unitTitle: next.title,
      goalTitle: goal.title,
      learnedAt: last?.learnedAt ?? null,
      mode: "continue",
    };
  }

  if (next === null && last) {
    return {
      href: `/reviews/${goal.id}/${last.id}`,
      unitId: last.id,
      unitTitle: last.title,
      goalTitle: goal.title,
      learnedAt: last.learnedAt,
      mode: "review",
    };
  }

  if (last) {
    return {
      href: `/goals/${goal.id}/units/${last.id}`,
      unitId: last.id,
      unitTitle: last.title,
      goalTitle: goal.title,
      learnedAt: last.learnedAt,
      mode: "continue",
    };
  }

  return null;
}
