/**
 * The Electron host owns Codex OAuth credentials. The sidecar installs this
 * callback during bootstrap; the provider never persists or logs the token.
 */
export type CodexAccessTokenRequest = { forceRefresh?: boolean };
let accessTokenProvider:
  | ((request?: CodexAccessTokenRequest) => Promise<string>)
  | null = null;

/** Whether the Electron host has installed the OAuth token bridge. */
export function hasCodexAccessTokenProvider(): boolean {
  return accessTokenProvider !== null;
}

export const CODEX_BACKEND_BASE_URL =
  "https://chatgpt.com/backend-api/codex" as const;

export class CodexBackendError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "CodexBackendError";
  }
}

export function setCodexAccessTokenProvider(
  provider:
    | ((request?: CodexAccessTokenRequest) => Promise<string>)
    | null,
): void {
  accessTokenProvider = provider;
}

export function accountIdFromJwt(token: string): string | undefined {
  try {
    const [, encoded] = token.split(".");
    if (!encoded) return undefined;
    const payload = JSON.parse(
      Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
        "utf8",
      ),
    ) as Record<string, unknown>;
    const direct = payload["https://api.openai.com/auth.chatgpt_account_id"];
    if (typeof direct === "string" && direct.trim()) return direct.trim();
    const auth = payload["https://api.openai.com/auth"];
    if (auth && typeof auth === "object") {
      const accountId = (auth as Record<string, unknown>).chatgpt_account_id;
      if (typeof accountId === "string" && accountId.trim()) return accountId.trim();
    }
  } catch {
    // The server remains responsible for rejecting malformed credentials.
  }
  return undefined;
}

function normalizeGpt6CodexRequest(
  requestUrl: URL,
  init?: RequestInit,
): RequestInit | undefined {
  if (
    requestUrl.pathname !== "/backend-api/codex/responses" ||
    init?.method?.toUpperCase() !== "POST" ||
    typeof init.body !== "string"
  ) {
    return init;
  }
  try {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    if (typeof body.model !== "string" || !/^gpt-6[.-]/.test(body.model)) {
      return init;
    }
    if (!Array.isArray(body.input)) return init;
    let changed = false;
    const normalizedInput = body.input.map((item) => {
      if (!item || typeof item !== "object" || item.role !== "system") {
        return item;
      }
      changed = true;
      return { ...item, role: "developer" };
    });
    return changed
      ? { ...init, body: JSON.stringify({ ...body, input: normalizedInput }) }
      : init;
  } catch {
    return init;
  }
}

/**
 * ChatOpenAI normally freezes the API key into its OpenAI client. A fetch
 * wrapper lets the sidecar ask the Electron owner for a fresh access token on
 * every request without restarting the sidecar.
 */
export async function codexFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const requestUrl =
    input instanceof URL
      ? input
      : typeof input === "string"
        ? new URL(input)
        : new URL(input.url);
  const allowedPath =
    requestUrl.hostname === "chatgpt.com" &&
    (requestUrl.port === "" || requestUrl.port === "443") &&
    (requestUrl.pathname === "/backend-api/wham/usage" ||
      requestUrl.pathname === "/backend-api/codex" ||
      requestUrl.pathname.startsWith("/backend-api/codex/"));
  if (requestUrl.protocol !== "https:" || !allowedPath) {
    throw new Error("Codex requests must use the official backend endpoint");
  }
  if (!accessTokenProvider) {
    throw new Error("Codex authentication host is unavailable");
  }
  const token = await accessTokenProvider();
  if (!token) throw new Error("Codex is not signed in");
  // LangChain 1.5.5 treats GPT-6 as a non-reasoning model and leaves system
  // messages unchanged. Match its existing GPT-5 reasoning-model wire format.
  const requestInit = normalizeGpt6CodexRequest(requestUrl, init);
  const headers = new Headers(init?.headers);
  if (requestInit !== init) headers.delete("content-length");
  headers.set("Authorization", "Bearer " + token);
  // Cloudflare requires a first-party-compatible client identity on the
  // subscription route. This is transport metadata, not a user credential.
  headers.set("originator", "codex_cli_rs");
  headers.set("User-Agent", "codex_cli_rs/0.0.0 (XueLearn Desktop)");
  const accountId = accountIdFromJwt(token);
  if (accountId) headers.set("ChatGPT-Account-Id", accountId);
  const response = await fetch(input, { ...requestInit, headers });
  if (response.status !== 401 || !accessTokenProvider) return response;

  // A token can be revoked between requests. Refresh once before any
  // response is exposed to the business layer; never replay after streaming
  // has started because tool/text chunks may already have been committed.
  const refreshed = await accessTokenProvider({ forceRefresh: true });
  headers.set("Authorization", "Bearer " + refreshed);
  const refreshedAccountId = accountIdFromJwt(refreshed);
  if (refreshedAccountId) headers.set("ChatGPT-Account-Id", refreshedAccountId);
  else headers.delete("ChatGPT-Account-Id");
  return fetch(input, { ...requestInit, headers });
}

export type CodexModelCatalogEntry = {
  id: string;
  displayName: string;
  description: string | null;
  defaultReasoningEffort: string | null;
  supportedReasoningEfforts: string[];
  inputModalities?: string[];
  supportsImageDetailOriginal?: boolean;
};

function reasoningEffortsFromModel(item: Record<string, unknown>): string[] {
  const raw = item.supported_reasoning_efforts ?? item.supported_reasoning_levels;
  if (!Array.isArray(raw)) return [];
  const efforts: string[] = [];
  for (const value of raw) {
    const effort =
      typeof value === "string"
        ? value
        : value && typeof value === "object"
          ? (value as Record<string, unknown>).effort ??
            (value as Record<string, unknown>).reasoning_effort
          : undefined;
    if (typeof effort === "string" && effort.trim() && !efforts.includes(effort)) {
      efforts.push(effort.trim());
    }
  }
  return efforts;
}

/** Fetches the account-scoped catalog without exposing the OAuth token. */
export async function fetchCodexModelCatalog(signal?: AbortSignal): Promise<CodexModelCatalogEntry[]> {
  const response = await codexFetch(
    `${CODEX_BACKEND_BASE_URL}/models?client_version=1.0.0`,
    { headers: { Accept: "application/json" }, signal },
  );
  if (!response.ok) {
    throw new CodexBackendError(
      `Codex model catalog request failed (HTTP ${response.status})`,
      response.status,
    );
  }
  const payload = (await response.json()) as unknown;
  const entries =
    payload && typeof payload === "object" &&
    Array.isArray((payload as Record<string, unknown>).models)
      ? ((payload as Record<string, unknown>).models as unknown[])
      : [];
  const models: CodexModelCatalogEntry[] = [];
  for (const raw of entries) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const id = item.slug ?? item.model ?? item.id;
    if (typeof id !== "string" || !id.trim()) continue;
    const visibility = item.visibility;
    if (
      typeof visibility === "string" &&
      ["hide", "hidden"].includes(visibility.trim().toLowerCase())
    ) {
      continue;
    }
    const displayName = item.display_name ?? item.displayName ?? id;
    const defaultReasoningEffort =
      item.default_reasoning_effort ?? item.default_reasoning_level;
    models.push({
      id: id.trim(),
      displayName:
        typeof displayName === "string" && displayName.trim()
          ? displayName.trim()
          : id.trim(),
      description:
        typeof item.description === "string" && item.description.trim()
          ? item.description.trim()
          : null,
      defaultReasoningEffort:
        typeof defaultReasoningEffort === "string" && defaultReasoningEffort.trim()
          ? defaultReasoningEffort.trim()
          : null,
      supportedReasoningEfforts: reasoningEffortsFromModel(item),
      ...(Array.isArray(item.input_modalities)
        ? { inputModalities: item.input_modalities.filter((value): value is string => typeof value === "string") }
        : {}),
      ...(typeof item.supports_image_detail_original === "boolean"
        ? { supportsImageDetailOriginal: item.supports_image_detail_original }
        : {}),
    });
  }
  return models;
}

export type CodexUsageSnapshot = {
  plan: string | null;
  windows: Array<{
    label: string;
    usedPercent: number;
    resetAt: string | null;
  }>;
  resetCreditsAvailable: number | null;
  creditsBalance: number | null;
  creditsUnlimited: boolean;
};

function resetTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value < 2_000_000_000 ? value * 1000 : value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

/** Reads account quota from the same backend used by Codex CLI. */
export async function fetchCodexUsage(): Promise<CodexUsageSnapshot> {
  const response = await codexFetch(`${CODEX_BACKEND_BASE_URL.replace(/\/codex$/, "")}/wham/usage`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new CodexBackendError(
      `Codex usage request failed (HTTP ${response.status})`,
      response.status,
    );
  }
  const payload = (await response.json()) as Record<string, unknown>;
  const rateLimit =
    payload.rate_limit && typeof payload.rate_limit === "object"
      ? (payload.rate_limit as Record<string, unknown>)
      : {};
  const windows: CodexUsageSnapshot["windows"] = [];
  for (const [key, label] of [
    ["primary_window", "当前会话"],
    ["secondary_window", "当前周期"],
  ] as const) {
    const raw = rateLimit[key];
    if (!raw || typeof raw !== "object") continue;
    const window = raw as Record<string, unknown>;
    const used = Number(window.used_percent);
    if (!Number.isFinite(used)) continue;
    windows.push({
      label,
      usedPercent: Math.max(0, Math.min(100, used)),
      resetAt: resetTimestamp(window.reset_at),
    });
  }
  const resetCredits =
    payload.rate_limit_reset_credits &&
    typeof payload.rate_limit_reset_credits === "object"
      ? (payload.rate_limit_reset_credits as Record<string, unknown>)
      : {};
  const credits =
    payload.credits && typeof payload.credits === "object"
      ? (payload.credits as Record<string, unknown>)
      : {};
  const rawBalance = Number(credits.balance);
  return {
    plan: typeof payload.plan_type === "string" ? payload.plan_type : null,
    windows,
    resetCreditsAvailable:
      Number.isFinite(Number(resetCredits.available_count))
        ? Math.max(0, Math.trunc(Number(resetCredits.available_count)))
        : null,
    creditsBalance:
      Number.isFinite(rawBalance) ? Math.max(0, rawBalance) : null,
    creditsUnlimited: credits.unlimited === true,
  };
}
