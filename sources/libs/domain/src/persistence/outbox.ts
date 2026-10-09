import type { UnitOfWork } from "./transaction.js";

export type OutboxMessageStatus =
  "pending" | "processing" | "published" | "dead-letter";

export type OutboxMessage<TPayload = unknown> = Readonly<{
  id: string;
  topic: string;
  aggregateType: string;
  aggregateId: string;
  payload: TPayload;
  occurredAt: number;
  availableAt: number;
  status: OutboxMessageStatus;
  attempt: number;
  leaseOwner: string | null;
  fencingToken: string | null;
  leaseExpiresAt: number | null;
  lastError?: string | null;
  sequence?: number;
}>;

export type AppendOutboxMessageInput<TPayload> = Readonly<{
  id: string;
  topic: string;
  aggregateType: string;
  aggregateId: string;
  payload: TPayload;
  occurredAt: number;
  availableAt?: number;
  unitOfWork?: UnitOfWork;
}>;

/**
 * Transactional event delivery boundary. `append` may participate in a
 * caller-owned unit of work; implementations must preserve idempotency by
 * message id and fence stale acknowledgements.
 */
export interface OutboxPort<TPayload = unknown> {
  append(
    input: AppendOutboxMessageInput<TPayload>,
  ): Promise<{ message: OutboxMessage<TPayload>; inserted: boolean }>;
  claim(input: {
    owner: string;
    now: number;
    leaseMs: number;
    limit: number;
    topics?: readonly string[];
  }): Promise<readonly OutboxMessage<TPayload>[]>;
  acknowledge(input: {
    id: string;
    owner: string;
    fencingToken: string;
    now: number;
  }): Promise<boolean>;
  fail(input: {
    id: string;
    owner: string;
    fencingToken: string;
    now: number;
    error: string;
    retryAt: number;
  }): Promise<"retried" | "dead-letter" | "stale">;
  recoverExpired(now: number): Promise<number>;
  readAfter(input: {
    sequence: number;
    limit: number;
    topics?: readonly string[];
  }): Promise<readonly OutboxMessage<TPayload>[]>;
}
