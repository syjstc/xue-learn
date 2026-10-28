import { ChatOpenAI } from "@langchain/openai";
import type { Env } from "../../../../env.js";
import type { LlmProvider, LlmProviderSelection } from "../../types.js";
import {
  LLM_REQUEST_TIMEOUT_MS,
  MINIMAX_CHAT_OPENAI_STREAMING_DEFAULTS,
} from "../../chat-openai-defaults.js";
import { createMinimaxStructuredOutputAdapter } from "./structured-output.js";
import { MiniMaxEmbeddings } from "./embeddings.js";
import {
  defaultMinimaxLlmOptions,
  minimaxModelKwargs,
  type MinimaxLlmOptions,
} from "./options.js";

function minimaxEmbeddingUrl(env: Env): string {
  if (env.MINIMAX_EMBEDDING_URL) return env.MINIMAX_EMBEDDING_URL;
  const base = env.MINIMAX_BASE_URL.replace(/\/$/, "");
  return `${base}/embeddings`;
}

function mergeMinimaxOptions(
  env: Env,
  selection?: LlmProviderSelection,
): MinimaxLlmOptions {
  const defaults = defaultMinimaxLlmOptions(env);
  return {
    chatModel:
      selection?.model ?? selection?.options?.chatModel ?? defaults.chatModel,
    embeddingModel:
      selection?.options?.embeddingModel ?? defaults.embeddingModel,
    minimaxThinkingEnabled:
      selection?.options?.minimaxThinkingEnabled ??
      defaults.minimaxThinkingEnabled,
  };
}

export function createMinimaxLlmProvider(
  env: Env,
  selection?: LlmProviderSelection,
): LlmProvider {
  const options = mergeMinimaxOptions(env, selection);
  const embeddingApiKey = env.MINIMAX_EMBEDDING_API_KEY ?? env.MINIMAX_API_KEY!;
  const createChatModel = (request?: { maxTokens?: number }) =>
    new ChatOpenAI({
      ...MINIMAX_CHAT_OPENAI_STREAMING_DEFAULTS,
      model: options.chatModel!,
      temperature: 0.7,
      apiKey: env.MINIMAX_API_KEY!,
      timeout: LLM_REQUEST_TIMEOUT_MS,
      modelKwargs: minimaxModelKwargs(
        options.chatModel!,
        options.minimaxThinkingEnabled ?? false,
        request?.maxTokens,
      ),
      configuration: { baseURL: env.MINIMAX_BASE_URL },
    });

  return {
    id: "minimax",
    structuredOutput: createMinimaxStructuredOutputAdapter({
      getModel: createChatModel,
    }),
    getChatModel(request) {
      return createChatModel(request);
    },
    getEmbeddings() {
      return new MiniMaxEmbeddings({
        model: options.embeddingModel,
        apiKey: embeddingApiKey,
        groupId: env.MINIMAX_GROUP_ID!,
        endpointUrl: minimaxEmbeddingUrl(env),
        batchSize: env.EMBEDDING_BATCH_SIZE,
      });
    },
  };
}
