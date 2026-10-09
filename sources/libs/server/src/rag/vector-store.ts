import { Document } from "@langchain/core/documents";
import { sanitizeDbString } from "../../../common/src/index.js";
import { encodeEmbeddingVector } from "./vector-encoding.js";
import { getEmbeddings } from "../llm/client.js";
import { beginRagRequestLog } from "../llm/request-log.js";
import {
  ensureLlmRuntimeConfig,
  getLlmRuntimeConfig,
} from "../llm/runtime-config.js";
import { buildRagChunkId } from "./chunk-id.js";
import { getEmbeddingBatchSize } from "./rag-config.js";
import { normalizeIngestText } from "./ingest-text.js";
import { requireRagVectors } from "./persistence.js";

export type RagScope = "goal" | "learned" | "web_knowledge";
export { buildRagChunkId } from "./chunk-id.js";

export function embeddingScopeKey(provider: string, model: string): string {
  return `${provider}_${model}`
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 96);
}

/** Legacy name kept for callers that log or key goal collections. */
export function collectionName(goalId: string): string {
  const runtime = getLlmRuntimeConfig();
  return `goal_${goalId.replace(/[^a-zA-Z0-9]/g, "_")}_${embeddingScopeKey(runtime.embeddingProvider, runtime.embeddingModel)}`;
}

function getEmbeddingConfig() {
  const runtime = getLlmRuntimeConfig();
  return {
    provider: runtime.embeddingProvider,
    model: runtime.embeddingModel,
  };
}

/** Chroma only accepts scalar metadata; LangChain splitters add nested `loc`. */
export function sanitizeChunkMetadata(
  metadata: Record<string, unknown>,
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value === null || value === undefined) {
      out[key] = null;
      continue;
    }
    if (typeof value === "string") {
      out[key] = sanitizeDbString(value);
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    if (key === "loc" && typeof value === "object") {
      const lines = (value as { lines?: { from?: number; to?: number } }).lines;
      if (lines?.from != null) out.lineFrom = lines.from;
      if (lines?.to != null) out.lineTo = lines.to;
      continue;
    }
    out[key] = sanitizeDbString(JSON.stringify(value));
  }
  return out;
}

/** @deprecated Use sanitizeChunkMetadata */
export const sanitizeMetadataForChroma = sanitizeChunkMetadata;

type ScopeFilter = {
  scope: RagScope;
  scopeId: string;
  embeddingProvider: string;
  embeddingModel: string;
};

async function resolveScopeFilter(
  scope: RagScope,
  scopeId: string,
): Promise<ScopeFilter> {
  await ensureLlmRuntimeConfig();
  const { provider, model } = getEmbeddingConfig();
  return {
    scope,
    scopeId,
    embeddingProvider: provider,
    embeddingModel: model,
  };
}

async function resetScopeAfterEmbeddingMismatch(
  filter: ScopeFilter,
  label: string,
): Promise<void> {
  console.warn(
    `[rag] Embedding chunks for ${label} use a different embedding dimension; resetting the active scope. Re-upload resources if older chunks are missing.`,
  );
  await requireRagVectors().delete(filter);
}

async function ensureEmbeddingDimensions(
  filter: ScopeFilter,
  dimensions: number,
  label: string,
): Promise<void> {
  const existing = await requireRagVectors().findDimensions(filter);
  if (existing !== null && existing !== dimensions) {
    await resetScopeAfterEmbeddingMismatch(filter, label);
  }
}

type ChunkInsertRow = {
  id: string;
  content: string;
  metadata: Record<string, string | number | boolean | null>;
  embedding: number[];
  dimensions: number;
};

async function insertChunkBatch(
  filter: ScopeFilter,
  rows: ChunkInsertRow[],
): Promise<void> {
  if (rows.length === 0) return;

  await requireRagVectors().insert(
    filter,
    rows.map((row) => ({
      id: row.id,
      content: sanitizeDbString(row.content),
      metadata: row.metadata,
      embeddingSql: encodeEmbeddingVector(row.embedding),
      dimensions: row.dimensions,
    })),
  );
}

export async function deleteScopedCollection(
  scope: RagScope,
  scopeId: string,
): Promise<void> {
  try {
    await deleteScopedCollectionOrThrow(scope, scopeId);
  } catch (err) {
    console.warn(
      "[rag] Failed to delete vector scope:",
      err instanceof Error ? err.message : err,
    );
  }
}

/** Delete every embedding generation in a learner scope; failures stay visible to outbox retries. */
export async function deleteScopedCollectionOrThrow(
  scope: RagScope,
  scopeId: string,
): Promise<void> {
  await requireRagVectors().delete({ scope, scopeId });
}

export async function deleteGoalCollection(goalId: string): Promise<void> {
  await deleteScopedCollection("goal", goalId);
}

export async function deleteChunksByMetadata(
  scope: RagScope,
  scopeId: string,
  metadataFilter: Record<string, string>,
): Promise<void> {
  const filter = await resolveScopeFilter(scope, scopeId);
  await requireRagVectors().delete({ ...filter, metadata: metadataFilter });
}

/** Delete matching chunks across every embedding generation in a private scope. */
export async function deleteAllChunksByMetadata(
  scope: RagScope,
  scopeId: string,
  metadataFilter: Record<string, string>,
): Promise<void> {
  await requireRagVectors().delete({
    scope,
    scopeId,
    metadata: metadataFilter,
  });
}

export async function getScopedDocumentCount(
  scope: RagScope,
  scopeId: string,
): Promise<number> {
  try {
    const filter = await resolveScopeFilter(scope, scopeId);
    return requireRagVectors().count(filter);
  } catch {
    return 0;
  }
}

export async function getCollectionDocumentCount(
  goalId: string,
): Promise<number> {
  return getScopedDocumentCount("goal", goalId);
}

export async function addDocumentsToScopedCollection(
  scope: RagScope,
  scopeId: string,
  docs: Document[],
  scopeMetadata: Record<string, unknown> = {},
  onProgress?: (message: string) => void | Promise<void>,
): Promise<void> {
  if (docs.length === 0) return;
  const batchSize = getEmbeddingBatchSize();
  const batchCount = Math.ceil(docs.length / batchSize);
  const logHandle = await beginRagRequestLog({
    operation: "rag.ingest",
    request: {
      scope,
      scopeId,
      chunkCount: docs.length,
      batchSize,
      batchCount,
    },
    meta: {
      goalId: scope === "goal" ? scopeId : undefined,
      mode: "ingest",
      scope,
      scopeId,
    },
  });
  const started = Date.now();

  try {
    const filter = await resolveScopeFilter(scope, scopeId);
    const label = scope === "goal" ? `goal ${scopeId}` : `user ${scopeId}`;
    // Clean once at the embed gate (upload/URL paths already normalize; web_knowledge
    // extract can still carry NUL/control/whitespace noise). Drop empty chunks.
    const cleanedDocs = docs
      .map(
        (doc) =>
          new Document({
            pageContent: normalizeIngestText(doc.pageContent),
            metadata: doc.metadata,
          }),
      )
      .filter((doc) => doc.pageContent.length > 0);
    if (cleanedDocs.length === 0) {
      await logHandle?.finish({
        status: "success",
        durationMs: Date.now() - started,
        response: { chunkCount: 0, skippedEmpty: docs.length },
      });
      return;
    }
    const cleanedBatchCount = Math.ceil(cleanedDocs.length / batchSize);
    const addAllBatches = async () => {
      for (let offset = 0; offset < cleanedDocs.length; offset += batchSize) {
        const batchIndex = Math.floor(offset / batchSize) + 1;
        await onProgress?.(
          cleanedBatchCount > 1
            ? `正在生成向量嵌入（${batchIndex}/${cleanedBatchCount} 批，共 ${cleanedDocs.length} 段）…`
            : `正在生成向量嵌入（${cleanedDocs.length} 段）…`,
        );
        const slice = cleanedDocs.slice(offset, offset + batchSize);
        // Defense in depth for raw SQL; normalizeIngestText already ran sanitizeDbString.
        const texts = slice.map((d) => sanitizeDbString(d.pageContent));
        let vectors: number[][];
        try {
          vectors = await (await getEmbeddings()).embedDocuments(texts);
        } catch (error) {
          if (process.env.PERSISTENCE_DATABASE_KIND !== "sqlite") throw error;
          const message =
            error instanceof Error ? error.message : String(error);
          await requireRagVectors().insertLexical(
            filter,
            slice.map((doc, index) => ({
              id: buildRagChunkId(scopeId),
              content: texts[index]!,
              metadata: sanitizeChunkMetadata({
                ...(doc.metadata as Record<string, unknown>),
                ...scopeMetadata,
              }),
            })),
            message,
          );
          throw error;
        }
        if (vectors.length > 0) {
          await ensureEmbeddingDimensions(filter, vectors[0]!.length, label);
        }
        // UUID ids: concurrent web_knowledge indexRevision used Date.now() and
        // collided on `${scopeId}_chunk_${ms}_${i}` (Postgres 23505).
        const rows: ChunkInsertRow[] = slice.map((doc, i) => ({
          id: buildRagChunkId(scopeId),
          content: texts[i]!,
          embedding: vectors[i]!,
          dimensions: vectors[i]!.length,
          metadata: sanitizeChunkMetadata({
            ...(doc.metadata as Record<string, unknown>),
            ...scopeMetadata,
          }),
        }));
        await insertChunkBatch(filter, rows);
      }
    };

    await addAllBatches();

    await logHandle?.finish({
      status: "success",
      durationMs: Date.now() - started,
      response: { chunkCount: cleanedDocs.length },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logHandle?.finish({
      status: "error",
      durationMs: Date.now() - started,
      error: message,
    });
    throw err;
  }
}

export async function addDocumentsToCollection(
  goalId: string,
  docs: Document[],
  onProgress?: (message: string) => void | Promise<void>,
): Promise<void> {
  return addDocumentsToScopedCollection(
    "goal",
    goalId,
    docs,
    { goalId },
    onProgress,
  );
}

export async function queryScopedCollection(
  scope: RagScope,
  scopeId: string,
  query: string,
  k = 4,
): Promise<Document[]> {
  const filter = await resolveScopeFilter(scope, scopeId);
  const count = await getScopedDocumentCount(scope, scopeId);
  if (count === 0) return [];

  let vector: readonly number[] = [];
  try {
    vector = await (await getEmbeddings()).embedQuery(query);
  } catch (error) {
    if (process.env.PERSISTENCE_DATABASE_KIND !== "sqlite") throw error;
  }
  let rows: { content: string; metadata: unknown }[];
  try {
    rows = [
      ...(await requireRagVectors().nearest(
        filter,
        encodeEmbeddingVector(vector),
        query,
        Math.min(k, count),
      )),
    ];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/different vector dimensions/i.test(message)) {
      await resetScopeAfterEmbeddingMismatch(
        filter,
        scope === "goal" ? `goal ${scopeId}` : `user ${scopeId}`,
      );
      return [];
    }
    throw err;
  }

  return rows
    .filter((row) => row.content)
    .map(
      (row) =>
        new Document({
          pageContent: row.content,
          metadata: (row.metadata as Record<string, unknown>) ?? {},
        }),
    );
}

export async function queryCollection(
  goalId: string,
  query: string,
  k = 4,
): Promise<Document[]> {
  return queryScopedCollection("goal", goalId, query, k);
}

export async function queryScopedCollectionByMetadata(
  scope: RagScope,
  scopeId: string,
  query: string,
  metadataFilter: Record<string, string>,
  k = 4,
): Promise<Document[]> {
  const filter = await resolveScopeFilter(scope, scopeId);
  let vector: readonly number[] = [];
  try {
    vector = await (await getEmbeddings()).embedQuery(query);
  } catch (error) {
    if (process.env.PERSISTENCE_DATABASE_KIND !== "sqlite") throw error;
  }
  const rows = await requireRagVectors().nearest(
    { ...filter, metadata: metadataFilter },
    encodeEmbeddingVector(vector),
    query,
    Math.max(1, k),
  );
  return rows.map(
    (row) =>
      new Document({
        pageContent: row.content,
        metadata: (row.metadata as Record<string, unknown>) ?? {},
      }),
  );
}
