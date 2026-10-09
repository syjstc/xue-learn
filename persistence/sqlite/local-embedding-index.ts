import type { LocalVectorReindexStatus } from "@xue-learn/core/source/libs/runtime-contracts/src/index.ts";
import type { LocalEmbeddingIndexRecord } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { getEmbeddings } from "@xue-learn/core/source/libs/server/src/llm/client.ts";
import { ensureLlmRuntimeConfig, getLlmRuntimeConfig } from "@xue-learn/core/source/libs/server/src/llm/runtime-config.ts";
import { runWithUserId } from "@xue-learn/core/source/libs/server/src/user-context.ts";
import { requireGeneralMemoryPersistence } from "@xue-learn/core/source/libs/server/src/learning-systems/capabilities/general-memory/persistence.ts";
import { retryPendingMemoryIndexes } from "@xue-learn/core/source/libs/server/src/learning-systems/capabilities/general-memory/formation.ts";
import { requireTeachingSkillRuntimePersistence } from "@xue-learn/core/source/libs/server/src/teaching-skills/persistence.ts";
import { retryTeachingSkillIndexes } from "@xue-learn/core/source/libs/server/src/teaching-skills/repository.ts";
import { ensurePersonalSyncCapture } from "@xue-learn/core/source/libs/server/src/personal-sync/index.ts";
import { requireRagVectors } from "@xue-learn/core/source/libs/server/src/rag/persistence.ts";
import { processEmbeddingReindexBatch, type EmbeddingReindexTasks } from "@xue-learn/core/source/libs/server/src/rag/embedding-reindex.ts";

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
