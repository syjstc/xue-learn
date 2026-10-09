import type { ProviderSpec } from "../../../core/types.js";
import type { LlmProvider, LlmProviderOptions, LlmProviderSelection } from "../../types.js";
import { createDoubaoLlmProvider } from "./provider.js";
import {
  defaultDoubaoLlmOptions,
  DEFAULT_DOUBAO_CHAT_MODEL,
  DOUBAO_LLM_MODELS,
} from "./options.js";

export const doubaoLlmSpec: ProviderSpec<
  "doubao",
  LlmProvider,
  LlmProviderOptions
> = {
  id: "doubao",
  label: "Doubao",
  description:
    "ByteDance Doubao via Volcengine Ark (OpenAI-compatible chat); embeddings via BigModel",
  models: [...DOUBAO_LLM_MODELS],
  defaultModel: () => DEFAULT_DOUBAO_CHAT_MODEL,
  hasCredentials: (env) => Boolean(env.DOUBAO_API_KEY?.trim()),
  defaultOptions: defaultDoubaoLlmOptions,
  create: ({ env }, selection: LlmProviderSelection) =>
    createDoubaoLlmProvider(env, {
      id: "doubao",
      model: selection.model,
      options: {
        ...defaultDoubaoLlmOptions(env),
        ...selection.options,
      },
    }),
};
