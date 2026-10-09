/** Canonical completed domain fact stored in the fan-out event outbox. */
export type DomainEventOutboxRecord = Readonly<{
  id: string;
  type: string;
  schemaVersion: number;
  idempotencyKey: string | null;
  userId: string | null;
  goalId: string | null;
  unitId: string | null;
  threadId: string | null;
  payload: string;
  occurredAt: Date;
  fanoutCompletedAt: Date | null;
  createdAt: Date;
}>;

export type AppendDomainEventOutboxInput = Readonly<
  Omit<DomainEventOutboxRecord, "fanoutCompletedAt" | "createdAt"> & {
    fanoutCompletedAt?: Date | null;
    createdAt?: Date;
  }
>;

/**
 * Persistence boundary for completed domain facts.
 *
 * An adapter must append a new row when `idempotencyKey` is null, and must
 * atomically reuse the existing row when a non-null key already exists. In
 * either case it returns the canonical persisted record; the operation has no
 * owner scope and does not update an existing fact on retry.
 */
export interface DomainEventOutboxRepository {
  append(input: AppendDomainEventOutboxInput): Promise<DomainEventOutboxRecord>;
}
