import type { Embeddings } from "@langchain/core/embeddings";
import type { Env, EmbeddingProviderId } from "../env.js";
import {
  createSharedEmbeddings,
  resolveEmbeddingProviderId,
} from "../providers/llm/shared-embeddings.js";

export { resolveEmbeddingProviderId };

export function createEmbeddings(
  env: Env,
  embeddingProvider: EmbeddingProviderId,
  embeddingModel?: string,
): Embeddings {
  return createSharedEmbeddings(env, embeddingProvider, embeddingModel);
}
