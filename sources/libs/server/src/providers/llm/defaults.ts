import { getRuntimeEnvironment } from "../../env.js";
import {
  type EmbeddingProviderId,
  type Env,
  type LlmProviderId,
} from "../../env.js";
import { EMBEDDING_PROVIDER_OPTIONS, LLM_PROVIDER_SPECS } from "./specs.js";

const EMPTY_ENV = {} as Env;

/** Server-fixed embedding backend; not user-configurable. */
export const FIXED_EMBEDDING_PROVIDER: EmbeddingProviderId = "bigmodel";

export function defaultLlmChatModel(provider: LlmProviderId): string {
  const spec = LLM_PROVIDER_SPECS.find((entry) => entry.id === provider);
  return spec?.defaultModel(EMPTY_ENV) ?? provider;
}

export function defaultEmbeddingModel(
  embeddingProvider: EmbeddingProviderId = FIXED_EMBEDDING_PROVIDER,
): string {
  const option = EMBEDDING_PROVIDER_OPTIONS.find(
    (p) => p.id === embeddingProvider,
  );
  return option?.models[0] ?? "embedding-3";
}

/** Embeddings always use BigModel in API services; chat provider is ignored. */
export function defaultEmbeddingProvider(
  _chatProvider?: LlmProviderId,
): EmbeddingProviderId {
  return getRuntimeEnvironment().XUELEARN_DESKTOP_LOCAL === "1"
    ? "builtin"
    : FIXED_EMBEDDING_PROVIDER;
}
