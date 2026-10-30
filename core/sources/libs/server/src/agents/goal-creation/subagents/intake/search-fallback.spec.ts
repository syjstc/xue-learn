import { createIntakeTools } from "./tools.js";
import { createInitialGoalState } from "../../state.js";
import { retrieveOrSearchWebKnowledge } from "../../../../search/web-knowledge.js";
import type { AgentRunContext } from "../../../core/types.js";

jest.mock("../../../../search/web-knowledge.js", () => ({
  retrieveOrSearchWebKnowledge: jest.fn(),
}));
describe("goal intake without web search", () => {
  it("continues after unavailable search and attempts it only once per goal, independently for each learner", async () => {
    const lookup = jest.mocked(retrieveOrSearchWebKnowledge);
    lookup
      .mockReset()
      .mockResolvedValue({
        context: "",
        sources: [],
        stale: false,
        activity: {
          id: "s1",
          mode: "web_search",
          status: "error",
          query: "topic",
          reason: "context",
          error: "not configured",
        },
      });
    const tool = createIntakeTools().find(
      (entry) => entry.name === "search_web_knowledge",
    )!;
    const send = jest.fn().mockResolvedValue(undefined);
    const context = () =>
      ({
        userId: "learner",
        threadId: "thread",
        state: createInitialGoalState(),
        send,
      }) as unknown as AgentRunContext & { state: Record<string, unknown> };
    const first = context();
    expect(
      await tool.handler({ query: "topic", reason: "context" }, first),
    ).toMatchObject({
      continueWithoutSearch: true,
      activity: { status: "skipped" },
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "knowledge_activity",
        activity: expect.objectContaining({ status: "skipped" }),
      }),
    );
    expect(
      await tool.handler({ query: "try again", reason: "context" }, first),
    ).toMatchObject({ continueWithoutSearch: true });
    expect(lookup).toHaveBeenCalledTimes(1);
    await tool.handler({ query: "topic", reason: "context" }, context());
    expect(lookup).toHaveBeenCalledTimes(2);
  });
});
