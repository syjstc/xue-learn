import { ChatOpenAI } from "@langchain/openai";
import type { Env } from "../../../../env.js";
import type { LlmProvider, LlmProviderSelection } from "../../types.js";
import {
  CHAT_OPENAI_STREAMING_DEFAULTS,
  LLM_REQUEST_TIMEOUT_MS,
} from "../../chat-openai-defaults.js";
import { createOpenAiCompatibleStructuredOutputAdapter } from "../../openai-compatible-structured-output.js";
import { createBuiltinEmbeddings } from "../builtin/embeddings.js";
import { openaiReasoningEffort } from "../openai/options.js";
import { codexFetch } from "./runtime.js";
import {
  defaultCodexLlmOptions,
  type CodexLlmOptions,
} from "./options.js";
import { patchCodexChatOpenAI } from "./responses-tool-choice.js";

function mergeCodexOptions(
  env: Env,
  selection?: LlmProviderSelection,
): CodexLlmOptions {
  const defaults = defaultCodexLlmOptions(env);
  return {
    chatModel:
      selection?.model ?? selection?.options?.chatModel ?? defaults.chatModel,
    openaiThinkingEnabled:
      selection?.options?.openaiThinkingEnabled ??
      defaults.openaiThinkingEnabled,
    codexReasoningEffort:
      selection?.options?.codexReasoningEffort ?? defaults.codexReasoningEffort,
  };
}

export function createCodexLlmProvider(
  env: Env,
  selection?: LlmProviderSelection,
): LlmProvider {
  const options = mergeCodexOptions(env, selection);
  const selectedModel = options.chatModel?.trim();
  const createChatModel = (_request?: { maxTokens?: number }) => {
    if (!selectedModel) {
      throw new Error(
        "Codex model catalog is unavailable; sign in and select an account model",
      );
    }
    const isGpt6 = /^gpt-6[.-]/.test(selectedModel);
    let effort =
      options.codexReasoningEffort ??
      openaiReasoningEffort(options.openaiThinkingEnabled === true);
    // Existing desktop preferences may contain levels omitted by the GPT-6
    // subscription catalog. Keep the request on a supported reasoning level.
    if (isGpt6 && effort === "minimal") effort = "low";
    if (isGpt6 && effort === "none") {
      effort = selectedModel === "gpt-6-astra" ? "low" : "medium";
    }
    return patchCodexChatOpenAI(
      new ChatOpenAI({
        ...CHAT_OPENAI_STREAMING_DEFAULTS,
        model: selectedModel,
        // Fetch replaces this placeholder with the host-owned OAuth token.
        apiKey: "codex-host-auth",
        timeout: LLM_REQUEST_TIMEOUT_MS,
        useResponsesApi: true,
        configuration: {
          baseURL: "https://chatgpt.com/backend-api/codex",
          fetch: codexFetch,
        },
        // The subscription endpoint does not implement the public API's
        // max_tokens/max_output_tokens knobs. Upper layers still enforce their
        // structured-size limits; this transport deliberately omits the hint.
        reasoning: { effort },
        // Keep the request stateless on the service while retaining the complete
        // local message/tool history for replay and association.
        // @langchain/openai 1.5.5 does not recognize GPT-6 as a reasoning
        // model, so its Responses adapter drops the constructor field above.
        // modelKwargs keeps the same value on the actual request wire.
        modelKwargs: {
          store: false,
          ...(isGpt6 ? { reasoning: { effort } } : {}),
        },
        supportsStrictToolCalling: false,
      }),
    );
  };

  return {
    id: "codex",
    structuredOutput: createOpenAiCompatibleStructuredOutputAdapter({
      getModel: createChatModel,
      // The subscription Responses route uses function tools first.
      // Keep retries on the same schema-bearing transport; there is no
      // unconstrained prompt-JSON fallback for the subscription route.
      methods: ["functionCalling", "functionCalling", "functionCalling"],
      strictBinding: "openai",
      promptJsonFallback: false,
    }),
    getChatModel(request) {
      return createChatModel(request);
    },
    getEmbeddings() {
      // Embeddings are intentionally not billed to the Codex subscription.
      return createBuiltinEmbeddings(env);
    },
  };
}
