import type { Env } from "../../../../env.js";
import type { LlmProviderOptions } from "../../types.js";

export type OllamaLlmOptions = Pick<
  LlmProviderOptions,
  "chatModel" | "embeddingModel" | "embeddingProvider" | "ollamaThinkingEnabled"
>;

/** Local embedding models — use any name from `ollama list` via custom input in Settings. */
export const OLLAMA_EMBEDDING_MODELS = ["bge-m3"] as const;

/** Common models — use any name from `ollama list` via custom input in Settings. */
export const OLLAMA_LLM_MODELS = [
  "gemma4:e2b-mlx",
  "llama3.2",
  "llama3.1",
  "mistral",
  "qwen2.5",
  "gemma2",
] as const;

export function defaultOllamaLlmOptions(_env?: Env): OllamaLlmOptions {
  return {
    chatModel: OLLAMA_LLM_MODELS[0],
    ollamaThinkingEnabled: false,
  };
}

/** Ollama native `think` flag on chat/generate requests (boolean for most models). */
export function ollamaThinkingModelKwargs(
  enabled: boolean,
): Record<string, unknown> {
  return { think: enabled };
}
