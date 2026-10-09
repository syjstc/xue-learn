import { getEnv, type Env } from "../../env.js";
import { getCurrentUserId } from "../../user-context.js";
import { ProviderCache, providerCacheKey } from "../core/cache.js";
import { createFromSpec } from "../core/registry.js";
import { selectionCacheKey } from "../core/selection-key.js";
import type { AudioProviderId } from "./ids.js";
import { getAudioProviderSpec } from "./registry.js";
import {
  audioRuntimeConfigToSelection,
  getAudioRuntimeConfig,
} from "./runtime.js";
import type { AudioProviderSelection, TtsProvider } from "./types.js";

const cachedProviders = new ProviderCache<TtsProvider>();

function scopeKey(): string {
  return getCurrentUserId() ?? "__default__";
}

export function hasAudioProviderCredentials(
  providerId: AudioProviderId,
  env: Env = getEnv(),
): boolean {
  return getAudioProviderSpec(providerId).hasCredentials(env);
}

export function resolveAudioProvider(
  selection?: AudioProviderSelection,
  env: Env = getEnv(),
): TtsProvider {
  const resolvedSelection =
    selection ?? audioRuntimeConfigToSelection(getAudioRuntimeConfig(env));
  const spec = getAudioProviderSpec(resolvedSelection.id);
  if (!spec.hasCredentials(env)) {
    throw new Error(`${resolvedSelection.id} audio is not configured`);
  }
  return createFromSpec(spec, { env }, resolvedSelection);
}

export function getAudioProvider(
  selection?: AudioProviderSelection,
): TtsProvider {
  const resolvedSelection =
    selection ?? audioRuntimeConfigToSelection(getAudioRuntimeConfig());
  const key = providerCacheKey({
    scopeKey: scopeKey(),
    selectionKey: selectionCacheKey(resolvedSelection),
  });
  const cached = cachedProviders.get(key);
  if (cached) return cached;
  const provider = resolveAudioProvider(resolvedSelection);
  cachedProviders.set(key, provider);
  return provider;
}

export function resetAudioProviderCache(userId?: string): void {
  if (userId) {
    cachedProviders.deleteByScopePrefix(userId);
    return;
  }
  cachedProviders.clear();
}
