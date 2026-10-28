import type { UnitStatus } from "./types.js";

const DONE_STATUSES = new Set<UnitStatus>([
  'completed',
  'completed_needs_reinforcement',
]);

export function isUnitLearningDone(status: string): status is UnitStatus {
  return DONE_STATUSES.has(status as UnitStatus);
}

/** Journey no longer needs to schedule this unit; skipped is not learning evidence. */
export function isUnitJourneyResolved(status: string): status is UnitStatus {
  return status === 'skipped' || isUnitLearningDone(status);
}

export function parsePrereqs(json: string): string[] {
  try {
    const arr = JSON.parse(json) as unknown;
    return Array.isArray(arr) ? (arr as string[]) : [];
  } catch {
    return [];
  }
}

export function normalizeUnitStatus(status: string): UnitStatus {
  return status as UnitStatus;
}
