import { getEnv, isActiveLlmProvider, type Env } from "../../env.js";
import { getLlmRuntimeConfig } from "../../llm/runtime-config.js";
import { getCurrentUserId } from "../../user-context.js";
import { ProviderCache, providerCacheKey } from "../core/cache.js";
import { createFromSpec } from "../core/registry.js";
import { selectionCacheKey } from "../core/selection-key.js";
import { getLlmProviderSpec } from "./registry.js";
import { llmRuntimeConfigToSelection } from "./runtime.js";
import type { LlmProvider, LlmProviderSelection } from "./types.js";
import { applyOperationReasoningOverride } from "./reasoning-policy.js";
import { getActiveLlmOperationRoute } from "./operation-routing-context.js";
import { getExplicitLlmSelection } from "./explicit-selection-context.js";
import { getOpenAiBaseUrl } from "./vendors/openai/runtime-config.js";
import { resolveHostLlmProvider } from "./host-provider.js";

const cachedProviders = new ProviderCache<LlmProvider>();

function scopeKey(): string {
  if (getExplicitLlmSelection()) return "__platform_explicit__";
  return getCurrentUserId() ?? "__default__";
}

function providerSelectionCacheKey(selection: LlmProviderSelection): string {
  const base = selectionCacheKey(selection);
  if (selection.id !== "openai") return base;
  return `${base}\0openaiBaseUrl=${getOpenAiBaseUrl()}`;
}

/**
 * Build an LLM provider from an explicit selection (router agent / per-gen override)
 * or from the effective runtime config when `selection` is omitted.
 */
export function resolveLlmProvider(
  selection?: LlmProviderSelection,
  env: Env = getEnv(),
): LlmProvider {
  const resolvedSelection = applyOperationReasoningOverride(
    selection ??
      getExplicitLlmSelection() ??
      getActiveLlmOperationRoute()?.selection ??
      llmRuntimeConfigToSelection(getLlmRuntimeConfig()),
  );
  const hostProvider = resolveHostLlmProvider(resolvedSelection, env);
  if (hostProvider) return hostProvider;
  if (!isActiveLlmProvider(resolvedSelection.id)) {
    throw new Error(`LLM provider "${resolvedSelection.id}" is disabled`);
  }
  const spec = getLlmProviderSpec(resolvedSelection.id);
  return createFromSpec(spec, { env }, resolvedSelection);
}

export function getLlmProvider(selection?: LlmProviderSelection): LlmProvider {
  const resolvedSelection = applyOperationReasoningOverride(
    selection ??
      getExplicitLlmSelection() ??
      getActiveLlmOperationRoute()?.selection ??
      llmRuntimeConfigToSelection(getLlmRuntimeConfig()),
  );
  const hostProvider = resolveHostLlmProvider(resolvedSelection, getEnv());
  if (hostProvider) return hostProvider;
  if (!isActiveLlmProvider(resolvedSelection.id)) {
    throw new Error(`LLM provider "${resolvedSelection.id}" is disabled`);
  }
  const key = providerCacheKey({
    scopeKey: scopeKey(),
    selectionKey: providerSelectionCacheKey(resolvedSelection),
  });
  const cached = cachedProviders.get(key);
  if (cached) return cached;
  const provider = resolveLlmProvider(resolvedSelection);
  cachedProviders.set(key, provider);
  return provider;
}

export function resetLlmProviderCache(userId?: string): void {
  if (userId) {
    cachedProviders.deleteByScopePrefix(userId);
    return;
  }
  cachedProviders.clear();
}

export function hasLlmProviderCredentials(
  selection: LlmProviderSelection,
  env: Env = getEnv(),
): boolean {
  if (resolveHostLlmProvider(selection, env)) return true;
  return getLlmProviderSpec(selection.id).hasCredentials(env);
}
