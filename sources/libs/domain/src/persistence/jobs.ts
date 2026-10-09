export type DurableJobStatus =
  "queued" | "running" | "completed" | "dead-letter" | "cancelled";

export type DurableJob<TPayload = unknown> = Readonly<{
  id: string;
  idempotencyKey: string;
  type: string;
  payload: TPayload;
  status: DurableJobStatus;
  attempt: number;
  maxAttempts: number;
  availableAt: number;
  leaseOwner: string | null;
  fencingToken: string | null;
  leaseExpiresAt: number | null;
  lastError?: string | null;
}>;

export type EnqueueJobInput<TPayload> = Readonly<{
  id: string;
  idempotencyKey: string;
  type: string;
  payload: TPayload;
  now: number;
  availableAt?: number;
  maxAttempts?: number;
}>;

/**
 * Durable job execution is separate from application workflows. Hosted
 * adapters may claim rows across workers, while a local adapter can poll the
 * same contract with one serialized writer.
 */
export interface JobRuntimePort<TPayload = unknown> {
  enqueue(
    input: EnqueueJobInput<TPayload>,
  ): Promise<{ job: DurableJob<TPayload>; inserted: boolean }>;
  claim(input: {
    owner: string;
    now: number;
    leaseMs: number;
    types?: readonly string[];
  }): Promise<DurableJob<TPayload> | null>;
  heartbeat(input: {
    id: string;
    fencingToken: string;
    now: number;
    leaseMs: number;
  }): Promise<boolean>;
  complete(input: {
    id: string;
    fencingToken: string;
    now: number;
  }): Promise<boolean>;
  fail(input: {
    id: string;
    fencingToken: string;
    now: number;
    error: string;
    retryAt: number;
  }): Promise<"retried" | "dead-letter" | "stale">;
  recoverExpired(now: number): Promise<number>;
}
