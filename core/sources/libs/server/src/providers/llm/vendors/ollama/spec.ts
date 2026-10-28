import type { ProviderSpec } from "../../../core/types.js";
import type { LlmProvider, LlmProviderOptions, LlmProviderSelection } from "../../types.js";
import { createOllamaLlmProvider } from "./provider.js";
import { defaultOllamaLlmOptions, OLLAMA_LLM_MODELS } from "./options.js";

export const ollamaLlmSpec: ProviderSpec<
  "ollama",
  LlmProvider,
  LlmProviderOptions
> = {
  id: "ollama",
  label: "Ollama",
  description:
    "Local chat via Ollama (OpenAI-compatible API); tool calls need a tool-capable model (e.g. llama3.2, qwen2.5)",
  models: [...OLLAMA_LLM_MODELS],
  defaultModel: () => OLLAMA_LLM_MODELS[0],
  hasCredentials: (env) => Boolean(env.OLLAMA_BASE_URL?.trim()),
  defaultOptions: defaultOllamaLlmOptions,
  create: ({ env }, selection: LlmProviderSelection) =>
    createOllamaLlmProvider(env, {
      id: "ollama",
      model: selection.model,
      options: {
        ...defaultOllamaLlmOptions(env),
        ...selection.options,
      },
    }),
};
