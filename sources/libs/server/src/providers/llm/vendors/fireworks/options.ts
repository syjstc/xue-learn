import type { Env } from "../../../../env.js";
import type { LlmProviderOptions } from "../../types.js";

export type FireworksLlmOptions = Pick<
  LlmProviderOptions,
  "chatModel" | "embeddingModel" | "embeddingProvider"
>;

export const FIREWORKS_LLM_MODELS = [
  "accounts/fireworks/models/kimi-k2p6",
  "accounts/fireworks/models/llama-v3p3-70b-instruct",
] as const;

export function defaultFireworksLlmOptions(_env?: Env): FireworksLlmOptions {
  return {
    chatModel: FIREWORKS_LLM_MODELS[0],
  };
}
