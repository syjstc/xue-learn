import { ChatOpenAI } from "@langchain/openai";
import type { Env } from "../../../../env.js";
import type { LlmProvider, LlmProviderSelection } from "../../types.js";
import {
  CHAT_OPENAI_STREAMING_DEFAULTS,
  LLM_REQUEST_TIMEOUT_MS,
} from "../../chat-openai-defaults.js";
import {
  createSharedEmbeddings,
  resolveEmbeddingProviderId,
} from "../../shared-embeddings.js";
import {
  defaultQwenLlmOptions,
  qwenThinkingModelKwargs,
  type QwenLlmOptions,
} from "./options.js";
import { createQwenStructuredOutputAdapter } from "./structured-output.js";

function mergeQwenOptions(
  env: Env,
  selection?: LlmProviderSelection,
): QwenLlmOptions {
  const defaults = defaultQwenLlmOptions(env);
  return {
    chatModel:
      selection?.model ?? selection?.options?.chatModel ?? defaults.chatModel,
    embeddingModel: selection?.options?.embeddingModel,
    embeddingProvider: selection?.options?.embeddingProvider,
  };
}

export function createQwenLlmProvider(
  env: Env,
  selection?: LlmProviderSelection,
): LlmProvider {
  const options = mergeQwenOptions(env, selection);
  const embeddingProvider = resolveEmbeddingProviderId(
    "qwen",
    options.embeddingProvider,
  );
  const chatModel = options.chatModel!;
  const thinkingKwargs = qwenThinkingModelKwargs(false);
  const createChatModel = (request?: { maxTokens?: number }) =>
    new ChatOpenAI({
      ...CHAT_OPENAI_STREAMING_DEFAULTS,
      model: chatModel,
      temperature: 0.7,
      apiKey: env.DASHSCOPE_API_KEY!,
      timeout: LLM_REQUEST_TIMEOUT_MS,
      ...(request?.maxTokens ? { maxTokens: request.maxTokens } : {}),
      modelKwargs: thinkingKwargs,
      configuration: { baseURL: env.DASHSCOPE_BASE_URL },
    });

  return {
    id: "qwen",
    structuredOutput: createQwenStructuredOutputAdapter({
      getModel: createChatModel,
    }),
    getChatModel(request) {
      return createChatModel(request);
    },
    getEmbeddings() {
      return createSharedEmbeddings(
        env,
        embeddingProvider,
        options.embeddingModel,
      );
    },
    getEmbeddingProviderId() {
      return embeddingProvider;
    },
  };
}
