import type { ProviderSelection } from "./types.js";

/** Stable cache key for a provider selection (model + options). */
export function selectionCacheKey<
  TId extends string,
  TOptions,
>(selection: ProviderSelection<TId, TOptions>): string {
  return JSON.stringify({
    id: selection.id,
    model: selection.model ?? null,
    options: selection.options ?? null,
  });
}
