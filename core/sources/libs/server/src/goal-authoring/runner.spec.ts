import { z } from "zod";
import { learningPathFixture } from "../../../domain/src/learning-path-contract.fixture.js";
import { runGoalPathAuthoring } from "./path.js";
import { resolveStructuredContract } from "../llm/structured-contract.js";
import { runUnitAuthoringAgentRound } from "../unit-authoring/agent-round.js";
import { runGoalAuthoringRound, seedGoalAuthoringContract } from "./runner.js";
import { findAcceptedGoalAuthoringIdentity, saveGoalAuthoringState } from "./session.js";

let mockState: { traceId: string; blueprintMessageId: string | null; checkpoints: Record<string, { messageId: string; result: unknown }> };
jest.mock("../unit-authoring/agent-round.js", () => ({
  runUnitAuthoringAgentRound: jest.fn(),
  splitUnitAuthoringBootstrapPrompt: (prompt: string) => ({ userPrompt: prompt }),
}));
jest.mock("./session.js", () => ({
  ensureGoalAuthoringSession: async () => ({ threadId: "authoring-thread", state: mockState }),
  loadGoalAuthoringMessages: async () => [],
  findAcceptedGoalAuthoringIdentity: jest.fn(),
  appendGoalAuthoringMessage: async () => ({ id: "accepted-message" }),
  saveGoalAuthoringState: jest.fn(async (_threadId, state) => { mockState = state; }),
}));

const request = {
  userId: "user-1", goalId: "goal-1", expectedTool: "commit_goal_path_part",
  prompt: "Author only this part.", resultSchema: z.object({ ok: z.boolean() }),
  operation: "goal.authoring_agent", checkpointKey: "path:module:1",
};
beforeEach(() => {
  jest.clearAllMocks();
  mockState = { traceId: "trace-1", blueprintMessageId: null, checkpoints: {} };
  jest.mocked(findAcceptedGoalAuthoringIdentity).mockResolvedValue(undefined);
  jest.mocked(runUnitAuthoringAgentRound).mockResolvedValue({
    result: { ok: true }, repairMessages: [],
    userMessage: { role: "user", content: request.prompt },
    assistantMessage: { role: "assistant", content: "" },
    toolMessage: { role: "tool", toolCallId: "call-1", content: "accepted" },
  });
});

it("keeps each path segment on the normal budget and branches only after final validation", async () => {
  await runGoalAuthoringRound(request);
  const invocation = jest.mocked(runUnitAuthoringAgentRound).mock.calls[0]![0];
  expect(resolveStructuredContract({ operation: invocation.operation!, mode: "tool-call",
    schemas: [invocation.resultSchema], metadata: invocation.contract }).limits.maxTokens).toBe(16_384);
  expect(mockState.blueprintMessageId).toBeNull();
  await runGoalAuthoringRound({ ...request, checkpointKey: "path:module:2", markBlueprint: true });
  expect(mockState.blueprintMessageId).toBe("accepted-message");
});

it("reuses accepted parts without another model call or repeated source prompt", async () => {
  expect(await runGoalAuthoringRound(request)).toEqual({ ok: true });
  expect(await runGoalAuthoringRound(request)).toEqual({ ok: true });
  expect(runUnitAuthoringAgentRound).toHaveBeenCalledTimes(1);
  expect(mockState.checkpoints[request.checkpointKey]!.result).toEqual({ ok: true });
});

it("validates restored parts again instead of trusting an invalid checkpoint", async () => {
  mockState.checkpoints[request.checkpointKey] = { messageId: "invalid", result: {} };
  expect(await runGoalAuthoringRound(request)).toEqual({ ok: true });
  expect(runUnitAuthoringAgentRound).toHaveBeenCalledTimes(1);
});

it("adopts a previously accepted identity when upgrading an interrupted legacy draft", async () => {
  jest.mocked(findAcceptedGoalAuthoringIdentity).mockResolvedValue({ messageId: "legacy-identity", result: { ok: true } });
  await runGoalAuthoringRound({ ...request, expectedTool: "commit_goal_identity", checkpointKey: "identity:1" });
  expect(runUnitAuthoringAgentRound).not.toHaveBeenCalled();
  expect(mockState.checkpoints["identity:1"]!.messageId).toBe("legacy-identity");
});

it("does not reuse a different identity checkpoint after changed planning requirements", async () => {
  mockState.checkpoints["identity:old"] = { messageId: "old", result: { ok: true } };
  await runGoalAuthoringRound({ ...request, expectedTool: "commit_goal_identity", checkpointKey: "identity:new" });
  expect(findAcceptedGoalAuthoringIdentity).not.toHaveBeenCalled();
  expect(runUnitAuthoringAgentRound).toHaveBeenCalledTimes(1);
});

it("invalidates prior parts when the confirmed contract changes", async () => {
  mockState.checkpoints["identity:old"] = { messageId: "old", result: { ok: true } };
  mockState.blueprintMessageId = "old-blueprint";
  await seedGoalAuthoringContract({ userId: "user-1", goalId: "goal-1",
    userRequest: "Add a bridge.", contract: { level: "zero" }, traceId: "trace-1" });
  expect(mockState.checkpoints).toEqual({});
  expect(mockState.blueprintMessageId).toBeNull();
  expect(saveGoalAuthoringState).toHaveBeenCalled();
});

it("resumes at the failed module and retains accepted outline, registry and earlier modules", async () => {
  const path = learningPathFixture();
  const modules = path.modules.map((_, index) => ({ title: `Module ${index + 1}`,
    summary: "Learn the next operation.", objective: "Apply the operation.", dependsOnPrevious: "Earlier operation." }));
  const registry = { entities: path.entities, baseline: path.baseline, goal: path.goal,
    moduleTargets: path.modules.map(({ moduleRef, provides }) => ({ moduleRef, provides })) };
  let failed = false;
  const calls: string[] = [];
  jest.mocked(runUnitAuthoringAgentRound).mockImplementation(async (input) => {
    const stage = String(input.meta!.stage);
    const moduleRef = String(input.meta!.moduleRef ?? "");
    calls.push(`${stage}:${moduleRef}`);
    if (moduleRef === "m_2" && !failed) { failed = true; throw Error("Interrupted module 2"); }
    const candidate = stage === "path_outline" ? { part: "outline", modules }
      : stage === "path_registry" ? { part: "registry", registry }
      : { part: "module", entities: [], module: path.modules[Number(input.meta!.moduleIndex) - 1] };
    const result = input.resultSchema.parse(candidate);
    return { result, repairMessages: [], userMessage: { role: "user", content: input.prompt },
      assistantMessage: { role: "assistant", content: "" },
      toolMessage: { role: "tool", content: "accepted", toolCallId: "call-1" } };
  });
  const input = { userId: "user-1", goalId: "goal-1", instruction: "Teach operations.", identity: {
    schemaVersion: 2 as const, topicOverview: "Learn operations.", whatYouWillLearn: ["One", "Two", "Three"],
    prerequisitesAssumed: [], domainAnalysis: { field: "Math", subdomain: "Operations", learningMode: "skill_practice" as const,
      domainTag: "stem" as const, topicCategory: "mathematics" as const, modeClarification: "Practice.", alternateInterpretations: [] },
  } };
  await expect(runGoalPathAuthoring(input)).rejects.toThrow("Interrupted module 2");
  expect(mockState.blueprintMessageId).toBeNull();
  expect((await runGoalPathAuthoring(input)).learningPath).toEqual(path);
  expect(calls).toEqual(["path_outline:", "path_registry:", "path_module:m_1", "path_module:m_2", "path_module:m_2", "path_module:m_3"]);
  expect(mockState.blueprintMessageId).toBe("accepted-message");
});
