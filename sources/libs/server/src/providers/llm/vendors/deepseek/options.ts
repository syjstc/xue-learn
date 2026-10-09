import type { Env } from "../../../../env.js";
import type { LlmProviderOptions } from "../../types.js";

export type DeepseekLlmOptions = Pick<
  LlmProviderOptions,
  "chatModel" | "embeddingModel" | "embeddingProvider" | "deepseekThinkingEnabled"
>;

/** @see https://api-docs.deepseek.com/quick_start/pricing */
export const DEEPSEEK_CHAT_MODEL = "deepseek-flash" as const;

export const DEEPSEEK_LLM_MODELS = [DEEPSEEK_CHAT_MODEL] as const;

export function resolveDeepseekChatModel(model?: string | null): string {
  const trimmed = model?.trim() ?? "";
  return trimmed === DEEPSEEK_CHAT_MODEL ? trimmed : DEEPSEEK_CHAT_MODEL;
}

export function defaultDeepseekLlmOptions(_env?: Env): DeepseekLlmOptions {
  return {
    chatModel: DEEPSEEK_CHAT_MODEL,
    deepseekThinkingEnabled: false,
  };
}

/** DeepSeek Flash: `thinking.type=disabled` opts out of the default thinking mode. */
export function deepseekThinkingModelKwargs(
  enabled: boolean,
): Record<string, unknown> {
  if (enabled) {
    return {};
  }
  return {
    thinking: { type: "disabled" },
  };
}
