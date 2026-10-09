import { useEffect, useMemo, useState } from "react";
import {
  AudioLines,
  Binary,
  CheckCircle2,
  Image as ImageIcon,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  MessageSquareText,
  Search,
  RefreshCcw,
  Trash2,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import {
  BUILTIN_EMBEDDING_MODEL_ID,
  LOCAL_OWNER_ID,
  customThinkingProtocols,
  localAudioProviderIds,
  localChatProviderIds,
  localEmbeddingProviderIds,
  localImageProviderIds,
  localSearchProviderIds,
  type CredentialStatus,
  type CodexAuthStatus,
  type CodexModelCatalog,
  type CodexUsage,
  type CodexReasoningEffort,
  resolveCodexReasoningEffort,
  codexReasoningEffortsForCatalog,
  type EmbeddingModelInstallStatus,
  type LocalCapabilityConnectionResult,
  type LocalAiModelSettings,
  type LocalChatThinkingSettings,
  type LocalProviderConnectionResult,
  type LocalProviderId,
  type LocalVectorReindexStatus,
  type TavilyUsage,
} from "@xue-learn/core/source/libs/runtime-contracts/src/index.ts";
import { getDesktopBridge } from "./runtime.ts";
import {
  chatThinkingFromSettings,
  inferCustomThinkingProtocol,
  LOCAL_DEFAULT_MODELS,
  LOCAL_PROVIDER_DEFAULT_URLS,
  localAudioModelLabel,
  localChatThinkingControl,
  type LocalChatThinkingControl,
} from "./local-provider-catalog.ts";
import { Switch } from "@/components/ui/switch";
import { useT, type TranslationKey } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import { cn } from "@xue-learn/core/source/src/shared/utils.ts";
import { BuiltinEmbeddingDownloadDialog } from "./builtin-embedding-download-dialog.tsx";
import {
  CustomChatEndpointsPanel,
  customChatProviderReady,
  migrateLegacyCustomChatEndpoint,
} from "./custom-chat-endpoints-panel.tsx";
import { queryClient, queryKeys } from "@/shared/api";
import type { LearningViewSettingsResponse } from "@/hooks/api/use-settings";
import { emptyCustomChatEndpointsState } from "@xue-learn/core/source/libs/runtime-contracts/src/index.ts";
import { GuidedImageModelSettingsPanel } from "./guided-image-model-settings.tsx";

const providerLabels: Partial<Record<LocalProviderId, string>> = {
  custom: "OpenAI-compatible",
  openai: "OpenAI",
  deepseek: "DeepSeek",
  minimax: "MiniMax",
  fireworks: "Fireworks",
  doubao: "Doubao",
  qwen: "Qwen Audio",
  cartesia: "Cartesia",
  bigmodel: "BigModel",
  custom_embedding: "OpenAI-compatible",
  apimart: "ApiMart",
  krill: "Krill",
  tavily: "Tavily",
  anysearch: "AnySearch",
  ollama: "Ollama",
  codex: "Codex（ChatGPT 订阅）",
  builtin: "Qwen3 Embedding · Local",
};

const vectorStatusLabelKeys = {
  no_chunks: "desktop.runtime.vector.noChunks",
  lexical_only: "desktop.runtime.vector.lexicalOnly",
  queued: "desktop.runtime.vector.queued",
  building: "desktop.runtime.vector.building",
  published: "desktop.runtime.vector.published",
  failed: "desktop.runtime.vector.failed",
} as const satisfies Record<LocalVectorReindexStatus["status"], TranslationKey>;

const vectorStatusDescriptionKeys = {
  no_chunks: "desktop.runtime.vectorDesc.noChunks",
  lexical_only: "desktop.runtime.vectorDesc.lexicalOnly",
  queued: "desktop.runtime.vectorDesc.queued",
  building: "desktop.runtime.vectorDesc.building",
  published: "desktop.runtime.vectorDesc.published",
  failed: "desktop.runtime.vectorDesc.failed",
} as const satisfies Record<LocalVectorReindexStatus["status"], TranslationKey>;

const tavilyUsageFailureKeys = {
  missing_credentials: "desktop.apiKeys.tavilyUsage.failed.missing_credentials",
  unauthorized: "desktop.apiKeys.tavilyUsage.failed.unauthorized",
  unreachable: "desktop.apiKeys.tavilyUsage.failed.unreachable",
  provider_error: "desktop.apiKeys.tavilyUsage.failed.provider_error",
} as const satisfies Record<Exclude<TavilyUsage["code"], "ok">, TranslationKey>;

const thinkingProtocolLabelKeys = {
  none: "desktop.apiKeys.thinkingProtocol.none",
  openai: "desktop.apiKeys.thinkingProtocol.openai",
  minimax: "desktop.apiKeys.thinkingProtocol.minimax",
  deepseek: "desktop.apiKeys.thinkingProtocol.deepseek",
  doubao: "desktop.apiKeys.thinkingProtocol.doubao",
  bigmodel: "desktop.apiKeys.thinkingProtocol.bigmodel",
  qwen: "desktop.apiKeys.thinkingProtocol.qwen",
  ollama: "desktop.apiKeys.thinkingProtocol.ollama",
} as const satisfies Record<
  (typeof customThinkingProtocols)[number],
  TranslationKey
>;

const fieldKeys: Record<string, TranslationKey> = {
  baseUrl: "desktop.apiKeys.field.baseUrl",
  apiKey: "desktop.apiKeys.field.apiKey",
  groupId: "desktop.apiKeys.field.groupId",
  embeddingApiKey: "desktop.apiKeys.field.embeddingApiKey",
  searchApiKey: "desktop.apiKeys.field.searchApiKey",
  speechApiKey: "desktop.apiKeys.field.speechApiKey",
};

type ProviderType = "chat" | "image" | "audio" | "embedding" | "search";
type OptionalFeatureType = "image" | "audio";

function isOptionalFeatureType(
  type: ProviderType,
): type is OptionalFeatureType {
  return type === "image" || type === "audio";
}

type ProviderTypeDefinition = {
  id: ProviderType;
  labelKey: TranslationKey;
  icon: LucideIcon;
  providers: readonly string[];
  credentialFields: Partial<Record<LocalProviderId, readonly string[]>>;
};

const PROVIDER_TYPES: readonly ProviderTypeDefinition[] = [
  {
    id: "chat",
    labelKey: "desktop.runtime.capability.chat",
    icon: MessageSquareText,
    providers: localChatProviderIds,
    credentialFields: {
      custom: ["apiKey", "baseUrl"],
      minimax: ["apiKey", "groupId"],
      openai: ["apiKey"],
      deepseek: ["apiKey"],
      fireworks: ["apiKey"],
      doubao: ["apiKey"],
      ollama: [],
      codex: [],
    },
  },
  {
    id: "image",
    labelKey: "desktop.runtime.capability.image",
    icon: ImageIcon,
    providers: localImageProviderIds,
    credentialFields: {
      minimax: ["apiKey"],
      openai: ["apiKey"],
      apimart: ["apiKey"],
      doubao: ["apiKey"],
      krill: ["apiKey"],
      codex: [],
    },
  },
  {
    id: "audio",
    labelKey: "desktop.runtime.capability.audio",
    icon: AudioLines,
    providers: localAudioProviderIds,
    credentialFields: {
      minimax: ["apiKey", "groupId"],
      doubao: ["speechApiKey"],
      qwen: ["apiKey", "baseUrl"],
      cartesia: ["apiKey"],
    },
  },
  {
    id: "embedding",
    labelKey: "desktop.runtime.capability.embedding",
    icon: Binary,
    providers: localEmbeddingProviderIds,
    credentialFields: {
      builtin: [],
      ollama: [],
      custom_embedding: ["apiKey", "baseUrl"],
    },
  },
  {
    id: "search",
    labelKey: "desktop.runtime.capability.search",
    icon: Search,
    providers: localSearchProviderIds,
    credentialFields: {
      tavily: ["apiKey"],
      doubao: ["searchApiKey"],
      anysearch: ["apiKey"],
    },
  },
] as const;

function firstEnabledProvider(type: ProviderTypeDefinition): LocalProviderId {
  return type.providers.find(
    (provider) => provider !== "none",
  ) as LocalProviderId;
}

function modelChoices(
  type: ProviderType,
  providerId: LocalProviderId,
): readonly string[] {
  if (type === "search") return [];
  return LOCAL_DEFAULT_MODELS[type][providerId] ?? [];
}

function modelDraftKey(type: ProviderType, providerId: LocalProviderId) {
  return `${type}.${providerId}`;
}

export function getActiveLocalModelSelection(
  settings: LocalAiModelSettings | undefined,
  type: ProviderType,
): { provider: LocalProviderId; model?: string } | undefined {
  if (!settings) return undefined;
  const selection =
    type === "chat"
      ? { provider: settings.chatProvider, model: settings.chatModel }
      : type === "embedding"
        ? {
            provider: settings.embeddingProvider,
            model: settings.embeddingModel ?? undefined,
          }
        : type === "image"
          ? {
              provider: settings.imageProvider,
              model: settings.imageModel ?? undefined,
            }
          : type === "audio"
            ? {
                provider: settings.audioProvider,
                model: settings.audioModel ?? undefined,
              }
            : { provider: settings.searchProvider };
  if (!selection.provider || selection.provider === "none") return undefined;
  return selection as { provider: LocalProviderId; model?: string };
}

export function hasRequiredLocalProviderCredentials(
  type: ProviderType,
  providerId: LocalProviderId,
  statuses: CredentialStatus[],
): boolean {
  if (type === "chat" && providerId === "custom") {
    return customChatProviderReady(statuses);
  }
  const definition = PROVIDER_TYPES.find((candidate) => candidate.id === type);
  const fields = definition?.credentialFields[providerId] ?? [];
  const configured =
    statuses.find((status) => status.providerId === providerId)
      ?.configuredFields ?? [];
  return requiredCredentialFields(providerId, fields).every((field) =>
    configured.includes(field),
  );
}

function requiredCredentialFields(
  providerId: LocalProviderId,
  fields: readonly string[],
): readonly string[] {
  if (providerId === "qwen") {
    return fields.filter((field) => field !== "baseUrl");
  }
  return fields;
}

export function requiresBuiltinEmbeddingDownload(
  capability: ProviderType,
  providerId: LocalProviderId,
  status: EmbeddingModelInstallStatus | undefined,
): boolean {
  return (
    capability === "embedding" &&
    providerId === "builtin" &&
    status?.state !== "installed"
  );
}

export function LocalApiKeysPage() {
  const t = useT();
  const bridge = useMemo(() => getDesktopBridge(), []);
  const [activeTypeId, setActiveTypeId] = useState<ProviderType>("chat");
  const [selectedProviders, setSelectedProviders] = useState<
    Partial<Record<ProviderType, LocalProviderId>>
  >({});
  const [statuses, setStatuses] = useState<CredentialStatus[]>([]);
  const [credentialStatusesLoaded, setCredentialStatusesLoaded] =
    useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({});
  const [activeModelSettings, setActiveModelSettings] =
    useState<LocalAiModelSettings>();
  const [busyProvider, setBusyProvider] = useState<LocalProviderId>();
  const [busyFeature, setBusyFeature] = useState<OptionalFeatureType>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [vectorStatus, setVectorStatus] = useState<LocalVectorReindexStatus>();
  const [retryingIndex, setRetryingIndex] = useState(false);
  const [builtinModelStatus, setBuiltinModelStatus] =
    useState<EmbeddingModelInstallStatus>();
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [codexAuth, setCodexAuth] = useState<CodexAuthStatus>();
  const [codexCatalog, setCodexCatalog] = useState<CodexModelCatalog>();
  const [codexUsage, setCodexUsage] = useState<CodexUsage>();
  const [codexAuthBusy, setCodexAuthBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const status = await bridge.codexAuth.status();
        if (cancelled) return;
        setCodexAuth(status);
        if (status.pendingLogin && Date.now() < status.pendingLogin.expiresAt) {
          timer = setTimeout(() => void load(), 2_000);
        }
        if (!status.signedIn) return;
        const [catalogResponse, usageResponse] = await Promise.all([
          fetch("/api/local/ai-models/codex-models"),
          fetch("/api/local/ai-models/codex-usage"),
        ]);
        if (cancelled) return;
        if (catalogResponse.ok)
          setCodexCatalog((await catalogResponse.json()) as CodexModelCatalog);
        if (usageResponse.ok)
          setCodexUsage((await usageResponse.json()) as CodexUsage);
      } catch {
        // Codex stays visibly signed out/unavailable when the host is upgrading.
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [bridge, codexAuth?.pendingLogin?.id]);

  async function refreshCodexStatus() {
    try {
      setCodexAuth(await bridge.codexAuth.status());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function startCodexLogin() {
    setCodexAuthBusy(true);
    setError(undefined);
    try {
      const challenge = await bridge.codexAuth.startLogin();
      const status = await bridge.codexAuth.status();
      setCodexAuth({ ...status, pendingLogin: challenge });
      await bridge.external.openHttpsUrl(challenge.verificationUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCodexAuthBusy(false);
    }
  }

  async function cancelCodexLogin() {
    setCodexAuthBusy(true);
    try {
      await bridge.codexAuth.cancelLogin();
      await refreshCodexStatus();
    } finally {
      setCodexAuthBusy(false);
    }
  }

  async function logoutCodex() {
    setCodexAuthBusy(true);
    try {
      await bridge.codexAuth.logout();
      setCodexAuth(undefined);
      setCodexCatalog(undefined);
      setCodexUsage(undefined);
    } finally {
      setCodexAuthBusy(false);
    }
  }

  useEffect(() => {
    void bridge.credentials
      .getStatuses()
      .then((nextStatuses) => {
        setStatuses(nextStatuses);
        setCredentialStatusesLoaded(true);
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      );
  }, [bridge]);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const status = await bridge.embeddingModel.getStatus();
        if (disposed) return;
        setBuiltinModelStatus(status);
        if (status.state === "downloading") {
          timer = setTimeout(() => void load(), 500);
          return;
        }
        if (status.state === "installed") {
          // A packaged renderer moves to a new loopback origin while the
          // sidecar restarts. Synchronize the selection after that handoff.
          const response = await fetch("/api/local/ai-models");
          if (!response.ok || disposed) return;
          const settings = (await response.json()) as LocalAiModelSettings;
          if (disposed || settings.embeddingProvider !== "builtin") return;
          setActiveModelSettings(settings);
          setSelectedProviders((current) => ({
            ...current,
            embedding: "builtin",
          }));
          const embeddingModel = settings.embeddingModel;
          if (embeddingModel) {
            setModelDrafts((current) => ({
              ...current,
              [modelDraftKey("embedding", "builtin")]: embeddingModel,
            }));
          }
        }
      } catch {
        // Remote embedding settings remain usable if model inspection fails.
      }
    };
    void load();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [bridge]);

  useEffect(() => {
    if (!credentialStatusesLoaded) return;
    let cancelled = false;
    void fetch("/api/local/ai-models")
      .then(async (response) => {
        if (!response.ok)
          throw new Error(`Model settings request failed (${response.status})`);
        return response.json() as Promise<LocalAiModelSettings>;
      })
      .then(async (settings) => {
        if (cancelled) return;
        let nextSettings: LocalAiModelSettings = {
          ...settings,
          customChatEndpoints:
            settings.customChatEndpoints ?? emptyCustomChatEndpointsState,
        };
        try {
          const latestStatuses = await bridge.credentials.getStatuses();
          if (cancelled) return;
          const migrated = await migrateLegacyCustomChatEndpoint({
            settings: nextSettings,
            statuses: latestStatuses,
          });
          if (migrated) {
            nextSettings = migrated.settings;
            setStatuses(migrated.statuses);
          } else {
            setStatuses(latestStatuses);
          }
        } catch {
          // Keep the legacy single-slot form usable if migration fails.
        }
        if (cancelled) return;
        setActiveModelSettings(nextSettings);
        setSelectedProviders((current) => ({
          ...current,
          chat: nextSettings.chatProvider,
          ...(nextSettings.embeddingProvider !== "none"
            ? { embedding: nextSettings.embeddingProvider }
            : {}),
          ...(nextSettings.searchProvider !== "none"
            ? { search: nextSettings.searchProvider }
            : {}),
          ...(nextSettings.imageProvider !== "none"
            ? { image: nextSettings.imageProvider }
            : {}),
          ...(nextSettings.audioProvider !== "none"
            ? { audio: nextSettings.audioProvider }
            : {}),
        }));
        setModelDrafts((current) => ({
          ...current,
          [modelDraftKey("chat", nextSettings.chatProvider)]:
            nextSettings.chatModel,
          ...(nextSettings.embeddingProvider !== "none" &&
          nextSettings.embeddingModel
            ? {
                [modelDraftKey("embedding", nextSettings.embeddingProvider)]:
                  nextSettings.embeddingModel,
              }
            : {}),
        }));
        if (nextSettings.customBaseUrl) {
          setDrafts((current) => ({
            ...current,
            "custom.baseUrl": nextSettings.customBaseUrl!,
          }));
        }
        if (nextSettings.customEmbeddingBaseUrl) {
          setDrafts((current) => ({
            ...current,
            "custom_embedding.baseUrl": nextSettings.customEmbeddingBaseUrl!,
          }));
        }
      })
      .catch(() => {
        // Credential management remains usable while the sidecar is restarting.
      });
    return () => {
      cancelled = true;
    };
  }, [bridge, credentialStatusesLoaded]);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const response = await fetch("/api/local/ai-models/embedding-index");
        if (!response.ok) return;
        const next = (await response.json()) as LocalVectorReindexStatus;
        if (disposed) return;
        setVectorStatus(next);
        if (next.status === "queued" || next.status === "building") {
          timer = setTimeout(() => void load(), 2_000);
        }
      } catch {
        // Keep model settings usable while the sidecar is restarting.
      }
    };
    void load();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    activeModelSettings?.embeddingProvider,
    activeModelSettings?.embeddingModel,
    vectorStatus?.jobId,
  ]);

  async function retryEmbeddingIndex() {
    setRetryingIndex(true);
    setError(undefined);
    try {
      const response = await fetch(
        "/api/local/ai-models/embedding-index/retry",
        { method: "POST" },
      );
      if (!response.ok)
        throw new Error(`Search index retry failed (${response.status})`);
      setVectorStatus((await response.json()) as LocalVectorReindexStatus);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRetryingIndex(false);
    }
  }

  const activeType =
    PROVIDER_TYPES.find((type) => type.id === activeTypeId) ??
    PROVIDER_TYPES[0];
  const selectedProvider =
    selectedProviders[activeType.id] ?? firstEnabledProvider(activeType);
  const savedSelection = getActiveLocalModelSelection(
    activeModelSettings,
    activeType.id,
  );
  const currentSelection =
    savedSelection &&
    credentialStatusesLoaded &&
    hasRequiredLocalProviderCredentials(
      activeType.id,
      savedSelection.provider,
      statuses,
    ) &&
    !requiresBuiltinEmbeddingDownload(
      activeType.id,
      savedSelection.provider,
      builtinModelStatus,
    )
    && (savedSelection.provider !== "codex" || codexAuth?.signedIn === true)
      ? savedSelection
      : undefined;
  const codexModelChoices =
    codexCatalog?.models.map((entry) => entry.id) ??
    modelChoices("chat", "codex");
  const codexModelForDraft = codexCatalog?.models.find(
    (entry) =>
      entry.id ===
      (modelDrafts[modelDraftKey("chat", "codex")] ??
        activeModelSettings?.chatModel),
  );
  const codexReasoningEffortForModel = resolveCodexReasoningEffort({
    current: activeModelSettings?.codexReasoningEffort,
    supported: codexModelForDraft?.supportedReasoningEfforts,
    catalogDefault: codexModelForDraft?.defaultReasoningEffort,
    modelId: codexModelForDraft?.id,
  });

  async function saveProviderConfiguration(
    providerId: LocalProviderId,
    fields: readonly string[],
    model: string,
    capability: ProviderType = activeType.id,
  ) {
    const values = Object.fromEntries(
      fields
        .map((field) => [field, drafts[`${providerId}.${field}`]?.trim()])
        .filter((entry): entry is [string, string] => Boolean(entry[1])),
    );
    const modelAware =
      capability === "chat" ||
      capability === "embedding" ||
      capability === "audio";
    if (modelAware && !model.trim()) return;
    setBusyProvider(providerId);
    setError(undefined);
    setNotice(undefined);
    try {
      if (capability === "embedding" && providerId === "builtin") {
        const status = await bridge.embeddingModel.getStatus();
        setBuiltinModelStatus(status);
        if (requiresBuiltinEmbeddingDownload(capability, providerId, status)) {
          setDownloadDialogOpen(true);
          return;
        }
      }
      // Persist the desired route first. Credential mutation restarts the
      // sidecar, so the new process can immediately load the complete choice.
      const response = await fetch("/api/local/ai-models", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          capability === "chat"
            ? {
                capability,
                providerId,
                model: model.trim(),
                ...chatThinkingFromSettings(activeModelSettings),
                ...(providerId === "codex"
                  ? {
                      codexReasoningEffort:
                        codexReasoningEffortForModel,
                    }
                  : {}),
              }
            : modelAware
              ? { capability, providerId, model: model.trim() }
              : { capability, providerId },
        ),
      });
      if (!response.ok)
        throw new Error(`Model settings update failed (${response.status})`);
      const saved = (await response.json()) as LocalAiModelSettings;

      if (Object.keys(values).length) {
        setStatuses(
          await bridge.credentials.mutate({
            action: "set",
            providerId,
            values,
          }),
        );
        setDrafts((current) => {
          const next = { ...current };
          for (const field of Object.keys(values))
            delete next[`${providerId}.${field}`];
          return next;
        });
      }
      setActiveModelSettings({
        ...saved,
        ...(capability === "chat"
          ? {
              chatProvider: providerId as typeof saved.chatProvider,
              chatModel: model.trim(),
            }
          : capability === "embedding"
            ? {
                embeddingProvider: providerId as typeof saved.embeddingProvider,
                embeddingModel: model.trim(),
              }
            : capability === "search"
              ? { searchProvider: providerId as typeof saved.searchProvider }
              : capability === "image"
                ? {
                    imageProvider: providerId as typeof saved.imageProvider,
                    imageModel:
                      modelChoices("image", providerId)[0] ?? saved.imageModel,
                  }
                : {
                    audioProvider: providerId as typeof saved.audioProvider,
                    audioModel: model.trim() || saved.audioModel,
                  }),
      });
      setSelectedProviders((current) => ({
        ...current,
        [capability]: providerId,
      }));
      if (capability === "audio") {
        queryClient.setQueryData<LearningViewSettingsResponse>(
          queryKeys.settings.learningView(LOCAL_OWNER_ID),
          (current) => ({
            mode: current?.mode ?? "chat",
            chatAudioEnabled: true,
          }),
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyProvider(undefined);
    }
  }

  function preferredProviderForType(
    type: ProviderTypeDefinition,
  ): LocalProviderId {
    const selected = selectedProviders[type.id];
    if (selected) return selected;
    const ready = type.providers.find(
      (provider) =>
        provider !== "none" &&
        hasRequiredLocalProviderCredentials(
          type.id,
          provider as LocalProviderId,
          statuses,
        ),
    );
    if (ready) return ready as LocalProviderId;
    return firstEnabledProvider(type);
  }

  async function toggleOptionalFeature(
    capability: OptionalFeatureType,
    enabled: boolean,
  ) {
    const type =
      PROVIDER_TYPES.find((candidate) => candidate.id === capability) ??
      PROVIDER_TYPES[0];
    const providerId = preferredProviderForType(type);
    setBusyFeature(capability);
    setError(undefined);
    setNotice(undefined);
    try {
      if (!enabled) {
        const response = await fetch("/api/local/ai-models", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ capability, providerId: "none" }),
        });
        if (!response.ok) {
          throw new Error(`Model settings update failed (${response.status})`);
        }
        const saved = (await response.json()) as LocalAiModelSettings;
        setActiveModelSettings(saved);
        setSelectedProviders((current) => ({
          ...current,
          [capability]: providerId,
        }));
        if (capability === "audio") {
          queryClient.setQueryData<LearningViewSettingsResponse>(
            queryKeys.settings.learningView(LOCAL_OWNER_ID),
            (current) => ({
              mode: current?.mode ?? "chat",
              chatAudioEnabled: false,
            }),
          );
        }
        return;
      }

      if (
        credentialStatusesLoaded &&
        !hasRequiredLocalProviderCredentials(capability, providerId, statuses)
      ) {
        setActiveTypeId(capability);
        setSelectedProviders((current) => ({
          ...current,
          [capability]: providerId,
        }));
        setNotice(t("desktop.apiKeys.featureNeedsProvider"));
        return;
      }

      const fields = type.credentialFields[providerId] ?? [];
      const model =
        modelDrafts[modelDraftKey(capability, providerId)] ??
        modelChoices(capability, providerId)[0] ??
        "";
      await saveProviderConfiguration(providerId, fields, model, capability);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyFeature(undefined);
    }
  }

  async function remove(providerId: LocalProviderId, fields: string[]) {
    if (!fields.length) return;
    setBusyProvider(providerId);
    setError(undefined);
    setNotice(undefined);
    try {
      const removesActiveAudioProvider =
        activeType.id === "audio" &&
        activeModelSettings?.audioProvider === providerId;
      if (removesActiveAudioProvider) {
        const response = await fetch("/api/local/ai-models", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ capability: "audio", providerId: "none" }),
        });
        if (!response.ok) {
          throw new Error(`Audio settings update failed (${response.status})`);
        }
        const saved = (await response.json()) as LocalAiModelSettings;
        setActiveModelSettings(saved);
        queryClient.setQueryData<LearningViewSettingsResponse>(
          queryKeys.settings.learningView(LOCAL_OWNER_ID),
          (current) => ({
            mode: current?.mode ?? "chat",
            chatAudioEnabled: false,
          }),
        );
      }
      setStatuses(
        await bridge.credentials.mutate({
          action: "delete",
          providerId,
          fields,
        }),
      );
      setNotice(
        t("desktop.apiKeys.removedNotice", {
          provider: providerLabels[providerId] ?? providerId,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyProvider(undefined);
    }
  }

  return (
    <section className="space-y-6" aria-labelledby="local-api-keys-title">
      <div className="flex items-start gap-3">
        <span className="rounded-xl bg-primary/10 p-2.5 text-primary">
          <KeyRound className="size-5" aria-hidden />
        </span>
        <div>
          <h2 id="local-api-keys-title" className="text-xl font-semibold">
            {t("desktop.apiKeys.title")}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {t("desktop.apiKeys.description")}
          </p>
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="rounded-xl bg-[var(--success-soft)] p-3 text-sm text-[var(--success)]"
        >
          {notice}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
        <section aria-labelledby="provider-type-title">
          <h3
            id="provider-type-title"
            className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground"
          >
            {t("desktop.apiKeys.chooseType")}
          </h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-1">
            {PROVIDER_TYPES.map(({ id, labelKey, icon: Icon }) => {
              const active = id === activeType.id;
              const featureEnabled = isOptionalFeatureType(id)
                ? Boolean(getActiveLocalModelSelection(activeModelSettings, id))
                : false;
              return (
                <div
                  key={id}
                  className={cn(
                    "flex items-center gap-2 rounded-xl border px-3 py-3 transition-colors",
                    active
                      ? "border-primary bg-[var(--course-content-surface-accent)] text-primary shadow-[inset_0_0_0_1px_var(--primary)]"
                      : "border-border bg-card text-muted-foreground hover:border-[var(--border-strong)] hover:bg-[var(--surface-elevated)] hover:text-foreground",
                  )}
                >
                  <button
                    type="button"
                    aria-pressed={active}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left text-sm font-medium"
                    onClick={() => setActiveTypeId(id)}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    {t(labelKey)}
                  </button>
                  {isOptionalFeatureType(id) ? (
                    <Switch
                      size="sm"
                      checked={featureEnabled}
                      disabled={busyFeature === id || Boolean(busyProvider)}
                      aria-label={t(
                        id === "image"
                          ? "desktop.apiKeys.toggleImageFeature"
                          : "desktop.apiKeys.toggleAudioFeature",
                      )}
                      onCheckedChange={(enabled) =>
                        void toggleOptionalFeature(id, enabled)
                      }
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>

        <section className="min-w-0" aria-labelledby="provider-list-title">
          <div>
            <h3 id="provider-list-title" className="font-semibold">
              {t("desktop.apiKeys.chooseProvider", {
                type: t(activeType.labelKey),
              })}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("desktop.apiKeys.providerDescription")}
            </p>
          </div>

          {currentSelection ? (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-[color-mix(in_srgb,var(--success)_28%,var(--border))] bg-[var(--success-soft)] px-4 py-3 text-sm">
              <span className="inline-flex items-center gap-1.5 font-medium text-[var(--success)]">
                <CheckCircle2 className="size-4" aria-hidden />
                {t("desktop.apiKeys.currentlyUsing")}
              </span>
              <strong className="text-foreground">
                {currentSelection.provider === "custom" &&
                activeModelSettings?.customChatEndpoints.activeProfileId
                  ? (activeModelSettings.customChatEndpoints.profiles.find(
                      (profile) =>
                        profile.id ===
                        activeModelSettings.customChatEndpoints.activeProfileId,
                    )?.name ?? providerLabels.custom)
                  : (providerLabels[currentSelection.provider] ??
                    currentSelection.provider)}
              </strong>
              {currentSelection.model ? (
                <code className="rounded-md bg-background px-2 py-0.5 text-xs text-foreground">
                  {currentSelection.model}
                </code>
              ) : null}
            </div>
          ) : activeModelSettings && credentialStatusesLoaded ? (
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-[color-mix(in_srgb,var(--warning)_28%,var(--border))] bg-[var(--warning-soft)] px-4 py-3 text-sm font-medium text-[var(--warning)]">
              <LockKeyhole className="size-4 shrink-0" aria-hidden />
              {isOptionalFeatureType(activeType.id) &&
              !getActiveLocalModelSelection(activeModelSettings, activeType.id)
                ? t("desktop.apiKeys.featureOff")
                : t("desktop.apiKeys.currentNotConfigured")}
            </div>
          ) : null}

          {activeType.id === "embedding" && vectorStatus ? (
            <div className="mt-3 rounded-xl border border-border bg-[var(--surface-elevated)] px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-foreground">
                    {t("desktop.runtime.vectorHeading", {
                      status: t(vectorStatusLabelKeys[vectorStatus.status]),
                    })}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {t(vectorStatusDescriptionKeys[vectorStatus.status])}
                  </p>
                </div>
                {vectorStatus.status === "failed" ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 font-medium text-foreground disabled:opacity-50"
                    disabled={retryingIndex}
                    onClick={() => void retryEmbeddingIndex()}
                  >
                    {retryingIndex ? (
                      <LoaderCircle
                        className="size-4 animate-spin"
                        aria-hidden
                      />
                    ) : (
                      <RefreshCcw className="size-4" aria-hidden />
                    )}
                    {t("desktop.runtime.retryIndex")}
                  </button>
                ) : null}
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{
                    width: `${vectorStatus.lexicalChunks === 0 ? 0 : Math.min(100, (vectorStatus.indexedVectors / vectorStatus.lexicalChunks) * 100)}%`,
                  }}
                />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {t("desktop.runtime.vectorProgress", {
                  indexed: vectorStatus.indexedVectors,
                  total: vectorStatus.lexicalChunks,
                })}
              </p>
              {vectorStatus.error ? (
                <p className="mt-2 text-xs text-destructive">
                  {vectorStatus.error}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2" role="list">
            {activeType.providers
              .filter((provider) => provider !== "none")
              .map((providerId) => {
                const provider = providerId as LocalProviderId;
                const active = provider === selectedProvider;
                const inUse = currentSelection?.provider === provider;
                const ready =
                  (provider !== "codex" || codexAuth?.signedIn === true) &&
                  hasRequiredLocalProviderCredentials(
                    activeType.id,
                    provider,
                    statuses,
                  ) &&
                  !requiresBuiltinEmbeddingDownload(
                    activeType.id,
                    provider,
                    builtinModelStatus,
                  );
                return (
                  <button
                    key={provider}
                    type="button"
                    role="listitem"
                    aria-pressed={active}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition-colors",
                      active
                        ? "border-primary bg-[var(--course-content-surface-accent)] font-medium text-primary shadow-[inset_0_0_0_1px_var(--primary)]"
                        : inUse
                          ? "border-[color-mix(in_srgb,var(--success)_36%,var(--border))] bg-[var(--success-soft)] text-foreground"
                          : "border-border bg-card text-foreground hover:border-[var(--border-strong)] hover:bg-[var(--surface-elevated)]",
                    )}
                    onClick={() => {
                      setSelectedProviders((current) => ({
                        ...current,
                        [activeType.id]: provider,
                      }));
                      setModelDrafts((current) => ({
                        ...current,
                        [modelDraftKey(activeType.id, provider)]:
                          current[modelDraftKey(activeType.id, provider)] ??
                          (provider === "codex"
                            ? codexModelChoices[0]
                            : modelChoices(activeType.id, provider)[0]) ??
                          "",
                      }));
                    }}
                  >
                    {ready ? (
                      <CheckCircle2
                        className="size-3.5 text-[var(--success)]"
                        aria-hidden
                      />
                    ) : (
                      <LockKeyhole
                        className="size-3.5 text-muted-foreground"
                        aria-hidden
                      />
                    )}
                    {providerLabels[provider] ?? provider}
                    {inUse ? (
                      <span className="rounded-full bg-[var(--success-100)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--success-700)]">
                        {t("desktop.apiKeys.inUse")}
                      </span>
                    ) : null}
                  </button>
                );
              })}
          </div>

          {activeType.id === "chat" &&
          selectedProvider === "custom" &&
          activeModelSettings ? (
            <div className="mt-4">
              <CustomChatEndpointsPanel
                settings={activeModelSettings}
                statuses={statuses}
                busy={busyProvider === "custom"}
                onSettingsChange={setActiveModelSettings}
                onStatusesChange={setStatuses}
                onBusyChange={(nextBusy) =>
                  setBusyProvider(nextBusy ? "custom" : undefined)
                }
                onError={setError}
                onNotice={setNotice}
              />
            </div>
          ) : (
            <>
              {activeType.id === "chat" && selectedProvider === "codex" ? (
                <CodexAuthPanel
                  auth={codexAuth}
                  catalog={codexCatalog}
                  usage={codexUsage}
                  busy={codexAuthBusy}
                  modelId={
                    modelDrafts[modelDraftKey("chat", "codex")] ??
                    activeModelSettings?.chatModel ??
                    codexModelChoices[0] ??
                    ""
                  }
                  reasoningEffort={codexReasoningEffortForModel}
                  onLogin={() => void startCodexLogin()}
                  onCancel={() => void cancelCodexLogin()}
                  onLogout={() => void logoutCodex()}
                  onRefresh={async () => {
                    const status = await bridge.codexAuth.status();
                    setCodexAuth(status);
                    if (status.signedIn) {
                      const [catalogResponse, usageResponse] = await Promise.all([
                        fetch("/api/local/ai-models/codex-models"),
                        fetch("/api/local/ai-models/codex-usage"),
                      ]);
                      if (catalogResponse.ok)
                        setCodexCatalog(
                          (await catalogResponse.json()) as CodexModelCatalog,
                        );
                      if (usageResponse.ok)
                        setCodexUsage(
                          (await usageResponse.json()) as CodexUsage,
                        );
                    }
                  }}
                  onReasoningEffortChange={(effort) => {
                    setActiveModelSettings((current) =>
                      current ? { ...current, codexReasoningEffort: effort } : current,
                    );
                    const selectedModel =
                      modelDrafts[modelDraftKey("chat", "codex")] ??
                      activeModelSettings?.chatModel ??
                      codexModelChoices[0] ??
                      "";
                    if (!selectedModel) return;
                    void fetch("/api/local/ai-models", {
                      method: "PATCH",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({
                        capability: "chat",
                        providerId: "codex",
                        model: selectedModel,
                        codexReasoningEffort: effort,
                      }),
                    });
                  }}
                />
              ) : null}
            <ProviderCredentialPanel
              key={`${activeType.id}.${selectedProvider}`}
              providerId={selectedProvider}
              fields={activeType.credentialFields[selectedProvider] ?? []}
              capability={activeType.id}
              models={
                selectedProvider === "codex"
                  ? codexModelChoices
                  : modelChoices(activeType.id, selectedProvider)
              }
              model={
                modelDrafts[modelDraftKey(activeType.id, selectedProvider)] ??
                (selectedProvider === "codex"
                  ? codexModelChoices[0]
                  : modelChoices(activeType.id, selectedProvider)[0]) ??
                ""
              }
              activeModel={
                currentSelection?.provider === selectedProvider
                  ? currentSelection?.model
                  : undefined
              }
              isActiveProvider={currentSelection?.provider === selectedProvider}
              statuses={statuses}
              drafts={drafts}
              savedFieldValues={{
                ...(activeModelSettings?.customBaseUrl
                  ? { "custom.baseUrl": activeModelSettings.customBaseUrl }
                  : {}),
                ...(activeModelSettings?.customEmbeddingBaseUrl
                  ? {
                      "custom_embedding.baseUrl":
                        activeModelSettings.customEmbeddingBaseUrl,
                    }
                  : {}),
                ...(activeModelSettings?.qwenBaseUrl
                  ? { "qwen.baseUrl": activeModelSettings.qwenBaseUrl }
                  : {}),
              }}
              busy={busyProvider === selectedProvider}
              thinking={chatThinkingFromSettings(activeModelSettings)}
              codexSignedIn={codexAuth?.signedIn ?? false}
              onThinkingChange={(patch) => {
                setActiveModelSettings((current) =>
                  current ? { ...current, ...patch } : current,
                );
                if (
                  activeType.id !== "chat" ||
                  currentSelection?.provider !== selectedProvider
                ) {
                  return;
                }
                const model =
                  modelDrafts[modelDraftKey("chat", selectedProvider)] ??
                  currentSelection.model ??
                  "";
                if (!model.trim()) return;
                void fetch("/api/local/ai-models", {
                  method: "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    capability: "chat",
                    providerId: selectedProvider,
                    model: model.trim(),
                    ...chatThinkingFromSettings({
                      ...activeModelSettings,
                      ...patch,
                    }),
                  }),
                });
              }}
              onDraftChange={(key, value) =>
                setDrafts((current) => ({ ...current, [key]: value }))
              }
              onModelChange={(value) =>
                setModelDrafts((current) => ({
                  ...current,
                  [modelDraftKey(activeType.id, selectedProvider)]: value,
                }))
              }
              onSaveConfiguration={saveProviderConfiguration}
              onRemove={remove}
            />
            </>
          )}
          {activeType.id === "chat" && activeModelSettings ? (
            <GuidedImageModelSettingsPanel settings={activeModelSettings} catalog={codexCatalog} onSaved={setActiveModelSettings} />
          ) : null}
        </section>
      </div>
      <BuiltinEmbeddingDownloadDialog
        open={downloadDialogOpen}
        status={builtinModelStatus}
        onOpenChange={setDownloadDialogOpen}
        onStatusChange={setBuiltinModelStatus}
        onInstalled={(status) => {
          setBuiltinModelStatus(status);
          setDownloadDialogOpen(false);
          setActiveModelSettings((current) =>
            current
              ? {
                  ...current,
                  embeddingProvider: "builtin",
                  embeddingModel: BUILTIN_EMBEDDING_MODEL_ID,
                }
              : current,
          );
          setVectorStatus(undefined);
          setNotice(t("desktop.embeddingSetup.installedAndUsing"));
        }}
      />
    </section>
  );
}

function CodexAuthPanel({
  auth,
  catalog,
  usage,
  busy,
  modelId,
  reasoningEffort,
  onLogin,
  onCancel,
  onLogout,
  onRefresh,
  onReasoningEffortChange,
}: {
  auth?: CodexAuthStatus;
  catalog?: CodexModelCatalog;
  usage?: CodexUsage;
  busy: boolean;
  modelId: string;
  reasoningEffort: CodexReasoningEffort;
  onLogin(): void;
  onCancel(): void;
  onLogout(): void;
  onRefresh(): void | Promise<void>;
  onReasoningEffortChange(effort: CodexReasoningEffort): void;
}) {
  const t = useT();
  const model = catalog?.models.find((entry) => entry.id === modelId);
  const availableEfforts = codexReasoningEffortsForCatalog(
    model?.supportedReasoningEfforts,
    model?.id,
  );
  return (
    <article className="mt-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-lg font-semibold">
            {t("desktop.apiKeys.codex.label")}
          </h4>
          <p className="mt-1 text-sm text-muted-foreground">
            {auth?.signedIn
              ? t("desktop.apiKeys.codex.signedIn")
              : t("desktop.apiKeys.codex.notSignedIn")}
          </p>
          {auth?.accountId ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("desktop.apiKeys.codex.account", { account: auth.accountId })}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {auth?.signedIn ? (
            <>
              <button
                type="button"
                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground disabled:opacity-50"
                disabled={busy}
                onClick={onLogin}
              >
                {t("desktop.apiKeys.codex.relogin")}
              </button>
              <button
                type="button"
                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-destructive disabled:opacity-50"
                disabled={busy}
                onClick={onLogout}
              >
                {t("desktop.apiKeys.codex.signOut")}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
              disabled={busy}
              onClick={onLogin}
            >
              {t("desktop.apiKeys.codex.signIn")}
            </button>
          )}
        </div>
      </div>
      {auth?.pendingLogin ? (
        <div className="mt-3 rounded-xl border border-primary/30 bg-primary/5 px-3 py-3 text-sm">
          <p className="font-medium text-foreground">
            {t("desktop.apiKeys.codex.pending", {
              code: auth.pendingLogin.userCode,
            })}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground"
              onClick={() => void getDesktopBridge().external.openHttpsUrl(auth.pendingLogin!.verificationUrl)}
            >
              {t("desktop.apiKeys.codex.openAuth")}
            </button>
            <button
              type="button"
              className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground disabled:opacity-50"
              disabled={busy}
              onClick={onCancel}
            >
              {t("desktop.apiKeys.codex.cancel")}
            </button>
          </div>
        </div>
      ) : null}
      {auth?.signedIn ? (
        <>
          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-3 py-3">
            <div>
              <p className="text-sm font-medium text-foreground">
                {t("desktop.apiKeys.thinking")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("desktop.apiKeys.codex.reasoningHint")}
              </p>
            </div>
            <select
              className="native-select max-w-[9rem] rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              value={availableEfforts.includes(reasoningEffort) ? reasoningEffort : availableEfforts[0] ?? "medium"}
              onChange={(event) =>
                onReasoningEffortChange(event.target.value as CodexReasoningEffort)
              }
            >
              {availableEfforts.map((effort) => (
                <option key={effort} value={effort}>
                  {effort === "none"
                    ? t("desktop.apiKeys.thinkingOff")
                    : effort}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-3 rounded-xl border border-border bg-muted/40 px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-foreground">
                {t("desktop.apiKeys.codex.usageTitle")}
              </p>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground"
                onClick={() => void onRefresh()}
              >
                <RefreshCcw className="size-3.5" aria-hidden />
                {t("desktop.apiKeys.tavilyUsage.refresh")}
              </button>
            </div>
            {usage?.available ? (
              <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                {usage.plan ? (
                  <p>{t("desktop.apiKeys.codex.plan", { plan: usage.plan })}</p>
                ) : null}
                {usage.windows.map((window) => (
                  <p key={window.label}>
                    {t("desktop.apiKeys.codex.usageWindow", {
                      label: window.label,
                      percent: String(Math.round(window.usedPercent)),
                      reset: window.resetAt
                        ? new Date(window.resetAt).toLocaleString()
                        : "—",
                    })}
                  </p>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("desktop.apiKeys.codex.usageUnavailable")}
              </p>
            )}
          </div>
          {catalog?.stale ? (
            <p className="mt-2 text-xs text-warning">
              {t("desktop.apiKeys.codex.catalogStale")}
            </p>
          ) : null}
        </>
      ) : null}
      {auth?.signedIn && catalog && !catalog.available ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("desktop.apiKeys.codex.catalogUnavailable")}
        </p>
      ) : null}
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        {t("desktop.apiKeys.codex.quotaNotice")}
      </p>
    </article>
  );
}

function ChatThinkingControls({
  control,
  model,
  thinking,
  disabled,
  onChange,
}: {
  control: Exclude<LocalChatThinkingControl, { kind: "none" }>;
  model: string;
  thinking: LocalChatThinkingSettings;
  disabled: boolean;
  onChange?(patch: Partial<LocalChatThinkingSettings>): void;
}) {
  const t = useT();
  if (control.kind === "custom") {
    return (
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
            value={thinking.customThinkingProtocol}
            disabled={disabled}
            aria-label={t("desktop.apiKeys.thinkingProtocol")}
            onChange={(event) =>
              onChange?.({
                customThinkingProtocol: event.target
                  .value as (typeof customThinkingProtocols)[number],
              })
            }
          >
            {customThinkingProtocols.map((protocol) => (
              <option key={protocol} value={protocol}>
                {t(thinkingProtocolLabelKeys[protocol])}
              </option>
            ))}
          </select>
        </div>
        {control.inner.kind !== "none" ? (
          <div className="mt-3 border-t border-border/70 pt-3">
            <VendorThinkingControls
              control={control.inner}
              model={model}
              thinking={thinking}
              disabled={disabled}
              onChange={onChange}
            />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-border bg-muted/40 px-3 py-3">
      <VendorThinkingControls
        control={control}
        model={model}
        thinking={thinking}
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  );
}

function VendorThinkingControls({
  control,
  model,
  thinking,
  disabled,
  onChange,
}: {
  control: Exclude<LocalChatThinkingControl, { kind: "none" | "custom" }>;
  model: string;
  thinking: LocalChatThinkingSettings;
  disabled: boolean;
  onChange?(patch: Partial<LocalChatThinkingSettings>): void;
}) {
  const t = useT();
  const switchHint =
    control.kind === "switch" && control.field === "minimaxThinkingEnabled"
      ? control.configurable
        ? `${t("settings.llm.minimaxThinkingPrefix")} thinking.type=disabled${
            control.customEndpoint
              ? t("settings.llm.customThinkingSuffix")
              : t("settings.llm.minimaxThinkingSuffix")
          }`
        : t("settings.llm.minimaxThinkingUnsupported", { model })
      : control.kind === "switch" && control.field === "deepseekThinkingEnabled"
        ? `${t("settings.llm.deepseekThinkingPrefix")} thinking.type=disabled ${t("settings.llm.deepseekThinkingSuffix")}`
        : control.kind === "switch" && control.field === "openaiThinkingEnabled"
          ? `${t("settings.llm.openaiThinkingPrefix")} reasoning.effort=none${
              control.customEndpoint
                ? t("settings.llm.customThinkingSuffix")
                : t("settings.llm.openaiThinkingSuffix")
            }`
          : control.kind === "switch" &&
              control.field === "bigmodelThinkingEnabled"
            ? `${t("settings.llm.bigmodelThinkingPrefix")} reasoning_effort=low${
                control.customEndpoint
                  ? t("settings.llm.customThinkingSuffix")
                  : t("settings.llm.bigmodelThinkingSuffix")
              }`
            : control.kind === "switch" &&
                control.field === "qwenThinkingEnabled"
              ? `${t("settings.llm.qwenThinkingPrefix")} enable_thinking=false${
                  control.customEndpoint
                    ? t("settings.llm.customThinkingSuffix")
                    : t("settings.llm.qwenThinkingSuffix")
                }`
            : control.kind === "switch"
              ? `${t("settings.llm.ollamaThinkingPrefix")} think ${t("settings.llm.ollamaThinkingSuffix")}`
              : control.configurable
                ? `${t("settings.llm.doubaoThinkingPrefix")} thinking.type ${
                    control.customEndpoint
                      ? t("settings.llm.customThinkingSuffix")
                      : t("settings.llm.doubaoThinkingSuffix")
                  }`
                : t("settings.llm.doubaoThinkingUnsupported", { model });
  const ariaLabel =
    control.kind === "switch" && control.field === "minimaxThinkingEnabled"
      ? t("settings.llm.minimaxThinkingAria")
      : control.kind === "switch" && control.field === "deepseekThinkingEnabled"
        ? t("settings.llm.deepseekThinkingAria")
        : control.kind === "switch" && control.field === "openaiThinkingEnabled"
          ? t("settings.llm.openaiThinkingAria")
          : control.kind === "switch" &&
              control.field === "bigmodelThinkingEnabled"
            ? t("settings.llm.bigmodelThinkingAria")
            : control.kind === "switch" &&
                control.field === "qwenThinkingEnabled"
              ? t("settings.llm.qwenThinkingAria")
            : control.kind === "switch"
              ? t("settings.llm.ollamaThinkingAria")
              : t("settings.llm.doubaoThinkingAria");

  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-sm font-medium text-foreground">
          {t("desktop.apiKeys.thinking")}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {switchHint}
        </p>
      </div>
      {control.kind === "switch" ? (
        <Switch
          checked={thinking[control.field]}
          disabled={disabled || !control.configurable}
          aria-label={ariaLabel}
          onCheckedChange={(enabled) =>
            onChange?.({ [control.field]: enabled })
          }
        />
      ) : (
        <select
          className="native-select max-w-[9rem] shrink-0 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none transition-colors focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/25 disabled:opacity-50"
          value={thinking.doubaoThinkingMode}
          disabled={disabled || !control.configurable}
          aria-label={ariaLabel}
          onChange={(event) =>
            onChange?.({
              doubaoThinkingMode: event.target.value as
                "enabled" | "disabled" | "auto",
            })
          }
        >
          <option value="enabled">{t("desktop.apiKeys.thinkingOn")}</option>
          <option value="disabled">{t("desktop.apiKeys.thinkingOff")}</option>
          <option value="auto">{t("desktop.apiKeys.thinkingAuto")}</option>
        </select>
      )}
    </div>
  );
}

export function TavilyUsageCard({
  credentialsReady,
  usage,
}: {
  credentialsReady: boolean;
  usage?: TavilyUsage;
}) {
  const t = useT();
  const [loaded, setLoaded] = useState<TavilyUsage | undefined>(usage);
  const [loading, setLoading] = useState(false);

  async function loadUsage() {
    setLoading(true);
    try {
      const response = await fetch("/api/local/ai-models/tavily-usage");
      if (!response.ok) throw new Error("usage request failed");
      setLoaded((await response.json()) as TavilyUsage);
    } catch {
      setLoaded({
        available: false,
        code: "unreachable",
        message: "Tavily usage could not be reached.",
        checkedAt: Date.now(),
        plan: null,
        planUsage: null,
        planLimit: null,
        paygoUsage: null,
        paygoLimit: null,
        keyUsage: null,
        keyLimit: null,
        searchUsage: null,
        extractUsage: null,
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (usage) {
      setLoaded(usage);
      return;
    }
    if (!credentialsReady) {
      setLoaded(undefined);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetch("/api/local/ai-models/tavily-usage")
      .then(async (response) => {
        if (!response.ok) throw new Error("usage request failed");
        return (await response.json()) as TavilyUsage;
      })
      .then((next) => {
        if (!cancelled) setLoaded(next);
      })
      .catch(() => {
        if (!cancelled) {
          setLoaded({
            available: false,
            code: "unreachable",
            message: "Tavily usage could not be reached.",
            checkedAt: Date.now(),
            plan: null,
            planUsage: null,
            planLimit: null,
            paygoUsage: null,
            paygoLimit: null,
            keyUsage: null,
            keyLimit: null,
            searchUsage: null,
            extractUsage: null,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [credentialsReady, usage]);

  const used = loaded?.planUsage ?? loaded?.keyUsage;
  const limit = loaded?.planLimit ?? loaded?.keyLimit;
  const remaining =
    used != null && limit != null ? Math.max(0, limit - used) : null;
  const percent =
    used != null && limit != null && limit > 0
      ? Math.min(100, (used / limit) * 100)
      : 0;

  return (
    <div className="mt-4 rounded-xl border border-border bg-muted/40 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">
            {t("desktop.apiKeys.tavilyUsage.title")}
          </p>
          {!credentialsReady ? (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t("desktop.apiKeys.tavilyUsage.needKey")}
            </p>
          ) : loading && !loaded ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("desktop.apiKeys.tavilyUsage.loading")}
            </p>
          ) : loaded?.available ? (
            <div className="mt-1 space-y-1 text-xs leading-relaxed text-muted-foreground">
              {loaded.plan ? (
                <p>
                  {t("desktop.apiKeys.tavilyUsage.plan", { plan: loaded.plan })}
                </p>
              ) : null}
              {used != null && limit != null ? (
                <p>
                  {t("desktop.apiKeys.tavilyUsage.usedOfLimit", {
                    used: String(used),
                    limit: String(limit),
                  })}
                  {remaining != null
                    ? ` · ${t("desktop.apiKeys.tavilyUsage.remaining", {
                        remaining: String(remaining),
                      })}`
                    : ""}
                </p>
              ) : used != null ? (
                <p>
                  {t("desktop.apiKeys.tavilyUsage.usedUnlimited", {
                    used: String(used),
                  })}
                </p>
              ) : null}
              {loaded.searchUsage != null || loaded.extractUsage != null ? (
                <p>
                  {t("desktop.apiKeys.tavilyUsage.searchExtract", {
                    search: String(loaded.searchUsage ?? 0),
                    extract: String(loaded.extractUsage ?? 0),
                  })}
                </p>
              ) : null}
              {(loaded.paygoUsage ?? 0) > 0 || (loaded.paygoLimit ?? 0) > 0 ? (
                <p>
                  {t("desktop.apiKeys.tavilyUsage.paygo", {
                    used: String(loaded.paygoUsage ?? 0),
                    limit: String(loaded.paygoLimit ?? 0),
                  })}
                </p>
              ) : null}
            </div>
          ) : loaded && loaded.code !== "ok" ? (
            <p className="mt-1 text-xs leading-relaxed text-destructive">
              {t(tavilyUsageFailureKeys[loaded.code])}
            </p>
          ) : null}
        </div>
        {credentialsReady ? (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground disabled:opacity-50"
            disabled={loading}
            onClick={() => void loadUsage()}
          >
            {loading ? (
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <RefreshCcw className="size-3.5" aria-hidden />
            )}
            {t("desktop.apiKeys.tavilyUsage.refresh")}
          </button>
        ) : null}
      </div>
      {loaded?.available && limit != null && limit > 0 ? (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${percent}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

export function ProviderCredentialPanel({
  providerId,
  capability,
  models,
  model,
  activeModel,
  isActiveProvider,
  fields,
  statuses,
  drafts,
  savedFieldValues = {},
  busy,
  codexSignedIn = true,
  thinking,
  onThinkingChange,
  onDraftChange,
  onModelChange,
  onSaveConfiguration,
  onRemove,
}: {
  providerId: LocalProviderId;
  capability: ProviderType;
  models: readonly string[];
  model: string;
  activeModel?: string;
  isActiveProvider: boolean;
  fields: readonly string[];
  statuses: CredentialStatus[];
  drafts: Record<string, string>;
  savedFieldValues?: Record<string, string>;
  busy: boolean;
  codexSignedIn?: boolean;
  thinking?: LocalChatThinkingSettings;
  onThinkingChange?(patch: Partial<LocalChatThinkingSettings>): void;
  onDraftChange(key: string, value: string): void;
  onModelChange(value: string): void;
  onSaveConfiguration(
    providerId: LocalProviderId,
    fields: readonly string[],
    model: string,
  ): Promise<void>;
  onRemove(providerId: LocalProviderId, fields: string[]): Promise<void>;
}) {
  const t = useT();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    LocalProviderConnectionResult | LocalCapabilityConnectionResult
  >();
  const configured =
    statuses.find((item) => item.providerId === providerId)?.configuredFields ??
    [];
  const configuredForType = fields.filter((field) =>
    configured.includes(field),
  );
  const requiredFields = requiredCredentialFields(providerId, fields);
  const hasDraft = fields.some((field) => {
    const key = `${providerId}.${field}`;
    const value = drafts[key]?.trim();
    return Boolean(value && value !== savedFieldValues[key]);
  });
  const configurationReady = requiredFields.every(
    (field) =>
      configured.includes(field) ||
      Boolean(drafts[`${providerId}.${field}`]?.trim()),
  );
  const authenticationReady = providerId !== "codex" || codexSignedIn;
  const supportsModelSelection =
    capability === "chat" ||
    capability === "embedding" ||
    capability === "audio";
  const thinkingControl =
    capability === "chat"
      ? localChatThinkingControl(
          providerId,
          model,
          thinking?.customThinkingProtocol ?? "none",
        )
      : { kind: "none" as const };
  const selectionIsActive =
    isActiveProvider &&
    (!supportsModelSelection || activeModel === model.trim());
  const savedConfigurationReady = requiredFields.every((field) =>
    configured.includes(field),
  );

  async function testConfiguration() {
    setTesting(true);
    setTestResult(undefined);
    try {
      const response = await fetch(
        capability === "chat"
          ? "/api/local/ai-models/test-chat"
          : "/api/local/ai-models/test",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            capability === "chat"
              ? { providerId, model: model.trim() }
              : {
                  capability,
                  providerId,
                  ...(model.trim() ? { model: model.trim() } : {}),
                },
          ),
        },
      );
      if (!response.ok)
        throw new Error(`Connection test failed (${response.status})`);
      setTestResult(
        (await response.json()) as
          LocalProviderConnectionResult | LocalCapabilityConnectionResult,
      );
    } catch {
      setTestResult({
        ...(capability === "chat" ? {} : { capability }),
        providerId: providerId as LocalProviderConnectionResult["providerId"],
        model: model.trim() || null,
        healthy: false,
        checkedAt: Date.now(),
        latencyMs: 0,
        code: "unreachable",
        message: "Connection test request failed.",
      } as LocalProviderConnectionResult | LocalCapabilityConnectionResult);
    } finally {
      setTesting(false);
    }
  }

  return (
    <article className="mt-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-lg font-semibold">
            {providerLabels[providerId] ?? providerId}
          </h4>
          <p className="mt-1 text-sm text-muted-foreground">
            {providerId === "codex" && !codexSignedIn
              ? t("desktop.apiKeys.codex.notSignedIn")
              : isActiveProvider
                ? t("desktop.apiKeys.activeProviderDescription", {
                    model: activeModel ?? model,
                  })
                : fields.length === 0
                  ? t("desktop.apiKeys.noKeyRequiredDescription")
                  : configuredForType.length === fields.length
                    ? t("desktop.apiKeys.configuredNotActive")
                    : t("desktop.apiKeys.keyRequired")}
          </p>
          {providerId === "builtin" ? (
            <p className="mt-1 text-xs font-medium text-[var(--success)]">
              {t("desktop.apiKeys.noKeyRequired")}
            </p>
          ) : null}
        </div>
        {isActiveProvider ? (
          <CheckCircle2
            className="size-5 text-[var(--success)]"
            aria-label={t("desktop.apiKeys.inUse")}
          />
        ) : fields.length === 0 ||
          configuredForType.length === fields.length ? (
          <KeyRound className="size-5 text-muted-foreground" aria-hidden />
        ) : (
          <LockKeyhole className="size-5 text-muted-foreground" aria-hidden />
        )}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {supportsModelSelection ? (
          <label className="text-sm text-muted-foreground">
            <span className="mb-1.5 block font-medium text-foreground">
              {t("desktop.apiKeys.modelName")}
            </span>
            {providerId === "builtin" ? (
              <input
                className="w-full rounded-lg border border-border bg-muted px-3 py-2 font-mono text-xs text-foreground"
                value={model}
                readOnly
                aria-readonly="true"
              />
            ) : providerId === "custom" || models.length === 0 ? (
              <input
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none transition-colors focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/25"
                value={model}
                placeholder={t("desktop.apiKeys.modelNamePlaceholder")}
                onChange={(event) => {
                  setTestResult(undefined);
                  const nextModel = event.target.value;
                  onModelChange(nextModel);
                  if (
                    providerId === "custom" &&
                    thinking?.customThinkingProtocol === "none"
                  ) {
                    const inferred = inferCustomThinkingProtocol(
                      nextModel,
                      drafts[`${providerId}.baseUrl`] ??
                        savedFieldValues[`${providerId}.baseUrl`],
                    );
                    if (inferred !== "none") {
                      onThinkingChange?.({ customThinkingProtocol: inferred });
                    }
                  }
                }}
              />
            ) : (
              <select
                className="native-select w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none transition-colors focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/25"
                value={model}
                onChange={(event) => {
                  setTestResult(undefined);
                  onModelChange(event.target.value);
                }}
              >
                {models.map((modelName) => (
                  <option key={modelName} value={modelName}>
                    {capability === "audio"
                      ? localAudioModelLabel(modelName)
                      : modelName}
                  </option>
                ))}
              </select>
            )}
          </label>
        ) : null}
        {fields.map((field) => {
          const saved = configured.includes(field);
          const key = `${providerId}.${field}`;
          return (
            <label key={field} className="text-sm text-muted-foreground">
              <span className="mb-1.5 flex items-center justify-between gap-2">
                <span>
                  {t(fieldKeys[field] ?? "desktop.apiKeys.field.apiKey")}
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
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none transition-colors focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/25"
                placeholder={
                  field === "baseUrl"
                    ? (LOCAL_PROVIDER_DEFAULT_URLS[providerId] ??
                      "https://api.example.com/v1")
                    : saved
                      ? t("desktop.apiKeys.placeholderReplace")
                      : t("desktop.apiKeys.placeholderNew")
                }
                value={drafts[key] ?? ""}
                onChange={(event) => {
                  setTestResult(undefined);
                  onDraftChange(key, event.target.value);
                  if (
                    providerId === "custom" &&
                    field === "baseUrl" &&
                    thinking?.customThinkingProtocol === "none"
                  ) {
                    const inferred = inferCustomThinkingProtocol(
                      model,
                      event.target.value,
                    );
                    if (inferred !== "none") {
                      onThinkingChange?.({ customThinkingProtocol: inferred });
                    }
                  }
                }}
              />
            </label>
          );
        })}
      </div>
      {capability === "chat" && providerId === "custom" ? (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {t("desktop.apiKeys.commonModelHint")}
        </p>
      ) : null}
      {thinking && thinkingControl.kind !== "none" ? (
        <ChatThinkingControls
          control={thinkingControl}
          model={model}
          thinking={thinking}
          disabled={busy}
          onChange={onThinkingChange}
        />
      ) : null}
      {providerId === "tavily" ? (
        <TavilyUsageCard credentialsReady={savedConfigurationReady} />
      ) : null}

      <div className={cn("mt-4 grid gap-2", "sm:grid-cols-2")}>
        <button
          type="button"
          className={cn(
            "w-full rounded-xl px-4 py-3 text-sm font-semibold transition-colors",
            selectionIsActive && !hasDraft
              ? "border border-primary/30 bg-primary/10 text-primary"
              : "bg-primary text-primary-foreground hover:bg-[var(--primary-hover)] disabled:opacity-50",
          )}
          disabled={
            busy ||
            testing ||
            !configurationReady ||
            !authenticationReady ||
            (supportsModelSelection && !model.trim()) ||
            (selectionIsActive && !hasDraft)
          }
          onClick={() => void onSaveConfiguration(providerId, fields, model)}
        >
          {busy
            ? t("common.saving")
            : selectionIsActive && !hasDraft
              ? t("desktop.apiKeys.currentConfigurationButton")
              : t("desktop.apiKeys.saveAndUse")}
        </button>

        <button
          type="button"
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-elevated)] disabled:opacity-50"
          disabled={
            busy ||
            testing ||
            hasDraft ||
            !savedConfigurationReady ||
            !authenticationReady ||
            (supportsModelSelection && !model.trim()) ||
            (capability === "search" && !isActiveProvider)
          }
          title={
            hasDraft
              ? t("desktop.apiKeys.testSaveFirst")
              : capability === "search" && !isActiveProvider
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

      <p className="mt-2 text-xs text-muted-foreground">
        {t("desktop.apiKeys.testUsageHint")}
      </p>

      {testResult ? (
        <p
          role="status"
          className={cn(
            "mt-3 rounded-lg px-3 py-2 text-sm",
            testResult.healthy
              ? "bg-[var(--success-soft)] text-[var(--success)]"
              : "bg-destructive/10 text-destructive",
          )}
        >
          {testResult.healthy
            ? t("desktop.apiKeys.testSucceeded", {
                latency: testResult.latencyMs,
              })
            : t(
                `desktop.apiKeys.testFailed.${testResult.code}` as TranslationKey,
              )}
          {!testResult.healthy && testResult.message ? (
            <span className="mt-1 block font-mono text-[11px] leading-relaxed opacity-90">
              {testResult.message}
            </span>
          ) : null}
        </p>
      ) : null}

      {configuredForType.length ? (
        <button
          type="button"
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-40"
          disabled={busy}
          onClick={() => void onRemove(providerId, configuredForType)}
        >
          <Trash2 className="size-3.5" aria-hidden />
          {t("desktop.apiKeys.remove")}
        </button>
      ) : null}
    </article>
  );
}
