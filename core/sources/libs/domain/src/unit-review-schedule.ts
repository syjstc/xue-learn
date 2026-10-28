export type UnitReviewScheduleState = {
  intervalDays: number;
  easeFactor: number;
  nextReviewAt: Date;
};

/**
 * Update the operational unit-review schedule only. A learner's grade here is
 * not a KACOM state update; criterion-level review evidence is recorded by the
 * assessment pipeline separately.
 */
export function scheduleUnitReview(
  state: UnitReviewScheduleState,
  grade: number,
  now = new Date(),
): UnitReviewScheduleState {
  if (!Number.isInteger(grade) || grade < 0 || grade > 5) {
    throw new RangeError("unit review grade must be an integer from 0 to 5");
  }
  const passed = grade >= 3;
  if (passed) {
    const intervalDays =
      state.intervalDays < 1 ? 1 : Math.min(state.intervalDays * 2, 180);
    return {
      intervalDays,
      easeFactor: Math.min(state.easeFactor + 0.1, 3),
      nextReviewAt: new Date(now.getTime() + intervalDays * 86_400_000),
    };
  }
  return {
    intervalDays: 1,
    easeFactor: Math.max(2, state.easeFactor - 0.2),
    nextReviewAt: new Date(now.getTime() + 86_400_000),
  };
}
