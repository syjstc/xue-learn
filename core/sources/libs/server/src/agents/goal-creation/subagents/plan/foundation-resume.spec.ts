import { applyPlanResumeResult } from "./tools.js";
import { generatePlanForGoal } from "../../actions.js";

jest.mock("../../actions.js", () => ({ generatePlanForGoal: jest.fn() }));

it("passes the explicit baseline identity to the bounded bridge revision and keeps the revised plan in review", async () => {
  const plan = { preserved: true };
  jest.mocked(generatePlanForGoal).mockResolvedValue(plan as never);
  const state: Record<string, unknown> = {
    goalId: "goal-1",
    mapPlanStatus: "ready",
  };
  await applyPlanResumeResult(
    "review_plan",
    {
      approved: false,
      feedback: "Teach this foundation first.",
      foundationEntityKey: "skill.entry",
    },
    {
      state,
      userId: "user-1",
      threadId: "thread-1",
      traceId: "trace-1",
      send: jest.fn(),
    } as never,
  );
  expect(generatePlanForGoal).toHaveBeenCalledWith(
    "user-1",
    expect.objectContaining({ goalId: "goal-1" }),
    expect.anything(),
    expect.objectContaining({
      adjustment: "Teach this foundation first.",
      foundationEntityKey: "skill.entry",
    }),
  );
  expect(state).toMatchObject({
    mapPlan: plan,
    mapPlanStatus: "ready",
    currentPhase: "reviewing_plan",
  });
});
