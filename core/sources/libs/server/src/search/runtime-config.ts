import { requireGlobalGenerationSettingsPersistence } from "../generation/global-generation-settings-persistence.js";
import { hasSearchProviderCredentials } from "../env.js";
import {
  defaultSearchRuntimeConfig,
  getGlobalSearchSettingsSnapshot,
  updateGlobalSearchSettings,
  type SearchRuntimeConfig,
} from "./global-search-settings.js";

export type { SearchRuntimeConfig };

let cached: SearchRuntimeConfig | null = null;
let loadPromise: Promise<SearchRuntimeConfig> | null = null;

export function getSearchRuntimeConfig(): SearchRuntimeConfig {
  return cached ?? defaultSearchRuntimeConfig();
}

export async function refreshSearchRuntimeConfig(
  _userId?: string,
): Promise<SearchRuntimeConfig> {
  const snapshot = await getGlobalSearchSettingsSnapshot();
  const config: SearchRuntimeConfig = {
    enabled: snapshot.enabled,
    provider: snapshot.provider,
  };
  cached = config;
  return config;
}

export async function ensureSearchRuntimeConfig(
  _userId?: string,
): Promise<SearchRuntimeConfig> {
  if (cached) return cached;
  if (!loadPromise) {
    loadPromise = refreshSearchRuntimeConfig().finally(() => {
      loadPromise = null;
    });
  }
  return loadPromise;
}

/** Persist global search settings (admin-owned). */
export async function saveSearchRuntimeConfig(
  patch: Partial<SearchRuntimeConfig>,
  updatedByUserId: string,
): Promise<SearchRuntimeConfig> {
  const snapshot = await updateGlobalSearchSettings(
    requireGlobalGenerationSettingsPersistence(),
    patch,
    updatedByUserId,
  );
  const config: SearchRuntimeConfig = {
    enabled: snapshot.enabled,
    provider: snapshot.provider,
  };
  cached = config;
  return config;
}

export function invalidateSearchRuntimeConfig(_userId?: string): void {
  cached = null;
  loadPromise = null;
}

/** True when global search is enabled and the selected provider is configured. */
export async function isWebSearchAvailable(
  _userId?: string,
): Promise<boolean> {
  const config = await ensureSearchRuntimeConfig();
  return config.enabled && hasSearchProviderCredentials(config.provider);
}
