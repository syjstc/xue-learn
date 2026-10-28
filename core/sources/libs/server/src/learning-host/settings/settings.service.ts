import { BadRequestException, Injectable } from "@nestjs/common";
import { tBackend } from "../../../../common/src/index.js";
import { getCurrentUserId } from "../../user-context.js";
import { z } from "zod";
import {
  activeLlmProviderIds,
  hasProviderCredentials,
  hasSearchProviderCredentials,
  type LlmProviderId,
} from "../../env.js";
import { isImageGenerationFeatureEnabled } from "../../features.js";
import { hasImageProviderCredentials } from "../../images/credentials.js";
import { IMAGE_PROVIDER_OPTIONS } from "../../images/provider-options.js";
import {
  ensureImageRuntimeConfig,
  refreshImageRuntimeConfig,
} from "../../images/runtime-config.js";
import { LLM_PROVIDER_OPTIONS } from "../../providers/llm/index.js";
import {
  ensureLlmRuntimeConfig,
  refreshLlmRuntimeConfig,
  saveLlmRuntimeConfig,
} from "../../llm/runtime-config.js";
import {
  ensureSearchRuntimeConfig,
  refreshSearchRuntimeConfig,
} from "../../search/runtime-config.js";
import { SEARCH_PROVIDER_OPTIONS } from "../../search/provider-options.js";
import {
  DEFAULT_LLM_OPERATION_KEY,
  resolveLlmOperationRoute,
} from "../../providers/llm/index.js";
import { defaultLlmChatModel } from "../../providers/llm/defaults.js";
import {
  getDefaultLearningSystemRuntime,
  type CapabilitySettingsRouter,
} from "../../learning-systems/index.js";
import { LearningSpaceOrmProvider } from "../../learning-spaces/learning-space-orm.provider.js";
import {
  getUserSettingsForUser,
  upsertUserSettingsForUser,
} from "../../user-settings.js";

const llmPatchSchema = z.object({
  provider: z.enum(activeLlmProviderIds).optional(),
  chatModel: z.string().min(1).optional(),
  minimaxThinkingEnabled: z.boolean().optional(),
  ollamaThinkingEnabled: z.boolean().optional(),
  deepseekThinkingEnabled: z.boolean().optional(),
  doubaoThinkingMode: z.enum(["enabled", "disabled", "auto"]).optional(),
});

const learningViewPatchSchema = z
  .object({
    mode: z.enum(["chat", "reading"]).optional(),
    chatAudioEnabled: z.boolean().optional(),
  })
  .refine(
    (value) => value.mode !== undefined || value.chatAudioEnabled !== undefined,
    { message: "At least one learning view setting is required" },
  );

const memoryPatchSchema = z.object({ enabled: z.boolean() }).strict();
const appearancePatchSchema = z
  .object({
    theme: z.enum(["light", "dark", "system"]).optional(),
    uiLocale: z.enum(["zh-Hans", "zh-Hant", "en"]).optional(),
  })
  .strict()
  .refine(
    (value) => value.theme !== undefined || value.uiLocale !== undefined,
    {
      message: "At least one appearance setting is required",
    },
  );
const clientPreferencesPatchSchema = z
  .object({ patch: z.record(z.string().min(1).max(120), z.unknown()) })
  .strict();

@Injectable()
export class SettingsService {
  private capabilitySettings?: CapabilitySettingsRouter;

  constructor(private readonly learningSpaceOrm: LearningSpaceOrmProvider) {}

  private getCapabilitySettings(): CapabilitySettingsRouter {
    return (this.capabilitySettings ??=
      getDefaultLearningSystemRuntime().settingsRouter);
  }

  async getLlm() {
    await ensureLlmRuntimeConfig();
    const runtime = await refreshLlmRuntimeConfig();
    const route = await resolveLlmOperationRoute(DEFAULT_LLM_OPERATION_KEY, runtime);
    return {
      config: { provider: runtime.provider, chatModel: route.model,
        minimaxThinkingEnabled: runtime.minimaxThinkingEnabled,
        ollamaThinkingEnabled: runtime.ollamaThinkingEnabled,
        deepseekThinkingEnabled: runtime.deepseekThinkingEnabled,
        doubaoThinkingMode: runtime.doubaoThinkingMode },
      providers: LLM_PROVIDER_OPTIONS.filter(option => activeLlmProviderIds.includes(option.id as typeof activeLlmProviderIds[number]))
        .map(option => ({ ...option, configured: hasProviderCredentials(option.id as LlmProviderId) })),
      unitLearningEstimate: null, unitLearningEstimateRange: null, unitLearningEstimates: [],
    };
  }

  async patchLlm(body: unknown) {
    const parsed = llmPatchSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException({code: "INVALID_BODY", message: tBackend("error.request.invalidBody"), details: parsed.error.flatten()});
    const current = await refreshLlmRuntimeConfig();
    const provider = parsed.data.provider ?? current.provider;
    if (!hasProviderCredentials(provider)) throw new BadRequestException({code: "PROVIDER_NOT_CONFIGURED", message: tBackend("error.settings.providerNotConfigured", {provider})});
    await saveLlmRuntimeConfig({ provider, chatModel: defaultLlmChatModel(provider),
      minimaxThinkingEnabled: parsed.data.minimaxThinkingEnabled ?? current.minimaxThinkingEnabled,
      ollamaThinkingEnabled: parsed.data.ollamaThinkingEnabled ?? current.ollamaThinkingEnabled,
      deepseekThinkingEnabled: parsed.data.deepseekThinkingEnabled ?? current.deepseekThinkingEnabled,
      doubaoThinkingMode: parsed.data.doubaoThinkingMode ?? current.doubaoThinkingMode });
    return this.getLlm();
  }

  async getSearch() {
    await ensureSearchRuntimeConfig();
    const config = await refreshSearchRuntimeConfig();

    const providers = SEARCH_PROVIDER_OPTIONS.map((p) => ({
      ...p,
      configured: hasSearchProviderCredentials(p.id),
    }));

    return {
      config,
      providers,
    };
  }

  async patchSearch(_body: unknown) {
    throw new BadRequestException({
      code: "SEARCH_SETTINGS_GLOBAL",
      message: tBackend("error.settings.searchLearnerManaged"),
    });
  }

  async getLearningView() {
    const userId = getCurrentUserId();
    if (!userId) {
      throw new BadRequestException({
        code: "MISSING_USER_IDENTITY",
        message: tBackend("error.auth.missingUserIdentity"),
      });
    }

    return this.getCapabilitySettings().read("learning-experience", "user", {
      userId,
    });
  }

  async patchLearningView(body: unknown) {
    const parsed = learningViewPatchSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_BODY",
        message: tBackend("error.request.invalidBody"),
        details: parsed.error.flatten(),
      });
    }

    const userId = getCurrentUserId();
    if (!userId) {
      throw new BadRequestException({
        code: "MISSING_USER_IDENTITY",
        message: tBackend("error.auth.missingUserIdentity"),
      });
    }

    return this.getCapabilitySettings().patch(
      "learning-experience",
      "user",
      { userId },
      parsed.data,
    );
  }

  async getAppearance() {
    const userId = this.requireUserId();
    const settings = await getUserSettingsForUser(userId);
    return {
      theme:
        settings?.theme === "light" || settings?.theme === "dark"
          ? settings.theme
          : "system",
      uiLocale:
        settings?.uiLocale === "zh-Hant" || settings?.uiLocale === "en"
          ? settings.uiLocale
          : "zh-Hans",
    };
  }

  async patchAppearance(body: unknown) {
    const parsed = appearancePatchSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_BODY",
        message: tBackend("error.request.invalidBody"),
        details: parsed.error.flatten(),
      });
    }
    const userId = this.requireUserId();
    await upsertUserSettingsForUser(userId, {
      create: parsed.data,
      update: parsed.data,
    });
    return this.getAppearance();
  }

  async getClientPreferences() {
    const settings = await getUserSettingsForUser(this.requireUserId());
    try {
      const parsed = JSON.parse(settings?.clientPreferencesJson ?? "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch {
      return {};
    }
  }

  async patchClientPreferences(body: unknown) {
    const parsed = clientPreferencesPatchSchema.safeParse(body);
    if (!parsed.success || JSON.stringify(parsed.data).length > 100_000) {
      throw new BadRequestException({
        code: "INVALID_BODY",
        message: tBackend("error.request.invalidBody"),
      });
    }
    const userId = this.requireUserId();
    const current = await this.getClientPreferences();
    const next = { ...current } as Record<string, unknown>;
    for (const [key, value] of Object.entries(parsed.data.patch)) {
      if (value === null) delete next[key];
      else next[key] = value;
    }
    await upsertUserSettingsForUser(userId, {
      create: { clientPreferencesJson: JSON.stringify(next) },
      update: { clientPreferencesJson: JSON.stringify(next) },
    });
    return next;
  }

  private requireUserId(): string {
    const userId = getCurrentUserId();
    if (!userId) {
      throw new BadRequestException({
        code: "MISSING_USER_IDENTITY",
        message: tBackend("error.auth.missingUserIdentity"),
      });
    }
    return userId;
  }

  async getMemory() {
    const userId = getCurrentUserId();
    if (!userId) {
      throw new BadRequestException({
        code: "MISSING_USER_IDENTITY",
        message: tBackend("error.auth.missingUserIdentity"),
      });
    }
    return this.getCapabilitySettings().read("general-memory", "user", {
      userId,
    });
  }

  async patchMemory(body: unknown) {
    const parsed = memoryPatchSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_BODY",
        message: tBackend("error.request.invalidBody"),
        details: parsed.error.flatten(),
      });
    }
    const userId = getCurrentUserId();
    if (!userId) {
      throw new BadRequestException({
        code: "MISSING_USER_IDENTITY",
        message: tBackend("error.auth.missingUserIdentity"),
      });
    }
    return this.getCapabilitySettings().patch(
      "general-memory",
      "user",
      { userId },
      parsed.data,
    );
  }

  async getImages() {
    if (
      !isImageGenerationFeatureEnabled(
        process.env.XUELEARN_DESKTOP_LOCAL === "1",
      )
    ) {
      throw new BadRequestException({
        code: "IMAGE_GENERATION_DISABLED",
        message: tBackend("error.settings.imagesDisabled"),
      });
    }

    await ensureImageRuntimeConfig();
    const config = await refreshImageRuntimeConfig();

    const providers = IMAGE_PROVIDER_OPTIONS.map((p) => ({
      ...p,
      configured: p.id === "none" ? true : hasImageProviderCredentials(p.id),
    }));

    return {
      config,
      providers,
    };
  }

  async patchImages(_body: unknown) {
    throw new BadRequestException({
      code: "IMAGE_SETTINGS_GLOBAL",
      message: tBackend("error.settings.imagesLearnerManaged"),
    });
  }
}
