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
  defaultOllamaLlmOptions,
  ollamaThinkingModelKwargs,
  type OllamaLlmOptions,
} from "./options.js";

/** Ollama exposes an OpenAI-compatible API; tool calling is more reliable than ChatOllama. */
function ollamaOpenAiBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function mergeOllamaOptions(
  env: Env,
  selection?: LlmProviderSelection,
): OllamaLlmOptions {
  const defaults = defaultOllamaLlmOptions(env);
  return {
    chatModel:
      selection?.model ?? selection?.options?.chatModel ?? defaults.chatModel,
    embeddingModel: selection?.options?.embeddingModel,
    embeddingProvider: selection?.options?.embeddingProvider,
    ollamaThinkingEnabled:
      selection?.options?.ollamaThinkingEnabled ??
      defaults.ollamaThinkingEnabled,
  };
}

export function createOllamaLlmProvider(
  env: Env,
  selection?: LlmProviderSelection,
): LlmProvider {
  const options = mergeOllamaOptions(env, selection);
  const embeddingProvider = resolveEmbeddingProviderId(
    "ollama",
    options.embeddingProvider,
  );
  const thinkingKwargs = ollamaThinkingModelKwargs(
    options.ollamaThinkingEnabled ?? false,
  );
  const createChatModel = (request?: { maxTokens?: number }) =>
    new ChatOpenAI({
      ...CHAT_OPENAI_STREAMING_DEFAULTS,
      model: options.chatModel!,
      temperature: 0.7,
      apiKey: "ollama",
      timeout: LLM_REQUEST_TIMEOUT_MS,
      ...(request?.maxTokens ? { maxTokens: request.maxTokens } : {}),
      modelKwargs: thinkingKwargs,
      configuration: { baseURL: ollamaOpenAiBaseUrl(env.OLLAMA_BASE_URL) },
    });

  return {
    id: "ollama",
    structuredOutput: createOpenAiCompatibleStructuredOutputAdapter({
      getModel: createChatModel,
      methods: ["jsonMode", "functionCalling"],
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
