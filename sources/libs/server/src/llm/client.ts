import type { Embeddings } from "@langchain/core/embeddings";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { getEnv } from "../env.js";
import { createEmbeddings } from "./embeddings.js";
import { LoggingEmbeddings } from "./logging-embeddings.js";
import { getLlmProvider } from "./providers/index.js";
import { ensureLlmRuntimeConfig } from "./runtime-config.js";
import { getExplicitLlmSelection } from "../providers/llm/index.js";

export async function getChatModel(options?: {
  maxTokens?: number;
  cachePrefix?: string;
  strictStructuredOutput?: boolean;
}): Promise<BaseChatModel> {
  const explicit = getExplicitLlmSelection();
  const provider = explicit
    ? getLlmProvider(explicit)
    : (await ensureLlmRuntimeConfig(), getLlmProvider());
  if (options?.cachePrefix && provider.getCachedChatModel) {
    const cached = await provider.getCachedChatModel({
      maxTokens: options.maxTokens,
      cachePrefix: options.cachePrefix,
    });
    if (cached) return cached;
  }
  return provider.getChatModel(options);
}

export async function getEmbeddings(): Promise<Embeddings> {
  const config = await ensureLlmRuntimeConfig();
  const embeddings = createEmbeddings(
    getEnv(),
    config.embeddingProvider,
    config.embeddingModel,
  );
  return new LoggingEmbeddings(embeddings, {
    operationPrefix: `${config.embeddingProvider}.embedding`,
  });
}
