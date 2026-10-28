export type UnitCompletionTransition = Readonly<{
  completionMethod: "learned" | "test_out";
  completionQuality: "strong" | "adequate" | "needs_reinforcement";
  status: "completed" | "completed_needs_reinforcement";
  completedAt: Date;
}>;

export type CommitUnitCompletionInput = Readonly<{
  userId: string;
  unitId: string;
  transition: UnitCompletionTransition;
  completionAttemptId?: string | null;
  idempotencyKey: string;
}>;

export type UnitCompletionRecord = Readonly<{
  transitioned: boolean;
  status: UnitCompletionTransition["status"];
  completionQuality: UnitCompletionTransition["completionQuality"];
  completedAt: Date;
}>;

/** Atomic owner-scoped unit/session/domain-event completion boundary. */
export interface UnitCompletionRepository {
  commitOwned(input: CommitUnitCompletionInput): Promise<UnitCompletionRecord>;
  healOwnedDemoted(
    userId: string,
    unitIds: readonly string[],
  ): Promise<readonly string[]>;
}
