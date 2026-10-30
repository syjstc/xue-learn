import { learningPathFixture } from "../../../domain/src/learning-path-contract.fixture.js";
import { goalMapPlanSchema } from "../llm/schemas.js";
import { pathModuleBrief } from "./learning-path.js";
import { projectPathModule } from "./path-module-projection.js";
import { runGoalAuthoringRound } from "../goal-authoring/runner.js";
import { auditGoalModuleStructures } from "./module-structure-audit.js";
import { processModuleStructureAuditEvent, processModuleStructureDraftPrepareEvent } from "./module-structure-draft-worker.js";

let mockCheckpoint: any;
jest.mock("../goal-authoring/runner.js", () => ({ runGoalAuthoringRound: jest.fn() }));
jest.mock("./module-structure-audit.js", () => ({
  ...jest.requireActual("./module-structure-audit.js"), auditGoalModuleStructures: jest.fn(),
}));
jest.mock("../agents/goal-creation/work-gate.js", () => ({ goalCreationWorkGate: jest.fn(async () => "running") }));
jest.mock("../agents/core/checkpoint.js", () => ({
  loadCheckpoint: jest.fn(async () => mockCheckpoint),
  saveCheckpoint: jest.fn(async (_id, next) => { mockCheckpoint = next; }),
  requireAgentConversationPersistence: jest.fn(() => ({ findGoalCreationSessionByGoalId: async () => ({ id: "session", threadId: "thread" }) })),
}));
jest.mock("./session-progress.js", () => ({
  emitGoalCreationProgress: jest.fn(),
  withGoalCreationPlanningActivity: jest.fn(async (_session, _spec, work) => work()),
}));

function setup() {
  const path = learningPathFixture(3);
  const modules = path.modules.map((module, index) => ({
    title: `Module ${index + 1}`, summary: "Build the next operation.", objective: "Apply the next operation.", dependsOnPrevious: "Use the previous operation.",
    entryFoundationBriefs: [], ...pathModuleBrief(path, module),
  }));
  const plan = goalMapPlanSchema.parse({ schemaVersion: 2, refinedTitle: "Operations",
    domainAnalysis: { field: "Math", subdomain: "Operations", learningMode: "skill_practice", domainTag: "stem", topicCategory: "mathematics", modeClarification: "Learn through practice.", alternateInterpretations: [] },
    topicOverview: "Build three operations.", whatYouWillLearn: ["First", "Second", "Third"],
    majorAreas: modules.map((module) => ({ title: module.title, description: module.summary, mapRole: "leaf" })),
    modules, learningPath: path, mapStructure: { recommendedDepth: 1, estimatedLeafUnits: 3, layeringStrategy: "Sequential.", nestingRationale: "Build on earlier work." }, outOfScope: [], prerequisitesAssumed: [],
  });
  const repair = structuredClone(path.modules[0]!);
  repair.units.push({ ...structuredClone(repair.units[0]!), unitRef: "u_1_2", title: "Planning practice", summary: "Run subgoal checks and replan after failure." });
  const finding = { moduleId: "module-1", issueCode: "coverage_gap" as const, reason: "Teach subgoal verification and replanning." };
  const rows = modules.map((module, index) => {
    const projection = projectPathModule(module.unitPlanningBrief, "en")!;
    return { moduleId: `module-${index + 1}`, goalId: "goal", sessionId: "session", status: index ? "ready_for_audit" : "failed", attemptCount: 4,
      issuesJson: index ? "[]" : JSON.stringify([`The approved capability path needs revision: ${JSON.stringify([finding])}`]),
      candidateJson: JSON.stringify({ kind: "mastery", capabilities: projection.capabilities, ...projection.structure }), candidateHash: `original-${index}` };
  });
  const drafts = {
    claim: jest.fn(async () => ({ ...rows[0] })),
    patch: jest.fn(async (patch) => { Object.assign(rows.find((row) => row.moduleId === patch.moduleId)!, patch); return true; }),
    listByGoal: jest.fn(async () => rows),
    enqueueAuditEvent: jest.fn(), enqueueCoordinateEvent: jest.fn(), enqueuePrepareEvents: jest.fn(),
    commitPathRepairs: jest.fn(async () => true),
  };
  const repos = { drafts, moduleGenerationLease: { loadContext: jest.fn(async ({ moduleId }) => {
    const index = Number(moduleId.split("-")[1]) - 1;
    return { id: moduleId, goalId: "goal", ...modules[index]!, goal: { userId: "user", title: "Operations", contentLanguage: "en", learningMode: "mastery", planningMode: "fast", mapPlanJson: JSON.stringify(plan) } };
  }) } } as any;
  mockCheckpoint = { goalState: { goalId: "goal", mapPlan: plan, moduleAuditRepairRound: 0, auditStatus: "pending" } };
  jest.mocked(runGoalAuthoringRound).mockImplementation(async (input) => input.resultSchema.parse({ part: "module", entities: [], module: repair }));
  return { plan, rows, drafts, repos, finding };
}

beforeEach(() => jest.clearAllMocks());
const payloadJson = JSON.stringify({ goalId: "goal", sessionId: "session", moduleId: "module-1", reason: "retry_failed" });

it("continues a failed path module through constrained authoring and commits it only after a fresh audit", async () => {
  const { plan, rows, drafts, repos } = setup();
  const untouched = rows.slice(1).map((row) => ({ ...row }));
  expect((await processModuleStructureDraftPrepareEvent({ payloadJson, repos })).status).toBe("ready_for_audit");
  expect(runGoalAuthoringRound).toHaveBeenCalledWith(expect.objectContaining({ expectedTool: "commit_goal_path_part", meta: expect.objectContaining({ stage: "path_module_repair" }) }));
  expect(drafts.commitPathRepairs).not.toHaveBeenCalled();
  jest.mocked(auditGoalModuleStructures).mockResolvedValue({ passed: true, findings: [] });
  expect((await processModuleStructureAuditEvent({ payloadJson, repos })).status).toBe("passed");
  const committed = drafts.commitPathRepairs.mock.calls[0]![0] as any;
  const revised = JSON.parse(committed.mapPlanJson);
  expect(revised.learningPath.modules[0].units).toHaveLength(2);
  expect(revised.learningPath.modules.slice(1)).toEqual(plan.learningPath!.modules.slice(1));
  expect(revised.modules[0].estimatedUnitCount).toBe(2);
  expect(committed.modules.map((module: any) => module.moduleId)).toEqual(["module-1"]);
  expect(rows.slice(1)).toEqual(untouched);
  expect(mockCheckpoint.goalState.mapPlan.learningPath).toEqual(revised.learningPath);
  expect(drafts.enqueueCoordinateEvent).toHaveBeenCalledWith(expect.objectContaining({ reason: "audit_passed" }));
});

it("keeps failed revisions unpublished and carries the latest repaired skeleton into another repair", async () => {
  const { rows, drafts, repos, finding } = setup();
  await processModuleStructureDraftPrepareEvent({ payloadJson, repos });
  jest.mocked(auditGoalModuleStructures).mockResolvedValue({ passed: false, findings: [finding] });
  expect((await processModuleStructureAuditEvent({ payloadJson, repos })).status).toBe("repairing");
  expect(drafts.commitPathRepairs).not.toHaveBeenCalled();
  expect(drafts.enqueueCoordinateEvent).not.toHaveBeenCalled();
  await processModuleStructureDraftPrepareEvent({ payloadJson, repos });
  expect(JSON.parse(rows[0]!.candidateJson).pathRepair.module.units).toHaveLength(2);
});

it("retains the audit finding across a provider failure without recursively wrapping it", async () => {
  const { rows, repos } = setup();
  jest.mocked(runGoalAuthoringRound).mockRejectedValue(new Error("Model timeout"));
  expect((await processModuleStructureDraftPrepareEvent({ payloadJson, repos })).status).toBe("failed");
  expect(JSON.parse(rows[0]!.issuesJson)).toEqual(["coverage_gap: Teach subgoal verification and replanning.", "Model timeout"]);
});
