import type { ProviderFactoryContext, ProviderSelection, ProviderSpec } from "./types.js";

export function buildProviderRegistry<
  TId extends string,
  TInstance,
  TOptions = Record<string, never>,
>(
  specs: readonly ProviderSpec<TId, TInstance, TOptions>[],
): Record<TId, ProviderSpec<TId, TInstance, TOptions>> {
  const registry = {} as Record<TId, ProviderSpec<TId, TInstance, TOptions>>;
  for (const spec of specs) {
    registry[spec.id] = spec;
  }
  return registry;
}

export function getProviderSpec<
  TId extends string,
  TInstance,
  TOptions,
>(
  registry: Record<TId, ProviderSpec<TId, TInstance, TOptions>>,
  id: TId,
): ProviderSpec<TId, TInstance, TOptions> {
  const spec = registry[id];
  if (!spec) {
    throw new Error(`Unknown provider: ${id}`);
  }
  return spec;
}

export function createFromSpec<
  TId extends string,
  TInstance,
  TOptions,
>(
  spec: ProviderSpec<TId, TInstance, TOptions>,
  ctx: ProviderFactoryContext,
  selection: ProviderSelection<TId, TOptions>,
): TInstance {
  return spec.create(ctx, selection);
}
