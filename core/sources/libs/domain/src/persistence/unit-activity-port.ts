/**
 * An owner-scoped activity heartbeat or focused-time flush.
 *
 * The adapter owns the unit/goal ownership check and applies the session,
 * learner-day, and section-progress changes atomically.
 */
export type TouchUnitActivityInput = Readonly<{
  userId: string;
  unitId: string;
  tab?: string;
  slideIndex?: number;
  hasCompletedSlides?: boolean;
  sectionSteps?: Record<string, number>;
  activeSeconds?: number;
  sectionId?: string;
  sectionContentRevision?: number;
  sectionCursor?: number;
  /** Client ended a focused learning segment (tab hidden / page leave). */
  timeFlush?: boolean;
}>;

export type TouchUnitActivityResult = Readonly<{
  totalActiveSeconds: number;
  acceptedActiveSeconds: number;
}>;

/** Persistence boundary for an atomic, learner-owned unit activity touch. */
export interface UnitActivityRepository {
  touchOwned(input: TouchUnitActivityInput): Promise<TouchUnitActivityResult>;
}
