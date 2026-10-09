/**
 * A review entry must never reopen an already submitted quiz as writable.
 * When every stored set has attempts, the caller must author a fresh batch.
 */
export function selectUnattemptedQuizSet<
  T extends { attemptCount: number },
>(sets: readonly T[]): T | null {
  return sets.find((set) => set.attemptCount === 0) ?? null;
}
