import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import type { Env } from "../../../../env.js";
import type { LlmProvider, LlmProviderSelection } from "../../types.js";
import {
  CHAT_OPENAI_STREAMING_DEFAULTS,
  LLM_REQUEST_TIMEOUT_MS,
} from "../../chat-openai-defaults.js";
import { createOpenAiCompatibleStructuredOutputAdapter } from "../../openai-compatible-structured-output.js";
import {
  defaultOpenAiLlmOptions,
  openaiReasoningEffort,
  type OpenAiLlmOptions,
} from "./options.js";
import { getOpenAiBaseUrl } from "./runtime-config.js";

function mergeOpenAiOptions(
  env: Env,
  selection?: LlmProviderSelection,
): OpenAiLlmOptions {
  const defaults = defaultOpenAiLlmOptions(env);
  return {
    chatModel:
      selection?.model ?? selection?.options?.chatModel ?? defaults.chatModel,
    embeddingModel:
      selection?.options?.embeddingModel ?? defaults.embeddingModel,
    openaiThinkingEnabled: selection?.options?.openaiThinkingEnabled ?? false,
  };
}

/**
 * GPT-5.6 Luna rejects sampling knobs like `temperature` and uses
 * `max_completion_tokens` + `reasoning_effort`. Keep reasoning off by default
 * so structured JSON-schema calls stay fast and deterministic.
 */
export function createOpenAiLlmProvider(
  env: Env,
  selection?: LlmProviderSelection,
): LlmProvider {
  const options = mergeOpenAiOptions(env, selection);
  const baseURL = getOpenAiBaseUrl();
  const createChatModel = (request?: { maxTokens?: number }) =>
    new ChatOpenAI({
      ...CHAT_OPENAI_STREAMING_DEFAULTS,
      model: options.chatModel!,
      apiKey: env.OPENAI_API_KEY!,
      timeout: LLM_REQUEST_TIMEOUT_MS,
      configuration: { baseURL },
      // Agent tools may intentionally expose optional arguments. Enabling
      // strict tool calling globally makes OpenAI reject those schemas because
      // every property must also appear in `required` (for example,
      // navigate.label). Structured generation still uses the adapter's native
      // JSON-schema/function-calling transports and authoritative Zod checks.
      supportsStrictToolCalling: false,
        reasoning: {
          effort: openaiReasoningEffort(options.openaiThinkingEnabled ?? false),
        },
      ...(request?.maxTokens ? { maxTokens: request.maxTokens } : {}),
    });

  return {
    id: "openai",
    structuredOutput: createOpenAiCompatibleStructuredOutputAdapter({
      getModel: createChatModel,
      // jsonSchema first with strict: true (constrained decoding). FC stays
      // schema-constrained; jsonMode is valid JSON only and is last.
      methods: [
        { method: "jsonSchema", strict: true },
        { method: "functionCalling", strict: true },
        "jsonMode",
      ],
      strictBinding: "openai",
    }),
    getChatModel(request) {
      return createChatModel(request);
    },
    getEmbeddings() {
      return new OpenAIEmbeddings({
        model: options.embeddingModel!,
        apiKey: env.OPENAI_API_KEY!,
        configuration: { baseURL },
      });
    },
  };
}
