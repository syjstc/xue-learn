import {createDisplayCatalog, createDisplayRuntime, createDisplayClock, activeDisplayTargets, validateDisplayDocument, validateDisplayPluginManifest, type DisplayDocument, type DisplayNode, type DisplayPluginManifest} from "./index.js";

const layout: DisplayPluginManifest = {apiVersion: 1, id: "layout", version: "1.0.0", execution: "trusted", components: [{kind: "layout:row", version: 1, slots: {children: {multiple: true}}}]};
const math: DisplayPluginManifest = {apiVersion: 1, id: "math", version: "2.0.0", execution: "trusted", components: [{kind: "math:value", version: 1, targets: ["value"], payloadSchema: {type: "object", properties: {value: {type: "number"}}, required: ["value"], additionalProperties: false}}]};
const value = (id: string, number = 3): DisplayNode => ({id, kind: "math:value", version: 1, payload: {value: number}});
const doc = (root: DisplayNode, plugins: DisplayDocument["plugins"] = [{id: "layout", version: "1.0.0"}, {id: "math", version: "2.0.0"}]): DisplayDocument => ({version: 1, id: "lesson", plugins, root});
const modules = {"layout:row@1": () => null, "math:value@1": () => null};

it("loads a reachable package once and preserves exact-version routing", async () => {
  const loader = jest.fn(async () => ({components: modules}));
  const runtime = createDisplayRuntime({catalog: createDisplayCatalog([layout, math]), resolveModule: loader});
  const document = doc(value("n"));
  expect(runtime.resolve(document.root, document)).toMatchObject({status: "unavailable", failure: {reason: "loading"}});
  expect((await runtime.prepare(document)).ready).toBe(true);
  await runtime.prepare(document);
  expect(loader).toHaveBeenCalledTimes(1);
  expect(loader.mock.calls[0]![0]).toMatchObject({id: "math", version: "2.0.0"});
  expect(runtime.resolve(value("n"), doc(value("n"), [{id: "math", version: "1.0.0"}]))).toMatchObject({status: "unavailable", failure: {reason: "version-mismatch"}});
});

it("composes a declarative domain package across dependencies without loading its code", async () => {
  const composition: DisplayPluginManifest = {apiVersion: 1, id: "lesson-kit", version: "1.0.0", execution: "declarative", dependencies: [{id: "layout", version: "1.0.0"}, {id: "math", version: "2.0.0"}], components: [{kind: "lesson:pair", version: 1, slots: {helper: {required: true, multiple: false}}, composition: {id: "row", kind: "layout:row", version: 1, payload: {}, children: [{...value("main"), payload: {value: {$display: "payload", path: "number"}}}, {id: "helper", kind: "display:slot", version: 1, payload: {name: "helper"}}]}}]};
  const loader = jest.fn(async () => ({components: modules}));
  const runtime = createDisplayRuntime({catalog: createDisplayCatalog([layout, math, composition]), resolveModule: loader});
  const document = doc({id: "pair", kind: "lesson:pair", version: 1, payload: {number: 7}, slots: {helper: [value("extra", 9)]}}, [...doc(value("unused")).plugins, {id: "lesson-kit", version: "1.0.0"}]);
  expect(await runtime.prepare(document)).toMatchObject({ready: true, issues: []});
  expect(loader.mock.calls.map(call => (call[0] as DisplayPluginManifest).id).sort()).toEqual(["layout", "math"]);
  const resolution = runtime.resolve(document.root, document);
  expect(resolution).toMatchObject({status: "ready", composition: {id: "pair/row", children: [{id: "pair/main", payload: {value: 7}}, {id: "extra"}]}});
});

it("rejects duplicated nodes, targets, cycles, absent slots, and stale integrity locks", async () => {
  const repeated = doc({id: "root", kind: "layout:row", version: 1, payload: {}, children: [value("same"), value("same")]});
  expect(validateDisplayDocument(repeated).some(issue => issue.message.includes("Duplicate node"))).toBe(true);
  expect(validateDisplayDocument(doc({...value("x"), targets: ["same", "same"]})).some(issue => issue.message.includes("Duplicate target"))).toBe(true);
  const cyclic: any = {id: "cycle", kind: "layout:row", version: 1, payload: {}, children: []}; cyclic.children.push(cyclic);
  expect(validateDisplayDocument(doc(cyclic)).some(issue => issue.reason === "composition-cycle")).toBe(true);
  const runtime = createDisplayRuntime({catalog: createDisplayCatalog([layout, math]), resolveModule: async () => ({components: modules})});
  expect(await runtime.prepare(doc(value("x"), [{id: "math", version: "2.0.0", integrity: "sha256-wrong"}]))).toMatchObject({ready: false, issues: expect.arrayContaining([expect.objectContaining({reason: "version-mismatch"})])});
});

it("fails closed on unsupported schemas and does not execute declarative modules", () => {
  expect(validateDisplayPluginManifest({...math, execution: "declarative"})).toEqual(expect.arrayContaining([expect.objectContaining({message: expect.stringContaining("needs a composition")})]));
  expect(validateDisplayPluginManifest({...math, version: "^2.0.0"})).not.toHaveLength(0);
});

it("detects package and declarative composition cycles before export", async () => {
  const a: DisplayPluginManifest = {...layout, id: "a", dependencies: [{id: "b", version: "1.0.0"}]};
  const b: DisplayPluginManifest = {...math, id: "b", version: "1.0.0", dependencies: [{id: "a", version: "1.0.0"}]};
  const runtime = createDisplayRuntime({catalog: createDisplayCatalog([a, b]), resolveModule: async () => ({components: modules})});
  expect(await runtime.prepare(doc(value("x"), [{id: "a", version: "1.0.0"}, {id: "b", version: "1.0.0"}]))).toMatchObject({ready: false, issues: expect.arrayContaining([expect.objectContaining({reason: "dependency-cycle"})])});
  const recursive: DisplayPluginManifest = {apiVersion: 1, id: "recursive", version: "1.0.0", execution: "declarative", components: [{kind: "demo:loop", version: 1, composition: {id: "next", kind: "demo:loop", version: 1, payload: {}}}]};
  const cycleRuntime = createDisplayRuntime({catalog: createDisplayCatalog([recursive])});
  expect(await cycleRuntime.prepare(doc({id: "start", kind: "demo:loop", version: 1, payload: {}}, [{id: "recursive", version: "1.0.0"}]))).toMatchObject({ready: false, issues: expect.arrayContaining([expect.objectContaining({reason: "composition-cycle"})])});
});

it("keeps failed resources out of export readiness and retries without reloading good modules", async () => {
  const manifest: DisplayPluginManifest = {...math, resources: [{id: "score", uri: "/score.svg", kind: "image"}], components: [{...math.components[0]!, resources: ["score"]}]};
  const load = jest.fn(async () => ({components: modules}));
  const resource = jest.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({uri: "blob:verified"});
  const runtime = createDisplayRuntime({catalog: createDisplayCatalog([manifest]), resolveModule: load, resolveResource: resource});
  const document = doc(value("x"), [{id: "math", version: "2.0.0"}]);
  expect(await runtime.preflight(document)).toMatchObject({ready: false, issues: expect.arrayContaining([expect.objectContaining({reason: "resource-error"})])});
  runtime.retry();
  expect(await runtime.preflight(document)).toMatchObject({ready: true});
  expect(load).toHaveBeenCalledTimes(1);
  expect(resource).toHaveBeenCalledTimes(2);
});

it("does not execute a module with a mismatched integrity lock or an unfinished build", async () => {
  const loader = jest.fn(async () => ({components: modules}));
  const runtime = createDisplayRuntime({catalog: createDisplayCatalog([math]), resolveModule: loader});
  expect((await runtime.prepare(doc(value("x"), [{id: "math", version: "2.0.0", integrity: "sha256-wrong"}]))).ready).toBe(false);
  expect((await runtime.prepare(doc({...value("x"), build: {jobId: "job", status: "running"}}, [{id: "math", version: "2.0.0"}]))).issues).toEqual(expect.arrayContaining([expect.objectContaining({reason: "building"})]));
  expect(loader).not.toHaveBeenCalled();
});

it("samples the same focus after forward and backwards seeks and rejects missing cue targets", async () => {
  const timeline = [{id: "spoken-1", startTick: 48_000, durationTicks: 48_000, targets: ["x/value"]}];
  const at = (frame: number) => activeDisplayTargets(timeline, createDisplayClock(frame, 30));
  expect(at(40)).toEqual(["x/value"]); expect(at(100)).toEqual([]); expect(at(40)).toEqual(["x/value"]);
  const runtime = createDisplayRuntime({catalog: createDisplayCatalog([math]), resolveModule: async () => ({components: modules})});
  const document = {...doc(value("x"), [{id: "math", version: "2.0.0"}]), timeline};
  expect((await runtime.preflight(document)).ready).toBe(true);
  expect((await runtime.preflight({...document, timeline: [{...timeline[0]!, targets: ["missing"]}]})).issues).toEqual(expect.arrayContaining([expect.objectContaining({reason: "invalid-document", message: expect.stringContaining("missing target")})]));
});

it('releases an unfinished loader immediately on disposal without starting descendant modules', async () => {
  jest.useFakeTimers();
  try {
    const loader = jest.fn(() => new Promise<{components: typeof modules}>(() => {}));
    const disposeResources = jest.fn();
    const resolver = Object.assign(jest.fn(async () => ({})), {dispose: disposeResources});
    const runtime = createDisplayRuntime({catalog: createDisplayCatalog([layout, math]), resolveModule: loader, resolveResource: resolver});
    const pending = runtime.prepare(doc({id: 'root', kind: 'layout:row', version: 1, payload: {}, children: [value('child')]}));
    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(1);
    runtime.dispose();
    expect(await pending).toMatchObject({ready: false, issues: expect.arrayContaining([expect.objectContaining({reason: 'load-error'})])});
    expect(loader).toHaveBeenCalledTimes(1);
    expect(disposeResources).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  } finally {jest.useRealTimers();}
});
