import {configureTeachingDerivationPersistence, requireTeachingDerivationPersistence, runWithTeachingDerivationGenerationFence} from "./persistence.js";
import {commitTeachingStepForRun} from "./session.js";
import {generateTeachingDerivationDocument} from "../../../sections/teaching-derivation-generation.js";
import {emptyTeachingDerivationDocument, compileTeachingDerivation} from "../../../../../teaching-derivation/src/index.js";
import type {TeachingDerivationRepository, TeachingDerivationRunRecord, TeachingDerivationStepRecord} from "../../../../../domain/src/index.js";

const mockAgent = jest.fn();
jest.mock("../../../teaching-derivation/agent-runner.js", () => ({runTeachingDerivationAgent: (...args: unknown[]) => mockAgent(...args)}));
function fixture() {
  const runs = new Map<string, TeachingDerivationRunRecord>(), steps = new Map<string, TeachingDerivationStepRecord>();
  const repository: TeachingDerivationRepository = {
    createRun: jest.fn(async input => {runs.set(input.id, {...input, ownerUserId: input.ownerUserId ?? null, generationToken: input.generationToken ?? null,
      status: input.status ?? "draft", revision: 0, repairAttempts: 0, eventsJson: "[]", nextEventSequence: 0} as TeachingDerivationRunRecord);}),
    getRun: jest.fn(async id => runs.get(id) ?? null), listRunsBySection: jest.fn(async () => []),
    updateRun: jest.fn(async input => {
      const run = runs.get(input.id);
      if (!run || input.expectedGenerationToken !== undefined && input.expectedGenerationToken !== run.generationToken) return false;
      const {expectedGenerationToken: _fence, ...patch} = input;
      runs.set(input.id, {...run, ...patch}); return true;
    }),
    appendStep: jest.fn(async input => {
      const run = runs.get(input.runId);
      if (!run || run.revision !== input.expectedRevision || input.expectedGenerationToken !== undefined && input.expectedGenerationToken !== run.generationToken) return false;
      runs.set(input.runId, {...run, documentJson: input.documentJson, derivedJson: input.derivedJson, revision: input.revision, repairAttempts: input.repairAttempts});
      steps.set(`${input.runId}/${input.step.ordinal}`, {...input.step, createdAt: input.now}); return true;
    }),
    getStepByOrdinal: jest.fn(async (id, ordinal) => steps.get(`${id}/${ordinal}`) ?? null), listSteps: jest.fn(async () => [...steps.values()]),
    appendEvent: jest.fn(async input => ({sequence: 0, eventJson: input.eventJson})),
  };
  const document = emptyTeachingDerivationDocument({id: "child", title: "等式", locale: "zh-Hans"});
  runs.set("child", {id: "child", ownerUserId: "owner", unitId: "unit", generationToken: "lease-1", documentJson: JSON.stringify(document),
    derivedJson: JSON.stringify(compileTeachingDerivation(document)), revision: 0, repairAttempts: 0, status: "running"} as TeachingDerivationRunRecord);
  configureTeachingDerivationPersistence(repository);
  return {runs, steps, repository};
}
const fence = {runId: "child", ownerUserId: "owner", token: "lease-1"};
afterEach(() => {configureTeachingDerivationPersistence(undefined); mockAgent.mockReset();});

test("ordinary callers retain the same repository while display child commits carry the token fence", async () => {
  const {repository, runs} = fixture();
  expect(requireTeachingDerivationPersistence()).toBe(repository);
  const committed = await runWithTeachingDerivationGenerationFence(fence, () => commitTeachingStepForRun("child", {
    teachingGoal: "说明等式", givens: ["已知等式成立"], board: [{key: "work", title: "原式", latex: "x+1=3", role: "primary"}],
    relation: "introduce", justification: "保留已知等式", narration: "先观察原来的等式。", focusFormulaKey: "work",
  }));
  expect(committed).toMatchObject({ok: true});
  expect(repository.appendStep).toHaveBeenCalledWith(expect.objectContaining({expectedGenerationToken: "lease-1", expectedRevision: 0}));
  expect(runs.get("child")?.revision).toBe(1);
  await repository.updateRun({id: "child", status: "failed", now: new Date()});
  expect(repository.updateRun).toHaveBeenLastCalledWith({id: "child", status: "failed", now: expect.any(Date)});
});

test("stale owners and cancellation cannot append child steps or finish a newer attempt", async () => {
  const {repository, runs} = fixture();
  await runWithTeachingDerivationGenerationFence(fence, async () => {
    const scoped = requireTeachingDerivationPersistence();
    runs.set("child", {...runs.get("child")!, generationToken: "lease-2"});
    await expect(scoped.updateRun({id: "child", status: "complete", now: new Date()})).rejects.toThrow("lease lost");
    await expect(scoped.getRun("different-child")).rejects.toThrow("scope changed");
  });
  expect(repository.updateRun).not.toHaveBeenCalled();
  const controller = new AbortController(); controller.abort(Error("cancelled by owner"));
  await expect(runWithTeachingDerivationGenerationFence({...fence, token: "lease-2", signal: controller.signal}, async () => {
    await requireTeachingDerivationPersistence().updateRun({id: "child", status: "complete", now: new Date()});
  })).rejects.toThrow("cancelled by owner");
  expect(runs.get("child")?.status).toBe("running");
});

test("the database token CAS rejects takeover after the pre-write ownership check", async () => {
  const {repository, runs} = fixture();
  const write = repository.updateRun;
  repository.updateRun = jest.fn(async input => {
    runs.set("child", {...runs.get("child")!, generationToken: "lease-2"});
    return write(input);
  });
  await expect(runWithTeachingDerivationGenerationFence(fence, () => requireTeachingDerivationPersistence().updateRun({id: "child", status: "complete", now: new Date()}))).rejects.toThrow("lease lost");
  expect(write).toHaveBeenCalledWith(expect.objectContaining({expectedGenerationToken: "lease-1"}));
  expect(runs.get("child")?.status).toBe("running");
});

test("the real shared generator scopes only display builds and never marks the new child owner failed", async () => {
  const {runs} = fixture();
  let childId = "";
  mockAgent.mockImplementation(async ({runId}) => {
    childId = runId;
    runs.set(runId, {...runs.get(runId)!, generationToken: "replacement-lease"});
    await requireTeachingDerivationPersistence().updateRun({id: runId, status: "complete", now: new Date()});
  });
  await expect(generateTeachingDerivationDocument({userId: "owner", unitId: "unit", token: "first-lease", locale: "zh-Hans", unitTitle: "等式", sectionTitle: "等式", contentSummary: "保留全部推导",
    runScope: {kind: "display-build", jobId: "job", sourceHash: "source", revision: 1}})).rejects.toThrow("lease lost");
  expect(mockAgent).toHaveBeenCalledTimes(1);
  expect(runs.get(childId)).toMatchObject({generationToken: "replacement-lease", status: "running"});
});
