export type UnitCompletionQuality =
  "strong" | "adequate" | "needs_reinforcement";

export type UnitCompletionStatus =
  "completed" | "completed_needs_reinforcement";

export type UnitCompletionTransition = Readonly<{
  completionMethod: "learned";
  completionQuality: UnitCompletionQuality;
  status: UnitCompletionStatus;
  completedAt: Date;
}>;

export type UnitCompletionRollup = Readonly<{
  moduleCompleted: boolean;
  goalCompleted: boolean;
}>;

export type UnitCompletionCommitResult<TNextReviewAt = Date> = Readonly<{
  transitioned: boolean;
  status: UnitCompletionStatus;
  completionQuality: UnitCompletionQuality;
  nextReviewAt: TNextReviewAt | null;
  rollup: UnitCompletionRollup;
}>;

export type UnitCompletionPersistencePort<TNextReviewAt = Date> = Readonly<{
  /**
   * Atomically commits the unit/session transition and module/goal rollup.
   * Repeated calls must return the canonical stored outcome without demoting or
   * re-timestamping an already completed unit.
   */
  commitAndRollup(input: {
    userId: string;
    unitId: string;
    transition: UnitCompletionTransition;
    idempotencyKey: string;
  }): Promise<UnitCompletionCommitResult<TNextReviewAt>>;
}>;

export type UnitCompletionReviewPort = Readonly<{
  /** Must be idempotent for the supplied key so a retry can repair a crash gap. */
  ensureScheduled(input: {
    userId: string;
    unitId: string;
    idempotencyKey: string;
  }): Promise<void>;
}>;

export type UnitCompletionAgendaPort = Readonly<{
  /** Must be idempotent for the supplied key so a retry can repair a crash gap. */
  applyCompletion(input: {
    userId: string;
    unitId: string;
    idempotencyKey: string;
  }): Promise<void>;
}>;

export type UnitCompletionApplicationPort<TNextReviewAt = Date> = Readonly<{
  persistence: UnitCompletionPersistencePort<TNextReviewAt>;
  reviews: UnitCompletionReviewPort;
  agenda: UnitCompletionAgendaPort;
}>;

export function planUnitCompletion(input: {
  score: number;
  feynmanPassed: boolean;
  completedAt?: Date;
}): UnitCompletionTransition {
  if (!Number.isFinite(input.score) || input.score < 0 || input.score > 1) {
    throw new Error("Unit completion score must be between 0 and 1");
  }
  const completionQuality: UnitCompletionQuality =
    input.score >= 0.85 && input.feynmanPassed
      ? "strong"
      : input.score >= 0.6
        ? "adequate"
        : "needs_reinforcement";
  return {
    completionMethod: "learned",
    completionQuality,
    status:
      completionQuality === "needs_reinforcement"
        ? "completed_needs_reinforcement"
        : "completed",
    completedAt: input.completedAt ?? new Date(),
  };
}

/**
 * Portable completion orchestration. Storage adapters own their atomic unit +
 * hierarchy transaction. Review and agenda adapters are independently
 * idempotent and run on every invocation, allowing a retry to heal a process
 * crash after the primary commit.
 */
export async function completeUnitLearning<TNextReviewAt = Date>(
  port: UnitCompletionApplicationPort<TNextReviewAt>,
  input: {
    userId: string;
    unitId: string;
    score: number;
    feynmanPassed: boolean;
    completedAt?: Date;
  },
): Promise<UnitCompletionCommitResult<TNextReviewAt>> {
  const transition = planUnitCompletion(input);
  const idempotencyKey = `unit.completed:${input.unitId}`;
  const result = await port.persistence.commitAndRollup({
    userId: input.userId,
    unitId: input.unitId,
    transition,
    idempotencyKey,
  });
  const effectInput = {
    userId: input.userId,
    unitId: input.unitId,
    idempotencyKey,
  };
  await port.reviews.ensureScheduled(effectInput);
  await port.agenda.applyCompletion(effectInput);
  return result;
}
