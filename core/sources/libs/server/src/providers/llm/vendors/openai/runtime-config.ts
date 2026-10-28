import { requireGlobalGenerationSettingsPersistence } from "../../../../generation/global-generation-settings-persistence.js";
import {
  defaultOpenAiRuntimeConfig,
  getGlobalOpenAiSettingsSnapshot,
  updateGlobalOpenAiSettings,
  type OpenAiRuntimeConfig,
} from "./global-openai-settings.js";
import type { OpenAiBaseUrlId } from "./base-url.js";

export type { OpenAiRuntimeConfig };

/** Keep independently running API/worker processes in sync with admin changes. */
export const OPENAI_RUNTIME_CONFIG_CACHE_TTL_MS = 5_000;

let cached: OpenAiRuntimeConfig | null = null;
let loadPromise: Promise<OpenAiRuntimeConfig> | null = null;
let cachedAt = 0;

export function getOpenAiRuntimeConfig(): OpenAiRuntimeConfig {
  return cached ?? defaultOpenAiRuntimeConfig();
}

export function getOpenAiBaseUrl(): string {
  return getOpenAiRuntimeConfig().baseUrl;
}

export async function refreshOpenAiRuntimeConfig(): Promise<OpenAiRuntimeConfig> {
  const snapshot = await getGlobalOpenAiSettingsSnapshot();
  const config: OpenAiRuntimeConfig = {
    baseUrlId: snapshot.baseUrlId,
    baseUrl: snapshot.baseUrl,
  };
  cached = config;
  cachedAt = Date.now();
  return config;
}

export async function ensureOpenAiRuntimeConfig(): Promise<OpenAiRuntimeConfig> {
  if (cached && Date.now() - cachedAt < OPENAI_RUNTIME_CONFIG_CACHE_TTL_MS) {
    return cached;
  }
  if (!loadPromise) {
    loadPromise = refreshOpenAiRuntimeConfig()
      .catch((error) => {
        if (cached) return cached;
        throw error;
      })
      .finally(() => {
        loadPromise = null;
      });
  }
  return loadPromise;
}

export async function saveOpenAiRuntimeConfig(
  baseUrlId: OpenAiBaseUrlId,
  updatedByUserId: string,
): Promise<OpenAiRuntimeConfig> {
  const snapshot = await updateGlobalOpenAiSettings(
    requireGlobalGenerationSettingsPersistence(),
    baseUrlId,
    updatedByUserId,
  );
  const config: OpenAiRuntimeConfig = {
    baseUrlId: snapshot.baseUrlId,
    baseUrl: snapshot.baseUrl,
  };
  cached = config;
  cachedAt = Date.now();
  return config;
}

export function invalidateOpenAiRuntimeConfig(): void {
  cached = null;
  cachedAt = 0;
  loadPromise = null;
}
