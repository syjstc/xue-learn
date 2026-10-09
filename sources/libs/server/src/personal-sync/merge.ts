import {
  compareHybridLogicalClock,
  type HybridLogicalClock,
} from "./clock.js";

export function mergeCompletedIds(
  left: readonly string[],
  right: readonly string[],
): string[] {
  return [...new Set([...left, ...right])].sort();
}

export function mergeCompletionStatus(
  left: "available" | "in_progress" | "completed",
  right: "available" | "in_progress" | "completed",
): "available" | "in_progress" | "completed" {
  const order = { available: 0, in_progress: 1, completed: 2 } as const;
  return order[left] >= order[right] ? left : right;
}

export function mergeGrowOnlyCounters(
  left: Readonly<Record<string, number>>,
  right: Readonly<Record<string, number>>,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    result[key] = Math.max(0, left[key] ?? 0, right[key] ?? 0);
  }
  return result;
}

export type VersionedNote<T> = Readonly<{
  revisionId: string;
  baseRevisionId: string | null;
  clock: HybridLogicalClock;
  value: T;
}>;

export type NoteMergeResult<T> =
  | Readonly<{ status: "merged"; value: VersionedNote<T> }>
  | Readonly<{
      status: "conflict";
      preferred: VersionedNote<T>;
      alternate: VersionedNote<T>;
    }>;

export function mergeVersionedNote<T>(
  left: VersionedNote<T>,
  right: VersionedNote<T>,
): NoteMergeResult<T> {
  if (left.revisionId === right.revisionId) return { status: "merged", value: left };
  if (right.baseRevisionId === left.revisionId)
    return { status: "merged", value: right };
  if (left.baseRevisionId === right.revisionId)
    return { status: "merged", value: left };
  const comparison = compareHybridLogicalClock(left.clock, right.clock);
  return comparison >= 0
    ? { status: "conflict", preferred: left, alternate: right }
    : { status: "conflict", preferred: right, alternate: left };
}

