import { getRuntimeEnvironment } from "../../env.js";
import { getEnv, type Env } from "../../env.js";
import { isImageGenerationFeatureEnabled } from "../../features.js";
import { getImageRuntimeConfig } from "../../images/runtime-config.js";
import { getCurrentUserId } from "../../user-context.js";
import { ProviderCache, providerCacheKey } from "../core/cache.js";
import { createFromSpec } from "../core/registry.js";
import { selectionCacheKey } from "../core/selection-key.js";
import type { ActiveImageProviderId } from "./ids.js";
import { getImageProviderSpec } from "./registry.js";
import { imageRuntimeConfigToSelection } from "./runtime.js";
import type { ImageProvider, ImageProviderSelection } from "./types.js";

const cachedProviders = new ProviderCache<ImageProvider | null>();

function scopeKey(): string {
  return getCurrentUserId() ?? "__default__";
}

export function hasImageProviderCredentials(
  providerId: ActiveImageProviderId,
  env: Env = getEnv(),
): boolean {
  return getImageProviderSpec(providerId).hasCredentials(env);
}

export function resolveImageProvider(
  selection?: ImageProviderSelection,
  env: Env = getEnv(),
): ImageProvider | null {
  const resolvedSelection =
    selection ?? imageRuntimeConfigToSelection(getImageRuntimeConfig());
  if (!resolvedSelection) return null;
  if (!hasImageProviderCredentials(resolvedSelection.id, env)) {
    return null;
  }
  const spec = getImageProviderSpec(resolvedSelection.id);
  return createFromSpec(spec, { env }, resolvedSelection);
}

export function getImageProvider(
  selection?: ImageProviderSelection,
): ImageProvider | null {
  const resolvedSelection =
    selection ?? imageRuntimeConfigToSelection(getImageRuntimeConfig());
  const key = providerCacheKey({
    scopeKey: scopeKey(),
    selectionKey: resolvedSelection
      ? selectionCacheKey(resolvedSelection)
      : "__disabled__",
  });
  if (cachedProviders.has(key)) {
    return cachedProviders.get(key) ?? null;
  }
  const provider = resolveImageProvider(resolvedSelection ?? undefined);
  cachedProviders.set(key, provider);
  return provider;
}

export function resetImageProviderCache(userId?: string): void {
  if (userId) {
    cachedProviders.deleteByScopePrefix(userId);
    return;
  }
  cachedProviders.clear();
}

export function isImageGenerationAvailable(env: Env = getEnv()): boolean {
  if (
    !isImageGenerationFeatureEnabled(getRuntimeEnvironment().XUELEARN_DESKTOP_LOCAL === "1")
  ) {
    return false;
  }
  const runtime = getImageRuntimeConfig();
  if (!runtime.enabled || runtime.provider === "none") return false;
  const selection = imageRuntimeConfigToSelection(runtime);
  if (!selection) return false;
  return hasImageProviderCredentials(selection.id, env);
}

export function resolveImageProviderId(env: Env = getEnv()) {
  return getImageRuntimeConfig().provider;
}

export function resolveImageModel(): string {
  return getImageRuntimeConfig().model;
}
