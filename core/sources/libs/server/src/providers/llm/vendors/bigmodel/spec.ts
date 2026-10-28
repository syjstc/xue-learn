import type { ProviderSpec } from "../../../core/types.js";
import type { LlmProvider, LlmProviderOptions, LlmProviderSelection } from "../../types.js";
import { createBigModelLlmProvider } from "./provider.js";
import { defaultBigModelLlmOptions, BIGMODEL_LLM_MODELS } from "./options.js";

export const bigmodelLlmSpec: ProviderSpec<
  "bigmodel",
  LlmProvider,
  LlmProviderOptions
> = {
  id: "bigmodel",
  label: "BigModel",
  description:
    "Zhipu GLM via BigModel (OpenAI-compatible chat); embeddings via BigModel embedding-3",
  models: [...BIGMODEL_LLM_MODELS],
  defaultModel: () => BIGMODEL_LLM_MODELS[0],
  hasCredentials: (env) => Boolean(env.BIGMODEL_API_KEY?.trim()),
  defaultOptions: defaultBigModelLlmOptions,
  create: ({ env }, selection: LlmProviderSelection) =>
    createBigModelLlmProvider(env, {
      id: "bigmodel",
      model: selection.model,
      options: {
        ...defaultBigModelLlmOptions(env),
        ...selection.options,
      },
    }),
};
