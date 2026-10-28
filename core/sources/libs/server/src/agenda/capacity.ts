import {
  CAPACITY_CLAMP_RATIO,
  DEFAULT_UNIT_MINUTES,
  MAX_DAILY_CAPACITY,
  MIN_DAILY_CAPACITY,
  type CapacityBreakdown,
} from "./types.js";

export type CapacityInput = {
  /** Learner-owned global daily capacity target. */
  statedTargetMinutes: number;
  /** Manual override from settings. */
  overrideMinutes?: number | null;
  /** Recent same-goal (or cross-goal) average session length in minutes. */
  observedAvgSessionMinutes?: number | null;
  /** Recent daily active study minutes average. */
  observedDailyActiveMinutes?: number | null;
  /** Previous day's planned capacity for clamping. */
  previousCapacityMinutes?: number | null;
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Adaptive daily capacity in minutes.
 * The global target is the baseline; observed behavior adjusts execution capacity.
 */
export function calculateDailyCapacity(
  input: CapacityInput,
): CapacityBreakdown {
  const stated = clamp(
    Math.round(input.statedTargetMinutes || DEFAULT_UNIT_MINUTES),
    MIN_DAILY_CAPACITY,
    MAX_DAILY_CAPACITY,
  );

  if (
    input.overrideMinutes != null &&
    Number.isFinite(input.overrideMinutes) &&
    input.overrideMinutes > 0
  ) {
    const override = clamp(
      Math.round(input.overrideMinutes),
      MIN_DAILY_CAPACITY,
      MAX_DAILY_CAPACITY,
    );
    return {
      statedTargetMinutes: stated,
      overrideMinutes: override,
      observedAvgSessionMinutes: input.observedAvgSessionMinutes ?? null,
      observedDailyActiveMinutes: input.observedDailyActiveMinutes ?? null,
      adjustedMinutes: override,
      clampedFrom: null,
    };
  }

  let adjusted = stated;
  const observedDaily = input.observedDailyActiveMinutes;
  const observedSession = input.observedAvgSessionMinutes;

  if (observedDaily != null && observedDaily > 0) {
    // Blend 60% stated target with 40% recent daily active minutes.
    adjusted = stated * 0.6 + observedDaily * 0.4;
  } else if (observedSession != null && observedSession > 0) {
    adjusted = Math.max(observedSession, MIN_DAILY_CAPACITY);
  }

  adjusted = clamp(
    Math.round(adjusted),
    MIN_DAILY_CAPACITY,
    MAX_DAILY_CAPACITY,
  );

  let clampedFrom: number | null = null;
  const anchor = input.previousCapacityMinutes ?? stated;
  if (anchor > 0) {
    const maxDelta = Math.max(10, Math.round(anchor * CAPACITY_CLAMP_RATIO));
    const beforeClamp = adjusted;
    adjusted = clamp(adjusted, anchor - maxDelta, anchor + maxDelta);
    adjusted = clamp(adjusted, MIN_DAILY_CAPACITY, MAX_DAILY_CAPACITY);
    if (adjusted !== beforeClamp) clampedFrom = beforeClamp;
  }

  return {
    statedTargetMinutes: stated,
    overrideMinutes: null,
    observedAvgSessionMinutes: input.observedAvgSessionMinutes ?? null,
    observedDailyActiveMinutes: input.observedDailyActiveMinutes ?? null,
    adjustedMinutes: adjusted,
    clampedFrom,
  };
}
