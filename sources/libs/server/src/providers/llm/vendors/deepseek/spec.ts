import type { ProviderSpec } from "../../../core/types.js";
import type { LlmProvider, LlmProviderOptions, LlmProviderSelection } from "../../types.js";
import { createDeepseekLlmProvider } from "./provider.js";
import { defaultDeepseekLlmOptions, DEEPSEEK_LLM_MODELS } from "./options.js";

export const deepseekLlmSpec: ProviderSpec<
  "deepseek",
  LlmProvider,
  LlmProviderOptions
> = {
  id: "deepseek",
  label: "DeepSeek",
  description: "DeepSeek Flash (OpenAI-compatible chat); embeddings via BigModel",
  models: [...DEEPSEEK_LLM_MODELS],
  defaultModel: () => DEEPSEEK_LLM_MODELS[0],
  hasCredentials: (env) => Boolean(env.DEEPSEEK_API_KEY?.trim()),
  defaultOptions: defaultDeepseekLlmOptions,
  create: ({ env }, selection: LlmProviderSelection) =>
    createDeepseekLlmProvider(env, {
      id: "deepseek",
      model: selection.model,
      options: {
        ...defaultDeepseekLlmOptions(env),
        ...selection.options,
      },
    }),
};
