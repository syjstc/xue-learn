import type { ActiveImageProviderId } from "./ids.js";
import type { ProviderSpec } from "../core/types.js";
import type { ImageProvider, ImageProviderOptions } from "./types.js";
import { apimartImageSpec } from "./vendors/apimart/spec.js";
import { codexImageSpec } from "./vendors/codex/spec.js";
import { doubaoImageSpec } from "./vendors/doubao/spec.js";
import { krillImageSpec } from "./vendors/krill/spec.js";
import { minimaxImageSpec } from "./vendors/minimax/spec.js";

export type ImageProviderSpec = ProviderSpec<
  ActiveImageProviderId,
  ImageProvider,
  ImageProviderOptions
>;

export const IMAGE_PROVIDER_SPECS: readonly ImageProviderSpec[] = [
  minimaxImageSpec as ImageProviderSpec,
  apimartImageSpec as ImageProviderSpec,
  doubaoImageSpec as ImageProviderSpec,
  krillImageSpec as ImageProviderSpec,
  codexImageSpec as ImageProviderSpec,
];

export type ImageProviderOption = {
  id: ActiveImageProviderId | "none";
  label: string;
  description: string;
  models: string[];
};

export const IMAGE_PROVIDER_OPTIONS: ImageProviderOption[] = [
  {
    id: "none",
    label: "关闭",
    description: "不生成配图，学习页仅使用文字与互动块",
    models: [],
  },
  ...IMAGE_PROVIDER_SPECS.map((spec) => ({
    id: spec.id,
    label: spec.label,
    description: spec.description ?? "",
    models: spec.models,
  })),
];

export function getImageProviderOption(id: ActiveImageProviderId | "none") {
  return IMAGE_PROVIDER_OPTIONS.find((p) => p.id === id);
}

export function defaultImageModel(
  provider: ActiveImageProviderId | "none",
): string {
  return getImageProviderOption(provider)?.models[0] ?? "image-01";
}

export function imageModelsForProvider(id: ActiveImageProviderId): string[] {
  return getImageProviderOption(id)?.models ?? [];
}
