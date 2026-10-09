import { isLearnableUnitKind } from "@/shared/domain/unit-tree";
import { deriveUnitContentGenStatus } from "@/shared/domain/unit-content-status";
import type { SessionStep, UnitStatus } from "@/shared/domain/types";

type UnitProgressRow = {
  id?: string;
  status: string;
  unitKind: string;
  sessionState?: {
    currentStep?: string | null;
    sq3rData?: string;
    graphState?: string;
  } | null;
  learningMaterial?:
    | { sections: string; introduction: string }
    | { hasContent: true }
    | null;
};

const DONE_STATUSES = new Set<UnitStatus>([
  "completed",
  "completed_needs_reinforcement",
]);

const STEP_PROGRESS: Record<SessionStep, number> = {
  structured_input: 0,
  active_recall: 0.55,
  feynman: 0.75,
  socratic: 0.75,
  complete: 1,
};

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function structuredContentProgress(unit: UnitProgressRow): number {
  const content = deriveUnitContentGenStatus(unit);
  if (!content) return 0;

  let progress = 0;
  if (content.hasSurvey) progress += 0.1;
  if (content.hasMaterial) progress += 0.2;
  return progress;
}

export function unitLearningProgress(unit: UnitProgressRow): number {
  if (!isLearnableUnitKind(unit.unitKind)) return 0;
  if (DONE_STATUSES.has(unit.status as UnitStatus)) return 1;

  const step = unit.sessionState?.currentStep as SessionStep | undefined;
  const stepProgress = step ? (STEP_PROGRESS[step] ?? 0) : 0;
  return clampProgress(Math.max(stepProgress, structuredContentProgress(unit)));
}

export function aggregateLearningProgress(units: UnitProgressRow[]) {
  const lessons = units.filter((u) => isLearnableUnitKind(u.unitKind));
  const completedUnits = lessons.filter((u) =>
    DONE_STATUSES.has(u.status as UnitStatus),
  ).length;
  const progressUnits = lessons.reduce(
    (sum, unit) => sum + unitLearningProgress(unit),
    0,
  );
  const progressPercent =
    lessons.length > 0 ? Math.round((progressUnits / lessons.length) * 100) : 0;

  return {
    completedUnits,
    progressUnits,
    progressPercent,
    totalUnits: lessons.length,
  };
}
