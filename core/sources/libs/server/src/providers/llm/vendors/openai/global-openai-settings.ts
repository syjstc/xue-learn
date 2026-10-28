import type { GlobalGenerationSettingsRepository } from "../../../../../../domain/src/index.js";
import { requireGlobalGenerationSettingsPersistence } from "../../../../generation/global-generation-settings-persistence.js";
import {
  defaultOpenAiBaseUrlId,
  OPENAI_BASE_URL_OPTIONS,
  openaiBaseUrlIds,
  parseOpenAiBaseUrlId,
  resolveOpenAiBaseUrl,
  type OpenAiBaseUrlId,
} from "./base-url.js";


export type OpenAiRuntimeConfig = {
  baseUrlId: OpenAiBaseUrlId;
  baseUrl: string;
};

export type GlobalOpenAiSettingsSnapshot = OpenAiRuntimeConfig & {
  updatedAt: Date;
  updatedByUserId: string | null;
  baseUrls: Array<{
    id: OpenAiBaseUrlId;
    label: string;
    description: string;
    baseUrl: string;
  }>;
};

export function defaultOpenAiRuntimeConfig(): OpenAiRuntimeConfig {
  const baseUrlId = defaultOpenAiBaseUrlId();
  return {
    baseUrlId,
    baseUrl: resolveOpenAiBaseUrl(baseUrlId),
  };
}

function assertOpenAiBaseUrlId(
  value: string,
): asserts value is OpenAiBaseUrlId {
  if (!openaiBaseUrlIds.includes(value as OpenAiBaseUrlId)) {
    throw new RangeError(
      `openaiBaseUrl must be one of: ${openaiBaseUrlIds.join(", ")}`,
    );
  }
}

function toRuntimeConfig(baseUrlId: OpenAiBaseUrlId): OpenAiRuntimeConfig {
  return {
    baseUrlId,
    baseUrl: resolveOpenAiBaseUrl(baseUrlId),
  };
}

function baseUrlCatalog() {
  return OPENAI_BASE_URL_OPTIONS.map((option) => ({
    id: option.id,
    label: option.label,
    description: option.description,
    baseUrl: option.baseUrl,
  }));
}

export async function getGlobalOpenAiSettingsSnapshot(
  store: GlobalGenerationSettingsRepository = requireGlobalGenerationSettingsPersistence(),
): Promise<GlobalOpenAiSettingsSnapshot> {
  const row = await store.get();
  const baseUrlId = parseOpenAiBaseUrlId(row.openaiBaseUrl);
  return {
    ...toRuntimeConfig(baseUrlId),
    updatedAt: row.updatedAt,
    updatedByUserId: row.updatedByUserId,
    baseUrls: baseUrlCatalog(),
  };
}

export async function updateGlobalOpenAiSettings(
  store: GlobalGenerationSettingsRepository,
  baseUrlId: OpenAiBaseUrlId,
  updatedByUserId: string,
): Promise<GlobalOpenAiSettingsSnapshot> {
  assertOpenAiBaseUrlId(baseUrlId);
  await store.update({ openaiBaseUrl: baseUrlId, updatedByUserId });
  return getGlobalOpenAiSettingsSnapshot(store);
}
