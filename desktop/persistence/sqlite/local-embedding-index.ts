import type { LocalVectorReindexStatus } from "@xue-learn/core/runtime-contracts";
import type { LocalEmbeddingIndexRecord } from "@xue-learn/core/domain";
import { getEmbeddings } from "@xue-learn/core/server/llm/client";
import { ensureLlmRuntimeConfig, getLlmRuntimeConfig } from "@xue-learn/core/server/llm/runtime-config";
import { runWithUserId } from "@xue-learn/core/server/user-context";
import { requireGeneralMemoryPersistence } from "@xue-learn/core/server/learning-systems/capabilities/general-memory/persistence";
import { retryPendingMemoryIndexes } from "@xue-learn/core/server/learning-systems/capabilities/general-memory/formation";
import { requireTeachingSkillRuntimePersistence } from "@xue-learn/core/server/teaching-skills/persistence";
import { retryTeachingSkillIndexes } from "@xue-learn/core/server/teaching-skills/repository";
import { ensurePersonalSyncCapture } from "@xue-learn/core/server/personal-sync";
import { requireRagVectors } from "@xue-learn/core/server/rag/persistence";
import { processEmbeddingReindexBatch, type EmbeddingReindexTasks } from "@xue-learn/core/server/rag/embedding-reindex";

function assertElectronSqlite(): void {
  if (process.env.XUELEARN_DESKTOP_LOCAL !== "1" || process.env.PERSISTENCE_DATABASE_KIND !== "sqlite") {
    throw new Error("The local embedding index is available only in the Electron SQLite host");
  }
}

function statusDto(state: LocalEmbeddingIndexRecord): LocalVectorReindexStatus {
  return {
    status: state.status, lexicalChunks: state.lexicalChunks,
    indexedVectors: state.indexedVectors, vectorAvailable: state.status === "published",
    providerId: state.providerId as LocalVectorReindexStatus["providerId"], model: state.model || null,
    generationId: state.generationId, jobId: state.jobId, attempt: state.attempt,
    error: state.error || null, updatedAt: state.updatedAt.getTime(),
  };
}

async function target() {
  await ensureLlmRuntimeConfig();
  const runtime = getLlmRuntimeConfig();
  return { provider: runtime.embeddingProvider, model: runtime.embeddingModel };
}

export function queueLocalEmbeddingReindex(userId: string) {
  assertElectronSqlite();
  return runWithUserId(userId, async () => {
    const current = await target();
    return statusDto(await requireRagVectors().queueLocalEmbeddingReindex({ providerId: current.provider, model: current.model }));
  });
}

export function getLocalEmbeddingIndexStatus(userId: string) {
  assertElectronSqlite();
  return runWithUserId(userId, async () => {
    const current = await target();
    let state = await requireRagVectors().getLocalEmbeddingIndexState();
    if (!state || state.providerId !== current.provider || state.model !== current.model) {
      state = await requireRagVectors().queueLocalEmbeddingReindex({ providerId: current.provider, model: current.model });
    }
    return statusDto(state);
  });
}

function reindexTasks(): EmbeddingReindexTasks {
  return {
    currentTarget: target,
    getState: () => requireRagVectors().getLocalEmbeddingIndexState(),
    queue: ({ provider, model }) => requireRagVectors().queueLocalEmbeddingReindex({ providerId: provider, model }),
    update: ({ provider, model }, status, error) => requireRagVectors().updateLocalEmbeddingIndexState({ status, providerId: provider, model, error }),
    listVectors: ({ provider, model }, limit) => requireRagVectors().listLocalEmbeddingReindexSources({ providerId: provider, model, limit }),
    embed: async (texts) => (await getEmbeddings()).embedDocuments([...texts]),
    saveVectors: ({ provider, model }, rows) => ensurePersonalSyncCapture(() => requireRagVectors().saveLocalEmbeddingReindexVectors({ providerId: provider, model, rows })),
    pendingMemoryCount: async ({ provider, model }, limit) => (await requireGeneralMemoryPersistence().listPendingIndexes({ before: new Date(Date.now() + 1), limit, provider, model })).length,
    retryMemory: (identity, limit) => retryPendingMemoryIndexes(limit, identity),
    pendingSkillCount: async ({ provider, model }, limit) => (await requireTeachingSkillRuntimePersistence().listIndexSources({ provider, model, limit })).length,
    retrySkills: (identity, limit) => retryTeachingSkillIndexes(limit, identity),
  };
}

/** Device queue execution is admitted and scoped by this Electron host. */
export function processLocalEmbeddingReindexBatch(userId: string) {
  assertElectronSqlite();
  return runWithUserId(userId, () => ensurePersonalSyncCapture(async () => statusDto(await processEmbeddingReindexBatch(reindexTasks()))));
}
