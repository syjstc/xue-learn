import type { Embeddings } from "@langchain/core/embeddings";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type {
  EmbeddingProviderId,
  LlmProviderId,
} from "../../env.js";
import type { ProviderSelection } from "../core/types.js";
import type { StructuredOutputAdapter } from "./structured-output-adapter.js";

export type { LlmProviderId, EmbeddingProviderId };

export type CachedChatModelRequest = {
  maxTokens?: number;
  /** Stable prompt prefix to register with a provider-side prompt cache. */
  cachePrefix: string;
};

export type LlmProvider = {
  id: LlmProviderId;
  getChatModel(options?: {
    maxTokens?: number;
    /** Use the provider's strict structured-output transport when available. */
    strictStructuredOutput?: boolean;
  }): BaseChatModel;
  /** Return a cache-aware model, or undefined when provider caching is unavailable. */
  getCachedChatModel?: (
    options: CachedChatModelRequest,
  ) => Promise<BaseChatModel | undefined>;
  structuredOutput: StructuredOutputAdapter;
  getEmbeddings(): Embeddings;
  /** Present when chat and embedding backends differ (e.g. DeepSeek). */
  getEmbeddingProviderId?(): EmbeddingProviderId;
};

/** Per-vendor options merged at resolve time (env defaults + runtime + router). */
export type LlmProviderOptions = {
  chatModel?: string;
  embeddingModel?: string;
  embeddingProvider?: EmbeddingProviderId;
  minimaxThinkingEnabled?: boolean;
  ollamaThinkingEnabled?: boolean;
  deepseekThinkingEnabled?: boolean;
  openaiThinkingEnabled?: boolean;
  codexReasoningEffort?:
    | "none"
    | "minimal"
    | "low"
    | "medium"
    | "high"
    | "xhigh"
    | "max";
  bigmodelThinkingEnabled?: boolean;
  qwenThinkingEnabled?: boolean;
  doubaoThinkingMode?: "enabled" | "disabled" | "auto";
  customThinkingProtocol?:
    | "none"
    | "openai"
    | "minimax"
    | "deepseek"
    | "doubao"
    | "bigmodel"
    | "qwen"
    | "ollama";
  /** Final operation-routing decision; not persisted in learner settings. */
  routingReasoningMode?: "enabled" | "disabled" | "auto";
};

export type LlmProviderSelection = ProviderSelection<
  LlmProviderId,
  LlmProviderOptions
>;
