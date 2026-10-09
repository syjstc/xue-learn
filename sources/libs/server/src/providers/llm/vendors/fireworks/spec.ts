import type { ProviderSpec } from "../../../core/types.js";
import type { LlmProvider, LlmProviderOptions, LlmProviderSelection } from "../../types.js";
import { createFireworksLlmProvider } from "./provider.js";
import { defaultFireworksLlmOptions, FIREWORKS_LLM_MODELS } from "./options.js";

export const fireworksLlmSpec: ProviderSpec<
  "fireworks",
  LlmProvider,
  LlmProviderOptions
> = {
  id: "fireworks",
  label: "Fireworks",
  description: "OpenAI-compatible chat; embeddings via BigModel",
  models: [...FIREWORKS_LLM_MODELS],
  defaultModel: () => FIREWORKS_LLM_MODELS[0],
  hasCredentials: (env) => Boolean(env.FIREWORKS_API_KEY?.trim()),
  defaultOptions: defaultFireworksLlmOptions,
  create: ({ env }, selection: LlmProviderSelection) =>
    createFireworksLlmProvider(env, {
      id: "fireworks",
      model: selection.model,
      options: {
        ...defaultFireworksLlmOptions(env),
        ...selection.options,
      },
    }),
};
