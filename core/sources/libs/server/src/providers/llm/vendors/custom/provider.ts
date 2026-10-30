import type { Env } from "../../../../env.js";
import { createOpenAiCompatibleLlmProvider } from "../../openai-compatible-provider.js";
import {
  createSharedEmbeddings,
  resolveEmbeddingProviderId,
} from "../../shared-embeddings.js";
import type { LlmProvider, LlmProviderSelection } from "../../types.js";
import {
  customThinkingEnabled,
  customThinkingModelKwargs,
  defaultCustomLlmOptions,
  parseCustomThinkingProtocol,
  type CustomLlmOptions,
} from "./options.js";
import { openaiReasoningEffort } from "../openai/options.js";
import {
  isQwenChatModel,
  isQwenCompatibleEndpoint,
} from "../qwen/options.js";
import { createCustomStructuredOutputAdapter } from "./structured-output.js";

function mergeCustomOptions(
  env: Env,
  selection?: LlmProviderSelection,
): CustomLlmOptions {
  const defaults = defaultCustomLlmOptions(env);
  return {
    chatModel:
      selection?.model ?? selection?.options?.chatModel ?? defaults.chatModel,
    embeddingModel: selection?.options?.embeddingModel,
    embeddingProvider: selection?.options?.embeddingProvider,
    minimaxThinkingEnabled: selection?.options?.minimaxThinkingEnabled,
    minimaxReasoningEffort: selection?.options?.minimaxReasoningEffort,
    ollamaThinkingEnabled: selection?.options?.ollamaThinkingEnabled,
    deepseekThinkingEnabled: selection?.options?.deepseekThinkingEnabled,
    openaiThinkingEnabled: selection?.options?.openaiThinkingEnabled,
    bigmodelThinkingEnabled: selection?.options?.bigmodelThinkingEnabled,
    qwenThinkingEnabled: selection?.options?.qwenThinkingEnabled,
    doubaoThinkingMode: selection?.options?.doubaoThinkingMode,
    customThinkingProtocol: parseCustomThinkingProtocol(
      selection?.options?.customThinkingProtocol ??
        defaults.customThinkingProtocol,
    ),
  };
}

export function createCustomLlmProvider(
  env: Env,
  selection?: LlmProviderSelection,
): LlmProvider {
  const options = mergeCustomOptions(env, selection);
  const model = options.chatModel!;
  const embeddingProvider = resolveEmbeddingProviderId(
    "custom",
    options.embeddingProvider,
  );
  const protocol = parseCustomThinkingProtocol(options.customThinkingProtocol);
  const thinkingKwargs = customThinkingModelKwargs(options, {
    baseUrl: env.CUSTOM_OPENAI_BASE_URL,
  });
  const qwenLike =
    protocol === "qwen" ||
    (protocol === "none" &&
      (isQwenChatModel(model) ||
        isQwenCompatibleEndpoint(env.CUSTOM_OPENAI_BASE_URL)));
  return createOpenAiCompatibleLlmProvider({
    id: "custom",
    apiKey: env.CUSTOM_OPENAI_API_KEY!,
    baseUrl: env.CUSTOM_OPENAI_BASE_URL!,
    model,
    preserveMinimaxReasoning: protocol === "minimax",
    supportsStrictToolCalling: false,
    ...(protocol === "openai"
      ? {
          reasoning: {
            effort: openaiReasoningEffort(
              options.openaiThinkingEnabled ?? false,
            ),
          },
        }
      : Object.keys(thinkingKwargs).length > 0
        ? { modelKwargs: thinkingKwargs }
        : {}),
    structuredOutputFactory: (getModel) =>
      createCustomStructuredOutputAdapter({
        protocol,
        getModel,
        thinkingEnabled: qwenLike
          ? options.qwenThinkingEnabled === true
          : customThinkingEnabled(options),
        chatModel: model,
        baseUrl: env.CUSTOM_OPENAI_BASE_URL,
      }),
    getEmbeddings: () =>
      createSharedEmbeddings(env, embeddingProvider, options.embeddingModel),
  });
}
