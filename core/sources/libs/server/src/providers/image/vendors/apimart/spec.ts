import type { ProviderSpec } from "../../../core/types.js";
import type {
  ImageProvider,
  ImageProviderOptions,
  ImageProviderSelection,
} from "../../types.js";
import { createApimartImageProvider } from "./provider.js";
import { APIMART_IMAGE_MODELS } from "./options.js";

export const apimartImageSpec: ProviderSpec<
  "apimart",
  ImageProvider,
  ImageProviderOptions
> = {
  id: "apimart",
  label: "APIMart",
  description: "GPT-Image-2 文生图（异步任务）",
  models: [...APIMART_IMAGE_MODELS],
  defaultModel: () => "gpt-image-2",
  hasCredentials: (env) => Boolean(env.APIMART_API_KEY?.trim()),
  defaultOptions: () => ({}),
  create: ({ env }, selection: ImageProviderSelection) =>
    createApimartImageProvider(env, selection.model ?? "gpt-image-2"),
};
