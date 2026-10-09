import type { Env } from "../../../../env.js";
import type { LlmProviderOptions } from "../../types.js";

export type CodexLlmOptions = Pick<
  LlmProviderOptions,
  "chatModel" | "openaiThinkingEnabled" | "codexReasoningEffort"
>;

export function defaultCodexLlmOptions(_env?: Env): CodexLlmOptions {
  return {
    // The subscription account owns the model catalog. Do not guess or pin a
    // current model when the catalog is unavailable.
    chatModel: undefined,
    openaiThinkingEnabled: true,
    codexReasoningEffort: "medium",
  };
}
