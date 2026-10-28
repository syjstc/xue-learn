import type { Env } from "../../../../env.js";
import type { LlmProviderOptions } from "../../types.js";

export type MinimaxLlmOptions = Pick<
  LlmProviderOptions,
  "chatModel" | "embeddingModel" | "minimaxThinkingEnabled"
>;

export const MINIMAX_LLM_MODELS = [
  "MiniMax-M2.7-highspeed",
  "MiniMax-M2.7",
  "MiniMax-M3",
] as const;

export const DEFAULT_MINIMAX_CHAT_MODEL = "MiniMax-M3" as const;

/**
 * M2.x always spends some completion budget on reasoning. Keep the local
 * connection probe cheap, but large enough for the model to reach its visible
 * answer instead of returning an empty `content` field.
 */
export const MINIMAX_REASONING_CONNECTION_TEST_MAX_TOKENS = 512;

export const MINIMAX_EMBEDDING_MODELS = ["embo-01"] as const;

export function defaultMinimaxLlmOptions(_env?: Env): MinimaxLlmOptions {
  return {
    chatModel: DEFAULT_MINIMAX_CHAT_MODEL,
    embeddingModel: MINIMAX_EMBEDDING_MODELS[0],
    minimaxThinkingEnabled: false,
  };
}

/** MiniMax-M3 supports `thinking.type: disabled`; M2.x always emit thinking. */
export function minimaxThinkingConfigurable(model: string): boolean {
  return /^MiniMax-M3$/i.test(model.trim());
}

/**
 * LangChain `modelKwargs` merge at the request root (same effect as OpenAI SDK
 * `extra_body` in Python). Do not nest under an `extra_body` key — MiniMax ignores it.
 *
 * `reasoning_split` keeps thinking in `reasoning_details` so message `content`
 * (and JIT JSON) can stream instead of waiting behind `<think>` tags.
 */
export function minimaxThinkingModelKwargs(
  model: string,
  enabled: boolean,
  options?: { ignoreModelGate?: boolean },
): Record<string, unknown> {
  const kwargs: Record<string, unknown> = { reasoning_split: true };
  if (
    (options?.ignoreModelGate || minimaxThinkingConfigurable(model)) &&
    !enabled
  ) {
    kwargs.thinking = { type: "disabled" };
  }
  return kwargs;
}

/** MiniMax documents `max_completion_tokens`; avoid the deprecated alias. */
export function minimaxModelKwargs(
  model: string,
  thinkingEnabled: boolean,
  maxCompletionTokens?: number,
): Record<string, unknown> {
  return {
    ...minimaxThinkingModelKwargs(model, thinkingEnabled),
    ...(maxCompletionTokens
      ? { max_completion_tokens: maxCompletionTokens }
      : {}),
  };
}

export function minimaxConnectionTestMaxTokens(model: string): number {
  return minimaxThinkingConfigurable(model)
    ? 8
    : MINIMAX_REASONING_CONNECTION_TEST_MAX_TOKENS;
}
