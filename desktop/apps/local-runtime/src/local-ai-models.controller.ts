import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
} from "@nestjs/common";
import { tBackend } from "@xue-learn/core/common";
import {
  LOCAL_OWNER_ID,
  localChatConnectionTestRequestSchema,
  localProviderConnectionTestRequestSchema,
  localAiModelSettingsSchema,
  localAiModelSettingsPatchSchema,
  localVectorReindexStatusSchema,
  tavilyUsageSchema,
  codexModelCatalogSchema,
  codexReasoningEffortSchema,
  codexUsageSchema,
  localChatProviderIds,
  localEmbeddingProviderIds,
  customChatEndpointActivateSchema,
  customChatEndpointDeleteSchema,
  customChatEndpointUpsertSchema,
  customChatEndpointsStateSchema,
  emptyCustomChatEndpointsState,
} from "@xue-learn/core/runtime-contracts";
import { hasProviderCredentials } from "@xue-learn/core/server/env";
import {
  refreshLlmRuntimeConfig,
  saveLlmRuntimeConfig,
} from "@xue-learn/core/server/llm/runtime-config";
import { invalidateImageRuntimeConfig } from "@xue-learn/core/server/images/runtime-config";
import { guidedImageModelFromPreferences, saveGuidedImageModelSettings } from "@xue-learn/core/server/llm/guided-image-model-settings";
import { invalidateSearchRuntimeConfig } from "@xue-learn/core/server/search/runtime-config";
import { parseChatAudioProvider } from "@xue-learn/core/server/providers/audio/global-chat-audio-settings";
import {
  hasAudioProviderCredentials,
  chatAudioModelFromPreferences,
  parseClientPreferencesJson,
  resetAudioProviderCache,
  resolveAudioModelForProvider,
  CHAT_AUDIO_MODEL_PREF_KEY,
} from "@xue-learn/core/server/providers/audio";
import { requireGlobalGenerationSettingsPersistence } from "@xue-learn/core/server/generation/global-generation-settings-persistence";
import { parseImageProvider } from "@xue-learn/core/server/images/global-image-settings";
import { defaultImageModel } from "@xue-learn/core/server/images/provider-options";
import { parseSearchProvider } from "@xue-learn/core/server/search/global-search-settings";
import { upsertUserSettingsForUser, getUserSettingsForUser } from "@xue-learn/core/server/user-settings";
import {
  testLocalCapabilityConnection,
  testLocalChatConnection,
} from "./local-provider-connection-test.ts";
import {
  getLocalEmbeddingIndexStatus,
  queueLocalEmbeddingReindex,
} from "@cognilearn/desktop-persistence/local-embedding-index";
import { fetchTavilyUsage } from "@xue-learn/core/server/search/tavily-usage";
import {
  CodexBackendError,
  fetchCodexModelCatalog,
  fetchCodexUsage,
  type CodexModelCatalogEntry,
} from "@xue-learn/core/server/providers/llm/vendors/codex/runtime";
import {
  activateCustomChatEndpoint,
  deleteCustomChatEndpoint,
  readCustomChatEndpoints,
  replaceCustomChatEndpoints,
  upsertCustomChatEndpoint,
} from "./custom-chat-endpoints.ts";

function validOptionalUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

let codexModelCache: {
  models: CodexModelCatalogEntry[];
  fetchedAt: number;
} | null = null;

@Controller("api/local/ai-models")
export class LocalAiModelsController {
  @Get()
  async getSettings() {
    const [config, global, customChatEndpoints, userSettings] = await Promise.all([
      refreshLlmRuntimeConfig(),
      requireGlobalGenerationSettingsPersistence().get(),
      readCustomChatEndpoints(),
      getUserSettingsForUser(LOCAL_OWNER_ID).catch(() => null),
    ]);
    const imageProvider = parseImageProvider(global.imageProvider);
    const searchProvider = parseSearchProvider(global.searchProvider);
    const selectedAudioProvider =
      global.chatAudioProvider === "none"
        ? "none"
        : parseChatAudioProvider(global.chatAudioProvider);
    const audioProvider =
      selectedAudioProvider !== "none" &&
      hasAudioProviderCredentials(selectedAudioProvider)
        ? selectedAudioProvider
        : "none";
    const audioModel = resolveAudioModelForProvider(
      audioProvider,
      chatAudioModelFromPreferences(userSettings?.clientPreferencesJson),
    );
    const codexPreference = parseClientPreferencesJson(
      userSettings?.clientPreferencesJson,
    ).codexReasoningEffort;
    const codexReasoningEffort = codexReasoningEffortSchema.safeParse(
      codexPreference,
    ).success
      ? codexPreference
      : undefined;
    const customBaseUrl = process.env.CUSTOM_OPENAI_BASE_URL?.trim();
    const customEmbeddingBaseUrl =
      process.env.CUSTOM_EMBEDDING_BASE_URL?.trim();
    const embeddingProvider = localEmbeddingProviderIds.includes(
      config.embeddingProvider as (typeof localEmbeddingProviderIds)[number],
    )
      ? config.embeddingProvider
      : "none";
    return localAiModelSettingsSchema.parse({
      guidedImageModel: guidedImageModelFromPreferences(userSettings?.clientPreferencesJson),
      chatProvider: config.provider,
      chatModel: config.chatModel,
      embeddingProvider,
      embeddingModel:
        embeddingProvider === "none" ? null : config.embeddingModel,
      searchProvider: global.searchEnabled ? searchProvider : "none",
      imageProvider,
      imageModel:
        imageProvider === "none" ? null : defaultImageModel(imageProvider),
      audioProvider,
      audioModel,
      customBaseUrl: validOptionalUrl(customBaseUrl),
      qwenBaseUrl: validOptionalUrl(process.env.DASHSCOPE_BASE_URL),
      customEmbeddingBaseUrl: validOptionalUrl(customEmbeddingBaseUrl),
      configuredProviders: localChatProviderIds.filter((providerId) =>
        hasProviderCredentials(providerId),
      ),
      customChatEndpoints:
        customChatEndpoints ?? emptyCustomChatEndpointsState,
      minimaxThinkingEnabled: config.minimaxThinkingEnabled,
      ollamaThinkingEnabled: config.ollamaThinkingEnabled,
      deepseekThinkingEnabled: config.deepseekThinkingEnabled,
      openaiThinkingEnabled: config.openaiThinkingEnabled,
      // Keep this optional so the renderer can apply the selected account
      // model's catalog default until the learner chooses an override.
      ...(codexReasoningEffort
        ? { codexReasoningEffort }
        : {}),
      bigmodelThinkingEnabled: config.bigmodelThinkingEnabled,
      qwenThinkingEnabled: config.qwenThinkingEnabled,
      doubaoThinkingMode: config.doubaoThinkingMode,
      customThinkingProtocol: config.customThinkingProtocol,
    });
  }

  @Patch()
  async patchSettings(@Body() body: unknown) {
    const parsed = localAiModelSettingsPatchSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_BODY",
        message: tBackend("error.request.invalidBody"),
        details: parsed.error.flatten(),
      });
    }
    const patch = parsed.data;
    switch (patch.capability) {
      case "guided_image":
        await saveGuidedImageModelSettings(LOCAL_OWNER_ID, patch.settings);
        break;
      case "chat": {
        if (patch.providerId === "custom" && patch.customChatProfileId) {
          await upsertCustomChatEndpoint({
            id: patch.customChatProfileId,
            name: patch.customChatProfileName?.trim() || "OpenAI-compatible",
            model: patch.model,
            thinkingProtocol: patch.customThinkingProtocol ?? "none",
            activate: true,
          });
        }
        await saveLlmRuntimeConfig({
          provider: patch.providerId,
          chatModel: patch.model,
          ...(patch.minimaxThinkingEnabled !== undefined
            ? { minimaxThinkingEnabled: patch.minimaxThinkingEnabled }
            : {}),
          ...(patch.ollamaThinkingEnabled !== undefined
            ? { ollamaThinkingEnabled: patch.ollamaThinkingEnabled }
            : {}),
          ...(patch.deepseekThinkingEnabled !== undefined
            ? { deepseekThinkingEnabled: patch.deepseekThinkingEnabled }
            : {}),
          ...(patch.openaiThinkingEnabled !== undefined
            ? { openaiThinkingEnabled: patch.openaiThinkingEnabled }
            : {}),
          ...(patch.codexReasoningEffort !== undefined
            ? { codexReasoningEffort: patch.codexReasoningEffort }
            : {}),
          ...(patch.bigmodelThinkingEnabled !== undefined
            ? { bigmodelThinkingEnabled: patch.bigmodelThinkingEnabled }
            : {}),
          ...(patch.qwenThinkingEnabled !== undefined
            ? { qwenThinkingEnabled: patch.qwenThinkingEnabled }
            : {}),
          ...(patch.doubaoThinkingMode !== undefined
            ? { doubaoThinkingMode: patch.doubaoThinkingMode }
            : {}),
          ...(patch.customThinkingProtocol !== undefined
            ? { customThinkingProtocol: patch.customThinkingProtocol }
            : {}),
        });
        break;
      }
      case "embedding":
        if (
          patch.providerId === "builtin" &&
          (!process.env.XUELEARN_LOCAL_EMBEDDING_MODEL_ROOT?.trim() ||
            process.env.XUELEARN_LOCAL_EMBEDDING_MODEL_ERROR?.trim())
        ) {
          throw new BadRequestException({
            code: "LOCAL_EMBEDDING_MODEL_NOT_INSTALLED",
            message:
              "Download and verify Qwen3 Embedding before selecting the built-in provider.",
          });
        }
        await saveLlmRuntimeConfig({
          embeddingProvider: patch.providerId,
          embeddingModel: patch.model,
        });
        await queueLocalEmbeddingReindex(LOCAL_OWNER_ID);
        break;
      case "search":
        await requireGlobalGenerationSettingsPersistence().update({
          searchEnabled: true,
          searchProvider: patch.providerId,
          updatedByUserId: LOCAL_OWNER_ID,
        });
        invalidateSearchRuntimeConfig();
        break;
      case "image":
        await requireGlobalGenerationSettingsPersistence().update({
          imageProvider: patch.providerId,
          updatedByUserId: LOCAL_OWNER_ID,
        });
        invalidateImageRuntimeConfig();
        break;
      case "audio": {
        await requireGlobalGenerationSettingsPersistence().update({
          chatAudioProvider: patch.providerId,
          updatedByUserId: LOCAL_OWNER_ID,
        });
        const existing = await getUserSettingsForUser(LOCAL_OWNER_ID).catch(
          () => null,
        );
        const preferences = parseClientPreferencesJson(
          existing?.clientPreferencesJson,
        );
        const audioModel =
          patch.providerId === "none"
            ? null
            : resolveAudioModelForProvider(patch.providerId, patch.model);
        if (audioModel) {
          preferences[CHAT_AUDIO_MODEL_PREF_KEY] = audioModel;
        } else {
          delete preferences[CHAT_AUDIO_MODEL_PREF_KEY];
        }
        await upsertUserSettingsForUser(LOCAL_OWNER_ID, {
          create: {
            chatAudioEnabled: patch.providerId !== "none",
            clientPreferencesJson: JSON.stringify(preferences),
          },
          update: {
            chatAudioEnabled: patch.providerId !== "none",
            clientPreferencesJson: JSON.stringify(preferences),
          },
        });
        resetAudioProviderCache();
        break;
      }
    }
    return this.getSettings();
  }

  @Put("custom-endpoints")
  async replaceCustomEndpoints(@Body() body: unknown) {
    const parsed = customChatEndpointsStateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_BODY",
        message: tBackend("error.request.invalidBody"),
        details: parsed.error.flatten(),
      });
    }
    await replaceCustomChatEndpoints(parsed.data);
    return this.getSettings();
  }

  @Post("custom-endpoints")
  async upsertCustomEndpoint(@Body() body: unknown) {
    const parsed = customChatEndpointUpsertSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_BODY",
        message: tBackend("error.request.invalidBody"),
        details: parsed.error.flatten(),
      });
    }
    try {
      await upsertCustomChatEndpoint(parsed.data);
    } catch (error) {
      throw new BadRequestException({
        code: "INVALID_BODY",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return this.getSettings();
  }

  @Post("custom-endpoints/:id/activate")
  async activateCustomEndpoint(@Param("id") id: string) {
    const parsed = customChatEndpointActivateSchema.safeParse({ id });
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_BODY",
        message: tBackend("error.request.invalidBody"),
        details: parsed.error.flatten(),
      });
    }
    try {
      await activateCustomChatEndpoint(parsed.data.id);
    } catch {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: tBackend("error.notFound"),
      });
    }
    return this.getSettings();
  }

  @Delete("custom-endpoints/:id")
  async removeCustomEndpoint(@Param("id") id: string) {
    const parsed = customChatEndpointDeleteSchema.safeParse({ id });
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_BODY",
        message: tBackend("error.request.invalidBody"),
        details: parsed.error.flatten(),
      });
    }
    const current = await readCustomChatEndpoints();
    if (!current.profiles.some((profile) => profile.id === parsed.data.id)) {
      return this.getSettings();
    }
    await deleteCustomChatEndpoint(parsed.data.id);
    return this.getSettings();
  }

  @Get("embedding-index")
  async getEmbeddingIndex() {
    return localVectorReindexStatusSchema.parse(
      await getLocalEmbeddingIndexStatus(LOCAL_OWNER_ID),
    );
  }

  @Post("embedding-index/retry")
  async retryEmbeddingIndex() {
    return localVectorReindexStatusSchema.parse(
      await queueLocalEmbeddingReindex(LOCAL_OWNER_ID),
    );
  }

  @Get("tavily-usage")
  async getTavilyUsage() {
    return tavilyUsageSchema.parse(await fetchTavilyUsage());
  }

  @Get("codex-models")
  async getCodexModels() {
    try {
      const models = await fetchCodexModelCatalog();
      codexModelCache = { models, fetchedAt: Date.now() };
      return codexModelCatalogSchema.parse({
        available: true,
        models,
        fetchedAt: codexModelCache.fetchedAt,
        stale: false,
        error: null,
      });
    } catch (error) {
      const status = error instanceof CodexBackendError ? error.status : 0;
      const message =
        status === 401 || status === 403
          ? "Codex 登录已失效，请重新登录。"
          : error instanceof Error
            ? error.message
            : "Codex 模型目录暂不可用。";
      if (codexModelCache) {
        return codexModelCatalogSchema.parse({
          available: true,
          models: codexModelCache.models,
          fetchedAt: codexModelCache.fetchedAt,
          stale: true,
          error: message,
        });
      }
      return codexModelCatalogSchema.parse({
        available: false,
        models: [],
        fetchedAt: null,
        stale: false,
        error: message,
      });
    }
  }

  @Get("codex-usage")
  async getCodexUsage() {
    try {
      const usage = await fetchCodexUsage();
      return codexUsageSchema.parse({
        available: true,
        checkedAt: Date.now(),
        ...usage,
        error: null,
      });
    } catch (error) {
      const status = error instanceof CodexBackendError ? error.status : 0;
      return codexUsageSchema.parse({
        available: false,
        checkedAt: null,
        plan: null,
        windows: [],
        resetCreditsAvailable: null,
        creditsBalance: null,
        creditsUnlimited: false,
        error:
          status === 401 || status === 403
            ? "Codex 登录已失效，请重新登录。"
            : "Codex 额度暂不可用。",
      });
    }
  }

  @Post("test-chat")
  async testChatConnection(@Body() body: unknown) {
    const parsed = localChatConnectionTestRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_BODY",
        message: tBackend("error.request.invalidBody"),
        details: parsed.error.flatten(),
      });
    }

    return testLocalChatConnection(parsed.data);
  }

  @Post("test")
  async testCapabilityConnection(@Body() body: unknown) {
    const parsed = localProviderConnectionTestRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_BODY",
        message: tBackend("error.request.invalidBody"),
        details: parsed.error.flatten(),
      });
    }

    return testLocalCapabilityConnection(parsed.data);
  }
}
