import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  KeyRound,
  LoaderCircle,
  Plus,
  Trash2,
  Wifi,
} from "lucide-react";
import {
  customChatProfileCredentialProviderId,
  customThinkingProtocols,
  emptyCustomChatEndpointsState,
  localProviderBaseUrlSchema,
  parseCustomChatProfileCredentialProviderId,
  type CredentialStatus,
  type CustomChatEndpointProfile,
  type CustomChatEndpointsState,
  type CustomThinkingProtocol,
  type LocalAiModelSettings,
  type LocalChatThinkingSettings,
  type LocalProviderConnectionResult,
} from "@xue-learn/core/runtime-contracts";
import {
  chatThinkingFromSettings,
  inferCustomThinkingProtocol,
} from "./local-provider-catalog.ts";
import { getDesktopBridge } from "./runtime.ts";
import { useT, type TranslationKey } from "@xue-learn/core/i18n";
import { cn } from "@xue-learn/core/utils";

const thinkingProtocolLabelKeys = {
  none: "desktop.apiKeys.thinkingProtocol.none",
  openai: "desktop.apiKeys.thinkingProtocol.openai",
  minimax: "desktop.apiKeys.thinkingProtocol.minimax",
  deepseek: "desktop.apiKeys.thinkingProtocol.deepseek",
  doubao: "desktop.apiKeys.thinkingProtocol.doubao",
  bigmodel: "desktop.apiKeys.thinkingProtocol.bigmodel",
  qwen: "desktop.apiKeys.thinkingProtocol.qwen",
  ollama: "desktop.apiKeys.thinkingProtocol.ollama",
} as const satisfies Record<CustomThinkingProtocol, TranslationKey>;

const CUSTOM_FIELDS = ["apiKey", "baseUrl"] as const;

/**
 * Credential writes restart the desktop sidecar. Keep them strictly after all
 * HTTP persistence so saving a profile cannot race its own restart.
 */
export async function persistCustomEndpointBeforeCredentialRestart<T>(input: {
  persistSettings(): Promise<T>;
  persistProfileCredentials(): Promise<void>;
  activateProfileCredentials(): Promise<void>;
}): Promise<T> {
  const settings = await input.persistSettings();
  await input.persistProfileCredentials();
  await input.activateProfileCredentials();
  return settings;
}

function profileConfigured(
  profileId: string,
  statuses: CredentialStatus[],
): boolean {
  const key = customChatProfileCredentialProviderId(profileId);
  const configured =
    statuses.find((status) => status.providerId === key)?.configuredFields ??
    [];
  return CUSTOM_FIELDS.every((field) => configured.includes(field));
}

function legacyCustomConfigured(statuses: CredentialStatus[]): boolean {
  const configured =
    statuses.find((status) => status.providerId === "custom")
      ?.configuredFields ?? [];
  return CUSTOM_FIELDS.every((field) => configured.includes(field));
}

export function customChatProviderReady(statuses: CredentialStatus[]): boolean {
  if (legacyCustomConfigured(statuses)) return true;
  return statuses.some((status) => {
    const profileId = parseCustomChatProfileCredentialProviderId(
      status.providerId,
    );
    return (
      profileId !== null &&
      CUSTOM_FIELDS.every((field) => status.configuredFields.includes(field))
    );
  });
}

export async function migrateLegacyCustomChatEndpoint(input: {
  settings: LocalAiModelSettings;
  statuses: CredentialStatus[];
}): Promise<{
  settings: LocalAiModelSettings;
  statuses: CredentialStatus[];
} | null> {
  const endpoints =
    input.settings.customChatEndpoints ?? emptyCustomChatEndpointsState;
  if (endpoints.profiles.length > 0) return null;
  if (!legacyCustomConfigured(input.statuses)) return null;

  const bridge = getDesktopBridge();
  const id = crypto.randomUUID();
  const profile: CustomChatEndpointProfile = {
    id,
    name: "OpenAI-compatible",
    model: input.settings.chatModel.trim() || "custom-model",
    thinkingProtocol: input.settings.customThinkingProtocol,
  };
  const nextState: CustomChatEndpointsState = {
    activeProfileId: input.settings.chatProvider === "custom" ? id : null,
    profiles: [profile],
  };
  const response = await fetch("/api/local/ai-models/custom-endpoints", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(nextState),
  });
  if (!response.ok) {
    throw new Error(`Custom endpoint migration failed (${response.status})`);
  }
  const settings = (await response.json()) as LocalAiModelSettings;
  const statuses = await bridge.credentials.cloneProvider(
    "custom",
    customChatProfileCredentialProviderId(id),
  );
  return { settings, statuses };
}

export function CustomChatEndpointsPanel({
  settings,
  statuses,
  busy,
  onSettingsChange,
  onStatusesChange,
  onBusyChange,
  onError,
  onNotice,
}: {
  settings: LocalAiModelSettings;
  statuses: CredentialStatus[];
  busy: boolean;
  onSettingsChange(settings: LocalAiModelSettings): void;
  onStatusesChange(statuses: CredentialStatus[]): void;
  onBusyChange(busy: boolean): void;
  onError(message: string | undefined): void;
  onNotice(message: string | undefined): void;
}) {
  const t = useT();
  const bridge = useMemo(() => getDesktopBridge(), []);
  const endpoints =
    settings.customChatEndpoints ?? emptyCustomChatEndpointsState;
  const [selectedProfileId, setSelectedProfileId] = useState<string | "new">(
    endpoints.activeProfileId ?? endpoints.profiles[0]?.id ?? "new",
  );
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [protocol, setProtocol] = useState<CustomThinkingProtocol>("none");
  const [thinking, setThinking] = useState<LocalChatThinkingSettings>(
    chatThinkingFromSettings(settings),
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<LocalProviderConnectionResult>();

  const selectedProfile =
    selectedProfileId === "new"
      ? null
      : (endpoints.profiles.find(
          (profile) => profile.id === selectedProfileId,
        ) ?? null);

  useEffect(() => {
    if (selectedProfileId === "new") {
      setName("");
      setModel("");
      setProtocol("none");
      setThinking({
        ...chatThinkingFromSettings(settings),
        customThinkingProtocol: "none",
      });
      setDrafts({});
      setTestResult(undefined);
      return;
    }
    const profile = endpoints.profiles.find(
      (candidate) => candidate.id === selectedProfileId,
    );
    if (!profile) {
      setSelectedProfileId(endpoints.profiles[0]?.id ?? "new");
      return;
    }
    setName(profile.name);
    setModel(profile.model);
    setProtocol(profile.thinkingProtocol);
    setThinking({
      ...chatThinkingFromSettings(settings),
      customThinkingProtocol: profile.thinkingProtocol,
    });
    setDrafts({});
    setTestResult(undefined);
  }, [selectedProfileId, endpoints.profiles, settings]);

  const isActive =
    settings.chatProvider === "custom" &&
    endpoints.activeProfileId !== null &&
    endpoints.activeProfileId === selectedProfile?.id;
  const profileReady = selectedProfile
    ? profileConfigured(selectedProfile.id, statuses)
    : false;
  const hasDraft =
    Boolean(drafts.apiKey?.trim()) ||
    Boolean(drafts.baseUrl?.trim()) ||
    (selectedProfile
      ? name.trim() !== selectedProfile.name ||
        model.trim() !== selectedProfile.model ||
        protocol !== selectedProfile.thinkingProtocol
      : Boolean(
          name.trim() || model.trim() || drafts.apiKey || drafts.baseUrl,
        ));
  const baseUrlInvalid = Boolean(
    drafts.baseUrl?.trim() &&
    !localProviderBaseUrlSchema.safeParse(drafts.baseUrl).success,
  );

  async function saveAndUse() {
    const profileName = name.trim() || "OpenAI-compatible";
    const profileModel = model.trim();
    if (!profileModel) return;
    if (baseUrlInvalid) {
      onError(t("desktop.apiKeys.customEndpoint.invalidUrl"));
      return;
    }
    const profileId = selectedProfile?.id ?? crypto.randomUUID();
    const values = Object.fromEntries(
      CUSTOM_FIELDS.map((field) => [field, drafts[field]?.trim()]).filter(
        (entry): entry is [string, string] => Boolean(entry[1]),
      ),
    );
    if (!profileReady && Object.keys(values).length < CUSTOM_FIELDS.length) {
      // New profile needs both fields unless already saved in vault.
      const missing = CUSTOM_FIELDS.filter((field) => !values[field]);
      if (missing.length) return;
    }
    onBusyChange(true);
    onError(undefined);
    onNotice(undefined);
    try {
      const credentialKey = customChatProfileCredentialProviderId(profileId);
      // Persist every sidecar-owned setting before touching the vault. Each
      // credential mutation schedules a sidecar restart, so an API request
      // made afterwards can race that restart and surface as a spurious 500.
      const next = await persistCustomEndpointBeforeCredentialRestart({
        persistSettings: async () => {
          const response = await fetch(
            "/api/local/ai-models/custom-endpoints",
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                id: profileId,
                name: profileName,
                model: profileModel,
                thinkingProtocol: protocol,
                activate: true,
              }),
            },
          );
          if (!response.ok) {
            throw new Error(`Custom endpoint save failed (${response.status})`);
          }
          const saved = (await response.json()) as LocalAiModelSettings;
          // Ensure thinking dialect toggles are applied for the active protocol.
          const activateThinking = await fetch("/api/local/ai-models", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              capability: "chat",
              providerId: "custom",
              model: profileModel,
              customChatProfileId: profileId,
              customChatProfileName: profileName,
              ...chatThinkingFromSettings({
                ...saved,
                ...thinking,
                customThinkingProtocol: protocol,
              }),
            }),
          });
          if (!activateThinking.ok) {
            throw new Error(
              `Custom endpoint activation failed (${activateThinking.status})`,
            );
          }
          return (await activateThinking.json()) as LocalAiModelSettings;
        },
        persistProfileCredentials: async () => {
          if (!Object.keys(values).length) return;
          onStatusesChange(
            await bridge.credentials.mutate({
              action: "set",
              providerId: credentialKey,
              values,
            }),
          );
        },
        // Active runtime still reads the legacy `custom` slot. Keep this as
        // the final operation because cloning also schedules a restart.
        activateProfileCredentials: async () => {
          onStatusesChange(
            await bridge.credentials.cloneProvider(credentialKey, "custom"),
          );
        },
      });
      onSettingsChange(next);
      setSelectedProfileId(profileId);
      setDrafts({});
      onNotice(
        t("desktop.apiKeys.customEndpoint.savedNotice", { name: profileName }),
      );
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      onBusyChange(false);
    }
  }

  async function activateOnly(profile: CustomChatEndpointProfile) {
    if (!profileConfigured(profile.id, statuses)) {
      setSelectedProfileId(profile.id);
      onError(t("desktop.apiKeys.customEndpoint.configureFirst"));
      return;
    }
    onBusyChange(true);
    onError(undefined);
    onNotice(undefined);
    try {
      onStatusesChange(
        await bridge.credentials.cloneProvider(
          customChatProfileCredentialProviderId(profile.id),
          "custom",
        ),
      );
      const response = await fetch(
        `/api/local/ai-models/custom-endpoints/${profile.id}/activate`,
        { method: "POST" },
      );
      if (!response.ok) {
        throw new Error(`Custom endpoint switch failed (${response.status})`);
      }
      onSettingsChange((await response.json()) as LocalAiModelSettings);
      setSelectedProfileId(profile.id);
      onNotice(
        t("desktop.apiKeys.customEndpoint.switchedNotice", {
          name: profile.name,
        }),
      );
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      onBusyChange(false);
    }
  }

  async function removeSelected() {
    if (!selectedProfile) return;
    onBusyChange(true);
    onError(undefined);
    onNotice(undefined);
    try {
      const key = customChatProfileCredentialProviderId(selectedProfile.id);
      onStatusesChange(await bridge.credentials.clearProvider(key));
      if (endpoints.activeProfileId === selectedProfile.id) {
        onStatusesChange(await bridge.credentials.clearProvider("custom"));
      }
      const response = await fetch(
        `/api/local/ai-models/custom-endpoints/${selectedProfile.id}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        throw new Error(`Custom endpoint delete failed (${response.status})`);
      }
      const next = (await response.json()) as LocalAiModelSettings;
      onSettingsChange(next);
      setSelectedProfileId(
        next.customChatEndpoints.activeProfileId ??
          next.customChatEndpoints.profiles[0]?.id ??
          "new",
      );
      onNotice(
        t("desktop.apiKeys.customEndpoint.removedNotice", {
          name: selectedProfile.name,
        }),
      );
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      onBusyChange(false);
    }
  }

  async function testConfiguration() {
    if (!isActive || hasDraft || !model.trim()) return;
    setTesting(true);
    setTestResult(undefined);
    onError(undefined);
    try {
      const response = await fetch("/api/local/ai-models/test-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerId: "custom", model: model.trim() }),
      });
      if (!response.ok) {
        throw new Error(`Connection test failed (${response.status})`);
      }
      setTestResult((await response.json()) as LocalProviderConnectionResult);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-semibold text-foreground">OpenAI-compatible</h4>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("desktop.apiKeys.customEndpoint.listHint")}
          </p>
        </div>
        <KeyRound className="size-5 text-muted-foreground" aria-hidden />
      </div>

      <div className="mt-4 flex flex-wrap gap-2" role="list">
        {endpoints.profiles.map((profile) => {
          const active = selectedProfileId === profile.id;
          const inUse =
            settings.chatProvider === "custom" &&
            endpoints.activeProfileId === profile.id;
          const ready = profileConfigured(profile.id, statuses);
          return (
            <button
              key={profile.id}
              type="button"
              role="listitem"
              aria-pressed={active}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition-colors",
                active
                  ? "border-primary bg-[var(--course-content-surface-accent)] font-medium text-primary shadow-[inset_0_0_0_1px_var(--primary)]"
                  : inUse
                    ? "border-[color-mix(in_srgb,var(--success)_36%,var(--border))] bg-[var(--success-soft)] text-foreground"
                    : "border-border bg-background text-foreground hover:border-[var(--border-strong)]",
              )}
              onClick={() => setSelectedProfileId(profile.id)}
              onDoubleClick={() => void activateOnly(profile)}
            >
              {ready ? (
                <CheckCircle2
                  className="size-3.5 text-[var(--success)]"
                  aria-hidden
                />
              ) : (
                <KeyRound
                  className="size-3.5 text-muted-foreground"
                  aria-hidden
                />
              )}
              <span className="max-w-[10rem] truncate">{profile.name}</span>
              {inUse ? (
                <span className="rounded-full bg-[var(--success-100)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--success-700)]">
                  {t("desktop.apiKeys.inUse")}
                </span>
              ) : null}
            </button>
          );
        })}
        <button
          type="button"
          role="listitem"
          aria-pressed={selectedProfileId === "new"}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-sm transition-colors",
            selectedProfileId === "new"
              ? "border-primary bg-[var(--course-content-surface-accent)] font-medium text-primary"
              : "border-dashed border-border bg-background text-muted-foreground hover:border-[var(--border-strong)] hover:text-foreground",
          )}
          onClick={() => setSelectedProfileId("new")}
        >
          <Plus className="size-3.5" aria-hidden />
          {t("desktop.apiKeys.customEndpoint.add")}
        </button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="text-sm text-muted-foreground md:col-span-2">
          <span className="mb-1.5 block font-medium text-foreground">
            {t("desktop.apiKeys.customEndpoint.name")}
          </span>
          <input
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none transition-colors focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/25"
            value={name}
            placeholder={t("desktop.apiKeys.customEndpoint.namePlaceholder")}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="text-sm text-muted-foreground">
          <span className="mb-1.5 block font-medium text-foreground">
            {t("desktop.apiKeys.modelName")}
          </span>
          <input
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none transition-colors focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/25"
            value={model}
            placeholder={t("desktop.apiKeys.modelNamePlaceholder")}
            onChange={(event) => {
              const nextModel = event.target.value;
              setModel(nextModel);
              setTestResult(undefined);
              if (protocol === "none") {
                const inferred = inferCustomThinkingProtocol(
                  nextModel,
                  drafts.baseUrl,
                );
                if (inferred !== "none") {
                  setProtocol(inferred);
                  setThinking((current) => ({
                    ...current,
                    customThinkingProtocol: inferred,
                  }));
                }
              }
            }}
          />
        </label>
        {CUSTOM_FIELDS.map((field) => {
          const saved = selectedProfile
            ? (
                statuses.find(
                  (status) =>
                    status.providerId ===
                    customChatProfileCredentialProviderId(selectedProfile.id),
                )?.configuredFields ?? []
              ).includes(field)
            : false;
          return (
            <label key={field} className="text-sm text-muted-foreground">
              <span className="mb-1.5 flex items-center justify-between gap-2">
                <span>
                  {t(
                    field === "baseUrl"
                      ? "desktop.apiKeys.field.baseUrl"
                      : "desktop.apiKeys.field.apiKey",
                  )}
                </span>
                {saved ? (
                  <span className="text-xs font-medium text-[var(--success)]">
                    {t("desktop.apiKeys.saved")}
                  </span>
                ) : null}
              </span>
              <input
                type={field === "baseUrl" ? "url" : "password"}
                autoComplete="new-password"
                spellCheck={false}
                aria-invalid={field === "baseUrl" && baseUrlInvalid}
                className={cn(
                  "w-full rounded-lg border bg-background px-3 py-2 text-foreground outline-none transition-colors focus-visible:ring-3",
                  field === "baseUrl" && baseUrlInvalid
                    ? "border-destructive focus-visible:border-destructive focus-visible:ring-destructive/20"
                    : "border-border focus-visible:border-primary focus-visible:ring-primary/25",
                )}
                placeholder={
                  field === "baseUrl"
                    ? "https://api.example.com/v1"
                    : saved
                      ? t("desktop.apiKeys.placeholderReplace")
                      : t("desktop.apiKeys.placeholderNew")
                }
                value={drafts[field] ?? ""}
                onChange={(event) => {
                  const value = event.target.value;
                  setDrafts((current) => ({ ...current, [field]: value }));
                  setTestResult(undefined);
                  if (field === "baseUrl" && protocol === "none") {
                    const inferred = inferCustomThinkingProtocol(model, value);
                    if (inferred !== "none") {
                      setProtocol(inferred);
                      setThinking((current) => ({
                        ...current,
                        customThinkingProtocol: inferred,
                      }));
                    }
                  }
                }}
              />
              {field === "baseUrl" && baseUrlInvalid ? (
                <span
                  className="mt-1.5 block text-xs text-destructive"
                  role="alert"
                >
                  {t("desktop.apiKeys.customEndpoint.invalidUrl")}
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        {t("desktop.apiKeys.commonModelHint")}
      </p>

      <div className="mt-4 rounded-xl border border-border bg-muted/40 px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-foreground">
              {t("desktop.apiKeys.thinkingProtocol")}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t("desktop.apiKeys.thinkingProtocolHint")}
            </p>
          </div>
          <select
            className="native-select max-w-[11rem] shrink-0 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none transition-colors focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/25 disabled:opacity-50"
            value={protocol}
            disabled={busy}
            aria-label={t("desktop.apiKeys.thinkingProtocol")}
            onChange={(event) => {
              const next = event.target.value as CustomThinkingProtocol;
              setProtocol(next);
              setThinking((current) => ({
                ...current,
                customThinkingProtocol: next,
              }));
            }}
          >
            {customThinkingProtocols.map((value) => (
              <option key={value} value={value}>
                {t(thinkingProtocolLabelKeys[value])}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          className={cn(
            "w-full rounded-xl px-4 py-3 text-sm font-semibold transition-colors",
            isActive && !hasDraft
              ? "border border-primary/30 bg-primary/10 text-primary"
              : "bg-primary text-primary-foreground hover:bg-[var(--primary-hover)] disabled:opacity-50",
          )}
          disabled={
            busy ||
            testing ||
            !model.trim() ||
            baseUrlInvalid ||
            (isActive && !hasDraft && selectedProfileId !== "new")
          }
          onClick={() => void saveAndUse()}
        >
          {busy
            ? t("common.saving")
            : isActive && !hasDraft
              ? t("desktop.apiKeys.currentConfigurationButton")
              : t("desktop.apiKeys.saveAndUse")}
        </button>
        <button
          type="button"
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-elevated)] disabled:opacity-50"
          disabled={busy || testing || hasDraft || !isActive || !profileReady}
          title={
            hasDraft
              ? t("desktop.apiKeys.testSaveFirst")
              : !isActive
                ? t("desktop.apiKeys.testActivateFirst")
                : undefined
          }
          onClick={() => void testConfiguration()}
        >
          {testing ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
          ) : (
            <Wifi className="size-4" aria-hidden />
          )}
          {testing
            ? t("desktop.apiKeys.testingModel")
            : t("desktop.apiKeys.testConfiguration")}
        </button>
      </div>
      {testResult ? (
        <p
          className={cn(
            "mt-3 text-sm",
            testResult.healthy ? "text-[var(--success)]" : "text-destructive",
          )}
        >
          {testResult.message}
        </p>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          {t("desktop.apiKeys.testUsageHint")}
        </p>
      )}

      {selectedProfile ? (
        <button
          type="button"
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-destructive hover:underline disabled:opacity-50"
          disabled={busy}
          onClick={() => void removeSelected()}
        >
          <Trash2 className="size-3.5" aria-hidden />
          {t("desktop.apiKeys.customEndpoint.remove")}
        </button>
      ) : null}
    </div>
  );
}
