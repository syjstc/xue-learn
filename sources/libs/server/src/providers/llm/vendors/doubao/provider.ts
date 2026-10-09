import { ChatOpenAI } from "@langchain/openai";
import type { Env } from "../../../../env.js";
import type { LlmProvider, LlmProviderSelection } from "../../types.js";
import {
  CHAT_OPENAI_STREAMING_DEFAULTS,
  LLM_REQUEST_TIMEOUT_MS,
} from "../../chat-openai-defaults.js";
import { createOpenAiCompatibleStructuredOutputAdapter } from "../../openai-compatible-structured-output.js";
import {
  createSharedEmbeddings,
  resolveEmbeddingProviderId,
} from "../../shared-embeddings.js";
import {
  defaultDoubaoLlmOptions,
  doubaoThinkingModelKwargs,
  type DoubaoLlmOptions,
} from "./options.js";
import { PROMPT_PREFIX_FORMAT_VERSION } from "../../../../generation/prompt-prefix.js";
import { createDoubaoContextCachedChatModel } from "./context-cache.js";

function mergeDoubaoOptions(
  env: Env,
  selection?: LlmProviderSelection,
): DoubaoLlmOptions {
  const defaults = defaultDoubaoLlmOptions(env);
  return {
    chatModel:
      selection?.model ?? selection?.options?.chatModel ?? defaults.chatModel,
    embeddingModel: selection?.options?.embeddingModel,
    embeddingProvider: selection?.options?.embeddingProvider,
    doubaoThinkingMode:
      selection?.options?.doubaoThinkingMode ?? defaults.doubaoThinkingMode,
  };
}

export function createDoubaoLlmProvider(
  env: Env,
  selection?: LlmProviderSelection,
): LlmProvider {
  const options = mergeDoubaoOptions(env, selection);
  const embeddingProvider = resolveEmbeddingProviderId(
    "doubao",
    options.embeddingProvider,
  );
  const chatModel = options.chatModel!;
  const thinkingKwargs = doubaoThinkingModelKwargs(
    chatModel,
    options.doubaoThinkingMode ?? "disabled",
  );
  const createChatModel = (request?: { maxTokens?: number }) =>
    new ChatOpenAI({
      ...CHAT_OPENAI_STREAMING_DEFAULTS,
      model: chatModel,
      temperature: 0.7,
      apiKey: env.DOUBAO_API_KEY!,
      timeout: LLM_REQUEST_TIMEOUT_MS,
      ...(request?.maxTokens ? { maxTokens: request.maxTokens } : {}),
      ...(Object.keys(thinkingKwargs).length > 0
        ? { modelKwargs: thinkingKwargs }
        : {}),
      configuration: { baseURL: env.DOUBAO_BASE_URL },
    });
  const createCachedChatModel = (request: {
    maxTokens?: number;
    cachePrefix: string;
  }) =>
    createDoubaoContextCachedChatModel({
      baseUrl: env.DOUBAO_BASE_URL,
      apiKey: env.DOUBAO_API_KEY!,
      model: chatModel,
      maxTokens: request.maxTokens,
      cachePrefix: request.cachePrefix,
      prefixVersion: PROMPT_PREFIX_FORMAT_VERSION,
      modelKwargs: thinkingKwargs,
      createFallbackModel: () => createChatModel(request),
    });

  return {
    id: "doubao",
    structuredOutput: createOpenAiCompatibleStructuredOutputAdapter({
      getModel: (request) =>
        request?.cachePrefix
          ? createCachedChatModel({
              maxTokens: request.maxTokens,
              cachePrefix: request.cachePrefix,
            }).then((cached) => cached ?? createChatModel(request))
          : createChatModel(request),
      // Prefer Ark json_schema with OpenAI-style strict when the schema
      // compiles. A non-strict json_schema retry covers endpoints that 400 on
      // `strict`, then function calling. See
      // https://docs.volcengine.com/docs/82379/1568221
      methods: [
        { method: "jsonSchema", strict: true },
        "jsonSchema",
        "functionCalling",
      ],
      strictBinding: "openai",
    }),
    getChatModel(request) {
      return createChatModel(request);
    },
    getCachedChatModel(request) {
      return createCachedChatModel(request);
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
