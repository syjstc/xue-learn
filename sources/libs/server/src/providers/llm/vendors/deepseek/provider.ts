import { ChatOpenAI } from "@langchain/openai";
import type { Env } from "../../../../env.js";
import type { LlmProvider, LlmProviderSelection } from "../../types.js";
import {
  CHAT_OPENAI_STREAMING_DEFAULTS,
  LLM_REQUEST_TIMEOUT_MS,
} from "../../chat-openai-defaults.js";
import { createDeepseekStructuredOutputAdapter } from "./structured-output.js";
import {
  createSharedEmbeddings,
  resolveEmbeddingProviderId,
} from "../../shared-embeddings.js";
import {
  deepseekThinkingModelKwargs,
  defaultDeepseekLlmOptions,
  type DeepseekLlmOptions,
} from "./options.js";

function mergeDeepseekOptions(
  env: Env,
  selection?: LlmProviderSelection,
): DeepseekLlmOptions {
  const defaults = defaultDeepseekLlmOptions(env);
  return {
    chatModel:
      selection?.model ?? selection?.options?.chatModel ?? defaults.chatModel,
    embeddingModel: selection?.options?.embeddingModel,
    embeddingProvider: selection?.options?.embeddingProvider,
    deepseekThinkingEnabled:
      selection?.options?.deepseekThinkingEnabled ??
      defaults.deepseekThinkingEnabled,
  };
}

export function createDeepseekLlmProvider(
  env: Env,
  selection?: LlmProviderSelection,
): LlmProvider {
  const options = mergeDeepseekOptions(env, selection);
  const chatModel = options.chatModel!;
  const embeddingProvider = resolveEmbeddingProviderId(
    "deepseek",
    options.embeddingProvider,
  );
  const thinkingKwargs = deepseekThinkingModelKwargs(
    options.deepseekThinkingEnabled ?? false,
  );
  const createChatModel = (baseURL: string, maxTokens?: number) =>
    new ChatOpenAI({
      ...CHAT_OPENAI_STREAMING_DEFAULTS,
      model: chatModel,
      temperature: 0.7,
      apiKey: env.DEEPSEEK_API_KEY!,
      timeout: LLM_REQUEST_TIMEOUT_MS,
      ...(maxTokens ? { maxTokens } : {}),
      ...(Object.keys(thinkingKwargs).length > 0
        ? { modelKwargs: thinkingKwargs }
        : {}),
      configuration: { baseURL },
    });

  return {
    id: "deepseek",
    structuredOutput: createDeepseekStructuredOutputAdapter({
      getDefaultModel: (request) =>
        createChatModel(env.DEEPSEEK_BASE_URL, request?.maxTokens),
      getStrictModel: (request) =>
        createChatModel(env.DEEPSEEK_STRICT_BASE_URL, request?.maxTokens),
      strictEnabled: env.DEEPSEEK_STRICT_STRUCTURED_OUTPUT_ENABLED,
      thinkingEnabled: options.deepseekThinkingEnabled === true,
    }),
    getChatModel(request) {
      return createChatModel(
        request?.strictStructuredOutput &&
          env.DEEPSEEK_STRICT_STRUCTURED_OUTPUT_ENABLED
          ? env.DEEPSEEK_STRICT_BASE_URL
          : env.DEEPSEEK_BASE_URL,
        request?.maxTokens,
      );
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
