import type { ProviderSpec } from "../../../core/types.js";
import type { LlmProvider, LlmProviderOptions, LlmProviderSelection } from "../../types.js";
import { createOpenAiLlmProvider } from "./provider.js";
import {
  defaultOpenAiLlmOptions,
  OPENAI_EMBEDDING_MODELS,
  OPENAI_LLM_MODELS,
} from "./options.js";

export const openAiLlmSpec: ProviderSpec<
  "openai",
  LlmProvider,
  LlmProviderOptions
> = {
  id: "openai",
  label: "OpenAI",
  description: "GPT-5.6 Luna chat + text-embedding models",
  models: [...OPENAI_LLM_MODELS],
  defaultModel: () => OPENAI_LLM_MODELS[0],
  hasCredentials: (env) => Boolean(env.OPENAI_API_KEY?.trim()),
  defaultOptions: defaultOpenAiLlmOptions,
  create: ({ env }, selection: LlmProviderSelection) =>
    createOpenAiLlmProvider(env, {
      id: "openai",
      model: selection.model,
      options: {
        ...defaultOpenAiLlmOptions(env),
        ...selection.options,
      },
    }),
};
