import type { GlobalGenerationSettingsRepository } from "../../../domain/src/index.js";
import { requireGlobalGenerationSettingsPersistence } from "../generation/global-generation-settings-persistence.js";
import {
  hasDoubaoSearchConfigured,
  hasSearchProviderCredentials,
} from "../env.js";
import {
  searchProviderIds,
  type SearchProviderId,
} from "./provider-ids.js";
import { SEARCH_PROVIDER_OPTIONS } from "./provider-options.js";


export type SearchRuntimeConfig = {
  enabled: boolean;
  provider: SearchProviderId;
};

export type GlobalSearchSettingsSnapshot = SearchRuntimeConfig & {
  updatedAt: Date;
  updatedByUserId: string | null;
  providers: Array<{
    id: SearchProviderId;
    label: string;
    description: string;
    configured: boolean;
  }>;
};

export function defaultSearchProvider(): SearchProviderId {
  if (hasDoubaoSearchConfigured()) return "doubao";
  return "tavily";
}

export function defaultSearchRuntimeConfig(): SearchRuntimeConfig {
  const provider = defaultSearchProvider();
  return {
    enabled: hasSearchProviderCredentials(provider),
    provider,
  };
}

export function parseSearchProvider(
  value: string | null | undefined,
): SearchProviderId {
  if (value && searchProviderIds.includes(value as SearchProviderId)) {
    return value as SearchProviderId;
  }
  return defaultSearchProvider();
}

function assertSearchProvider(value: string): asserts value is SearchProviderId {
  if (!searchProviderIds.includes(value as SearchProviderId)) {
    throw new RangeError(
      `searchProvider must be one of: ${searchProviderIds.join(", ")}`,
    );
  }
}

function toRuntimeConfig(row: {
  searchEnabled: boolean;
  searchProvider: string;
}): SearchRuntimeConfig {
  return {
    enabled: row.searchEnabled,
    provider: parseSearchProvider(row.searchProvider),
  };
}

function providerCatalog() {
  return SEARCH_PROVIDER_OPTIONS.map((provider) => ({
    ...provider,
    configured: hasSearchProviderCredentials(provider.id),
  }));
}

export async function getGlobalSearchSettingsSnapshot(
  store: GlobalGenerationSettingsRepository = requireGlobalGenerationSettingsPersistence(),
): Promise<GlobalSearchSettingsSnapshot> {
  const settings = await store.get();
  return {
    ...toRuntimeConfig(settings),
    updatedAt: settings.updatedAt,
    updatedByUserId: settings.updatedByUserId,
    providers: providerCatalog(),
  };
}

export async function updateGlobalSearchSettings(
  store: GlobalGenerationSettingsRepository,
  patch: Partial<SearchRuntimeConfig>,
  updatedByUserId: string,
): Promise<GlobalSearchSettingsSnapshot> {
  const current = await getGlobalSearchSettingsSnapshot(store);
  const next: SearchRuntimeConfig = {
    enabled: patch.enabled ?? current.enabled,
    provider: patch.provider ?? current.provider,
  };
  assertSearchProvider(next.provider);

  if (next.enabled && !hasSearchProviderCredentials(next.provider)) {
    const envHint =
      next.provider === "doubao"
        ? "DOUBAO_SEARCH_API_KEY"
        : next.provider === "anysearch"
          ? "ANYSEARCH_API_KEY"
          : "TAVILY_API_KEY";
    throw new Error(
      `${envHint} is not configured. Add it in .env before enabling web search.`,
    );
  }

  await store.update({
    searchEnabled: next.enabled,
    searchProvider: next.provider,
    updatedByUserId,
  });

  return getGlobalSearchSettingsSnapshot(store);
}
