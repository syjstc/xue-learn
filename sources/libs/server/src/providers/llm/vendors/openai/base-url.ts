export const openaiBaseUrlIds = ["official", "krill"] as const;
export type OpenAiBaseUrlId = (typeof openaiBaseUrlIds)[number];

export const OPENAI_OFFICIAL_BASE_URL = "https://api.openai.com/v1";
export const OPENAI_KRILL_BASE_URL =
  "https://api-slb.krill-ai.net/codex/v1";

export const OPENAI_BASE_URL_BY_ID: Record<OpenAiBaseUrlId, string> = {
  official: OPENAI_OFFICIAL_BASE_URL,
  krill: OPENAI_KRILL_BASE_URL,
};

export const OPENAI_BASE_URL_OPTIONS: Array<{
  id: OpenAiBaseUrlId;
  label: string;
  description: string;
  baseUrl: string;
}> = [
  {
    id: "official",
    label: "OpenAI official",
    description: "Direct OpenAI Chat Completions API.",
    baseUrl: OPENAI_OFFICIAL_BASE_URL,
  },
  {
    id: "krill",
    label: "Krill Codex",
    description: "OpenAI-compatible Codex proxy via Krill SLB.",
    baseUrl: OPENAI_KRILL_BASE_URL,
  },
];

export function defaultOpenAiBaseUrlId(): OpenAiBaseUrlId {
  return "official";
}

export function parseOpenAiBaseUrlId(
  value: string | null | undefined,
): OpenAiBaseUrlId {
  return value && openaiBaseUrlIds.includes(value as OpenAiBaseUrlId)
    ? (value as OpenAiBaseUrlId)
    : defaultOpenAiBaseUrlId();
}

export function resolveOpenAiBaseUrl(id: OpenAiBaseUrlId): string {
  return OPENAI_BASE_URL_BY_ID[id];
}
