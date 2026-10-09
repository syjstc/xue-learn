import type { Env } from "../../../../env.js";
import type { LlmProviderOptions } from "../../types.js";

export type BigModelLlmOptions = Pick<
  LlmProviderOptions,
  | "chatModel"
  | "embeddingModel"
  | "embeddingProvider"
  | "bigmodelThinkingEnabled"
>;

export type BigModelEmbeddingOptions = Pick<
  LlmProviderOptions,
  "embeddingModel"
>;

/** @see https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash */
export const BIGMODEL_LLM_MODELS = ["glm-5.3-flash"] as const;
export const DEFAULT_BIGMODEL_CHAT_MODEL = BIGMODEL_LLM_MODELS[0];

export const BIGMODEL_EMBEDDING_MODELS = ["embedding-3"] as const;

/**
 * embedding-3 allows at most 3072 tokens per input string.
 * CJK text is often near 1 token/char, so keep a conservative char budget
 * under that ceiling (also respects the provider batch max of 64 inputs).
 */
export const BIGMODEL_EMBEDDING_MAX_INPUT_CHARS = 2000;

export function defaultBigModelLlmOptions(_env?: Env): BigModelLlmOptions {
  return {
    chatModel: DEFAULT_BIGMODEL_CHAT_MODEL,
    bigmodelThinkingEnabled: false,
  };
}

export function defaultBigModelEmbeddingOptions(
  _env?: Env,
): BigModelEmbeddingOptions {
  return {
    embeddingModel: BIGMODEL_EMBEDDING_MODELS[0],
  };
}

/**
 * GLM-5.3-Flash cannot disable thinking (`thinking.type=disabled` 400s).
 * The closest "off" is forced thinking at `reasoning_effort: low`.
 * @see https://docs.bigmodel.cn/cn/guide/capabilities/thinking
 */
export function bigmodelThinkingModelKwargs(
  thinkingEnabled: boolean,
): Record<string, unknown> {
  return {
    thinking: { type: "enabled" },
    reasoning_effort: thinkingEnabled ? "high" : "low",
  };
}

/**
 * BigModel requires `tool_stream` for streamed function-call deltas. Keep the
 * flag on the model so both direct authoring binds and structured transports
 * send it through ChatOpenAI's OpenAI-compatible request body.
 */
export function bigmodelChatModelKwargs(
  thinkingEnabled: boolean,
): Record<string, unknown> {
  return {
    ...bigmodelThinkingModelKwargs(thinkingEnabled),
    // Authoring replays the prior reasoning_content in its durable transcript.
    // BigModel requires preserved thinking for interleaved thinking + tools.
    thinking: { type: "enabled", clear_thinking: false },
    tool_stream: true,
  };
}
