import { z } from "zod";
import { customChatProfileCredentialProviderId } from "@xue-learn/core/runtime-contracts";
import { CHAT_PROVIDER_PRESETS } from "../../../src/shared/chat-provider-presets";
import type {
  ProviderModel,
  ProviderModelCatalog,
} from "../../../src/desktop-local/model-catalog-contract";

export const modelCatalogRequestSchema = z.object({
  providerId: z.enum(
    CHAT_PROVIDER_PRESETS.map((p) => p.id) as [string, ...string[]],
  ),
  apiKey: z.string().trim().max(8192).optional(),
  baseUrl: z.string().trim().max(2048).optional(),
  customProfileId: z.string().max(200).optional(),
  sourceCustomProfileId: z.string().max(200).optional(),
});
type SavedCredentials = Record<string, Record<string, string>>;

export function providerCredentialsForSave(
  raw: unknown,
  credentials: SavedCredentials,
) {
  const input = modelCatalogRequestSchema.parse(raw);
  const preset = CHAT_PROVIDER_PRESETS.find((p) => p.id === input.providerId)!;
  const custom = input.providerId === "custom";
  const slot =
    custom && input.sourceCustomProfileId
      ? customChatProfileCredentialProviderId(input.sourceCustomProfileId)
      : input.providerId;
  const saved = credentials[slot] ?? {};
  const editable = custom || input.providerId === "qwen";
  const base = new URL(
    editable
      ? input.baseUrl || saved.baseUrl || preset.baseUrl
      : preset.baseUrl,
  );
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw Error("Invalid provider address");
  if (
    editable &&
    !input.apiKey &&
    saved.apiKey &&
    new URL(saved.baseUrl || preset.baseUrl).origin !== base.origin
  )
    throw Error("Enter a key for the new provider address");
  const apiKey = input.apiKey || saved.apiKey;
  if (!apiKey) throw Error("Provider credentials are incomplete");
  return {
    apiKey,
    ...(editable ? { baseUrl: base.toString().replace(/\/$/, "") } : {}),
  };
}

/** Resolve models in Electron main. Never return credentials or vendor error
 * bodies, and never manufacture a current catalog from bundled model names. */
export async function listProviderModels(
  raw: unknown,
  credentials: SavedCredentials,
  request: typeof fetch = fetch,
): Promise<ProviderModelCatalog> {
  const input = modelCatalogRequestSchema.parse(raw);
  const result = (
    code: ProviderModelCatalog["code"],
    models: ProviderModel[] = [],
  ): ProviderModelCatalog => ({
    providerId: input.providerId,
    models,
    fetchedAt: Date.now(),
    source: "provider",
    code,
  });
  if (input.providerId === "codex") return result("unsupported");
  const preset = CHAT_PROVIDER_PRESETS.find((p) => p.id === input.providerId)!;
  const slot =
    input.providerId === "custom" && input.customProfileId
      ? customChatProfileCredentialProviderId(input.customProfileId)
      : input.providerId;
  const saved = credentials[slot] ?? {};
  const apiKey = input.apiKey || saved.apiKey;
  if (input.providerId !== "ollama" && !apiKey)
    return result("missing_credentials");
  try {
    const editable = ["custom", "ollama", "qwen"].includes(input.providerId);
    const base = new URL(
      editable
        ? input.baseUrl || saved.baseUrl || preset.baseUrl
        : preset.baseUrl,
    );
    if (
      !["http:", "https:"].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    )
      return result("invalid_configuration");
    if (
      ["custom", "qwen"].includes(input.providerId) &&
      saved.apiKey &&
      !input.apiKey &&
      new URL(saved.baseUrl || preset.baseUrl).origin !== base.origin
    )
      return result("missing_credentials");
    const url =
      input.providerId === "fireworks"
        ? new URL("https://api.fireworks.ai/v1/accounts/fireworks/models")
        : new URL(base.toString());
    if (input.providerId !== "fireworks")
      url.pathname =
        base.pathname.replace(/\/$/, "") +
        (input.providerId === "ollama" ? "/api/tags" : "/models");
    const signal = AbortSignal.timeout(12000);
    const models: ProviderModel[] = [];
    const seen = new Set<string>();
    for (let page = 0; page < 10; page++) {
      const response = await request(url, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal,
        redirect: "error",
      });
      if (!response.ok)
        return result(
          response.status === 401 || response.status === 403
            ? "unauthorized"
            : response.status === 404 || response.status === 405
              ? "unsupported"
              : "unavailable",
        );
      const body = await response.text();
      if (body.length > 4 * 1024 * 1024) return result("unavailable");
      const data = JSON.parse(body) as Record<string, unknown>;
      const rows = Array.isArray(data.data)
        ? data.data
        : Array.isArray(data.models)
          ? data.models
          : [];
      for (const value of rows) {
        if (!value || typeof value !== "object") continue;
        const row = value as Record<string, unknown>;
        if (
          input.providerId === "fireworks" &&
          row.supportsServerless === false
        )
          continue;
        const id =
          typeof row.id === "string"
            ? row.id
            : typeof row.name === "string"
              ? row.name
              : typeof row.model === "string"
                ? row.model
                : "";
        if (!id.trim() || id.length > 512 || seen.has(id)) continue;
        // Model IDs are the provider's actual response, including newly added
        // releases. Skip obvious non-chat resources in mixed inventories.
        if (
          /(?:^|[/_-])(embedding|embed|whisper|tts|dall-e|rerank|moderation|transcri)/i.test(
            id,
          )
        )
          continue;
        const endpoints = Array.isArray(row.supported_endpoints)
          ? row.supported_endpoints
          : undefined;
        if (
          endpoints &&
          !endpoints.some(
            (e) => typeof e === "string" && /chat|responses|completion/.test(e),
          )
        )
          continue;
        seen.add(id);
        models.push({
          id,
          label:
            typeof row.displayName === "string"
              ? `${row.displayName} · ${id}`
              : id,
          ...(typeof row.created === "number" ? { created: row.created } : {}),
        });
        if (models.length >= 5000) break;
      }
      if (models.length >= 5000) break;
      const token =
        typeof data.nextPageToken === "string"
          ? data.nextPageToken
          : typeof data.next_page_token === "string"
            ? data.next_page_token
            : undefined;
      if (token && input.providerId === "fireworks")
        url.searchParams.set("pageToken", token);
      else if (data.has_more === true && typeof data.last_id === "string")
        url.searchParams.set("after", data.last_id);
      else break;
    }
    models.sort(
      (a, b) =>
        (b.created ?? 0) - (a.created ?? 0) ||
        a.id.localeCompare(b.id, undefined, { numeric: true }),
    );
    return result(models.length ? "ok" : "empty", models);
  } catch {
    return result("unavailable");
  }
}
