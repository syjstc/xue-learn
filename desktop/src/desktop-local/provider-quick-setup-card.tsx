import { useRef, useState } from "react";
import {
  ArrowRight,
  ExternalLink,
  Eye,
  EyeOff,
  LoaderCircle,
  RefreshCcw,
  SlidersHorizontal,
} from "lucide-react";
import { useI18n } from "@xue-learn/core/i18n";
import {
  customChatProfileCredentialProviderId,
  type CredentialStatus,
  type LocalAiModelSettings,
} from "@xue-learn/core/runtime-contracts";
import { getDesktopBridge } from "./runtime";
import { quickSetupMessages } from "./quick-setup";
import { providerSetupMessages } from "./provider-setup-messages";
import { CHAT_PROVIDER_PRESETS } from "@/shared/chat-provider-presets";
import {
  chatThinkingFromSettings,
  inferCustomThinkingProtocol,
} from "./local-provider-catalog";
import type {
  ProviderModel,
  ProviderModelCatalog,
} from "./model-catalog-contract";

export function ProviderQuickSetupCard({
  settings,
  statuses,
  onConnected,
}: {
  settings?: LocalAiModelSettings;
  statuses: CredentialStatus[];
  onConnected(
    settings: LocalAiModelSettings,
    statuses: CredentialStatus[],
  ): void | Promise<void>;
}) {
  const { locale } = useI18n();
  const m = quickSetupMessages(locale),
    c = providerSetupMessages(locale);
  const [provider, setProvider] = useState(""),
    [key, setKey] = useState(""),
    [baseUrl, setBaseUrl] = useState("");
  const [show, setShow] = useState(false),
    [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false);
  const [models, setModels] = useState<ProviderModel[]>([]),
    [model, setModel] = useState(""),
    [manual, setManual] = useState(false);
  const [catalog, setCatalog] = useState<ProviderModelCatalog>(),
    [error, setError] = useState<string>();
  const generation = useRef(0);
  const preset = CHAT_PROVIDER_PRESETS.find((p) => p.id === provider);
  const sourceProfile =
    provider === "custom"
      ? (settings?.customChatEndpoints?.activeProfileId ?? undefined)
      : undefined;
  const slot = sourceProfile
    ? customChatProfileCredentialProviderId(sourceProfile)
    : provider;
  const storedKey = statuses.some(
    (s) => s.providerId === slot && s.configuredFields.includes("apiKey"),
  );
  const hasSavedKey =
    storedKey &&
    (provider !== "custom" || !baseUrl || baseUrl === settings?.customBaseUrl);
  const noKey = provider === "ollama" || provider === "codex";
  const canRead = Boolean(
    provider &&
    (noKey || key.trim() || hasSavedKey) &&
    (provider !== "custom" || baseUrl.trim()),
  );
  function selectProvider(value: string) {
    generation.current++;
    setProvider(value);
    setKey("");
    setModels([]);
    setModel("");
    setCatalog(undefined);
    setManual(false);
    setError(undefined);
    setLoading(false);
    const choice = CHAT_PROVIDER_PRESETS.find((p) => p.id === value);
    setBaseUrl(
      value === "custom"
        ? (settings?.customBaseUrl ?? "")
        : value === "qwen"
          ? (settings?.qwenBaseUrl ?? choice?.baseUrl ?? "")
          : (choice?.baseUrl ?? ""),
    );
  }
  async function readModels() {
    const ticket = ++generation.current;
    setLoading(true);
    setError(undefined);
    try {
      let result: ProviderModelCatalog;
      if (provider === "codex") {
        const auth = await getDesktopBridge().codexAuth.status();
        if (!auth.signedIn) throw Error(c.loginWait);
        const response = await fetch("/api/local/ai-models/codex-models");
        if (!response.ok) throw Error(c.unavailable);
        const data = (await response.json()) as {
          available: boolean;
          models: { id: string; displayName?: string; display_name?: string }[];
          fetchedAt: number;
          stale?: boolean;
        };
        if (!data.available || data.stale) throw Error(c.unavailable);
        result = {
          providerId: provider,
          models: data.models.map((item) => ({
            id: item.id,
            label: item.displayName ?? item.display_name ?? item.id,
          })),
          fetchedAt: data.fetchedAt,
          source: "provider",
          code: "ok",
        };
      } else {
        if (!window.xueLearnModelCatalog) throw Error(c.restart);
        result = await window.xueLearnModelCatalog.list({
          providerId: provider,
          apiKey: key.trim() || undefined,
          baseUrl: baseUrl.trim() || undefined,
          customProfileId: sourceProfile,
        });
      }
      if (ticket !== generation.current) return;
      setCatalog(result);
      setModels(result.models);
      if (result.code !== "ok") {
        setManual(true);
        setError(
          result.code === "unauthorized"
            ? c.unauthorized
            : result.code === "missing_credentials"
              ? c.missing
              : result.code === "unsupported"
                ? c.unsupported
                : result.code === "empty"
                  ? c.empty
                  : c.unavailable,
        );
        return;
      }
      setManual(false);
      setModel(
        result.models.find(
          (item) =>
            item.id ===
            (settings?.chatProvider === provider
              ? settings.chatModel
              : undefined),
        )?.id ??
          result.models[0]?.id ??
          "",
      );
    } catch (cause) {
      if (ticket === generation.current) {
        setManual(true);
        setError(
          cause instanceof Error &&
            [c.loginWait, c.restart].includes(cause.message)
            ? cause.message
            : c.unavailable,
        );
      }
    } finally {
      if (ticket === generation.current) setLoading(false);
    }
  }
  async function save() {
    if (!settings || !provider || !model.trim() || !canRead) return;
    setSaving(true);
    setError(undefined);
    let routeChanged = false;
    let credentialsCommitted = false;
    try {
      if (!noKey && !window.xueLearnModelCatalog) throw Error(c.restart);
      const profileId =
        provider === "custom"
          ? sourceProfile && !key.trim() && baseUrl === settings.customBaseUrl
            ? sourceProfile
            : crypto.randomUUID()
          : undefined;
      // Persist the complete desired route before the credential write. The
      // host restarts its sidecar after IPC returns and may reload this page.
      const response = await fetch("/api/local/ai-models", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          capability: "chat",
          providerId: provider,
          model: model.trim(),
          ...chatThinkingFromSettings(settings),
          ...(provider === "deepseek" ? { deepseekThinkingEnabled: true } : {}),
          ...(profileId
            ? {
                customChatProfileId: profileId,
                customChatProfileName: new URL(baseUrl).hostname,
                customThinkingProtocol: inferCustomThinkingProtocol(
                  model,
                  baseUrl,
                ),
              }
            : {}),
        }),
      });
      if (!response.ok) throw Error(c.saveError);
      routeChanged = true;
      const next = (await response.json()) as LocalAiModelSettings;
      let nextStatuses = statuses;
      if (!noKey) {
        if (!window.xueLearnModelCatalog) throw Error(c.restart);
        nextStatuses = await window.xueLearnModelCatalog.saveCredentials({
          providerId: provider,
          apiKey: key.trim() || undefined,
          baseUrl: baseUrl.trim() || undefined,
          customProfileId: profileId,
          sourceCustomProfileId: sourceProfile,
        });
      }
      credentialsCommitted = true;
      setKey("");
      await onConnected(
        {
          ...next,
          ...(provider === "custom" ? { customBaseUrl: baseUrl } : {}),
        },
        nextStatuses,
      );
    } catch {
      if (routeChanged && !credentialsCommitted && settings.chatModel) {
        try {
          await fetch("/api/local/ai-models", {
            method: "PATCH", headers: { "content-type": "application/json" },
            body: JSON.stringify({ capability: "chat", providerId: settings.chatProvider,
              model: settings.chatModel, ...chatThinkingFromSettings(settings),
              ...(settings.chatProvider === "custom" && settings.customChatEndpoints?.activeProfileId
                ? { customChatProfileId: settings.customChatEndpoints.activeProfileId } : {}),
            }),
          });
        } catch { /* The next refresh will show the service's saved state. */ }
      }
      setError(c.saveError);
    } finally {
      setSaving(false);
    }
  }
  const field =
    "mt-2 h-12 w-full rounded-xl border border-border bg-background px-4 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-50";
  return (
    <section
      className="rounded-2xl border border-primary/25 bg-card p-5 shadow-sm sm:p-6"
      aria-labelledby="quick-provider-title"
    >
      <div className="flex items-center gap-3">
        <span className="rounded-xl bg-primary/10 p-2.5 text-primary">
          <SlidersHorizontal className="size-5" aria-hidden />
        </span>
        <div>
          <h2 id="quick-provider-title" className="text-lg font-semibold">
            {m.assistant}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{c.catalogHint}</p>
        </div>
      </div>
      <label
        className="mt-5 block text-sm font-medium"
        htmlFor="quick-provider"
      >
        {c.provider}
      </label>
      <select
        id="quick-provider"
        className={`native-select ${field}`}
        value={provider}
        onChange={(event) => selectProvider(event.target.value)}
        disabled={saving}
      >
        <option value="" disabled>
          {c.chooseProvider}
        </option>
        {CHAT_PROVIDER_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.id === "custom" ? c.custom : p.name}
            {"recommended" in p && p.recommended ? ` · ${m.recommended}` : ""}
          </option>
        ))}
      </select>
      {provider ? (
        <form
          className="mt-5 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {provider === "custom" || provider === "qwen" ? (
            <label className="block text-sm font-medium">
              {c.baseUrl}
              <input
                type="url"
                className={field}
                value={baseUrl}
                onChange={(event) => {
                  generation.current++;
                  setBaseUrl(event.target.value);
                  setModels([]);
                  setCatalog(undefined);
                  setModel("");
                  setLoading(false);
                }}
                disabled={saving}
                placeholder="https://api.example.com/v1"
              />
            </label>
          ) : null}
          {!noKey ? (
            <div>
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor="quick-provider-key"
                  className="text-sm font-medium"
                >
                  {m.key}
                </label>
                {preset && "keysUrl" in preset ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    onClick={() =>
                      void getDesktopBridge().external.openHttpsUrl(
                        preset.keysUrl,
                      )
                    }
                  >
                    {m.getKey}
                    <ExternalLink className="size-3" aria-hidden />
                  </button>
                ) : null}
              </div>
              <div className="relative">
                <input
                  id="quick-provider-key"
                  type={show ? "text" : "password"}
                  value={key}
                  onChange={(event) => {
                    generation.current++;
                    setKey(event.target.value);
                    setModels([]);
                    setCatalog(undefined);
                    setModel("");
                    setLoading(false);
                    setError(undefined);
                  }}
                  placeholder={
                    hasSavedKey ? "••••••••••••••••" : m.keyPlaceholder
                  }
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  disabled={saving}
                  className={`${field} pr-12`}
                />
                <button
                  type="button"
                  aria-label={show ? m.hide : m.show}
                  aria-pressed={show}
                  onClick={() => setShow(!show)}
                  className="absolute bottom-0 right-0 flex h-12 items-center px-4 text-muted-foreground"
                >
                  {show ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
              {hasSavedKey ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {m.savedKey}
                </p>
              ) : null}
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                {m.pricing}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {m.privacy}
              </p>
            </div>
          ) : provider === "codex" ? (
            <div className="text-sm text-muted-foreground">
              <p>{c.loginHint}</p>
              <button
                type="button"
                className="mt-3 text-primary underline"
                onClick={() =>
                  void getDesktopBridge()
                    .codexAuth.startLogin()
                    .then(() => setError(c.loginWait))
                    .catch(() => setError(c.unavailable))
                }
              >
                {c.login}
              </button>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!canRead || loading || saving}
              onClick={() => void readModels()}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-primary/30 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/5 disabled:opacity-50"
            >
              {loading ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <RefreshCcw className="size-4" />
              )}
              {loading ? c.reading : models.length ? c.refresh : c.read}
            </button>
            <button
              type="button"
              onClick={() => setManual(!manual)}
              className="text-xs text-muted-foreground underline underline-offset-4"
            >
              {manual ? c.useList : c.manual}
            </button>
          </div>
          <label className="block text-sm font-medium" htmlFor="quick-model">
            {c.model}
          </label>
          {manual ? (
            <>
              <input
                id="quick-model"
                className={field}
                value={model}
                onChange={(event) => setModel(event.target.value)}
                disabled={saving}
              />
              <p className="text-xs leading-5 text-muted-foreground">
                {c.manualHint}
              </p>
            </>
          ) : (
            <select
              id="quick-model"
              className={`native-select ${field}`}
              value={model}
              onChange={(event) => setModel(event.target.value)}
              disabled={!models.length || saving}
            >
              <option value="" disabled>
                {c.chooseModel}
              </option>
              {models.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          )}
          {catalog?.code === "ok" ? (
            <p className="text-xs text-muted-foreground">
              {c.catalogSource} · {models.length} ·{" "}
              {new Date(catalog.fetchedAt).toLocaleTimeString(locale)}
            </p>
          ) : null}
          {error ? (
            <p
              role="alert"
              className="rounded-xl bg-destructive/10 p-3 text-sm leading-6 text-destructive"
            >
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={saving || loading || !canRead || !model.trim()}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <ArrowRight className="size-4" />
            )}
            {saving ? m.testing : m.connect}
          </button>
        </form>
      ) : null}
    </section>
  );
}
