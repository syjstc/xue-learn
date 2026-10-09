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
import { createBigModelStructuredOutputAdapter } from "./structured-output.js";
import {
  bigmodelChatModelKwargs,
  defaultBigModelLlmOptions,
  type BigModelLlmOptions,
} from "./options.js";

function mergeBigModelOptions(
  env: Env,
  selection?: LlmProviderSelection,
): BigModelLlmOptions {
  const defaults = defaultBigModelLlmOptions(env);
  return {
    chatModel:
      selection?.model ?? selection?.options?.chatModel ?? defaults.chatModel,
    embeddingModel: selection?.options?.embeddingModel,
    embeddingProvider: selection?.options?.embeddingProvider,
    bigmodelThinkingEnabled:
      selection?.options?.bigmodelThinkingEnabled ??
      defaults.bigmodelThinkingEnabled,
  };
}

export function createBigModelLlmProvider(
  env: Env,
  selection?: LlmProviderSelection,
): LlmProvider {
  const options = mergeBigModelOptions(env, selection);
  const chatModel = options.chatModel!;
  const embeddingProvider = resolveEmbeddingProviderId(
    "bigmodel",
    options.embeddingProvider,
  );
  const modelKwargs = bigmodelChatModelKwargs(
    options.bigmodelThinkingEnabled === true,
  );
  const createChatModel = (request?: { maxTokens?: number }) =>
    new ChatOpenAI({
      ...CHAT_OPENAI_STREAMING_DEFAULTS,
      model: chatModel,
      temperature: 0.7,
      apiKey: env.BIGMODEL_API_KEY!,
      timeout: LLM_REQUEST_TIMEOUT_MS,
      supportsStrictToolCalling: false,
      ...(request?.maxTokens ? { maxTokens: request.maxTokens } : {}),
      modelKwargs,
      configuration: { baseURL: env.BIGMODEL_BASE_URL },
    });

  return {
    id: "bigmodel",
    structuredOutput: createBigModelStructuredOutputAdapter({
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
