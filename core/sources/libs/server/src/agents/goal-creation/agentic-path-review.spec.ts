import { createInitialGoalState } from "./state.js";
import { learningPathFixture } from "../../../../domain/src/learning-path-contract.fixture.js";
import { runAgenticPostApproval } from "./agentic-workflow.js";
import { approveGoalPlan, generatePlanForGoal } from "./actions.js";

let mockCheckpoint: any;
jest.mock("../core/checkpoint.js", () => ({
  loadCheckpoint: jest.fn(async () => mockCheckpoint),
  saveCheckpoint: jest.fn(async (_id, next) => { mockCheckpoint = next; }),
  requireAgentConversationPersistence: jest.fn(() => ({})),
}));
jest.mock("./actions.js", () => ({
  approveGoalPlan: jest.fn(async () => undefined),
  generatePlanForGoal: jest.fn(),
}));
jest.mock("../../goal-creation/module-structure-draft-persistence.js", () => ({
  getModuleStructureDraft: jest.fn(() => ({})),
}));

describe("agentic capability-path review", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckpoint = {
      goalState: {
        ...createInitialGoalState(),
        goalId: "goal-1", executionMode: "agentic", mapPlanStatus: "ready",
        mapPlan: { learningPath: learningPathFixture() },
      },
    };
  });
  const run = (planConfirmed = false) => runAgenticPostApproval(
    { threadId: "thread-1", send: jest.fn(async () => undefined) } as never,
    "user-1", mockCheckpoint, {}, "session-1", { planConfirmed },
  );
  it("keeps a concrete plan ready for review before publishing unknown entry assumptions", async () => {
    const next = await run();
    expect(next.goalState.mapPlanStatus).toBe("ready");
    expect(approveGoalPlan).not.toHaveBeenCalled();
    expect(generatePlanForGoal).not.toHaveBeenCalled();
  });
  it("continues the same prepared plan after confirmation without regenerating it", async () => {
    await run();
    const next = await run(true);
    expect(next.goalState.mapPlanStatus).toBe("approved");
    expect(approveGoalPlan).toHaveBeenCalledWith("user-1", "goal-1", expect.objectContaining({
      sessionId: "session-1", structureQueueMode: "draft",
    }));
    expect(generatePlanForGoal).not.toHaveBeenCalled();
  });
  it("honors an explicit no-questions choice", async () => {
    mockCheckpoint.goalState.autoApproveWithoutQuestions = true;
    expect((await run()).goalState.mapPlanStatus).toBe("approved");
  });
});
