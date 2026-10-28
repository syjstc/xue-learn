import { isUnitLearningDone } from "../../../domain/src/index.js";

export type ContinueLearningUnit = {
  id: string;
  title: string;
  status: string;
};

type UnitCandidate = ContinueLearningUnit & {
  unitKind: string;
  parentUnitId: string | null;
  orderIndex: number;
};

function orderedLessons(units: UnitCandidate[]): UnitCandidate[] {
  const children = new Map<string | null, UnitCandidate[]>();
  for (const unit of units) {
    const siblings = children.get(unit.parentUnitId) ?? [];
    siblings.push(unit);
    children.set(unit.parentUnitId, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((a, b) => a.orderIndex - b.orderIndex);
  }

  const lessons: UnitCandidate[] = [];
  const walk = (parentId: string | null) => {
    for (const unit of children.get(parentId) ?? []) {
      if (unit.unitKind === "lesson") lessons.push(unit);
      walk(unit.id);
    }
  };
  walk(null);
  return lessons;
}

/** Picks the exact lesson the home-page continue action should open. */
export function resolveContinueLearningUnit(
  units: UnitCandidate[],
  lastLearnedUnitId?: string | null,
): ContinueLearningUnit | null {
  const lessons = orderedLessons(units);
  const lastIndex = lastLearnedUnitId
    ? lessons.findIndex((unit) => unit.id === lastLearnedUnitId)
    : -1;

  if (lastIndex >= 0 && !isUnitLearningDone(lessons[lastIndex].status)) {
    return lessons[lastIndex];
  }

  const next = lessons
    .slice(lastIndex + 1)
    .find((unit) => !isUnitLearningDone(unit.status));
  if (next) return next;

  return lessons.find((unit) => !isUnitLearningDone(unit.status)) ?? null;
}
