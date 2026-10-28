import type { Env } from "../../../../env.js";
import type { LlmProviderOptions } from "../../types.js";

export type QwenLlmOptions = Pick<
  LlmProviderOptions,
  "chatModel" | "embeddingModel" | "embeddingProvider"
>;

/**
 * Qwen models via Alibaba Cloud Model Studio (DashScope).
 * @see https://www.qwencloud.com/models/qwen3.7-plus
 * @see https://docs.qwencloud.com/developer-guides/text-generation/structured-output
 */
export const QWEN_LLM_MODELS = ["qwen3.7-plus"] as const;

export const DEFAULT_QWEN_CHAT_MODEL = "qwen3.7-plus" as const;

export function defaultQwenLlmOptions(_env?: Env): QwenLlmOptions {
  return {
    chatModel: DEFAULT_QWEN_CHAT_MODEL,
  };
}

export function isQwenChatModel(model: string | undefined): boolean {
  return /qwen/i.test(model?.trim() ?? "");
}

export function isQwenCompatibleEndpoint(
  baseUrl: string | undefined,
): boolean {
  const url = (baseUrl ?? "").trim().toLowerCase();
  return (
    url.includes("dashscope") ||
    url.includes("qwencloud") ||
    url.includes("aliyuncs.com")
  );
}

/**
 * DashScope Qwen 3.x defaults thinking on. Thinking mode rejects
 * `tool_choice: required` and named function objects — only `auto`/`none`.
 * Hosted chat keeps thinking off because `response_format` is unreliable with
 * it. Desktop custom endpoints send this flag explicitly and may enable it.
 * @see https://docs.qwencloud.com/developer-guides/text-generation/structured-output
 */
export function qwenThinkingModelKwargs(
  thinkingEnabled = false,
): Record<string, unknown> {
  return { enable_thinking: thinkingEnabled };
}

/** Qwen thinking (including the API default) cannot force a tool. */
export function qwenRequiresAutoToolChoice(params: {
  provider?: string;
  model?: string;
}): boolean {
  return (
    params.provider === "qwen" ||
    (params.provider === "custom" && isQwenChatModel(params.model))
  );
}
