import { getEnv } from "../env.js";
import { getCurrentUserId } from "../user-context.js";
import { readLocalRuntimeSettings } from "./local-runtime-settings.js";

export function getEmbeddingBatchSize(): number {
  return getEnv().EMBEDDING_BATCH_SIZE;
}

export async function getRagMaxChunksPerUpload(
  userId = getCurrentUserId(),
): Promise<number> {
  const fallback = getEnv().RAG_MAX_CHUNKS_PER_UPLOAD;
  if (process.env.XUELEARN_DESKTOP_LOCAL !== "1" || !userId) return fallback;
  const local = await readLocalRuntimeSettings(userId);
  return local.ragMaxChunksPerUpload ?? fallback;
}
