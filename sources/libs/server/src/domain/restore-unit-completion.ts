import { isUnitLearningDone } from "../../../domain/src/index.js";

const COMPLETION_METHODS = new Set(["learned", "test_out"]);

/**
 * Detect units that finished GELC (completedAt + method) but were demoted
 * back to a non-done journey status — historically by getOrCreateSession.
 */
export function shouldRestoreCompletedStatus(unit: {
  status: string;
  completedAt: Date | string | null | undefined;
  completionMethod: string | null | undefined;
}): boolean {
  if (isUnitLearningDone(unit.status) || unit.status === "skipped") {
    return false;
  }
  if (!unit.completedAt) return false;
  return COMPLETION_METHODS.has(unit.completionMethod ?? "");
}

/** Promote available → in_progress only; never demote done / skipped / healed rows. */
export function shouldMarkUnitInProgress(unit: {
  status: string;
  completedAt: Date | string | null | undefined;
  completionMethod: string | null | undefined;
}): boolean {
  if (isUnitLearningDone(unit.status) || unit.status === "skipped") {
    return false;
  }
  if (shouldRestoreCompletedStatus(unit)) return false;
  return unit.status !== "in_progress";
}
