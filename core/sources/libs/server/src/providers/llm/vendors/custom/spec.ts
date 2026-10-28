import type { ProviderSpec } from "../../../core/types.js";
import type {
  LlmProvider,
  LlmProviderOptions,
  LlmProviderSelection,
} from "../../types.js";
import { createCustomLlmProvider } from "./provider.js";
import { defaultCustomLlmOptions, DEFAULT_CUSTOM_CHAT_MODEL } from "./options.js";

export const customLlmSpec: ProviderSpec<
  "custom",
  LlmProvider,
  LlmProviderOptions
> = {
  id: "custom",
  label: "OpenAI-compatible",
  description: "Custom OpenAI-compatible endpoint",
  models: [],
  defaultModel: () => DEFAULT_CUSTOM_CHAT_MODEL,
  hasCredentials: (env) =>
    Boolean(
      env.CUSTOM_OPENAI_API_KEY?.trim() && env.CUSTOM_OPENAI_BASE_URL?.trim(),
    ),
  defaultOptions: defaultCustomLlmOptions,
  create: ({ env }, selection: LlmProviderSelection) =>
    createCustomLlmProvider(env, selection),
};
