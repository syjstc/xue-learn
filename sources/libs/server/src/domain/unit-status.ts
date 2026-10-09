import type { UnitStatus } from "./types.js";

const DONE_STATUSES = new Set<UnitStatus>([
  "completed",
  "completed_needs_reinforcement",
]);

/** Leaf lesson has finished the course activity, with or without reinforcement due. */
export function isUnitLearningDone(status: string): status is UnitStatus {
  return DONE_STATUSES.has(status as UnitStatus);
}

/** Journey-terminal state without treating skipped work as learned. */
export function isUnitJourneyResolved(status: string): status is UnitStatus {
  return status === "skipped" || isUnitLearningDone(status);
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

export function scoreToWeakTags(score: number, threshold = 0.7): boolean {
  return score < threshold;
}

export function statusLabel(status: UnitStatus, zh = true): string {
  const map: Record<UnitStatus, string> = zh
    ? {
        available: "可开始",
        in_progress: "学习中",
        completed: "已完成",
        completed_needs_reinforcement: "需巩固",
        skipped: "已跳过",
      }
    : {
        available: "Ready",
        in_progress: "In progress",
        completed: "Completed",
        completed_needs_reinforcement: "Needs reinforcement",
        skipped: "Skipped",
      };
  return map[status];
}
