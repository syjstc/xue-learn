import type { ProviderSpec } from "../../../core/types.js";
import type {
  ImageProvider,
  ImageProviderOptions,
  ImageProviderSelection,
} from "../../types.js";
import { createDoubaoImageProvider } from "./provider.js";
import {
  DEFAULT_DOUBAO_IMAGE_MODEL,
  DOUBAO_IMAGE_MODELS,
} from "./options.js";

export const doubaoImageSpec: ProviderSpec<
  "doubao",
  ImageProvider,
  ImageProviderOptions
> = {
  id: "doubao",
  label: "豆包 Seedream",
  description: "Seedream 5.0 lite（doubao-seedream-5-0-260128）文生图，火山方舟 2K JPEG 流式",
  models: [...DOUBAO_IMAGE_MODELS],
  defaultModel: () => DEFAULT_DOUBAO_IMAGE_MODEL,
  hasCredentials: (env) => Boolean(env.DOUBAO_API_KEY?.trim()),
  defaultOptions: () => ({}),
  create: ({ env }, selection: ImageProviderSelection) =>
    createDoubaoImageProvider(
      env,
      selection.model ?? DEFAULT_DOUBAO_IMAGE_MODEL,
    ),
};
