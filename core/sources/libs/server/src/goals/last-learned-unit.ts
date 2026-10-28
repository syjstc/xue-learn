import type { LearningGoalRepository } from "../../../domain/src/index.js";

export type LastLearnedUnit = {
  id: string;
  title: string;
  status: string;
  learnedAt: string;
};

type UnitWithSession = {
  id: string;
  title: string;
  status: string;
  unitKind: string;
  sessionState?: { updatedAt: Date } | null;
};

export function pickLastLearnedUnit(
  units: UnitWithSession[],
): LastLearnedUnit | null {
  let best: { unit: UnitWithSession; updatedAt: Date } | null = null;

  for (const unit of units) {
    if (unit.unitKind !== "lesson") continue;
    const updatedAt = unit.sessionState?.updatedAt;
    if (!updatedAt) continue;
    if (!best || updatedAt > best.updatedAt) {
      best = { unit, updatedAt };
    }
  }

  if (!best) return null;

  return {
    id: best.unit.id,
    title: best.unit.title,
    status: best.unit.status,
    learnedAt: best.updatedAt.toISOString(),
  };
}

export async function getLastLearnedUnitsByGoalIds(
  goalIds: string[],
  repository: Pick<LearningGoalRepository, "listLastLearnedUnits">,
): Promise<Map<string, LastLearnedUnit>> {
  if (goalIds.length === 0) return new Map();

  const sessions = await repository.listLastLearnedUnits(goalIds);

  const map = new Map<string, LastLearnedUnit>();
  for (const session of sessions) {
    map.set(session.goalId, {
      id: session.id,
      title: session.title,
      status: session.status,
      learnedAt: session.updatedAt.toISOString(),
    });
  }

  return map;
}

type GoalLastStudiedSortable = {
  lastLearnedUnit?: LastLearnedUnit | null;
  createdAt?: string;
  updatedAt?: string;
};

function goalLastStudiedSortKey(goal: GoalLastStudiedSortable): string {
  return (
    goal.lastLearnedUnit?.learnedAt ?? goal.createdAt ?? goal.updatedAt ?? ""
  );
}

export function compareGoalsByLastStudiedDesc(
  a: GoalLastStudiedSortable,
  b: GoalLastStudiedSortable,
): number {
  return goalLastStudiedSortKey(b).localeCompare(goalLastStudiedSortKey(a));
}

export function sortGoalsByLastStudied<T extends GoalLastStudiedSortable>(
  goals: T[],
): T[] {
  return [...goals].sort(compareGoalsByLastStudiedDesc);
}
