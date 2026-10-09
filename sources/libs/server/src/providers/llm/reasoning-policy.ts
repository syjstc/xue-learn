import { AsyncLocalStorage } from "node:async_hooks";
import type { LlmProviderId } from "../../env.js";
import type { LlmProviderSelection } from "./types.js";

export type ReasoningRequestStatus = "active" | "unsupported";

const reasoningScope = new AsyncLocalStorage<boolean>();

export function withOperationReasoning<T>(
  enabled: boolean,
  run: () => Promise<T>,
): Promise<T> {
  return reasoningScope.run(enabled, run);
}

export function reasoningCapabilityForProvider(
  provider: LlmProviderId,
  model?: string,
): ReasoningRequestStatus {
  if (
    provider === "doubao" &&
    model &&
    !model.trim().toLowerCase().startsWith("doubao-seed-")
  ) {
    return "unsupported";
  }
  return provider === "deepseek" ||
    provider === "codex" ||
    provider === "doubao" ||
    provider === "bigmodel" ||
    provider === "minimax" ||
    provider === "ollama" ||
    provider === "custom"
    ? "active"
    : "unsupported";
}

/** Apply an operation-local thinking override without changing persisted settings. */
export function applyOperationReasoningOverride(
  selection: LlmProviderSelection,
): LlmProviderSelection {
  const routedMode = selection.options?.routingReasoningMode;
  const enabled = routedMode
    ? routedMode !== "disabled"
    : reasoningScope.getStore() === true;
  if (!routedMode && !enabled) return selection;
  switch (selection.id) {
    case "deepseek":
      return {
        ...selection,
        options: { ...selection.options, deepseekThinkingEnabled: enabled },
      };
    case "codex":
      return {
        ...selection,
        options: {
          ...selection.options,
          codexReasoningEffort: enabled
            ? selection.options?.codexReasoningEffort === "none"
              ? "medium"
              : (selection.options?.codexReasoningEffort ?? "medium")
            : "none",
        },
      };
    case "doubao":
      return {
        ...selection,
        options: {
          ...selection.options,
          doubaoThinkingMode:
            routedMode === "auto" ? "auto" : enabled ? "enabled" : "disabled",
        },
      };
    case "bigmodel":
      return {
        ...selection,
        options: { ...selection.options, bigmodelThinkingEnabled: enabled },
      };
    case "minimax":
      return {
        ...selection,
        options: { ...selection.options, minimaxThinkingEnabled: enabled },
      };
    case "ollama":
      return {
        ...selection,
        options: { ...selection.options, ollamaThinkingEnabled: enabled },
      };
    case "custom": {
      const protocol = selection.options?.customThinkingProtocol ?? "none";
      if (protocol === "none") return selection;
      if (protocol === "openai") {
        return {
          ...selection,
          options: {
            ...selection.options,
            openaiThinkingEnabled: enabled,
          },
        };
      }
      if (protocol === "doubao") {
        return {
          ...selection,
          options: {
            ...selection.options,
            doubaoThinkingMode:
              routedMode === "auto" ? "auto" : enabled ? "enabled" : "disabled",
          },
        };
      }
      if (protocol === "bigmodel") {
        return {
          ...selection,
          options: {
            ...selection.options,
            bigmodelThinkingEnabled: enabled,
          },
        };
      }
      if (protocol === "qwen") {
        return {
          ...selection,
          options: {
            ...selection.options,
            qwenThinkingEnabled: enabled,
          },
        };
      }
      if (protocol === "minimax") {
        return {
          ...selection,
          options: { ...selection.options, minimaxThinkingEnabled: enabled },
        };
      }
      if (protocol === "ollama") {
        return {
          ...selection,
          options: { ...selection.options, ollamaThinkingEnabled: enabled },
        };
      }
      return {
        ...selection,
        options: { ...selection.options, deepseekThinkingEnabled: enabled },
      };
    }
    default:
      return selection;
  }
}
