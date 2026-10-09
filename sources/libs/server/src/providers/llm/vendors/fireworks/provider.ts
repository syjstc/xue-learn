import type { Env } from "../../../../env.js";
import type { LlmProvider, LlmProviderSelection } from "../../types.js";
import { createOpenAiCompatibleLlmProvider } from "../../openai-compatible-provider.js";
import {
  createSharedEmbeddings,
  resolveEmbeddingProviderId,
} from "../../shared-embeddings.js";
import {
  defaultFireworksLlmOptions,
  type FireworksLlmOptions,
} from "./options.js";

function mergeFireworksOptions(
  env: Env,
  selection?: LlmProviderSelection,
): FireworksLlmOptions {
  const defaults = defaultFireworksLlmOptions(env);
  return {
    chatModel:
      selection?.model ?? selection?.options?.chatModel ?? defaults.chatModel,
    embeddingModel: selection?.options?.embeddingModel,
    embeddingProvider: selection?.options?.embeddingProvider,
  };
}

export function createFireworksLlmProvider(
  env: Env,
  selection?: LlmProviderSelection,
): LlmProvider {
  const options = mergeFireworksOptions(env, selection);
  const embeddingProvider = resolveEmbeddingProviderId(
    "fireworks",
    options.embeddingProvider,
  );
  const provider = createOpenAiCompatibleLlmProvider({
    id: "fireworks",
    model: options.chatModel!,
    temperature: 0.6,
    apiKey: env.FIREWORKS_API_KEY!,
    baseUrl: env.FIREWORKS_BASE_URL,
    structuredOutputMethods: ["functionCalling", "jsonSchema", "jsonMode"],
    getEmbeddings: () =>
      createSharedEmbeddings(env, embeddingProvider, options.embeddingModel),
  });
  return {
    ...provider,
    getEmbeddingProviderId() {
      return embeddingProvider;
    },
  };
}
