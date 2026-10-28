import type { LlmRuntimeConfig } from "../../llm/runtime-config.js";
import type { LlmProviderSelection } from "./types.js";

export function llmRuntimeConfigToSelection(
  config: LlmRuntimeConfig,
): LlmProviderSelection {
  return {
    id: config.provider,
    model: config.chatModel,
    options: {
      chatModel: config.chatModel,
      embeddingModel: config.embeddingModel,
      embeddingProvider: config.embeddingProvider,
      minimaxThinkingEnabled: config.minimaxThinkingEnabled,
      ollamaThinkingEnabled: config.ollamaThinkingEnabled,
      deepseekThinkingEnabled: config.deepseekThinkingEnabled,
      openaiThinkingEnabled: config.openaiThinkingEnabled,
      codexReasoningEffort: config.codexReasoningEffort,
      bigmodelThinkingEnabled: config.bigmodelThinkingEnabled,
      qwenThinkingEnabled: config.qwenThinkingEnabled,
      doubaoThinkingMode: config.doubaoThinkingMode,
      customThinkingProtocol: config.customThinkingProtocol,
    },
  };
}
