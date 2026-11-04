import { learningPathFixture } from "../../../domain/src/learning-path-contract.fixture.js";
import { goalMapPlanSchema } from "../llm/schemas.js";
import { pathModuleBrief } from "./learning-path.js";
import { projectPathModule } from "./path-module-projection.js";
import { runGoalAuthoringRound } from "../goal-authoring/runner.js";
import { auditGoalModuleStructures } from "./module-structure-audit.js";
import { processGoalCreationCoordinateEvent, processModuleStructureAuditEvent, processModuleStructureDraftPrepareEvent, recoverStuckAgenticGoalCreation } from "./module-structure-draft-worker.js";
import { enqueueInitialModuleKacomOnGoalOpen } from "../goals/sequential-modules.js";

let mockCheckpoint: any;
const mockSessionError = jest.fn();
jest.mock("../goal-authoring/runner.js", () => ({ runGoalAuthoringRound: jest.fn() }));
jest.mock("../goals/sequential-modules.js", () => ({enqueueInitialModuleKacomOnGoalOpen: jest.fn()}));
jest.mock("./module-structure-audit.js", () => ({
  ...jest.requireActual("./module-structure-audit.js"), auditGoalModuleStructures: jest.fn(),
}));
jest.mock("../agents/goal-creation/work-gate.js", () => ({ goalCreationWorkGate: jest.fn(async () => "running") }));
jest.mock("../agents/core/checkpoint.js", () => ({
  loadCheckpoint: jest.fn(async () => mockCheckpoint),
  saveCheckpoint: jest.fn(async (_id, next) => { mockCheckpoint = next; }),
  requireAgentConversationPersistence: jest.fn(() => ({ findGoalCreationSessionByGoalId: async () => ({ id: "session", threadId: "thread" }), markGoalCreationSessionError: mockSessionError })),
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


it("audits a proposed metadata-only title before atomically committing it with the unchanged path", async () => {
  const { plan, rows, drafts, repos } = setup();
  const brief = { title: "Actual first operation", summary: "Describe the already planned first operation.", objective: "Perform the first operation.", dependsOnPrevious: "Use the entry foundation." };
  rows[0]!.issuesJson = JSON.stringify(["goal_drift: Heading does not describe its already planned lessons."]);
  jest.mocked(runGoalAuthoringRound).mockImplementation(async (input) => input.resultSchema.parse({ part: "module", entities: [], module: plan.learningPath!.modules[0], moduleBrief: brief }));
  expect((await processModuleStructureDraftPrepareEvent({ payloadJson, repos })).status).toBe("ready_for_audit");
  expect(drafts.commitPathRepairs).not.toHaveBeenCalled();
  expect(JSON.parse(rows[0]!.candidateJson).pathRepair.moduleBrief).toEqual(brief);
  jest.mocked(auditGoalModuleStructures).mockResolvedValue({ passed: true, findings: [] });
  expect((await processModuleStructureAuditEvent({ payloadJson, repos })).status).toBe("passed");
  expect(auditGoalModuleStructures).toHaveBeenCalledWith(expect.objectContaining({ drafts: expect.arrayContaining([expect.objectContaining({ moduleId: "module-1", title: brief.title })]) }));
  const committed = drafts.commitPathRepairs.mock.calls[0]![0] as any;
  expect(committed.modules[0].metadata).toEqual(brief);
  const revised = JSON.parse(committed.mapPlanJson);
  expect(revised.modules[0]).toMatchObject(brief);
  expect(revised.majorAreas[0]).toMatchObject({ title: brief.title, description: brief.summary });
  expect(revised.majorAreas.slice(1)).toEqual(plan.majorAreas.slice(1));
  expect(revised.learningPath).toEqual(plan.learningPath);
  expect(revised.modules.slice(1)).toEqual(plan.modules!.slice(1));
});

it("never publishes metadata when the fresh catalog audit still fails", async () => {
  const { plan, drafts, repos, finding } = setup();
  jest.mocked(runGoalAuthoringRound).mockImplementation(async (input) => input.resultSchema.parse({ part: "module", entities: [], module: plan.learningPath!.modules[0], moduleBrief: { title: "Aligned heading", summary: "Same lessons.", objective: "Same exit.", dependsOnPrevious: "Same entry." } }));
  await processModuleStructureDraftPrepareEvent({ payloadJson, repos });
  jest.mocked(auditGoalModuleStructures).mockResolvedValue({ passed: false, findings: [finding] });
  await processModuleStructureAuditEvent({ payloadJson, repos });
  expect(drafts.commitPathRepairs).not.toHaveBeenCalled();
  expect(drafts.enqueueCoordinateEvent).not.toHaveBeenCalled();
});

function starter() {
  const result = setup();
  result.rows.forEach((row, index) => {row.status = index ? "queued" : "ready_for_audit";});
  const load = result.repos.moduleGenerationLease.loadContext;
  result.repos.moduleGenerationLease.loadContext = jest.fn(async input => ({...await load(input), orderIndex: 0, curriculumKey: "starter-key"}));
  Object.assign(result.repos.moduleGenerationLease, {claim: jest.fn(async () => ({claimed: true})), release: jest.fn(), fail: jest.fn()});
  result.repos.moduleStructureQueue = {};
  result.repos.preparedModulePublication = {publishMastery: jest.fn(async () => ({createdUnitCount: 1}))};
  result.repos.cognitiveModelInvalidation = {};
  return result;
}

it("keeps the published starter ready when a later module needs full-catalog repair", async () => {
  const { rows, drafts, repos } = starter();
  rows[0]!.status = "ready";
  rows.slice(1).forEach((row) => { row.status = "ready_for_audit"; });
  const publishedStarter = { ...rows[0]! };
  jest.mocked(auditGoalModuleStructures).mockResolvedValue({
    passed: false,
    findings: [{ moduleId: "module-2", issueCode: "coverage_gap", reason: "Add practice for the second milestone." }],
  });

  expect((await processModuleStructureAuditEvent({ payloadJson, repos })).status).toBe("repairing");
  expect(rows[0]).toEqual(publishedStarter);
  expect(drafts.patch).not.toHaveBeenCalledWith(expect.objectContaining({ moduleId: "module-1" }));
  expect(rows[1]!.status).toBe("repairing");
  expect(drafts.enqueuePrepareEvents).toHaveBeenCalledWith(expect.objectContaining({ moduleIds: ["module-2"], reason: "audit_repair" }));
});

it("audits and publishes the starter before later modules, prioritizes its model and keeps the rest queued for background work", async () => {
  const {rows, drafts, repos} = starter();
  jest.mocked(auditGoalModuleStructures).mockResolvedValue({passed: true, findings: []});
  const result = await processGoalCreationCoordinateEvent({payloadJson: JSON.stringify({goalId: "goal", sessionId: "session", reason: "starter_ready"}), repos});
  expect(result.status).toBe("seeded");
  expect(auditGoalModuleStructures).toHaveBeenCalledWith(expect.objectContaining({scope: "starter", drafts: [expect.objectContaining({moduleId: "module-1"})]}));
  expect(rows.map(row => row.status)).toEqual(["ready", "queued", "queued"]);
  expect(repos.preparedModulePublication.publishMastery).toHaveBeenCalledTimes(1);
  expect(enqueueInitialModuleKacomOnGoalOpen).toHaveBeenCalledWith("goal", repos.moduleStructureQueue, repos.cognitiveModelInvalidation, "first_lesson_priority");
  expect(drafts.enqueuePrepareEvents).toHaveBeenCalledWith(expect.objectContaining({moduleIds: ["module-2", "module-3"], reason: "background_modules"}));
});

it("does not publish a starter that fails its own audit; keeps the full audit and repair path available", async () => {
  const {rows, drafts, repos, finding} = starter();
  jest.mocked(auditGoalModuleStructures).mockResolvedValue({passed: false, findings: [finding]});
  await processGoalCreationCoordinateEvent({payloadJson, repos});
  expect(rows[0]!.status).toBe("ready_for_audit");
  expect(repos.preparedModulePublication.publishMastery).not.toHaveBeenCalled();
  expect(enqueueInitialModuleKacomOnGoalOpen).not.toHaveBeenCalled();
  expect(mockCheckpoint.goalState.starterAuditDeferred).toBe(true);
  expect(drafts.enqueuePrepareEvents).toHaveBeenCalledWith(expect.objectContaining({moduleIds: ["module-2", "module-3"]}));
});

it("keeps later module work behind the starter instead of blocking first access on a full fan-out", async () => {
  const {rows, drafts, repos} = starter();rows[0]!.status = "researching";
  const result = await processGoalCreationCoordinateEvent({payloadJson, repos});
  expect(result.status).toBe("waiting_for_starter");
  expect(drafts.enqueuePrepareEvents).not.toHaveBeenCalled();
  expect(auditGoalModuleStructures).not.toHaveBeenCalled();
});

it("reports a failed first module immediately while later modules are still held", async () => {
  const {rows, drafts, repos} = starter(); rows[0]!.status = "failed";
  expect((await processGoalCreationCoordinateEvent({payloadJson, repos})).status).toBe("needs_attention");
  expect(mockSessionError).toHaveBeenCalledWith("session", expect.any(String));
  expect(drafts.enqueuePrepareEvents).not.toHaveBeenCalled();
});

it.each(["ready_for_audit", "ready", "queued"])("recovers a %s starter with later modules still queued", async (status) => {
  const {rows, drafts} = starter(); rows[0]!.status = status;
  const repository = {...drafts, listGoalSessionsWithStatuses: jest.fn(async () => [{goalId: "goal", sessionId: "session"}])};
  await recoverStuckAgenticGoalCreation(repository as never);
  expect(drafts.enqueueCoordinateEvent).toHaveBeenCalledWith(expect.objectContaining({reason: "resume_starter"}));
});

it("does not grant a full audit pass when resuming a crashed starter publication", async () => {
  const {rows, drafts, repos} = starter(); rows[0]!.status = "publishing";
  rows[1]!.status = "ready_for_audit";
  const repository = {...drafts, listGoalSessionsWithStatuses: jest.fn(async () => [{goalId: "goal", sessionId: "session"}])};
  await recoverStuckAgenticGoalCreation(repository as never);
  expect(drafts.enqueueCoordinateEvent).toHaveBeenCalledWith(expect.objectContaining({reason: "resume_publication"}));
  expect(drafts.enqueueCoordinateEvent).not.toHaveBeenCalledWith(expect.objectContaining({reason: "audit_passed"}));
  await processGoalCreationCoordinateEvent({payloadJson: JSON.stringify({goalId: "goal", sessionId: "session", reason: "resume_publication"}), repos});
  expect(repos.preparedModulePublication.publishMastery).toHaveBeenCalledTimes(1);
  expect(rows[1]!.status).toBe("ready_for_audit");
});
