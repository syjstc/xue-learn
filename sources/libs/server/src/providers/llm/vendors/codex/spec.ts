import type { ProviderSpec } from "../../../core/types.js";
import type {
  LlmProvider,
  LlmProviderOptions,
  LlmProviderSelection,
} from "../../types.js";
import { createCodexLlmProvider } from "./provider.js";
import { defaultCodexLlmOptions } from "./options.js";

export const codexLlmSpec: ProviderSpec<
  "codex",
  LlmProvider,
  LlmProviderOptions
> = {
  id: "codex",
  label: "Codex（ChatGPT 订阅）",
  description: "ChatGPT subscription models through the Codex Responses endpoint",
  models: [],
  defaultModel: () => "",
  // The actual credential is provided by the Electron host at request time;
  // never advertise this subscription route from hosted services.
  hasCredentials: () => process.env.XUELEARN_DESKTOP_LOCAL === "1",
  defaultOptions: defaultCodexLlmOptions,
  create: ({ env }, selection: LlmProviderSelection) =>
    createCodexLlmProvider(env, selection),
};
