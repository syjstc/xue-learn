import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createDisplayBuildRuntime, configureDisplayBuildRuntime, type DisplayBuildRuntime, type DisplayBuilder} from "./service.js";
import {resolveDisplayBuilds, prepareDisplayBuildSnapshot} from "./material.js";
import {FileDisplayBuildRepository} from "./file-repository.js";

const deferred = <T,>() => {let resolve!: (value: T) => void; const promise = new Promise<T>(done => {resolve = done;}); return {promise, resolve};};
const input = {ownerUserId: "alice", scopeKey: "unit/section/object/revision", kind: "math:derivation", componentVersion: 1, input: {title: "Energy", requirement: "Derive energy conservation"}};
const waitFor = async (predicate: () => Promise<boolean>) => {for (let i = 0; i < 300; i++) {if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 5));} throw Error("Timed out waiting for display build");};
let directory: string;
let runtimes: DisplayBuildRuntime[];
beforeEach(async () => {directory = await mkdtemp(join(tmpdir(), "display-build-")); runtimes = [];});
afterEach(async () => {await Promise.all(runtimes.map(runtime => runtime.stop())); configureDisplayBuildRuntime(undefined); await rm(directory, {recursive: true, force: true});});
const runtime = (builder: DisplayBuilder) => {const value = createDisplayBuildRuntime({directory, builders: [builder], pollMs: 100}); runtimes.push(value); return value;};

test("enqueue returns a durable pending job before the component agent runs and deduplicates exact inputs", async () => {
  const build = jest.fn(async () => ({document: "ready"}));
  const worker = runtime({...input, version: 1, build});
  const first = await worker.enqueue(input), duplicate = await worker.enqueue({...input, input: {requirement: input.input.requirement, title: input.input.title}});
  expect(first.id).toBe(duplicate.id);
  expect(build).not.toHaveBeenCalled();
  expect((await new FileDisplayBuildRepository(directory).get(first.id))?.status).toBe("pending");
  await worker.start();
  await waitFor(async () => (await worker.getOwned(first.id, "alice"))?.status === "ready");
  expect(build).toHaveBeenCalledTimes(1);
});

test("two workers sharing a persistent directory cannot claim the same job", async () => {
  const gate = deferred<unknown>(), started = deferred<void>();
  const build = jest.fn(async () => {started.resolve(); return gate.promise;});
  const first = runtime({...input, version: 1, build}), second = runtime({...input, version: 1, build});
  const run = await first.enqueue(input);
  await Promise.all([first.start(), second.start()]);
  await started.promise;
  await Promise.all([first.tick(), second.tick()]);
  expect(build).toHaveBeenCalledTimes(1);
  gate.resolve({document: "complete"});
  await waitFor(async () => (await first.getOwned(run.id, "alice"))?.status === "ready");
});

test("a failed build persists its checkpoint and a new worker resumes the exact same input", async () => {
  const first = runtime({...input, version: 1, build: async ({saveCheckpoint}) => {await saveCheckpoint({childRunId: "child-1", step: 3}); throw Error("provider unavailable");}});
  const run = await first.enqueue(input);
  await first.start();
  await waitFor(async () => (await first.getOwned(run.id, "alice"))?.status === "failed");
  await first.stop();
  const resumed = jest.fn(async ({run}) => {expect(run.checkpoint).toEqual({childRunId: "child-1", step: 3}); return {steps: 6};});
  const second = runtime({...input, version: 1, build: resumed});
  await second.retry(run.id, "alice");
  await second.start();
  await waitFor(async () => (await second.getOwned(run.id, "alice"))?.status === "ready");
  expect((await second.getOwned(run.id, "alice"))?.attempt).toBe(2);
  expect(resumed).toHaveBeenCalledTimes(1);
});

test("cancelled workers cannot publish a late result and ownership is checked", async () => {
  const gate = deferred<unknown>(), started = deferred<void>();
  const worker = runtime({...input, version: 1, build: async () => {started.resolve(); return gate.promise;}});
  const run = await worker.enqueue(input);
  await worker.start(); await started.promise;
  expect(await worker.getOwned(run.id, "bob")).toBeNull();
  await expect(worker.cancel(run.id, "bob")).rejects.toThrow("not found");
  await worker.cancel(run.id, "alice"); gate.resolve({late: true});
  await worker.stop();
  expect((await worker.getOwned(run.id, "alice"))?.status).toBe("cancelled");
  expect((await worker.getOwned(run.id, "alice"))?.artifact).toBeUndefined();
});

test("changed inputs create distinct jobs and hydration requires the exact source revision and owner", async () => {
  const worker = runtime({...input, version: 1, build: async ({run}) => ({text: run.input.requirement})});
  configureDisplayBuildRuntime(worker);
  const old = await worker.enqueue(input), fresh = await worker.enqueue({...input, input: {...input.input, requirement: "A different lesson"}});
  expect(old.id).not.toBe(fresh.id);
  await worker.start();
  await waitFor(async () => (await worker.getOwned(old.id, "alice"))?.status === "ready");
  const node = {id: "math", kind: input.kind, version: 1, payload: {title: "placeholder"}, build: {jobId: old.id, status: "pending", sourceHash: old.sourceHash, revision: 1}};
  expect((await resolveDisplayBuilds(node, "alice")).payload).toEqual({text: input.input.requirement});
  const hidden = await resolveDisplayBuilds(node, "bob");
  expect(hidden.payload).toEqual(node.payload);
  expect(hidden.build.status).toBe("failed");
  const stale = {...node, build: {...node.build, sourceHash: fresh.sourceHash}};
  expect((await resolveDisplayBuilds(stale, "alice")).payload).toEqual(node.payload);
  expect((await resolveDisplayBuilds(stale, "alice")).build.status).toBe("failed");
  const changedRevision = {...node, build: {...node.build, revision: 2}};
  expect((await resolveDisplayBuilds(changedRevision, "alice")).payload).toEqual(node.payload);
  expect((await resolveDisplayBuilds(changedRevision, "alice")).build.status).toBe("failed");
});

test("expired leases are reclaimed after a process interruption", async () => {
  const worker = runtime({...input, version: 1, build: async ({run}) => ({restored: run.checkpoint})});
  const run = await worker.enqueue(input);
  await worker.repository.replace({...run, status: "running", revision: 1, leaseToken: "abandoned", leaseUntil: Date.now() - 1, checkpoint: {step: 2}}, 0);
  await worker.start();
  await waitFor(async () => (await worker.getOwned(run.id, "alice"))?.status === "ready");
  expect((await worker.getOwned(run.id, "alice"))?.artifact).toEqual({restored: {step: 2}});
});

test("hydrated ready artifacts remain portable without a job in the receiving workspace", async () => {
  const worker = runtime({...input, version: 1, build: async () => ({text: "Complete accepted teaching"})});
  configureDisplayBuildRuntime(worker);
  const run = await worker.enqueue(input);
  const node = {id: "math", kind: input.kind, version: 1, payload: {title: "placeholder"}, build: {jobId: run.id, status: "pending", sourceHash: run.sourceHash, revision: 1}};
  await expect(prepareDisplayBuildSnapshot(node, "alice")).rejects.toThrow("DISPLAY_BUILDS_PENDING");
  await worker.start();
  await waitFor(async () => (await worker.getOwned(run.id, "alice"))?.status === "ready");
  const frozen = await prepareDisplayBuildSnapshot(node, "alice");
  configureDisplayBuildRuntime(undefined);
  expect(await prepareDisplayBuildSnapshot(frozen, "alice")).toEqual(frozen);
  expect((await resolveDisplayBuilds(node, "alice")).build.status).toBe("failed");
});

test("shutdown drains an in-flight lease claim without starting an orphaned component agent", async () => {
  const gate = deferred<void>(), claiming = deferred<void>();
  const repository = new FileDisplayBuildRepository(directory);
  const replace = repository.replace.bind(repository);
  repository.replace = async (run, revision) => {
    if (run.status === "running") {claiming.resolve(); await gate.promise;}
    return replace(run, revision);
  };
  const build = jest.fn(async () => ({shouldNotStart: true}));
  const worker = createDisplayBuildRuntime({repository, builders: [{...input, version: 1, build}]});
  runtimes.push(worker);
  const run = await worker.enqueue(input);
  const starting = worker.start();
  await claiming.promise;
  const stopping = worker.stop();
  gate.resolve();
  await Promise.all([starting, stopping]);
  expect(build).not.toHaveBeenCalled();
  expect((await worker.getOwned(run.id, "alice"))?.status).toBe("pending");
});
