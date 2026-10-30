import { getUserSettingsForUser, upsertUserSettingsForUser } from "../user-settings.js";
import { invalidateLlmRuntimeConfig, mergeLlmRuntimeConfigRow, refreshLlmRuntimeConfig, saveLlmRuntimeConfig } from "./runtime-config.js";
import { llmRuntimeConfigToSelection } from "../providers/llm/runtime.js";

let mockDesktop = true;
jest.mock("../env.js", () => ({ ...jest.requireActual("../env.js"), getRuntimeEnvironment: () => ({ XUELEARN_DESKTOP_LOCAL: mockDesktop ? "1" : "0" }) }));
jest.mock("../user-context.js", () => ({ getCurrentUserId: () => "fixture-owner", resolveUserId: (id?: string) => id ?? "fixture-owner" }));
jest.mock("../providers/llm/resolve.js", () => ({ resetLlmProviderCache: jest.fn() }));
jest.mock("../user-settings.js", () => ({ getUserSettingsForUser: jest.fn(), upsertUserSettingsForUser: jest.fn() }));

const row = (preferences: string) => ({ llmProvider: "minimax", chatModel: "MiniMax-M3.1-Flash", embeddingModel: null, embeddingProvider: null,
  minimaxThinkingEnabled: false, ollamaThinkingEnabled: false, deepseekThinkingEnabled: false, openaiThinkingEnabled: false,
  bigmodelThinkingEnabled: false, qwenThinkingEnabled: false, doubaoThinkingMode: "disabled", customThinkingProtocol: "none",
  clientPreferencesJson: preferences, updatedAt: new Date(1) });

beforeEach(() => {
  mockDesktop = true;
  jest.clearAllMocks();
  invalidateLlmRuntimeConfig();
});

it.each(["{}", '{"minimaxReasoningEffort":"none"}', "invalid JSON"])("uses max for absent or invalid saved effort: %s", preferences => {
  expect(mergeLlmRuntimeConfigRow(row(preferences)).minimaxReasoningEffort).toBe("max");
});

it("persists manual effort, preserves other preferences and restores it into provider selection", async () => {
  let stored = row('{"codexReasoningEffort":"high","unrelated":{"keep":true}}');
  jest.mocked(getUserSettingsForUser).mockImplementation(async () => stored as never);
  jest.mocked(upsertUserSettingsForUser).mockImplementation(async (_id, data) => {
    stored = { ...stored, ...data.update, updatedAt: new Date(2) } as typeof stored;
    return { updatedAt: stored.updatedAt };
  });
  expect((await saveLlmRuntimeConfig({ provider: "minimax", chatModel: "MiniMax-M3.1-Flash", minimaxReasoningEffort: "low" })).minimaxReasoningEffort).toBe("low");
  expect(JSON.parse(stored.clientPreferencesJson)).toEqual({ codexReasoningEffort: "high", unrelated: { keep: true }, minimaxReasoningEffort: "low" });
  invalidateLlmRuntimeConfig();
  const restored = await refreshLlmRuntimeConfig();
  expect(llmRuntimeConfigToSelection(restored)).toMatchObject({ model: "MiniMax-M3.1-Flash", options: { minimaxReasoningEffort: "low" } });
});

it("keeps desktop effort out of hosted defaults", () => {
  mockDesktop = false;
  expect(mergeLlmRuntimeConfigRow(row('{"minimaxReasoningEffort":"low"}')).minimaxReasoningEffort).toBe("max");
});

it("rejects an invalid manual effort before writing settings", async () => {
  jest.mocked(getUserSettingsForUser).mockResolvedValue(row("{}") as never);
  await expect(saveLlmRuntimeConfig({ minimaxReasoningEffort: "none" as never })).rejects.toThrow();
  expect(upsertUserSettingsForUser).not.toHaveBeenCalled();
});
