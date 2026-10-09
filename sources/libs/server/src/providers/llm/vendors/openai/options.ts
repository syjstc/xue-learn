import type { Env } from "../../../../env.js";
import type { LlmProviderOptions } from "../../types.js";

export type OpenAiLlmOptions = Pick<
  LlmProviderOptions,
  "chatModel" | "embeddingModel" | "openaiThinkingEnabled"
>;

export type OpenAiReasoningEffort = "none" | "medium";

/** GPT-5 / Codex chat completions take `reasoning_effort` at the request root. */
export function openaiReasoningEffort(
  enabled: boolean,
): OpenAiReasoningEffort {
  return enabled ? "medium" : "none";
}

/** Sole supported OpenAI chat model for learner + admin routing. */
export const OPENAI_LLM_MODELS = ["gpt-5.6-luna"] as const;
export const OPENAI_EMBEDDING_MODELS = [
  "text-embedding-3-small",
  "text-embedding-3-large",
] as const;

export function defaultOpenAiLlmOptions(_env?: Env): OpenAiLlmOptions {
  return {
    chatModel: OPENAI_LLM_MODELS[0],
    embeddingModel: OPENAI_EMBEDDING_MODELS[0],
  };
}
