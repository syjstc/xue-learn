export type RagVectorFilter = Readonly<{
  scope: string;
  scopeId: string;
  embeddingProvider?: string;
  embeddingModel?: string;
  metadata?: Readonly<Record<string, string>>;
}>;

export type RagVectorChunkWrite = Readonly<{
  id: string;
  content: string;
  metadata: Readonly<Record<string, string | number | boolean | null>>;
  embeddingSql: string;
  dimensions: number;
}>;

export type LocalEmbeddingIndexRecord = Readonly<{
  status:
    | "no_chunks"
    | "lexical_only"
    | "queued"
    | "building"
    | "published"
    | "failed";
  providerId: string;
  model: string;
  lexicalChunks: number;
  indexedVectors: number;
  generationId: string | null;
  jobId: string | null;
  attempt: number;
  error: string | null;
  updatedAt: Date;
}>;

export type LocalEmbeddingReindexSource = Readonly<{
  id: string;
  text: string;
}>;

export interface RagVectorRepository {
  delete(filter: RagVectorFilter): Promise<void>;
  findDimensions(filter: RagVectorFilter): Promise<number | null>;
  insert(
    filter: Required<
      Pick<
        RagVectorFilter,
        "scope" | "scopeId" | "embeddingProvider" | "embeddingModel"
      >
    >,
    chunks: readonly RagVectorChunkWrite[],
  ): Promise<void>;
  insertLexical(
    filter: Required<
      Pick<
        RagVectorFilter,
        "scope" | "scopeId" | "embeddingProvider" | "embeddingModel"
      >
    >,
    chunks: readonly Omit<RagVectorChunkWrite, "embeddingSql" | "dimensions">[],
    error: string,
  ): Promise<void>;
  count(filter: RagVectorFilter): Promise<number>;
  /** Read source text without similarity ranking or an embedding dependency. */
  listSourceChunks(
    filter: RagVectorFilter,
    limit: number,
  ): Promise<readonly { content: string; metadata: unknown }[]>;
  nearest(
    filter: Required<
      Pick<
        RagVectorFilter,
        "scope" | "scopeId" | "embeddingProvider" | "embeddingModel"
      >
    > &
      Readonly<{ metadata?: Readonly<Record<string, string>> }>,
    embeddingSql: string,
    queryText: string,
    limit: number,
  ): Promise<readonly { content: string; metadata: unknown }[]>;
  getLocalEmbeddingIndexState(): Promise<LocalEmbeddingIndexRecord | null>;
  queueLocalEmbeddingReindex(input: {
    providerId: string;
    model: string;
  }): Promise<LocalEmbeddingIndexRecord>;
  listLocalEmbeddingReindexSources(input: {
    providerId: string;
    model: string;
    limit: number;
  }): Promise<readonly LocalEmbeddingReindexSource[]>;
  saveLocalEmbeddingReindexVectors(input: {
    providerId: string;
    model: string;
    rows: readonly Readonly<{ id: string; vector: readonly number[] }>[];
  }): Promise<void>;
  updateLocalEmbeddingIndexState(input: {
    status: LocalEmbeddingIndexRecord["status"];
    providerId: string;
    model: string;
    error?: string | null;
  }): Promise<LocalEmbeddingIndexRecord>;
}
