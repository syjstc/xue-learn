import { ensureGoalAuthoringSession, findAcceptedGoalAuthoringIdentity } from "./session.js";

let mockRows: Array<Record<string, unknown>> = [];
jest.mock("../agents/core/checkpoint.js", () => ({
  requireAgentConversationPersistence: () => ({
    listAllMessages: async () => mockRows,
    findOrCreateScopedThread: async () => ({ id: "thread-1", stateJson: JSON.stringify({
      schemaVersion: 1, goalId: "goal-1", traceId: "77777777-7777-4777-8777-777777777777", blueprintMessageId: null,
    }) }),
  }),
}));
const commit = (name: string, id: string) => ({ id, role: "assistant", toolCalls: JSON.stringify([{ name, id, args: { title: "Accepted identity" } }]) });
const accepted = (id: string) => ({ id: `accepted-${id}`, role: "tool", toolCallId: id,
  content: JSON.stringify({ status: "accepted", tool: "commit_goal_identity" }) });
beforeEach(() => { mockRows = []; });

it("loads legacy authoring state with empty part checkpoints", async () => {
  const session = await ensureGoalAuthoringSession({ userId: "user-1", goalId: "goal-1" });
  expect(session.state.checkpoints).toEqual({});
});

it("adopts only an accepted identity after the current confirmed contract", async () => {
  mockRows = [commit("commit_goal_contract", "contract-1"), commit("commit_goal_identity", "identity-1"), accepted("identity-1")];
  expect(await findAcceptedGoalAuthoringIdentity("thread-1")).toEqual({ messageId: "accepted-identity-1", result: { title: "Accepted identity" } });
  mockRows.push(commit("commit_goal_contract", "contract-2"));
  expect(await findAcceptedGoalAuthoringIdentity("thread-1")).toBeUndefined();
});

it("does not adopt a rejected or unpaired tool result", async () => {
  mockRows = [commit("commit_goal_identity", "identity-1"), accepted("different-call")];
  expect(await findAcceptedGoalAuthoringIdentity("thread-1")).toBeUndefined();
  mockRows[1] = { ...accepted("identity-1"), content: JSON.stringify({ status: "rejected", tool: "commit_goal_identity" }) };
  expect(await findAcceptedGoalAuthoringIdentity("thread-1")).toBeUndefined();
});
