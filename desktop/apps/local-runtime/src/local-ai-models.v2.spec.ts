import { LocalAiModelsController } from "./local-ai-models.controller.ts";
import { getUserSettingsForUser } from "@xue-learn/core/server/user-settings";
import {beginLlmRequestLog} from "@xue-learn/core/server/llm/logger";

const mockConnectionLogFinish = jest.fn();
jest.mock("@xue-learn/core/server/llm/logger", () => ({
  beginLlmRequestLog: jest.fn(async () => ({finish: mockConnectionLogFinish})),
}));

const refreshLlmRuntimeConfig = jest.fn();
const saveLlmRuntimeConfig = jest.fn();
const invalidateImageRuntimeConfig = jest.fn();
const invalidateSearchRuntimeConfig = jest.fn();
const getLlmProvider = jest.fn();
const hasProviderCredentials = jest.fn();
const createEmbeddings = jest.fn();
const getImageProvider = jest.fn();
const hasImageProviderCredentials = jest.fn();
const getAudioProvider = jest.fn();
const hasAudioProviderCredentials = jest.fn();
const searchLearningPathWithSources = jest.fn();
const fetchTavilyUsage = jest.fn();
const getLocalEmbeddingIndexStatus = jest.fn();
const queueLocalEmbeddingReindex = jest.fn();
const upsertUserSettingsForUser = jest.fn();
const globalSettings = {
  get: jest.fn(),
  update: jest.fn(),
};

jest.mock("@xue-learn/core/server/llm/runtime-config", () => ({
  refreshLlmRuntimeConfig: (...args: unknown[]) =>
    refreshLlmRuntimeConfig(...args),
  saveLlmRuntimeConfig: (...args: unknown[]) => saveLlmRuntimeConfig(...args),
}));
jest.mock("@xue-learn/core/server/images/runtime-config", () => ({
  invalidateImageRuntimeConfig: (...args: unknown[]) =>
    invalidateImageRuntimeConfig(...args),
}));
jest.mock("@xue-learn/core/server/search/runtime-config", () => ({
  invalidateSearchRuntimeConfig: (...args: unknown[]) =>
    invalidateSearchRuntimeConfig(...args),
}));
jest.mock("@xue-learn/core/server/llm/providers", () => ({
  getLlmProvider: (...args: unknown[]) => getLlmProvider(...args),
}));
jest.mock("@xue-learn/core/server/llm/embeddings", () => ({
  createEmbeddings: (...args: unknown[]) => createEmbeddings(...args),
}));
jest.mock("@xue-learn/core/server/providers/image", () => ({
  getImageProvider: (...args: unknown[]) => getImageProvider(...args),
  hasImageProviderCredentials: (...args: unknown[]) =>
    hasImageProviderCredentials(...args),
}));
jest.mock("@xue-learn/core/server/providers/audio", () => ({
  ...jest.requireActual("@xue-learn/core/server/providers/audio"),
  getAudioProvider: (...args: unknown[]) => getAudioProvider(...args),
  hasAudioProviderCredentials: (...args: unknown[]) =>
    hasAudioProviderCredentials(...args),
}));
jest.mock("@xue-learn/core/server/search/tavily", () => ({
  searchLearningPathWithSources: (...args: unknown[]) =>
    searchLearningPathWithSources(...args),
}));
jest.mock("@xue-learn/core/server/search/tavily-usage", () => ({
  fetchTavilyUsage: (...args: unknown[]) => fetchTavilyUsage(...args),
}));
jest.mock("@xue-learn/core/server/env", () => ({
  ...jest.requireActual("@xue-learn/core/server/env"),
  hasProviderCredentials: (...args: unknown[]) =>
    hasProviderCredentials(...args),
}));
jest.mock(
  "@xue-learn/core/server/generation/global-generation-settings-persistence",
  () => ({
    requireGlobalGenerationSettingsPersistence: () => globalSettings,
  }),
);
jest.mock("@cognilearn/desktop-persistence/local-embedding-index", () => ({
  getLocalEmbeddingIndexStatus: (...args: unknown[]) =>
    getLocalEmbeddingIndexStatus(...args),
  queueLocalEmbeddingReindex: (...args: unknown[]) =>
    queueLocalEmbeddingReindex(...args),
}));
jest.mock("@xue-learn/core/server/user-settings", () => ({
  getUserSettingsForUser: jest.fn().mockResolvedValue({
    customChatEndpointsJson: '{"activeProfileId":null,"profiles":[]}',
  }),
  upsertUserSettingsForUser: (...args: unknown[]) =>
    upsertUserSettingsForUser(...args),
}));

describe("desktop-local AI model settings v2", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getUserSettingsForUser).mockResolvedValue({ customChatEndpointsJson: '{"activeProfileId":null,"profiles":[]}' } as never);
    refreshLlmRuntimeConfig.mockResolvedValue({
      provider: "deepseek",
      chatModel: "deepseek-flash",
      embeddingProvider: "ollama",
      embeddingModel: "bge-m3",
      minimaxThinkingEnabled: false,
      minimaxReasoningEffort: "max",
      ollamaThinkingEnabled: false,
      deepseekThinkingEnabled: false,
      openaiThinkingEnabled: false,
      bigmodelThinkingEnabled: false,
      qwenThinkingEnabled: false,
      doubaoThinkingMode: "disabled",
      customThinkingProtocol: "none",
    });
    globalSettings.get.mockResolvedValue({
      imageProvider: "minimax",
      searchEnabled: true,
      searchProvider: "tavily",
      chatAudioProvider: "minimax",
    });
    globalSettings.update.mockResolvedValue(undefined);
    hasProviderCredentials.mockReturnValue(true);
    hasImageProviderCredentials.mockReturnValue(true);
    hasAudioProviderCredentials.mockReturnValue(true);
    const vectorStatus = {
      status: "published",
      lexicalChunks: 4,
      indexedVectors: 4,
      vectorAvailable: true,
      providerId: "builtin",
      model: "xuelearn/qwen3-embedding-0.6b-q8-v1",
      generationId: "generation-1",
      jobId: "job-1",
      attempt: 1,
      error: null,
      updatedAt: 1,
    };
    getLocalEmbeddingIndexStatus.mockResolvedValue(vectorStatus);
    queueLocalEmbeddingReindex.mockResolvedValue({
      ...vectorStatus,
      status: "queued",
      vectorAvailable: false,
      indexedVectors: 0,
    });
    delete process.env.CUSTOM_OPENAI_BASE_URL;
    process.env.XUELEARN_LOCAL_EMBEDDING_MODEL_ROOT = "/verified-qwen";
    delete process.env.XUELEARN_LOCAL_EMBEDDING_MODEL_ERROR;
  });

  it("keeps connection-test usage and TPS in the model log without changing saved selections", async () => {
    const clock = jest.spyOn(Date, "now");
    let now = 1000;
    clock.mockImplementation(() => now += 1000);
    getLlmProvider.mockReturnValue({getChatModel: () => ({invoke: jest.fn().mockResolvedValue({content: "OK",
      usage_metadata: {input_tokens: 120, output_tokens: 30, total_tokens: 150}})})});
    try {
      const result = await new LocalAiModelsController().testChatConnection({providerId: "minimax", model: "MiniMax-M3.1-Flash"});
      expect(result.healthy).toBe(true);
      expect(beginLlmRequestLog).toHaveBeenCalledWith(expect.objectContaining({operation: "local.chat_connection_test",
        request: expect.objectContaining({provider: "minimax", model: "MiniMax-M3.1-Flash", platformFunded: true})}));
      expect(mockConnectionLogFinish).toHaveBeenCalledWith(expect.objectContaining({status: "success", response: expect.objectContaining({
        usage: {input_tokens: 120, output_tokens: 30, total_tokens: 150, input_token_details: undefined, output_token_details: undefined}, outputTps: expect.any(Number),
      })}));
      expect(saveLlmRuntimeConfig).not.toHaveBeenCalled();
    } finally { clock.mockRestore(); }
  });

  it("saves and returns a manual image model without changing the chat or image generator", async () => {
    let preferences = JSON.stringify({ codexReasoningEffort: "high" });
    jest.mocked(getUserSettingsForUser).mockImplementation(async () => ({ clientPreferencesJson: preferences }) as never);
    upsertUserSettingsForUser.mockImplementation(async (_id, patch) => { preferences = patch.update.clientPreferencesJson; return { updatedAt: new Date() }; });
    const controller = new LocalAiModelsController();
    const settings = { mode: "manual", providerId: "codex", model: "gpt-6-sol" };
    expect(await controller.patchSettings({ capability: "guided_image", settings })).toMatchObject({ guidedImageModel: settings, chatProvider: "deepseek", imageProvider: "minimax" });
    expect(JSON.parse(preferences).codexReasoningEffort).toBe("high");
    expect(saveLlmRuntimeConfig).not.toHaveBeenCalled();
    expect(globalSettings.update).not.toHaveBeenCalled();
    expect(await controller.patchSettings({ capability: "guided_image", settings: { mode: "auto" } })).toMatchObject({ guidedImageModel: { mode: "auto" } });
  });

  it("rejects incomplete manual image settings", async () => {
    await expect(new LocalAiModelsController().patchSettings({ capability: "guided_image", settings: { mode: "manual", providerId: "codex", model: "" } })).rejects.toThrow();
    expect(upsertUserSettingsForUser).not.toHaveBeenCalled();
  });

  it("reads saved selections without requiring unrelated provider credentials", async () => {
    await expect(new LocalAiModelsController().getSettings()).resolves.toEqual(
      expect.objectContaining({
        chatProvider: "deepseek",
        chatModel: "deepseek-flash",
        embeddingProvider: "ollama",
        embeddingModel: "bge-m3",
        searchProvider: "tavily",
        imageProvider: "minimax",
        audioProvider: "minimax",
        deepseekThinkingEnabled: false,
        doubaoThinkingMode: "disabled",
      }),
    );
  });

  it("reports audio as unavailable when the selected provider has no credentials", async () => {
    hasAudioProviderCredentials.mockReturnValue(false);

    await expect(new LocalAiModelsController().getSettings()).resolves.toEqual(
      expect.objectContaining({
        audioProvider: "none",
        audioModel: null,
      }),
    );
  });

  it("persists a provider choice before returning the refreshed settings", async () => {
    await new LocalAiModelsController().patchSettings({
      capability: "search",
      providerId: "tavily",
    });

    expect(globalSettings.update).toHaveBeenCalledWith({
      searchEnabled: true,
      searchProvider: "tavily",
      updatedByUserId: "local-owner-v1",
    });
    expect(invalidateSearchRuntimeConfig).toHaveBeenCalledTimes(1);
  });

  it("persists chat thinking with the selected model", async () => {
    await new LocalAiModelsController().patchSettings({
      capability: "chat",
      providerId: "minimax",
      model: "MiniMax-M3",
      minimaxThinkingEnabled: false,
    });

    expect(saveLlmRuntimeConfig).toHaveBeenCalledWith({
      provider: "minimax",
      chatModel: "MiniMax-M3",
      minimaxThinkingEnabled: false,
    });
  });

  it.each(["low", "medium", "high", "xhigh", "max"])("saves Flash reasoning effort %s with its model", async effort => {
    await new LocalAiModelsController().patchSettings({
      capability: "chat", providerId: "minimax", model: "MiniMax-M3.1-Flash", minimaxReasoningEffort: effort,
    });
    expect(saveLlmRuntimeConfig).toHaveBeenCalledWith({ provider: "minimax", chatModel: "MiniMax-M3.1-Flash", minimaxReasoningEffort: effort });
  });

  it.each(["none", "minimal", "ultra"])("rejects unsupported Flash reasoning effort %s", async effort => {
    await expect(new LocalAiModelsController().patchSettings({
      capability: "chat", providerId: "minimax", model: "MiniMax-M3.1-Flash", minimaxReasoningEffort: effort,
    })).rejects.toThrow();
    expect(saveLlmRuntimeConfig).not.toHaveBeenCalled();
  });

  it("stores the selected Qwen Audio Plus model for learner chat", async () => {
    await new LocalAiModelsController().patchSettings({
      capability: "audio",
      providerId: "qwen",
      model: "qwen-audio-3.0-tts-plus",
    });

    expect(upsertUserSettingsForUser).toHaveBeenCalledWith("local-owner-v1", {
      create: expect.objectContaining({
        chatAudioEnabled: true,
        clientPreferencesJson: expect.stringContaining(
          "qwen-audio-3.0-tts-plus",
        ),
      }),
      update: expect.objectContaining({
        chatAudioEnabled: true,
        clientPreferencesJson: expect.stringContaining("qwen-audio-3.0-tts-plus"),
      }),
    });
  });

  it("enables learner narration when a local audio provider is selected", async () => {
    await new LocalAiModelsController().patchSettings({
      capability: "audio",
      providerId: "doubao",
    });

    expect(globalSettings.update).toHaveBeenCalledWith({
      chatAudioProvider: "doubao",
      updatedByUserId: "local-owner-v1",
    });
    expect(upsertUserSettingsForUser).toHaveBeenCalledWith("local-owner-v1", {
      create: expect.objectContaining({ chatAudioEnabled: true }),
      update: expect.objectContaining({ chatAudioEnabled: true }),
    });
  });

  it("disables learner narration when the local audio provider is cleared", async () => {
    await new LocalAiModelsController().patchSettings({
      capability: "audio",
      providerId: "none",
    });

    expect(globalSettings.update).toHaveBeenCalledWith({
      chatAudioProvider: "none",
      updatedByUserId: "local-owner-v1",
    });
    expect(upsertUserSettingsForUser).toHaveBeenCalledWith("local-owner-v1", {
      create: expect.objectContaining({ chatAudioEnabled: false }),
      update: expect.objectContaining({ chatAudioEnabled: false }),
    });
  });

  it("disables local image generation without requiring a replacement provider", async () => {
    await new LocalAiModelsController().patchSettings({
      capability: "image",
      providerId: "none",
    });

    expect(globalSettings.update).toHaveBeenCalledWith({
      imageProvider: "none",
      updatedByUserId: "local-owner-v1",
    });
    expect(invalidateImageRuntimeConfig).toHaveBeenCalledTimes(1);
  });

  it("queues reindexing on embedding changes and exposes retry status", async () => {
    const controller = new LocalAiModelsController();
    await controller.patchSettings({
      capability: "embedding",
      providerId: "builtin",
      model: "xuelearn/qwen3-embedding-0.6b-q8-v1",
    });

    expect(saveLlmRuntimeConfig).toHaveBeenCalledWith({
      embeddingProvider: "builtin",
      embeddingModel: "xuelearn/qwen3-embedding-0.6b-q8-v1",
    });
    expect(queueLocalEmbeddingReindex).toHaveBeenCalledWith("local-owner-v1");
    await expect(controller.getEmbeddingIndex()).resolves.toMatchObject({
      status: "published",
      vectorAvailable: true,
    });
    await expect(controller.retryEmbeddingIndex()).resolves.toMatchObject({
      status: "queued",
      vectorAvailable: false,
    });
  });

  it("refuses to select the built-in provider before its model is installed", async () => {
    delete process.env.XUELEARN_LOCAL_EMBEDDING_MODEL_ROOT;
    process.env.XUELEARN_LOCAL_EMBEDDING_MODEL_ERROR =
      "The downloaded Qwen embedding model is not installed";

    await expect(
      new LocalAiModelsController().patchSettings({
        capability: "embedding",
        providerId: "builtin",
        model: "xuelearn/qwen3-embedding-0.6b-q8-v1",
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: "LOCAL_EMBEDDING_MODEL_NOT_INSTALLED",
      }),
    });
    expect(saveLlmRuntimeConfig).not.toHaveBeenCalled();
    expect(queueLocalEmbeddingReindex).not.toHaveBeenCalled();
  });

  it("tests a selected chat model with a minimal request", async () => {
    const invoke = jest.fn().mockResolvedValue({ content: "OK" });
    getLlmProvider.mockReturnValue({
      getChatModel: jest.fn().mockReturnValue({ invoke }),
    });

    const result = await new LocalAiModelsController().testChatConnection({
      providerId: "deepseek",
      model: "deepseek-flash",
    });

    expect(getLlmProvider).toHaveBeenCalledWith({
      id: "deepseek",
      model: "deepseek-flash",
      options: { chatModel: "deepseek-flash" },
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      expect.objectContaining({
        providerId: "deepseek",
        model: "deepseek-flash",
        healthy: true,
        code: "ok",
      }),
    );
  });

  it("gives MiniMax M2.x enough budget to finish its required reasoning", async () => {
    const invoke = jest.fn().mockResolvedValue({ content: "OK" });
    const getChatModel = jest.fn().mockReturnValue({ invoke });
    getLlmProvider.mockReturnValue({ getChatModel });

    const result = await new LocalAiModelsController().testChatConnection({
      providerId: "minimax",
      model: "MiniMax-M2.7-highspeed",
    });

    expect(getChatModel).toHaveBeenCalledWith({ maxTokens: 512 });
    expect(result).toEqual(
      expect.objectContaining({
        providerId: "minimax",
        model: "MiniMax-M2.7-highspeed",
        healthy: true,
        code: "ok",
      }),
    );
  });

  it("uses the saved Flash reasoning effort for a connection test", async () => {
    const config = await refreshLlmRuntimeConfig();
    refreshLlmRuntimeConfig.mockResolvedValue({ ...config, minimaxReasoningEffort: "low" });
    const invoke = jest.fn().mockResolvedValue({ content: "OK" });
    getLlmProvider.mockReturnValue({ getChatModel: jest.fn().mockReturnValue({ invoke }) });
    await new LocalAiModelsController().testChatConnection({ providerId: "minimax", model: "MiniMax-M3.1-Flash" });
    expect(getLlmProvider).toHaveBeenCalledWith({ id: "minimax", model: "MiniMax-M3.1-Flash",
      options: { chatModel: "MiniMax-M3.1-Flash", minimaxReasoningEffort: "low" } });
  });

  it("gives custom endpoints enough completion budget for reasoning models", async () => {
    const invoke = jest.fn().mockResolvedValue({ content: "OK" });
    const getChatModel = jest.fn().mockReturnValue({ invoke });
    getLlmProvider.mockReturnValue({ getChatModel });

    const result = await new LocalAiModelsController().testChatConnection({
      providerId: "custom",
      model: "mimo-v2.5",
    });

    expect(getChatModel).toHaveBeenCalledWith({ maxTokens: 1024 });
    expect(result).toEqual(
      expect.objectContaining({
        providerId: "custom",
        model: "mimo-v2.5",
        healthy: true,
        code: "ok",
      }),
    );
  });

  it("returns a safe failure result when credentials are missing", async () => {
    hasProviderCredentials.mockReturnValue(false);

    await expect(
      new LocalAiModelsController().testChatConnection({
        providerId: "custom",
        model: "private-model",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        healthy: false,
        code: "missing_credentials",
      }),
    );
    expect(getLlmProvider).not.toHaveBeenCalled();
  });

  it("tests an embedding model with a finite vector", async () => {
    createEmbeddings.mockReturnValue({
      embedQuery: jest.fn().mockResolvedValue([0.1, -0.2, 0.3]),
    });

    const result = await new LocalAiModelsController().testCapabilityConnection(
      {
        capability: "embedding",
        providerId: "ollama",
        model: "bge-m3",
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        capability: "embedding",
        providerId: "ollama",
        model: "bge-m3",
        healthy: true,
        code: "ok",
      }),
    );
  });

  it("returns Tavily usage from the official usage endpoint", async () => {
    fetchTavilyUsage.mockResolvedValue({
      available: true,
      code: "ok",
      message: "Tavily usage loaded.",
      checkedAt: 1,
      plan: "Researcher",
      planUsage: 12,
      planLimit: 1000,
      paygoUsage: 0,
      paygoLimit: 0,
      keyUsage: 12,
      keyLimit: 1000,
      searchUsage: 10,
      extractUsage: 2,
    });

    await expect(
      new LocalAiModelsController().getTavilyUsage(),
    ).resolves.toEqual(
      expect.objectContaining({
        available: true,
        plan: "Researcher",
        planUsage: 12,
        planLimit: 1000,
      }),
    );
  });

  it("tests search with one result", async () => {
    process.env.TAVILY_API_KEY = "test-key";
    searchLearningPathWithSources.mockResolvedValue({
      context: "result",
      sources: [{ url: "https://example.test", title: "Example" }],
      sourceContents: {},
    });

    await expect(
      new LocalAiModelsController().testCapabilityConnection({
        capability: "search",
        providerId: "tavily",
      }),
    ).resolves.toEqual(expect.objectContaining({ healthy: true, code: "ok" }));
    delete process.env.TAVILY_API_KEY;
  });

  it("tests image generation without retaining the generated bytes", async () => {
    getImageProvider.mockReturnValue({
      generateImage: jest.fn().mockResolvedValue({
        data: Buffer.from("image"),
        mimeType: "image/png",
      }),
    });

    await expect(
      new LocalAiModelsController().testCapabilityConnection({
        capability: "image",
        providerId: "doubao",
        model: "doubao-seedream-5-0-260128",
      }),
    ).resolves.toEqual(expect.objectContaining({ healthy: true, code: "ok" }));
  });

  it("tests audio synthesis with a short phrase", async () => {
    getAudioProvider.mockReturnValue({
      synthesizeSpeech: jest.fn().mockResolvedValue({
        text: "Connection test.",
        audioBase64: "YXVkaW8=",
        mimeType: "audio/mpeg",
      }),
    });

    await expect(
      new LocalAiModelsController().testCapabilityConnection({
        capability: "audio",
        providerId: "minimax",
        model: "speech-2.8-turbo",
      }),
    ).resolves.toEqual(expect.objectContaining({ healthy: true, code: "ok" }));
  });
});
