export const llmProviderIds = [
  "minimax",
  "openai",
  "deepseek",
  "fireworks",
  "doubao",
  "bigmodel",
  "qwen",
  "ollama",
] as const;
export type LlmProviderId = (typeof llmProviderIds)[number];

/** Chat-only providers that require a separate embedding backend. */
export function isChatOnlyLlmProvider(provider: LlmProviderId): boolean {
  return (
    provider === "deepseek" ||
    provider === "fireworks" ||
    provider === "doubao" ||
    provider === "qwen" ||
    provider === "ollama"
  );
}

export const embeddingProviderIds = [
  "minimax",
  "openai",
  "bigmodel",
  "ollama",
] as const;
export type EmbeddingProviderId = (typeof embeddingProviderIds)[number];

export { imageProviderIds } from "@/shared/images/provider-ids";
export type { ImageProviderId } from "@/shared/images/provider-ids";
