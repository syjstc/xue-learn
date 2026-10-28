import { getRuntimeEnvironment } from "../../env.js";
import type { Embeddings } from "@langchain/core/embeddings";
import type {
  Env,
  EmbeddingProviderId,
  LlmProviderId,
} from "../../env.js";
import { defaultEmbeddingModel, defaultEmbeddingProvider } from "./defaults.js";
import { createBigModelEmbeddings } from "./vendors/bigmodel/embeddings.js";
import { createMinimaxLlmProvider } from "./vendors/minimax/provider.js";
import { createOllamaEmbeddings } from "./vendors/ollama/embeddings.js";
import { createOpenAiLlmProvider } from "./vendors/openai/provider.js";
import { createBuiltinEmbeddings } from "./vendors/builtin/embeddings.js";
import { createCustomEmbeddings } from "./vendors/custom/embeddings.js";

export function resolveEmbeddingProviderId(
  _chatProvider: LlmProviderId,
  override?: EmbeddingProviderId,
): EmbeddingProviderId {
  if (getRuntimeEnvironment().XUELEARN_DESKTOP_LOCAL === "1" && override) return override;
  return defaultEmbeddingProvider();
}

export function createSharedEmbeddings(
  env: Env,
  embeddingProvider: EmbeddingProviderId,
  embeddingModel?: string,
): Embeddings {
  const model = embeddingModel ?? defaultEmbeddingModel(embeddingProvider);
  switch (embeddingProvider) {
    case "builtin":
      if (getRuntimeEnvironment().XUELEARN_DESKTOP_LOCAL !== "1") {
        throw new Error(
          "Built-in embeddings are available only in desktop-local",
        );
      }
      return createBuiltinEmbeddings(env);
    case "custom_embedding":
      if (getRuntimeEnvironment().XUELEARN_DESKTOP_LOCAL !== "1") {
        throw new Error(
          "Custom embeddings are available only in desktop-local",
        );
      }
      return createCustomEmbeddings(env, model);
    case "openai":
      return createOpenAiLlmProvider(env, {
        id: "openai",
        options: {
          embeddingModel: model,
        },
      }).getEmbeddings();
    case "minimax":
      return createMinimaxLlmProvider(env, {
        id: "minimax",
        options: {
          embeddingModel: model,
        },
      }).getEmbeddings();
    case "bigmodel":
      return createBigModelEmbeddings(env, model);
    case "ollama":
      return createOllamaEmbeddings(env, model);
    default: {
      const _exhaustive: never = embeddingProvider;
      throw new Error(`Unknown embedding provider: ${_exhaustive}`);
    }
  }
}
