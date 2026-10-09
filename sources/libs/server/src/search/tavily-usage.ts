import {
  tavilyUsageSchema,
  type TavilyUsage,
  type TavilyUsageCode,
} from "../../../runtime-contracts/src/index.js";
import { hasTavilyConfigured } from "../env.js";

const TAVILY_USAGE_URL = "https://api.tavily.com/usage";
const USAGE_TIMEOUT_MS = 15_000;

const usageMessages: Record<TavilyUsageCode, string> = {
  ok: "Tavily usage loaded.",
  missing_credentials: "Save a Tavily API key first.",
  unauthorized: "Tavily rejected the saved API key.",
  unreachable: "Tavily usage could not be reached.",
  provider_error: "Tavily returned an error while loading usage.",
};

const emptyUsage = {
  plan: null,
  planUsage: null,
  planLimit: null,
  paygoUsage: null,
  paygoLimit: null,
  keyUsage: null,
  keyLimit: null,
  searchUsage: null,
  extractUsage: null,
} as const;

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, Math.trunc(parsed));
  }
  return null;
}

function usageResult(
  code: TavilyUsageCode,
  extras: Partial<TavilyUsage> = {},
): TavilyUsage {
  return tavilyUsageSchema.parse({
    available: code === "ok",
    code,
    message: usageMessages[code],
    checkedAt: Date.now(),
    ...emptyUsage,
    ...extras,
  });
}

export async function fetchTavilyUsage(): Promise<TavilyUsage> {
  if (!hasTavilyConfigured()) return usageResult("missing_credentials");
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) return usageResult("missing_credentials");

  try {
    const response = await fetch(TAVILY_USAGE_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(USAGE_TIMEOUT_MS),
    });
    if (response.status === 401 || response.status === 403) {
      return usageResult("unauthorized");
    }
    if (!response.ok) return usageResult("provider_error");

    const body = asObject(await response.json());
    const key = asObject(body.key);
    const account = asObject(body.account);
    return usageResult("ok", {
      plan: readString(account.current_plan),
      planUsage: readInt(account.plan_usage),
      planLimit: readInt(account.plan_limit),
      paygoUsage: readInt(account.paygo_usage),
      paygoLimit: readInt(account.paygo_limit),
      keyUsage: readInt(key.usage),
      keyLimit: readInt(key.limit),
      searchUsage: readInt(account.search_usage) ?? readInt(key.search_usage),
      extractUsage:
        readInt(account.extract_usage) ?? readInt(key.extract_usage),
    });
  } catch {
    return usageResult("unreachable");
  }
}
