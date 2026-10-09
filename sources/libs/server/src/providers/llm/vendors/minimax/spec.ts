import type { ProviderSpec } from "../../../core/types.js";
import type { LlmProvider, LlmProviderOptions, LlmProviderSelection } from "../../types.js";
import { createMinimaxLlmProvider } from "./provider.js";
import {
  DEFAULT_MINIMAX_CHAT_MODEL,
  defaultMinimaxLlmOptions,
  MINIMAX_EMBEDDING_MODELS,
  MINIMAX_LLM_MODELS,
} from "./options.js";

export const minimaxLlmSpec: ProviderSpec<
  "minimax",
  LlmProvider,
  LlmProviderOptions
> = {
  id: "minimax",
  label: "MiniMax",
  description: "OpenAI-compatible chat + native embo-01 embeddings",
  models: [...MINIMAX_LLM_MODELS],
  defaultModel: () => DEFAULT_MINIMAX_CHAT_MODEL,
  hasCredentials: (env) =>
    Boolean(env.MINIMAX_API_KEY?.trim() && env.MINIMAX_GROUP_ID?.trim()),
  defaultOptions: defaultMinimaxLlmOptions,
  create: ({ env }, selection: LlmProviderSelection) =>
    createMinimaxLlmProvider(env, {
      id: "minimax",
      model: selection.model,
      options: {
        ...defaultMinimaxLlmOptions(env),
        ...selection.options,
      },
    }),
};
