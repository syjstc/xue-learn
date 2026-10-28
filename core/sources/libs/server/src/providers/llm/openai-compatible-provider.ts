import { ChatOpenAI } from "@langchain/openai";
import type { Embeddings } from "@langchain/core/embeddings";
import type { LlmProvider, LlmProviderId } from "./types.js";
import {
  CHAT_OPENAI_STREAMING_DEFAULTS,
  LLM_REQUEST_TIMEOUT_MS,
  MINIMAX_CHAT_OPENAI_STREAMING_DEFAULTS,
} from "./chat-openai-defaults.js";
import {
  createOpenAiCompatibleStructuredOutputAdapter,
  type StructuredOutputMethodSpec,
} from "./openai-compatible-structured-output.js";
import type { StrictBindingDialect } from "./strict-binding-schema.js";
import type {
  StructuredOutputAdapter,
  StructuredOutputCapableModel,
} from "./structured-output-adapter.js";

export type OpenAiCompatibleProviderConfig = {
  id: LlmProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature?: number;
  modelKwargs?: Record<string, unknown>;
  reasoning?: { effort: "none" | "minimal" | "low" | "medium" | "high" };
  streamUsage?: boolean;
  /**
   * Agent tools often have optional arguments. Leave this false so ChatOpenAI
   * does not reject those schemas under OpenAI strict tool calling.
   */
  supportsStrictToolCalling?: boolean;
  structuredOutput?: StructuredOutputAdapter;
  structuredOutputFactory?: (
    getModel: (request?: { maxTokens?: number }) => StructuredOutputCapableModel,
  ) => StructuredOutputAdapter;
  structuredOutputMethods?: readonly StructuredOutputMethodSpec[];
  strictBinding?: StrictBindingDialect;
  getEmbeddings(): Embeddings;
};

/** Shared transport for providers that implement the OpenAI chat protocol. */
export function createOpenAiCompatibleLlmProvider(
  config: OpenAiCompatibleProviderConfig,
): LlmProvider {
  const createChatModel = (request?: { maxTokens?: number }) => {
    // Custom endpoints have arbitrary model ids, so ChatOpenAI cannot infer
    // that they need the newer max_completion_tokens wire field. Put the
    // common OpenAI-compatible field in modelKwargs instead of maxTokens,
    // which would otherwise serialize as max_tokens for unknown model ids.
    const modelKwargs = {
      ...(config.modelKwargs ?? {}),
      ...(request?.maxTokens !== undefined
        ? { max_completion_tokens: request.maxTokens }
        : {}),
    };
    return new ChatOpenAI({
      ...(config.streamUsage === false
        ? MINIMAX_CHAT_OPENAI_STREAMING_DEFAULTS
        : CHAT_OPENAI_STREAMING_DEFAULTS),
      model: config.model,
      apiKey: config.apiKey,
      timeout: LLM_REQUEST_TIMEOUT_MS,
      ...(config.supportsStrictToolCalling === undefined
        ? {}
        : { supportsStrictToolCalling: config.supportsStrictToolCalling }),
      ...(config.temperature === undefined
        ? {}
        : { temperature: config.temperature }),
      ...(config.reasoning ? { reasoning: config.reasoning } : {}),
      ...(Object.keys(modelKwargs).length ? { modelKwargs } : {}),
      configuration: { baseURL: config.baseUrl },
    });
  };

  return {
    id: config.id,
    structuredOutput:
      config.structuredOutput ??
      config.structuredOutputFactory?.(createChatModel) ??
      createOpenAiCompatibleStructuredOutputAdapter({
        getModel: createChatModel,
        methods: config.structuredOutputMethods ?? [
          "jsonSchema",
          "functionCalling",
          "jsonMode",
        ],
        ...(config.strictBinding
          ? { strictBinding: config.strictBinding }
          : {}),
      }),
    getChatModel: createChatModel,
    getEmbeddings: config.getEmbeddings,
  };
}
