import { getRuntimeEnvironment } from "../env.js";
import {
  type EmbeddingProviderId,
  type LlmProviderId,
  embeddingProviderIds,
  HOSTED_LLM_PROVIDER,
  isActiveLlmProvider,
} from "../env.js";
import {
  getCurrentUserId,
  resolveUserId,
} from "../user-context.js";
import {
  FIXED_EMBEDDING_PROVIDER,
  defaultEmbeddingModel,
  defaultEmbeddingProvider,
  defaultLlmChatModel,
} from "../providers/llm/defaults.js";
import { resolveDeepseekChatModel } from "../providers/llm/vendors/deepseek/options.js";
import { resetLlmProviderCache } from "../providers/llm/resolve.js";
import {
  getUserSettingsForUser,
  upsertUserSettingsForUser,
} from "../user-settings.js";

export type LlmModelOverrides = {
  chatModel?: string;
  embeddingModel?: string;
  embeddingProvider?: EmbeddingProviderId;
  minimaxThinkingEnabled?: boolean;
  ollamaThinkingEnabled?: boolean;
  deepseekThinkingEnabled?: boolean;
  openaiThinkingEnabled?: boolean;
  codexReasoningEffort?:
    "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  bigmodelThinkingEnabled?: boolean;
  qwenThinkingEnabled?: boolean;
  doubaoThinkingMode?: "enabled" | "disabled" | "auto";
  customThinkingProtocol?:
    | "none"
    | "openai"
    | "minimax"
    | "deepseek"
    | "doubao"
    | "bigmodel"
    | "qwen"
    | "ollama";
};

export type LlmRuntimeConfig = {
  provider: LlmProviderId;
  chatModel: string;
  embeddingModel: string;
  embeddingProvider: EmbeddingProviderId;
  minimaxThinkingEnabled: boolean;
  ollamaThinkingEnabled: boolean;
  deepseekThinkingEnabled: boolean;
  openaiThinkingEnabled: boolean;
  codexReasoningEffort:
    "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  bigmodelThinkingEnabled: boolean;
  qwenThinkingEnabled: boolean;
  doubaoThinkingMode: "enabled" | "disabled" | "auto";
  customThinkingProtocol:
    | "none"
    | "openai"
    | "minimax"
    | "deepseek"
    | "doubao"
    | "bigmodel"
    | "qwen"
    | "ollama";
};

const DEFAULT_LLM_PROVIDER: LlmProviderId = HOSTED_LLM_PROVIDER;
/** Hosted thinking stays off. Desktop-local honors saved learner toggles. */
const DEFAULT_MINIMAX_THINKING = false;
const DEFAULT_OLLAMA_THINKING = false;
const DEFAULT_DEEPSEEK_THINKING = false;
const DEFAULT_OPENAI_THINKING = false;
const DEFAULT_CODEX_REASONING_EFFORT = "medium" as const;
const DEFAULT_BIGMODEL_THINKING = false;
const DEFAULT_QWEN_THINKING = false;
const DEFAULT_DOUBAO_THINKING_MODE = "disabled" as const;
const DEFAULT_CUSTOM_THINKING_PROTOCOL = "none" as const;

type LlmRuntimeCacheEntry = {
  config: LlmRuntimeConfig;
  /** `userSettings.updatedAt` ms, or null when the user has no settings row. */
  settingsUpdatedAt: number | null;
};

const cache = new Map<string, LlmRuntimeCacheEntry>();
const loadPromises = new Map<string, Promise<LlmRuntimeConfig>>();

function fixedEmbeddingConfig(): Pick<
  LlmRuntimeConfig,
  "embeddingProvider" | "embeddingModel"
> {
  const embeddingProvider = defaultEmbeddingProvider();
  return {
    embeddingProvider,
    embeddingModel: defaultEmbeddingModel(embeddingProvider),
  };
}

function desktopEmbeddingConfig(
  row: {
    embeddingModel: string | null;
    embeddingProvider: string | null;
  } | null,
): Pick<LlmRuntimeConfig, "embeddingProvider" | "embeddingModel"> {
  const storedProvider = row?.embeddingProvider?.trim();
  const embeddingProvider =
    storedProvider &&
    embeddingProviderIds.includes(storedProvider as EmbeddingProviderId)
      ? (storedProvider as EmbeddingProviderId)
      : defaultEmbeddingProvider();
  return {
    embeddingProvider,
    embeddingModel:
      row?.embeddingModel?.trim() || defaultEmbeddingModel(embeddingProvider),
  };
}

function defaultConfig(): LlmRuntimeConfig {
  const provider = DEFAULT_LLM_PROVIDER;
  return {
    provider,
    chatModel: defaultLlmChatModel(provider),
    ...fixedEmbeddingConfig(),
    minimaxThinkingEnabled: DEFAULT_MINIMAX_THINKING,
    ollamaThinkingEnabled: DEFAULT_OLLAMA_THINKING,
    deepseekThinkingEnabled: DEFAULT_DEEPSEEK_THINKING,
    openaiThinkingEnabled: DEFAULT_OPENAI_THINKING,
    codexReasoningEffort: DEFAULT_CODEX_REASONING_EFFORT,
    bigmodelThinkingEnabled: DEFAULT_BIGMODEL_THINKING,
    qwenThinkingEnabled: DEFAULT_QWEN_THINKING,
    doubaoThinkingMode: DEFAULT_DOUBAO_THINKING_MODE,
    customThinkingProtocol: DEFAULT_CUSTOM_THINKING_PROTOCOL,
  };
}

function storedCodexReasoningEffort(
  value: unknown,
): LlmRuntimeConfig["codexReasoningEffort"] {
  return value === "none" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max"
    ? value
    : DEFAULT_CODEX_REASONING_EFFORT;
}

function codexReasoningEffortFromPreferences(
  raw: string | null | undefined,
): LlmRuntimeConfig["codexReasoningEffort"] {
  if (!raw?.trim()) return DEFAULT_CODEX_REASONING_EFFORT;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      return storedCodexReasoningEffort(
        (parsed as Record<string, unknown>).codexReasoningEffort,
      );
    }
  } catch {
    // Invalid client preferences are treated as defaults.
  }
  return DEFAULT_CODEX_REASONING_EFFORT;
}

function isDesktopLocalRuntime(): boolean {
  return getRuntimeEnvironment().XUELEARN_DESKTOP_LOCAL === "1";
}

function storedDoubaoThinkingMode(
  value: string | null | undefined,
): LlmRuntimeConfig["doubaoThinkingMode"] {
  if (value === "enabled" || value === "disabled" || value === "auto") {
    return value;
  }
  return DEFAULT_DOUBAO_THINKING_MODE;
}

function storedCustomThinkingProtocol(
  value: string | null | undefined,
): LlmRuntimeConfig["customThinkingProtocol"] {
  if (
    value === "none" ||
    value === "openai" ||
    value === "minimax" ||
    value === "deepseek" ||
    value === "doubao" ||
    value === "bigmodel" ||
    value === "qwen" ||
    value === "ollama"
  ) {
    return value;
  }
  return DEFAULT_CUSTOM_THINKING_PROTOCOL;
}

function thinkingFromRow(
  row: {
    minimaxThinkingEnabled: boolean | null;
    ollamaThinkingEnabled: boolean | null;
    deepseekThinkingEnabled: boolean | null;
    openaiThinkingEnabled: boolean | null;
    bigmodelThinkingEnabled: boolean | null;
    qwenThinkingEnabled: boolean | null;
    doubaoThinkingMode: string | null;
    customThinkingProtocol: string | null;
    clientPreferencesJson?: string | null;
  } | null,
): Pick<
  LlmRuntimeConfig,
  | "minimaxThinkingEnabled"
  | "ollamaThinkingEnabled"
  | "deepseekThinkingEnabled"
  | "openaiThinkingEnabled"
  | "codexReasoningEffort"
  | "bigmodelThinkingEnabled"
  | "qwenThinkingEnabled"
  | "doubaoThinkingMode"
  | "customThinkingProtocol"
> {
  const base = defaultConfig();
  if (!isDesktopLocalRuntime()) {
    return {
      minimaxThinkingEnabled: base.minimaxThinkingEnabled,
      ollamaThinkingEnabled: base.ollamaThinkingEnabled,
      deepseekThinkingEnabled: base.deepseekThinkingEnabled,
      openaiThinkingEnabled: base.openaiThinkingEnabled,
      codexReasoningEffort: base.codexReasoningEffort,
      bigmodelThinkingEnabled: base.bigmodelThinkingEnabled,
      qwenThinkingEnabled: base.qwenThinkingEnabled,
      doubaoThinkingMode: base.doubaoThinkingMode,
      customThinkingProtocol: base.customThinkingProtocol,
    };
  }
  return {
    minimaxThinkingEnabled:
      row?.minimaxThinkingEnabled ?? base.minimaxThinkingEnabled,
    ollamaThinkingEnabled:
      row?.ollamaThinkingEnabled ?? base.ollamaThinkingEnabled,
    deepseekThinkingEnabled:
      row?.deepseekThinkingEnabled ?? base.deepseekThinkingEnabled,
    openaiThinkingEnabled:
      row?.openaiThinkingEnabled ?? base.openaiThinkingEnabled,
    codexReasoningEffort: codexReasoningEffortFromPreferences(
      row?.clientPreferencesJson,
    ),
    bigmodelThinkingEnabled:
      row?.bigmodelThinkingEnabled ?? base.bigmodelThinkingEnabled,
    qwenThinkingEnabled: row?.qwenThinkingEnabled ?? base.qwenThinkingEnabled,
    doubaoThinkingMode: storedDoubaoThinkingMode(row?.doubaoThinkingMode),
    customThinkingProtocol: storedCustomThinkingProtocol(
      row?.customThinkingProtocol,
    ),
  };
}

export function mergeLlmRuntimeConfigRow(
  row: {
    llmProvider: string | null;
    chatModel: string | null;
    embeddingModel: string | null;
    embeddingProvider: string | null;
    minimaxThinkingEnabled: boolean | null;
    ollamaThinkingEnabled: boolean | null;
    deepseekThinkingEnabled: boolean | null;
    openaiThinkingEnabled: boolean | null;
    bigmodelThinkingEnabled: boolean | null;
    qwenThinkingEnabled: boolean | null;
    doubaoThinkingMode: string | null;
    customThinkingProtocol: string | null;
    clientPreferencesJson?: string | null;
  } | null,
): LlmRuntimeConfig {
  const base = defaultConfig();
  const storedProvider = row?.llmProvider?.trim();
  const storedProviderIsActive = Boolean(
    storedProvider && isActiveLlmProvider(storedProvider),
  );
  const provider =
    isDesktopLocalRuntime() && storedProviderIsActive
      ? (storedProvider as LlmProviderId)
      : base.provider;
  // Web and RN use the shared hosted provider. Desktop-local owns its route and
  // therefore honors the exact model saved on this computer, except retired
  // DeepSeek chat ids which now all resolve to the single Flash model.
  const storedChatModel = row?.chatModel?.trim();
  const chatModel = isDesktopLocalRuntime()
    ? provider === "deepseek"
      ? resolveDeepseekChatModel(storedChatModel)
      : storedChatModel || defaultLlmChatModel(provider)
    : defaultLlmChatModel(provider);

  return {
    provider,
    chatModel,
    // Hosted embeddings remain fixed. Desktop-local owns and persists its
    // private retrieval provider/model selection on this computer.
    ...(isDesktopLocalRuntime()
      ? desktopEmbeddingConfig(row)
      : fixedEmbeddingConfig()),
    ...thinkingFromRow(row),
  };
}

function cacheKey(userId?: string): string {
  return userId ?? "__default__";
}

function setCacheEntry(
  key: string,
  config: LlmRuntimeConfig,
  settingsUpdatedAt: number | null,
): void {
  cache.set(key, { config, settingsUpdatedAt });
}

/** Effective config: built-in defaults merged with DB overrides (sync; uses cache or defaults). */
export function getLlmRuntimeConfig(): LlmRuntimeConfig {
  const userId = getCurrentUserId();
  if (userId) {
    const cached = cache.get(userId);
    if (cached) return cached.config;
  }
  return defaultConfig();
}

export function getLlmModelOverrides(): LlmModelOverrides {
  const runtime = getLlmRuntimeConfig();
  const base = defaultConfig();
  const overrides: LlmModelOverrides = {};
  if (runtime.chatModel !== defaultLlmChatModel(runtime.provider)) {
    overrides.chatModel = runtime.chatModel;
  }
  if (runtime.minimaxThinkingEnabled !== base.minimaxThinkingEnabled) {
    overrides.minimaxThinkingEnabled = runtime.minimaxThinkingEnabled;
  }
  if (runtime.ollamaThinkingEnabled !== base.ollamaThinkingEnabled) {
    overrides.ollamaThinkingEnabled = runtime.ollamaThinkingEnabled;
  }
  if (runtime.deepseekThinkingEnabled !== base.deepseekThinkingEnabled) {
    overrides.deepseekThinkingEnabled = runtime.deepseekThinkingEnabled;
  }
  if (runtime.openaiThinkingEnabled !== base.openaiThinkingEnabled) {
    overrides.openaiThinkingEnabled = runtime.openaiThinkingEnabled;
  }
  if (
    isDesktopLocalRuntime() &&
    runtime.codexReasoningEffort !== base.codexReasoningEffort
  ) {
    overrides.codexReasoningEffort = runtime.codexReasoningEffort;
  }
  if (runtime.bigmodelThinkingEnabled !== base.bigmodelThinkingEnabled) {
    overrides.bigmodelThinkingEnabled = runtime.bigmodelThinkingEnabled;
  }
  if (runtime.qwenThinkingEnabled !== base.qwenThinkingEnabled) {
    overrides.qwenThinkingEnabled = runtime.qwenThinkingEnabled;
  }
  if (runtime.doubaoThinkingMode !== base.doubaoThinkingMode) {
    overrides.doubaoThinkingMode = runtime.doubaoThinkingMode;
  }
  if (runtime.customThinkingProtocol !== base.customThinkingProtocol) {
    overrides.customThinkingProtocol = runtime.customThinkingProtocol;
  }
  return overrides;
}

async function readSettingsVersion(userId: string): Promise<number | null> {
  const row = await getUserSettingsForUser(userId);
  return row?.updatedAt.getTime() ?? null;
}

export async function refreshLlmRuntimeConfig(
  userId?: string,
): Promise<LlmRuntimeConfig> {
  const uid = resolveUserId(userId);
  if (!uid) {
    const config = defaultConfig();
    setCacheEntry(cacheKey(), config, null);
    return config;
  }

  const row = await getUserSettingsForUser(uid);
  const config = mergeLlmRuntimeConfigRow(row);
  setCacheEntry(uid, config, row?.updatedAt.getTime() ?? null);
  resetLlmProviderCache(uid);
  return config;
}

/** Load DB overrides; re-reads when another process updates user settings. */
export async function ensureLlmRuntimeConfig(
  userId?: string,
): Promise<LlmRuntimeConfig> {
  const uid = resolveUserId(userId);
  const key = cacheKey(uid);
  const cached = uid ? cache.get(uid) : cache.get(key);

  if (cached) {
    if (!uid) return cached.config;
    const settingsUpdatedAt = await readSettingsVersion(uid);
    if (cached.settingsUpdatedAt === settingsUpdatedAt) {
      return cached.config;
    }
  } else if (!uid) {
    return refreshLlmRuntimeConfig();
  }

  if (!loadPromises.has(key)) {
    loadPromises.set(
      key,
      refreshLlmRuntimeConfig(uid).finally(() => {
        loadPromises.delete(key);
      }),
    );
  }
  return loadPromises.get(key)!;
}

export async function saveLlmRuntimeConfig(
  patch: Partial<LlmRuntimeConfig>,
  userId?: string,
): Promise<LlmRuntimeConfig> {
  const uid = resolveUserId(userId);
  if (!uid) {
    throw new Error("Cannot save LLM settings without a user id");
  }
  if (patch.provider && !isActiveLlmProvider(patch.provider)) {
    throw new Error(`LLM provider "${patch.provider}" is disabled`);
  }

  const current = await refreshLlmRuntimeConfig(uid);
  const currentSettings = await getUserSettingsForUser(uid);
  const embedding = isDesktopLocalRuntime()
    ? {
        embeddingProvider: patch.embeddingProvider ?? current.embeddingProvider,
        embeddingModel:
          patch.embeddingModel?.trim() ||
          (patch.embeddingProvider &&
          patch.embeddingProvider !== current.embeddingProvider
            ? defaultEmbeddingModel(patch.embeddingProvider)
            : current.embeddingModel),
      }
    : fixedEmbeddingConfig();
  const thinkingDefaults = defaultConfig();
  const thinking = isDesktopLocalRuntime()
    ? {
        minimaxThinkingEnabled:
          patch.minimaxThinkingEnabled ?? current.minimaxThinkingEnabled,
        ollamaThinkingEnabled:
          patch.ollamaThinkingEnabled ?? current.ollamaThinkingEnabled,
        deepseekThinkingEnabled:
          patch.deepseekThinkingEnabled ?? current.deepseekThinkingEnabled,
        openaiThinkingEnabled:
          patch.openaiThinkingEnabled ?? current.openaiThinkingEnabled,
        codexReasoningEffort: storedCodexReasoningEffort(
          patch.codexReasoningEffort ?? current.codexReasoningEffort,
        ),
        bigmodelThinkingEnabled:
          patch.bigmodelThinkingEnabled ?? current.bigmodelThinkingEnabled,
        qwenThinkingEnabled:
          patch.qwenThinkingEnabled ?? current.qwenThinkingEnabled,
        doubaoThinkingMode: storedDoubaoThinkingMode(
          patch.doubaoThinkingMode ?? current.doubaoThinkingMode,
        ),
        customThinkingProtocol: storedCustomThinkingProtocol(
          patch.customThinkingProtocol ?? current.customThinkingProtocol,
        ),
      }
    : {
        minimaxThinkingEnabled: thinkingDefaults.minimaxThinkingEnabled,
        ollamaThinkingEnabled: thinkingDefaults.ollamaThinkingEnabled,
        deepseekThinkingEnabled: thinkingDefaults.deepseekThinkingEnabled,
        openaiThinkingEnabled: thinkingDefaults.openaiThinkingEnabled,
        codexReasoningEffort: thinkingDefaults.codexReasoningEffort,
        bigmodelThinkingEnabled: thinkingDefaults.bigmodelThinkingEnabled,
        qwenThinkingEnabled: thinkingDefaults.qwenThinkingEnabled,
        doubaoThinkingMode: thinkingDefaults.doubaoThinkingMode,
        customThinkingProtocol: thinkingDefaults.customThinkingProtocol,
      };
  const provider = isDesktopLocalRuntime()
    ? (patch.provider ?? current.provider)
    : HOSTED_LLM_PROVIDER;
  const next: LlmRuntimeConfig = {
    provider,
    chatModel:
      isDesktopLocalRuntime() && patch.chatModel?.trim()
        ? patch.chatModel.trim()
        : defaultLlmChatModel(provider),
    ...embedding,
    ...thinking,
  };

  const preferences: Record<string, unknown> = (() => {
    try {
      const parsed = JSON.parse(currentSettings?.clientPreferencesJson ?? "{}");
      return parsed && typeof parsed === "object"
        ? { ...(parsed as Record<string, unknown>) }
        : {};
    } catch {
      return {};
    }
  })();
  if (isDesktopLocalRuntime()) {
    const hasCodexPreference = Object.prototype.hasOwnProperty.call(
      preferences,
      "codexReasoningEffort",
    );
    if (patch.codexReasoningEffort !== undefined || hasCodexPreference) {
      preferences.codexReasoningEffort = next.codexReasoningEffort;
    }
  }
  const clientPreferencesJson = isDesktopLocalRuntime()
    ? JSON.stringify(preferences)
    : (currentSettings?.clientPreferencesJson ?? "{}");

  const row = await upsertUserSettingsForUser(uid, {
    create: {
      llmProvider: next.provider,
      chatModel: next.chatModel,
      embeddingModel: embedding.embeddingModel,
      embeddingProvider: embedding.embeddingProvider,
      minimaxThinkingEnabled: next.minimaxThinkingEnabled,
      ollamaThinkingEnabled: next.ollamaThinkingEnabled,
      deepseekThinkingEnabled: next.deepseekThinkingEnabled,
      openaiThinkingEnabled: next.openaiThinkingEnabled,
      bigmodelThinkingEnabled: next.bigmodelThinkingEnabled,
      qwenThinkingEnabled: next.qwenThinkingEnabled,
      doubaoThinkingMode: next.doubaoThinkingMode,
      customThinkingProtocol: next.customThinkingProtocol,
      clientPreferencesJson,
    },
    update: {
      llmProvider: next.provider,
      chatModel: next.chatModel,
      embeddingModel: embedding.embeddingModel,
      embeddingProvider: embedding.embeddingProvider,
      minimaxThinkingEnabled: next.minimaxThinkingEnabled,
      ollamaThinkingEnabled: next.ollamaThinkingEnabled,
      deepseekThinkingEnabled: next.deepseekThinkingEnabled,
      openaiThinkingEnabled: next.openaiThinkingEnabled,
      bigmodelThinkingEnabled: next.bigmodelThinkingEnabled,
      qwenThinkingEnabled: next.qwenThinkingEnabled,
      doubaoThinkingMode: next.doubaoThinkingMode,
      customThinkingProtocol: next.customThinkingProtocol,
      clientPreferencesJson,
    },
  });

  setCacheEntry(uid, next, row.updatedAt.getTime());
  resetLlmProviderCache(uid);
  return next;
}

export function invalidateLlmRuntimeConfig(userId?: string): void {
  if (userId) {
    cache.delete(userId);
    loadPromises.delete(userId);
    resetLlmProviderCache(userId);
    return;
  }
  cache.clear();
  loadPromises.clear();
  resetLlmProviderCache();
}

/** @deprecated Use defaultLlmChatModel from providers/llm/defaults */
export function defaultChatModel(provider: LlmProviderId): string {
  return defaultLlmChatModel(provider);
}

/** @deprecated Use defaultEmbeddingModel from providers/llm/defaults */
export { defaultEmbeddingModel, defaultEmbeddingProvider };
