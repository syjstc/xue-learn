import type { Env } from "../../../../env.js";
import type { LlmProviderOptions } from "../../types.js";
import { bigmodelThinkingModelKwargs } from "../bigmodel/options.js";
import { deepseekThinkingModelKwargs } from "../deepseek/options.js";
import { doubaoThinkingModelKwargs } from "../doubao/options.js";
import { minimaxThinkingModelKwargs, minimaxReasoningEffortConfigurable } from "../minimax/options.js";
import { openaiReasoningEffort } from "../openai/options.js";
import { ollamaThinkingModelKwargs } from "../ollama/options.js";
import {
  isQwenChatModel,
  isQwenCompatibleEndpoint,
  qwenThinkingModelKwargs,
} from "../qwen/options.js";

export type CustomThinkingProtocol =
  | "none"
  | "openai"
  | "minimax"
  | "deepseek"
  | "doubao"
  | "bigmodel"
  | "qwen"
  | "ollama";

export type CustomLlmOptions = Pick<
  LlmProviderOptions,
  | "chatModel"
  | "embeddingModel"
  | "embeddingProvider"
  | "minimaxThinkingEnabled"
  | "minimaxReasoningEffort"
  | "ollamaThinkingEnabled"
  | "deepseekThinkingEnabled"
  | "openaiThinkingEnabled"
  | "bigmodelThinkingEnabled"
  | "qwenThinkingEnabled"
  | "doubaoThinkingMode"
  | "customThinkingProtocol"
>;

export const CUSTOM_LLM_MODELS: readonly string[] = [];
export const DEFAULT_CUSTOM_CHAT_MODEL = "custom-model";

export function defaultCustomLlmOptions(_env?: Env): CustomLlmOptions {
  return {
    chatModel: DEFAULT_CUSTOM_CHAT_MODEL,
    customThinkingProtocol: "none",
  };
}

export function parseCustomThinkingProtocol(
  value: string | null | undefined,
): CustomThinkingProtocol {
  if (
    value === "openai" ||
    value === "minimax" ||
    value === "deepseek" ||
    value === "doubao" ||
    value === "bigmodel" ||
    value === "qwen" ||
    value === "ollama"
  ) {
    return value;
  }
  return "none";
}

export function customThinkingEnabled(options: CustomLlmOptions): boolean {
  switch (parseCustomThinkingProtocol(options.customThinkingProtocol)) {
    case "openai":
      return options.openaiThinkingEnabled === true;
    case "minimax":
      return minimaxReasoningEffortConfigurable(options.chatModel ?? "") ||
        options.minimaxThinkingEnabled === true;
    case "deepseek":
      return options.deepseekThinkingEnabled === true;
    case "doubao":
      return (
        options.doubaoThinkingMode === "enabled" ||
        options.doubaoThinkingMode === "auto"
      );
    case "bigmodel":
      return options.bigmodelThinkingEnabled === true;
    case "qwen":
      return options.qwenThinkingEnabled === true;
    case "ollama":
      return options.ollamaThinkingEnabled === true;
    default:
      return false;
  }
}

/** Apply the selected vendor dialect on a generic OpenAI-compatible endpoint. */
export function customThinkingModelKwargs(
  options: CustomLlmOptions,
  extra?: { baseUrl?: string },
): Record<string, unknown> {
  const protocol = parseCustomThinkingProtocol(options.customThinkingProtocol);
  const model = options.chatModel ?? DEFAULT_CUSTOM_CHAT_MODEL;
  const qwenEndpoint =
    protocol === "qwen" ||
    (protocol === "none" &&
      (isQwenChatModel(model) || isQwenCompatibleEndpoint(extra?.baseUrl)));
  if (qwenEndpoint) {
    return qwenThinkingModelKwargs(options.qwenThinkingEnabled === true);
  }
  switch (protocol) {
    case "openai":
      return {
        reasoning_effort: openaiReasoningEffort(
          options.openaiThinkingEnabled ?? false,
        ),
      };
    case "minimax":
      return minimaxThinkingModelKwargs(
        model,
        options.minimaxThinkingEnabled ?? false,
        { ignoreModelGate: true, reasoningEffort: options.minimaxReasoningEffort },
      );
    case "deepseek":
      return deepseekThinkingModelKwargs(
        options.deepseekThinkingEnabled ?? false,
      );
    case "doubao":
      return doubaoThinkingModelKwargs(
        model,
        options.doubaoThinkingMode ?? "disabled",
        { ignoreModelGate: true },
      );
    case "bigmodel":
      return bigmodelThinkingModelKwargs(
        options.bigmodelThinkingEnabled === true,
      );
    case "ollama":
      return ollamaThinkingModelKwargs(options.ollamaThinkingEnabled ?? false);
    default:
      return {};
  }
}
