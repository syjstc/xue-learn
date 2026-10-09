export type LeaseClaim = {
  id: string;
  owner: string;
  fencingToken: string;
  expiresAt: number;
  attempt: number;
};

export interface LeaseStore {
  claim(input: {
    lane: string;
    owner: string;
    now: number;
    leaseMs: number;
  }): Promise<LeaseClaim | null>;
  heartbeat(input: {
    id: string;
    fencingToken: string;
    now: number;
    leaseMs: number;
  }): Promise<boolean>;
  settle(input: {
    id: string;
    fencingToken: string;
    now: number;
    outcome: "completed" | "failed" | "cancelled";
    error?: string;
  }): Promise<boolean>;
}

export type OrderedRunEvent<T> = {
  sequence: number;
  createdAt: number;
  event: T;
};

export interface GenerationRunStore<TEvent = unknown> {
  /**
   * Append one non-terminal event while the run is active. Implementations
   * must fence terminal rows so a late provider response cannot appear after
   * cancellation/completion in reconnect replay.
   */
  append(runId: string, event: TEvent): Promise<OrderedRunEvent<TEvent>>;
  readAfter(
    runId: string,
    sequence: number,
  ): Promise<OrderedRunEvent<TEvent>[]>;
  heartbeat(runId: string, now: number): Promise<boolean>;
  cancel(runId: string, now: number): Promise<boolean>;
  /**
   * Cancel all queued/running/interrupted runs for one operation subject.
   * Implementations must append one durable terminal cancellation event for
   * every row they transition so reconnect does not have to synthesize it.
   */
  cancelActive(input: {
    operationKey: string;
    subjectId: string;
    now?: number;
  }): Promise<number>;
  recoverInterrupted(now: number, staleBefore: number): Promise<number>;
}

export type DurableJob<TPayload = unknown> = {
  id: string;
  idempotencyKey: string;
  type: string;
  payload: TPayload;
  status: "queued" | "running" | "completed" | "dead-letter" | "cancelled";
  attempt: number;
  maxAttempts: number;
  availableAt: number;
  leaseOwner: string | null;
  fencingToken: string | null;
  leaseExpiresAt: number | null;
};

export interface JobOutboxStore<TPayload = unknown> {
  enqueue(input: {
    id: string;
    idempotencyKey: string;
    type: string;
    payload: TPayload;
    now: number;
    availableAt?: number;
    maxAttempts?: number;
  }): Promise<{ job: DurableJob<TPayload>; inserted: boolean }>;
  claim(input: {
    owner: string;
    now: number;
    leaseMs: number;
    types?: string[];
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

export type StoredDomainEvent<TPayload = unknown> = {
  sequence: number;
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: TPayload;
  occurredAt: number;
};

export interface DomainEventStore<TPayload = unknown> {
  append(
    input: Omit<StoredDomainEvent<TPayload>, "sequence">,
  ): Promise<StoredDomainEvent<TPayload>>;
  readAfter(
    sequence: number,
    limit: number,
  ): Promise<StoredDomainEvent<TPayload>[]>;
}

export interface RetrievalStore<TMetadata = Record<string, unknown>> {
  upsertChunks(
    input: Array<{
      id: string;
      scope: string;
      scopeId: string;
      content: string;
      contentHash: string;
      metadata: TMetadata;
    }>,
  ): Promise<void>;
  lexicalSearch(input: {
    scope: string;
    scopeId: string;
    query: string;
    limit: number;
  }): Promise<Array<{ id: string; score: number }>>;
  deleteScope(scope: string, scopeId: string): Promise<void>;
}

export type VectorGenerationStatus =
  "building" | "validating" | "published" | "failed" | "superseded";

export type VectorGeneration = {
  id: string;
  providerId: string;
  model: string;
  dimension: number;
  sourceCutoff: number;
  status: VectorGenerationStatus;
  expectedCount: number;
  indexedCount: number;
  fencingToken: string;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  publishedAt: number | null;
};

export type PendingEmbeddingChunk<TMetadata = Record<string, unknown>> = {
  id: string;
  content: string;
  contentHash: string;
  metadata: TMetadata;
};

export type RankedRetrievalResult = {
  id: string;
  score: number;
};

export type HybridRetrievalResult = RankedRetrievalResult & {
  lexicalRank: number | null;
  vectorRank: number | null;
};

/**
 * A resumable derived index. Generation mutations are fenced; canonical chunks
 * stay owned by RetrievalStore and are never copied into the vector index.
 */
export interface VectorGenerationStore<TMetadata = Record<string, unknown>> {
  startGeneration(input: {
    id: string;
    providerId: string;
    model: string;
    dimension: number;
    sourceCutoff: number;
    fencingToken: string;
    now: number;
  }): Promise<VectorGeneration>;
  getGeneration(id: string): VectorGeneration | null;
  listPendingChunks(input: {
    generationId: string;
    fencingToken: string;
    limit: number;
  }): PendingEmbeddingChunk<TMetadata>[];
  writeEmbeddings(input: {
    generationId: string;
    fencingToken: string;
    items: Array<{ chunkId: string; contentHash: string; vector: number[] }>;
    now: number;
  }): Promise<boolean>;
  validateAndPublish(input: {
    generationId: string;
    fencingToken: string;
    now: number;
    sampleSize?: number;
  }): Promise<{ published: boolean; error: string | null }>;
  failGeneration(input: {
    generationId: string;
    fencingToken: string;
    error: string;
    now: number;
  }): Promise<boolean>;
  vectorSearch(input: {
    scope: string;
    scopeId: string;
    providerId: string;
    model: string;
    dimension: number;
    queryVector: number[];
    limit: number;
  }): RankedRetrievalResult[];
  hybridSearch(input: {
    scope: string;
    scopeId: string;
    query: string;
    limit: number;
    vector?: {
      providerId: string;
      model: string;
      dimension: number;
      queryVector: number[];
    };
  }): HybridRetrievalResult[];
}

/** Domain ports are intentionally transaction-shaped, never Persistence-shaped. */
export interface RuntimeStore {
  readonly kind: string;
  healthCheck(): Promise<void>;
}
