export const MAX_GENERATED_FLASHCARDS = 15;

/**
 * Preserve coverage first, then target minimums, then optional extra cards,
 * without ever exceeding the authoritative deck limit.
 */
export function boundFlashcardBudgets(
  budgets: ReadonlyArray<{ min: number; max: number }>,
  limit = MAX_GENERATED_FLASHCARDS,
): Array<{ min: number; max: number }> {
  const capacity = Math.max(0, Math.trunc(limit));
  const normalized = budgets.map((budget) => ({
    min: Math.max(0, Math.trunc(budget.min)),
    max: Math.max(0, Math.trunc(budget.max)),
  }));
  let remainingCoverage = capacity;
  const allocated = normalized.map((budget) => {
    const covered = budget.min > 0 && remainingCoverage > 0 ? 1 : 0;
    remainingCoverage -= covered;
    return { min: covered, max: covered };
  });

  let usedMin = allocated.reduce((sum, budget) => sum + budget.min, 0);
  for (
    let index = 0;
    index < allocated.length && usedMin < capacity;
    index += 1
  ) {
    while (allocated[index].min < normalized[index].min && usedMin < capacity) {
      allocated[index].min += 1;
      allocated[index].max = allocated[index].min;
      usedMin += 1;
    }
  }

  let usedMax = allocated.reduce((sum, budget) => sum + budget.max, 0);
  for (
    let index = 0;
    index < allocated.length && usedMax < capacity;
    index += 1
  ) {
    while (allocated[index].max < normalized[index].max && usedMax < capacity) {
      allocated[index].max += 1;
      usedMax += 1;
    }
  }
  return allocated;
}
