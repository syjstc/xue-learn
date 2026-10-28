export type VectorIndexMode = "vector" | "lexical" | "hybrid";

export type VectorRecord<TMetadata = Record<string, unknown>> = Readonly<{
  id: string;
  scope: string;
  scopeId: string;
  content: string;
  contentHash: string;
  embedding?: readonly number[];
  metadata: TMetadata;
}>;

export type VectorSearchQuery = Readonly<{
  scope: string;
  scopeId?: string;
  query: string | readonly number[];
  limit: number;
  mode?: VectorIndexMode;
  metadata?: Readonly<Record<string, unknown>>;
}>;

export type VectorSearchHit<TMetadata = Record<string, unknown>> = Readonly<{
  id: string;
  score: number;
  content?: string;
  metadata?: TMetadata;
}>;

export type VectorReindexResult = Readonly<{
  processed: number;
  failed: number;
}>;

/**
 * Normalizes pgvector, sqlite-vec, and lexical fallback behavior behind one
 * retrieval contract. Database-specific indexing and query syntax belong in
 * the adapter, never in an application service.
 */
export interface VectorIndexPort<TMetadata = Record<string, unknown>> {
  readonly dimensions?: number;
  upsert(records: readonly VectorRecord<TMetadata>[]): Promise<void>;
  remove(input: {
    ids?: readonly string[];
    scope?: string;
    scopeId?: string;
  }): Promise<number>;
  search(
    input: VectorSearchQuery,
  ): Promise<readonly VectorSearchHit<TMetadata>[]>;
  reindex(input?: {
    scope?: string;
    scopeId?: string;
  }): Promise<VectorReindexResult>;
}
