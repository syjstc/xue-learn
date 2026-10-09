import type { ProviderSpec } from "../../../core/types.js";
import type {
  ImageProvider,
  ImageProviderOptions,
  ImageProviderSelection,
} from "../../types.js";
import { hasCodexAccessTokenProvider } from "../../../llm/vendors/codex/runtime.js";
import { createCodexImageProvider } from "./provider.js";
import { CODEX_IMAGE_MODELS, DEFAULT_CODEX_IMAGE_MODEL } from "./options.js";

export const codexImageSpec: ProviderSpec<
  "codex",
  ImageProvider,
  ImageProviderOptions
> = {
  id: "codex",
  label: "Codex（ChatGPT 订阅）",
  description:
    "GPT-Image-2.5 Flare or GPT-Image-2 through the Codex Responses image-generation tool",
  models: [...CODEX_IMAGE_MODELS],
  defaultModel: () => DEFAULT_CODEX_IMAGE_MODEL,
  // The subscription bridge is desktop-local only; hosted services must not
  // advertise or attempt to use the ChatGPT OAuth route.
  hasCredentials: () =>
    process.env.XUELEARN_DESKTOP_LOCAL === "1" && hasCodexAccessTokenProvider(),
  defaultOptions: () => ({}),
  create: ({ env }, selection: ImageProviderSelection) =>
    createCodexImageProvider(env, selection.model ?? DEFAULT_CODEX_IMAGE_MODEL),
};
