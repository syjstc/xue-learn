import type { LearningUnitRepository } from "../../../domain/src/index.js";
import { shouldRestoreCompletedStatus } from "./restore-unit-completion.js";

type UnitStatusRow = {
  id: string;
  status: string;
  completedAt: Date | null;
  completionMethod: string | null;
};

/**
 * Restore journey status for units that still have completion markers but were
 * demoted to a non-done status (e.g. historical getOrCreateSession overwrite).
 * Mutates `units` in place so callers can serialize without a second fetch.
 */
export async function healDemotedUnitStatuses(
  units: UnitStatusRow[],
  repository: LearningUnitRepository,
): Promise<number> {
  const demotedIds = units
    .filter((unit) => shouldRestoreCompletedStatus(unit))
    .map((unit) => unit.id);
  if (demotedIds.length === 0) return 0;

  await repository.healCompletedStatuses(demotedIds);
  const demoted = new Set(demotedIds);
  for (const unit of units) {
    if (demoted.has(unit.id)) unit.status = "completed";
  }
  return demotedIds.length;
}
