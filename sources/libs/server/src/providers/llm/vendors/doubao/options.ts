import type { Env } from "../../../../env.js";
import type { LlmProviderOptions } from "../../types.js";

export const DOUBAO_THINKING_MODES = ["enabled", "disabled", "auto"] as const;
export type DoubaoThinkingMode = (typeof DOUBAO_THINKING_MODES)[number];

export type DoubaoLlmOptions = Pick<
  LlmProviderOptions,
  "chatModel" | "embeddingModel" | "embeddingProvider" | "doubaoThinkingMode"
>;

/** @see https://www.volcengine.com/docs/82379/1330310 */
export const DOUBAO_LLM_MODELS = [
  // Seed 2.1 (2026-06)
  // "doubao-seed-2-1-pro-260628",
  "doubao-seed-2-1-turbo-260628",
  // "doubao-seed-evolving",
  // Seed 2.0 (2026-02)
  // "doubao-seed-2-0-pro-260215",
  "doubao-seed-2-0-lite-260215",
  "doubao-seed-2-0-mini-260215",
  // "doubao-seed-2-0-code-260215",
] as const;

export const DEFAULT_DOUBAO_CHAT_MODEL = "doubao-seed-2-0-mini-260215" as const;

export function defaultDoubaoLlmOptions(_env?: Env): DoubaoLlmOptions {
  return {
    chatModel: DEFAULT_DOUBAO_CHAT_MODEL,
    doubaoThinkingMode: "disabled",
  };
}

export function parseDoubaoThinkingMode(
  value: string | null | undefined,
): DoubaoThinkingMode {
  if (value === "disabled" || value === "auto") return value;
  return "enabled";
}

/** Seed-series models support Ark `thinking.type` (enabled / disabled / auto). */
export function doubaoThinkingConfigurable(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return (
    normalized.startsWith("doubao-seed-") ||
    normalized === "doubao-seed-evolving"
  );
}

/** LangChain `modelKwargs` at request root (same as OpenAI SDK `extra_body`). */
export function doubaoThinkingModelKwargs(
  model: string,
  mode: DoubaoThinkingMode,
  options?: { ignoreModelGate?: boolean },
): Record<string, unknown> {
  if (!options?.ignoreModelGate && !doubaoThinkingConfigurable(model)) {
    return {};
  }
  return {
    thinking: { type: mode },
  };
}
