import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReadingWorkspaceService, type ReadingGenerators, type ReadingSource } from "./workspace.js";
import { createDisplayBuildRuntime } from "../display-build/service.js";

const source: ReadingSource = {
  unitId: "unit", goalId: "goal", title: "Functions", language: "en",
  sections: [{id: "section", title: "Quadratics", scope: "Explain y = ax²"}, {id: "second", title: "A second chapter", scope: "Read independently"}],
};
const draft = {title: "Quadratics", blocks: [
  {type: "paragraph" as const, text: "Changing a changes the curvature."},
  {type: "component_slot" as const, title: "Graph", componentType: "svg" as const, description: "Compare two parabolas"},
  {type: "paragraph" as const, text: "The text after the figure remains readable."},
]};
const artifact = {type: "svg" as const, svg: '<svg viewBox="0 0 10 10"></svg>', caption: "A figure", alt: "A figure"};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {resolve = r;});
  return {promise, resolve};
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal) {
  return Promise.race([promise, new Promise<never>((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), {once: true});
  })]);
}
async function until<T>(read: () => Promise<T>, check: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const value = await read();
    if (check(value)) return value;
    if (Date.now() > deadline) throw Error(`Timed out: ${JSON.stringify(value)}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
let directory: string;
const workers: Array<{stop(): Promise<void>}> = [];
beforeEach(async () => {directory = await mkdtemp(join(tmpdir(), "reading-"));});
afterEach(async () => {
  await Promise.all(workers.splice(0).map(worker => worker.stop()));
  await rm(directory, {recursive: true, force: true});
});
function make(generators: Partial<ReadingGenerators> = {}) {
  const workspace = new ReadingWorkspaceService({
    directory,
    readSource: async owner => owner === "alice" ? source : null,
    generators: {document: async () => draft, component: async () => artifact, ...generators},
  });
  workers.push(workspace);
  return workspace;
}

it("pushes a readable JIT prefix before authoring finishes and survives observer disconnects", async () => {
  const body = deferred<void>(), figure = deferred<typeof artifact>();
  const workspace = make({
    document: async (_, signal, onPartial) => {
      await onPartial({...draft, blocks: draft.blocks.slice(0, 2)});
      await abortable(body.promise, signal);
      return draft;
    },
    component: (_, __, signal) => abortable(figure.promise, signal),
  });
  await workspace.start();
  const observed = jest.fn(), otherOwner = jest.fn(), otherUnit = jest.fn();
  const unsubscribe = workspace.subscribe("alice", "unit", observed);
  workspace.subscribe("bob", "unit", otherOwner);
  workspace.subscribe("alice", "other", otherUnit);
  const job = await workspace.generate("alice", "unit", "section");
  const partial = await until(() => workspace.read("alice", "unit"),
    course => course?.sections[0].reading?.document?.blocks.length === 2);
  expect(partial!.sections[0].reading).toMatchObject({jobId: job.jobId, status: "running", pendingComponents: 1});
  expect(await workspace.document("alice", "unit", "section", job.jobId)).toEqual(partial!.sections[0].reading!.document);
  expect(await workspace.document("bob", "unit", "section", job.jobId)).toBeNull();
  expect(await workspace.document("alice", "another-unit", "section", job.jobId)).toBeNull();
  expect(await workspace.document("alice", "unit", "second", job.jobId)).toBeNull();
  expect(partial!.sections[0]).not.toHaveProperty("legacy");
  expect(observed).toHaveBeenCalled();
  expect(otherOwner).not.toHaveBeenCalled();
  expect(otherUnit).not.toHaveBeenCalled();
  unsubscribe();
  const delivered = observed.mock.calls.length;
  body.resolve();
  const complete = await until(() => workspace.read("alice", "unit"),
    course => course?.sections[0].reading?.status === "ready");
  expect(complete!.sections[0].reading!.document!.blocks.slice(0, 2)).toMatchObject(
    partial!.sections[0].reading!.document!.blocks.map(({component: _component, ...block}) => block),
  );
  expect(await workspace.components.repository.list()).toHaveLength(1);
  expect(observed).toHaveBeenCalledTimes(delivered);
  figure.resolve(artifact);
});

it("publishes the complete body and subsequent chapters while components and Display are blocked", async () => {
  const figure = deferred<typeof artifact>(), displayGate = deferred<unknown>();
  const display = createDisplayBuildRuntime({directory: join(directory, "display"), builders: [{
    kind: "test:display", version: 1, build: ({signal}) => abortable(displayGate.promise, signal),
  }]});
  workers.push(display);
  await display.start();
  const displayJob = await display.enqueue({ownerUserId: "alice", scopeKey: "unit/section", kind: "test:display", componentVersion: 1, input: {}});
  const workspace = make({component: (_, __, signal) => abortable(figure.promise, signal)});
  await workspace.start();
  await workspace.generate("alice", "unit", "section");
  const course = await until(() => workspace.read("alice", "unit"), c => c?.sections[0].reading?.status === "ready");
  expect(course!.sections[0].reading!.pendingComponents).toBe(1);
  expect(course!.sections[0].reading!.document!.blocks[2]).toMatchObject({text: "The text after the figure remains readable."});
  await workspace.generate("alice", "unit", "second");
  await until(() => workspace.read("alice", "unit"), c => c?.sections[1].reading?.status === "ready");
  expect((await display.getOwned(displayJob.id, "alice"))!.status).toBe("running");
  figure.resolve(artifact);
  await until(() => workspace.read("alice", "unit"), c => c?.sections[0].reading?.pendingComponents === 0);
  expect((await workspace.read("alice", "unit"))!.sections[0].reading!.document!.blocks[1].component?.artifact).toEqual(artifact);
});

it("publishes around an invalid block and keeps later component IDs stable when its gap is repaired", async () => {
  const repair = deferred<void>(), figure = deferred<typeof artifact>();
  const workspace = make({
    document: async (_, signal, onPartial) => {
      await onPartial({title: draft.title, blocks: draft.blocks.slice(1)}, [1, 2]);
      await abortable(repair.promise, signal);
      await onPartial(draft, [0, 1, 2]);
      return draft;
    },
    component: (_, __, signal) => abortable(figure.promise, signal),
  });
  await workspace.start();
  await workspace.generate("alice", "unit", "section");
  const partial = await until(() => workspace.read("alice", "unit"),
    course => course?.sections[0].reading?.document?.blocks.length === 2);
  const blocks = partial!.sections[0].reading!.document!.blocks;
  expect(blocks.map(block => block.id)).toEqual(["b2", "b3"]);
  expect(partial!.sections[0].reading!.status).toBe("running");
  repair.resolve();
  const complete = await until(() => workspace.read("alice", "unit"),
    course => course?.sections[0].reading?.status === "ready");
  expect(complete!.sections[0].reading!.document!.blocks[1].component?.jobId).toBe(blocks[0].component?.jobId);
  expect(await workspace.components.repository.list()).toHaveLength(1);
  figure.resolve(artifact);
});

it("deduplicates repeated generate requests, and refuses another owner's reads and controls", async () => {
  const generate = jest.fn(async () => draft), workspace = make({document: generate});
  await workspace.start();
  const [a, b] = await Promise.all([workspace.generate("alice", "unit", "section"), workspace.generate("alice", "unit", "section")]);
  expect(a.jobId).toBe(b.jobId);
  await until(() => workspace.read("alice", "unit"), c => c?.sections[0].reading?.status === "ready");
  expect(generate).toHaveBeenCalledTimes(1);
  expect(await workspace.read("bob", "unit")).toBeNull();
  await expect(workspace.generate("bob", "unit", "section")).rejects.toThrow();
  await expect(workspace.control("bob", "unit", "section", {jobId: a.jobId, action: "cancel"})).rejects.toThrow();
});

it("does not let an old component completion overwrite a newer document", async () => {
  const first = deferred<typeof artifact>();
  let calls = 0;
  const workspace = make({component: (_, __, signal) => ++calls === 1 ? abortable(first.promise, signal) : Promise.resolve({...artifact, caption: "new"})});
  await workspace.start();
  const old = await workspace.generate("alice", "unit", "section");
  await until(() => workspace.read("alice", "unit"), c => c?.sections[0].reading?.status === "ready" && calls === 1);
  const next = await workspace.generate("alice", "unit", "section", true);
  expect(next.jobId).not.toBe(old.jobId);
  await until(() => workspace.read("alice", "unit"), c => c?.sections[0].reading?.status === "ready" && c.sections[0].reading?.pendingComponents === 0);
  first.resolve({...artifact, caption: "old"});
  const result = await until(() => workspace.components.repository.list(), jobs => jobs.every(job => job.status === "ready"));
  expect(result).toHaveLength(2);
  expect((await workspace.read("alice", "unit"))!.sections[0].reading!.document!.blocks[1].component?.artifact).toMatchObject({caption: "new"});
  expect((await workspace.document("alice", "unit", "section", old.jobId))!.blocks[1].component?.artifact).toMatchObject({caption: "old"});
  await expect(workspace.control("alice", "unit", "section", {jobId: old.jobId, action: "retry", componentId: "b2"})).rejects.toThrow();
});

it("retries a failed component without regenerating the body", async () => {
  let failures = 1;
  const body = jest.fn(async () => draft);
  const workspace = make({document: body, component: async () => {
    if (failures--) throw Error("Temporary figure failure");
    return artifact;
  }});
  await workspace.start();
  const job = await workspace.generate("alice", "unit", "section");
  await until(() => workspace.read("alice", "unit"), c => c?.sections[0].reading?.document?.blocks[1].component?.status === "failed");
  expect((await workspace.read("alice", "unit"))!.sections[0].reading!.status).toBe("ready");
  await workspace.control("alice", "unit", "section", {jobId: job.jobId, action: "retry", componentId: "b2"});
  await until(() => workspace.read("alice", "unit"), c => c?.sections[0].reading?.document?.blocks[1].component?.status === "ready");
  expect(body).toHaveBeenCalledTimes(1);
});

it("resumes persisted components after restart without another body call", async () => {
  const gate = deferred<typeof artifact>();
  const body = jest.fn(async () => draft);
  const first = make({document: body, component: (_, __, signal) => abortable(gate.promise, signal)});
  await first.start();
  await first.generate("alice", "unit", "section");
  await until(() => first.read("alice", "unit"), c => c?.sections[0].reading?.status === "ready");
  await first.stop();
  const second = make({document: body});
  await second.start();
  await until(() => second.read("alice", "unit"), c => c?.sections[0].reading?.document?.blocks[1].component?.status === "ready");
  expect(body).toHaveBeenCalledTimes(1);
});

it("retains a reading chapter when Display replaces its outline", async () => {
  let current = source;
  const workspace = new ReadingWorkspaceService({directory, readSource: async () => current,
    generators: {document: async () => draft, component: async () => artifact}});
  workers.push(workspace);
  await workspace.start();
  await workspace.generate("alice", "unit", "section");
  await until(() => workspace.read("alice", "unit"), c => c?.sections[0].reading?.status === "ready");
  current = {...source, sections: [{id: "new", title: "New Display outline", scope: "New plan"}]};
  const course = await workspace.read("alice", "unit");
  expect(course!.sections.find(s => s.id === "section")?.reading?.status).toBe("ready");
  expect((await workspace.generate("alice", "unit", "section", true)).revision).toBe(2);
});
