import type { ProviderSpec } from "../../../core/types.js";
import type {
  ImageProvider,
  ImageProviderOptions,
  ImageProviderSelection,
} from "../../types.js";
import { createKrillImageProvider } from "./provider.js";
import {
  DEFAULT_KRILL_IMAGE_MODEL,
  KRILL_IMAGE_MODELS,
} from "./options.js";

export const krillImageSpec: ProviderSpec<
  "krill",
  ImageProvider,
  ImageProviderOptions
> = {
  id: "krill",
  label: "Krill",
  description: "GPT-Image-2 2K 文生图（视觉创作 Images API）",
  models: [...KRILL_IMAGE_MODELS],
  defaultModel: () => DEFAULT_KRILL_IMAGE_MODEL,
  hasCredentials: (env) => Boolean(env.KRILL_API_KEY?.trim()),
  defaultOptions: () => ({}),
  create: ({ env }, selection: ImageProviderSelection) =>
    createKrillImageProvider(
      env,
      selection.model ?? DEFAULT_KRILL_IMAGE_MODEL,
    ),
};
