import type { GlobalGenerationSettingsRepository } from "../../../domain/src/index.js";
import { requireGlobalGenerationSettingsPersistence } from "../generation/global-generation-settings-persistence.js";
import { getEnv } from "../env.js";
import {
  imageProviderIds,
  isActiveImageProvider,
  type ImageProviderId,
} from "./provider-ids.js";
import {
  defaultImageModel,
  IMAGE_PROVIDER_OPTIONS,
} from "./provider-options.js";
import { getImageProviderSpec } from "../providers/image/registry.js";

/** Each material generation authors exactly one frozen course section. */
const DEFAULT_MAX_ILLUSTRATIONS = 2;

export type ImageRuntimeConfig = {
  provider: ImageProviderId;
  model: string;
  enabled: boolean;
  maxIllustrations: number;
};

export type GlobalImageSettingsSnapshot = ImageRuntimeConfig & {
  updatedAt: Date;
  updatedByUserId: string | null;
  providers: Array<{
    id: ImageProviderId;
    label: string;
    description: string;
    configured: boolean;
  }>;
};

export function defaultImageRuntimeConfig(): ImageRuntimeConfig {
  return {
    provider: "none",
    model: defaultImageModel("none"),
    enabled: false,
    maxIllustrations: DEFAULT_MAX_ILLUSTRATIONS,
  };
}

export function parseImageProvider(
  value: string | null | undefined,
): ImageProviderId {
  return value && imageProviderIds.includes(value as ImageProviderId)
    ? (value as ImageProviderId)
    : "none";
}

function assertImageProvider(value: string): asserts value is ImageProviderId {
  if (!imageProviderIds.includes(value as ImageProviderId)) {
    throw new RangeError(
      `imageProvider must be one of: ${imageProviderIds.join(", ")}`,
    );
  }
}

function hasImageProviderCredentials(provider: ImageProviderId): boolean {
  if (!isActiveImageProvider(provider)) return true;
  return getImageProviderSpec(provider).hasCredentials(getEnv());
}

function providerCredentialHint(provider: ImageProviderId): string {
  switch (provider) {
    case "minimax":
      return "MINIMAX_API_KEY";
    case "apimart":
      return "APIMART_API_KEY";
    case "doubao":
      return "DOUBAO_API_KEY";
    case "krill":
      return "KRILL_API_KEY";
    case "codex":
      return "Codex OAuth sign-in";
    default:
      return "the provider API key";
  }
}

function toRuntimeConfig(provider: ImageProviderId): ImageRuntimeConfig {
  return {
    provider,
    model: defaultImageModel(provider),
    enabled: isActiveImageProvider(provider),
    maxIllustrations: DEFAULT_MAX_ILLUSTRATIONS,
  };
}

function providerCatalog() {
  return IMAGE_PROVIDER_OPTIONS.map((provider) => ({
    id: provider.id,
    label: provider.label,
    description: provider.description,
    configured: hasImageProviderCredentials(provider.id),
  }));
}

export async function getGlobalImageSettingsSnapshot(
  store: GlobalGenerationSettingsRepository = requireGlobalGenerationSettingsPersistence(),
): Promise<GlobalImageSettingsSnapshot> {
  const row = await store.get();
  const provider = parseImageProvider(row.imageProvider);
  return {
    ...toRuntimeConfig(provider),
    updatedAt: row.updatedAt,
    updatedByUserId: row.updatedByUserId,
    providers: providerCatalog(),
  };
}

export async function updateGlobalImageSettings(
  store: GlobalGenerationSettingsRepository,
  provider: ImageProviderId,
  updatedByUserId: string,
): Promise<GlobalImageSettingsSnapshot> {
  assertImageProvider(provider);
  if (
    isActiveImageProvider(provider) &&
    !hasImageProviderCredentials(provider)
  ) {
    throw new Error(
      `${providerCredentialHint(provider)} is not configured. Add it in .env before selecting ${provider} image generation.`,
    );
  }
  await store.update({ imageProvider: provider, updatedByUserId });
  return getGlobalImageSettingsSnapshot(store);
}
