import {GoalCreationSessionService} from "./goal-creation-session.service.js";
import {saveCheckpoint} from "../../agents/core/checkpoint.js";

jest.mock("../../agents/core/checkpoint.js", () => ({saveCheckpoint: jest.fn()}));
jest.mock("../../rag/vector-store.js", () => ({}));
jest.mock("../../learning-spaces/learning-space-orm.provider.js", () => ({LearningSpaceOrmProvider: class {}}));

function fixture(firstUnitId: string | null, published = 1) {
  const session = {id: "session", threadId: "thread", goalId: "goal", status: "running"};
  const conversation = {
    findGoalCreationSessionById: jest.fn(async () => session),
    findThread: jest.fn(async () => ({stateJson: JSON.stringify({goalState: {executionMode: "agentic", goalId: "goal"}})})),
    appendGoalCreationEvent: jest.fn(), markGoalCreationFirstUnitReady: jest.fn(async () => true), completeGoalCreationSession: jest.fn(async () => true),
  };
  const service = new GoalCreationSessionService({agentConversation: conversation, moduleStructureDraft: {
    progressForGoal: async () => ({modules: Array.from({length: 8}, (_,i) => ({id: `m${i}`})), publishedModuleCount: published}),
  }} as never) as any;
  service.completeMicroSessionIfReady = jest.fn(async () => false);
  service.resolveJourney = jest.fn(async () => ({firstReadyUnitId: firstUnitId}));
  return {service, conversation};
}
beforeEach(() => jest.clearAllMocks());

it("announces the first usable lesson while seven modules are still preparing and leaves background creation running", async () => {
  const {service, conversation} = fixture("first", 1);
  await service.reconcile("session");
  expect(conversation.completeGoalCreationSession).not.toHaveBeenCalled();
  expect(conversation.appendGoalCreationEvent).toHaveBeenCalledWith("session", expect.objectContaining({type: "first_unit_ready",
    payload: expect.objectContaining({firstUnitId: "first", navigateTo: "/goals/goal/units/first"})}));
  expect(conversation.markGoalCreationFirstUnitReady).toHaveBeenCalledWith("session", "first");
  expect(saveCheckpoint).not.toHaveBeenCalled();
});

it("does not call structures a usable lesson while its initial cognitive model is pending", async () => {
  const {service, conversation} = fixture(null, 8);
  await service.reconcile("session");
  expect(conversation.completeGoalCreationSession).not.toHaveBeenCalled();
  expect(conversation.appendGoalCreationEvent).not.toHaveBeenCalled();
});

it("completes the background session once all modules and the first lesson are ready", async () => {
  const {service, conversation} = fixture("first", 8);
  await service.reconcile("session");
  expect(conversation.completeGoalCreationSession).toHaveBeenCalledWith("session", "first", expect.any(Date));
});
