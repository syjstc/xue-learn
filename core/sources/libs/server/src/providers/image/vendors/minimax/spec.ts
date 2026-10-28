import type { ProviderSpec } from "../../../core/types.js";
import type {
  ImageProvider,
  ImageProviderOptions,
  ImageProviderSelection,
} from "../../types.js";
import { createMinimaxImageProvider } from "./provider.js";
import { MINIMAX_IMAGE_MODELS } from "./options.js";

export const minimaxImageSpec: ProviderSpec<
  "minimax",
  ImageProvider,
  ImageProviderOptions
> = {
  id: "minimax",
  label: "MiniMax",
  description: "image-01 文生图，适合教育示意图",
  models: [...MINIMAX_IMAGE_MODELS],
  defaultModel: () => "image-01",
  hasCredentials: (env) => Boolean(env.MINIMAX_API_KEY?.trim()),
  defaultOptions: () => ({}),
  create: ({ env }, selection: ImageProviderSelection) =>
    createMinimaxImageProvider(env, selection.model ?? "image-01"),
};
