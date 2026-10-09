/** The hosted EventOutbox row shape retained during the incremental cutover. */
export type EventOutboxRecord = Readonly<{
  id: string;
  type: string;
  payload: string;
  createdAt: Date;
  publishedAt: Date | null;
  attemptCount: number;
  nextAttemptAt: Date | null;
  lastError: string | null;
  deadLetteredAt: Date | null;
}>;

export type AppendEventOutboxInput = Readonly<{
  id: string;
  type: string;
  payload: string;
  createdAt?: Date;
  nextAttemptAt?: Date | null;
}>;

export type AppendUnlessUnpublishedInput = Readonly<{
  event: AppendEventOutboxInput;
  unpublishedType: string;
  payloadIncludes: string;
}>;

/**
 * Minimal append boundary for events emitted by migrated application slices.
 * Claiming and delivery remain a separate jobs/outbox migration because the
 * hosted EventOutbox table has legacy retry columns rather than the richer
 * fencing contract in `OutboxPort`.
 */
export interface EventOutboxRepository {
  append(input: AppendEventOutboxInput): Promise<EventOutboxRecord>;
  /**
   * Insert only when no unpublished, non-dead-lettered row of this type already
   * matches the payload needle. Uses INSERT … WHERE NOT EXISTS so SQLite does
   * not abort the surrounding transaction on a duplicate primary key.
   */
  appendUnlessUnpublished(
    input: AppendUnlessUnpublishedInput,
  ): Promise<boolean>;
}

export type ClaimEventOutboxInput = Readonly<{
  types: readonly string[];
  includeTypes: boolean;
  limit: number;
  now: Date;
  leaseUntil: Date;
}>;

export type SettleEventOutboxFailureInput = Readonly<{
  id: string;
  expectedAttemptCount: number;
  attemptCount: number;
  nextAttemptAt: Date | null;
  lastError: string | null;
  deadLetteredAt: Date | null;
}>;

/** Transaction-owning claim and settlement boundary for legacy command events. */
export interface EventOutboxDeliveryRepository {
  claimDue(input: ClaimEventOutboxInput): Promise<readonly EventOutboxRecord[]>;
  settleFailure(input: SettleEventOutboxFailureInput): Promise<boolean>;
  markPublished(input: {
    id: string;
    expectedAttemptCount: number;
    publishedAt: Date;
  }): Promise<boolean>;
  deleteClaimed(input: {
    id: string;
    expectedAttemptCount: number;
  }): Promise<boolean>;
  releaseClaim(input: {
    id: string;
    expectedAttemptCount: number;
    nextAttemptAt: Date;
  }): Promise<boolean>;
}
