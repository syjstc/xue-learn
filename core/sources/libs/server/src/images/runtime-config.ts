import {
  defaultImageRuntimeConfig,
  getGlobalImageSettingsSnapshot,
  updateGlobalImageSettings,
  type ImageRuntimeConfig,
} from "./global-image-settings.js";
import type { ImageProviderId } from "./provider-ids.js";
import { resetImageProviderCache } from "../providers/image/resolve.js";
import { requireGlobalGenerationSettingsPersistence } from "../generation/global-generation-settings-persistence.js";

export type { ImageRuntimeConfig };

/** Keep independently running API/worker processes in sync with admin changes. */
export const IMAGE_RUNTIME_CONFIG_CACHE_TTL_MS = 5_000;

let cached: ImageRuntimeConfig | null = null;
let loadPromise: Promise<ImageRuntimeConfig> | null = null;
let cachedAt = 0;

export function getImageRuntimeConfig(): ImageRuntimeConfig {
  return cached ?? defaultImageRuntimeConfig();
}

export async function refreshImageRuntimeConfig(
  _userId?: string,
): Promise<ImageRuntimeConfig> {
  const snapshot = await getGlobalImageSettingsSnapshot();
  const config: ImageRuntimeConfig = {
    provider: snapshot.provider,
    model: snapshot.model,
    enabled: snapshot.enabled,
    maxIllustrations: snapshot.maxIllustrations,
  };
  cached = config;
  cachedAt = Date.now();
  resetImageProviderCache();
  return config;
}

export async function ensureImageRuntimeConfig(
  _userId?: string,
): Promise<ImageRuntimeConfig> {
  if (cached && Date.now() - cachedAt < IMAGE_RUNTIME_CONFIG_CACHE_TTL_MS) {
    return cached;
  }
  if (!loadPromise) {
    loadPromise = refreshImageRuntimeConfig()
      .catch((error) => {
        // Image generation is optional. Keep serving the last-good setting when
        // a transient database read fails, and retry on the next request.
        if (cached) return cached;
        throw error;
      })
      .finally(() => {
        loadPromise = null;
      });
  }
  return loadPromise;
}

/** Persist global image provider (admin-owned). */
export async function saveImageRuntimeConfig(
  patch: { provider?: ImageProviderId },
  updatedByUserId: string,
): Promise<ImageRuntimeConfig> {
  const current = await ensureImageRuntimeConfig();
  const snapshot = await updateGlobalImageSettings(
    requireGlobalGenerationSettingsPersistence(),
    patch.provider ?? current.provider,
    updatedByUserId,
  );
  const config: ImageRuntimeConfig = {
    provider: snapshot.provider,
    model: snapshot.model,
    enabled: snapshot.enabled,
    maxIllustrations: snapshot.maxIllustrations,
  };
  cached = config;
  cachedAt = Date.now();
  resetImageProviderCache();
  return config;
}

export function invalidateImageRuntimeConfig(_userId?: string): void {
  cached = null;
  cachedAt = 0;
  loadPromise = null;
  resetImageProviderCache();
}
