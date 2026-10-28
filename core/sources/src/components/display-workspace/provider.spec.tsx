/** @jest-environment jsdom */
import React, {StrictMode, act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {createDisplayCatalog, createDisplayClock, createDisplayRuntime, type DisplayDocument, type DisplayPluginManifest, type DisplayRuntime} from "../../../libs/display/src/index.js";
import type {DisplayRenderer} from "../display-runtime/index.js";
import {DisplayWorkspaceProvider, WorkspaceDisplaySurface, useDisplayWorkspace} from "./provider.js";
import type {DisplayPluginRecord, DisplayWorkspaceClient} from "./plugin-manager.js";
jest.mock("../display-runtime/display-runtime.css", () => ({}));
jest.mock("./workspace.css", () => ({}));

const manifest: DisplayPluginManifest = {apiVersion: 1, id: "demo", version: "1.0.0", execution: "trusted", components: [{kind: "demo:value", version: 1}]};
const makeRuntime = () => createDisplayRuntime<DisplayRenderer>({catalog: createDisplayCatalog([manifest]), resolveModule: async () => ({components: {"demo:value@1": ({node}) => <span>{String((node.payload as {text: string}).text)}</span>}})});
const pendingDocument = (jobId = "job", text = "pending"): DisplayDocument => ({version: 1, id: "lesson", plugins: [{id: "demo", version: "1.0.0"}], root: {id: "display", kind: "demo:value", version: 1, payload: {text}, build: {jobId, sourceHash: `source-${jobId}`, revision: 1, status: "pending"}}});
const completeDocument = (document: DisplayDocument, text = "ready"): DisplayDocument => ({...document, root: {...document.root, payload: {text}, build: {...document.root.build!, status: "ready"}}});
function deferred<T>() {let resolve!: (value: T) => void; const promise = new Promise<T>(done => {resolve = done;}); return {promise, resolve};}

describe("display workspace host", () => {
  let container: HTMLDivElement, root: Root;
  beforeEach(() => {jest.useFakeTimers(); (globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);});
  afterEach(async () => {await act(async () => {root.unmount();}); await act(async () => {jest.runOnlyPendingTimers();}); container.remove(); delete (globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT; jest.restoreAllMocks(); jest.useRealTimers();});

  it("keeps an owned runtime alive through StrictMode setup replay and disposes on final unmount", async () => {
    let runtime!: DisplayRuntime<DisplayRenderer>;
    function Capture() {runtime = useDisplayWorkspace().runtime; return <span>host</span>;}
    await act(async () => root.render(<StrictMode><DisplayWorkspaceProvider><Capture/></DisplayWorkspaceProvider></StrictMode>));
    const dispose = jest.spyOn(runtime, "dispose");
    await act(async () => {jest.runOnlyPendingTimers();});
    expect(dispose).not.toHaveBeenCalled();
    expect(runtime.catalog.list().length).toBeGreaterThan(0);
    await act(async () => root.render(null));
    await act(async () => {jest.runOnlyPendingTimers();});
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("never disposes a caller-owned runtime and preserves unchanged installed registrations", async () => {
    const runtime = makeRuntime(), dispose = jest.spyOn(runtime, "dispose");
    const extension: DisplayPluginManifest = {apiVersion: 1, id: "custom", version: "1.0.0", execution: "declarative", components: [{kind: "custom:value", version: 1, composition: {id: "leaf", kind: "demo:value", version: 1, payload: {text: "hello"}}}]};
    const records: DisplayPluginRecord[] = [{manifest: extension, enabled: true, builtin: false, sha256: "hash"}];
    const client = {get: jest.fn(async () => records), post: jest.fn()} as unknown as DisplayWorkspaceClient;
    let refresh!: () => Promise<void>;
    function Capture() {refresh = useDisplayWorkspace().refresh; return null;}
    await act(async () => root.render(<DisplayWorkspaceProvider runtime={runtime} client={client}><Capture/></DisplayWorkspaceProvider>));
    const registered = runtime.catalog.get("custom", "1.0.0");
    await act(async () => refresh());
    expect(runtime.catalog.get("custom", "1.0.0")).toBe(registered);
    await act(async () => root.render(null));
    await act(async () => {jest.runOnlyPendingTimers();});
    expect(dispose).not.toHaveBeenCalled();
    expect(runtime.catalog.get("custom", "1.0.0")).toBeUndefined();
    runtime.dispose();
  });

  it("polls pending builds until the prepared document is displayed", async () => {
    const runtime = makeRuntime(), source = pendingDocument();
    const running = {...source, root: {...source.root, build: {...source.root.build!, status: "running" as const}}};
    const ready = completeDocument(source);
    const post = jest.fn().mockResolvedValueOnce(running).mockResolvedValueOnce(ready);
    const client = {get: jest.fn(async () => []), post} as unknown as DisplayWorkspaceClient;
    const onDocumentResolved = jest.fn();
    await act(async () => root.render(<DisplayWorkspaceProvider runtime={runtime} client={client}><WorkspaceDisplaySurface document={source} clock={createDisplayClock(0)} onDocumentResolved={onDocumentResolved}/></DisplayWorkspaceProvider>));
    expect(container.querySelector('[data-display-placeholder="building"]')).not.toBeNull();
    await act(async () => {jest.advanceTimersByTime(1500);});
    expect(container.textContent).toBe("ready");
    expect(post).toHaveBeenCalledTimes(2);
    expect(onDocumentResolved).toHaveBeenLastCalledWith(ready);
    await act(async () => {jest.advanceTimersByTime(5000);});
    expect(post).toHaveBeenCalledTimes(2);
    runtime.dispose();
  });

  it("deduplicates a failed build retry and resumes projection after it succeeds", async () => {
    const runtime = makeRuntime(), source = pendingDocument();
    const retry = deferred<unknown>();
    let retried = false;
    const post = jest.fn((path: string) => {
      if (path.endsWith("/retry")) {retried = true; return retry.promise;}
      return Promise.resolve(retried ? completeDocument(source) : {...source, root: {...source.root, build: {...source.root.build!, status: "failed", error: "offline"}}});
    });
    const client = {get: jest.fn(async () => []), post} as unknown as DisplayWorkspaceClient;
    await act(async () => root.render(<DisplayWorkspaceProvider runtime={runtime} client={client}><WorkspaceDisplaySurface document={source} clock={createDisplayClock(0)}/></DisplayWorkspaceProvider>));
    expect(container.querySelector('[data-display-placeholder="build-failed"]')).not.toBeNull();
    await act(async () => {container.querySelector("button")!.click(); container.querySelector("button")!.click();});
    expect(post.mock.calls.filter(([path]) => path.endsWith("/retry"))).toHaveLength(1);
    await act(async () => retry.resolve({status: "pending"}));
    expect(container.textContent).toBe("ready");
    runtime.dispose();
  });

  it("ignores a completed request from an obsolete source revision", async () => {
    const runtime = makeRuntime(), first = pendingDocument("old"), second = pendingDocument("new");
    const oldRequest = deferred<DisplayDocument>(), newRequest = deferred<DisplayDocument>();
    const post = jest.fn((_path: string, value: {document: DisplayDocument}) => value.document.root.build!.jobId === "old" ? oldRequest.promise : newRequest.promise);
    const client = {get: jest.fn(async () => []), post} as unknown as DisplayWorkspaceClient;
    const render = (source: DisplayDocument) => root.render(<DisplayWorkspaceProvider runtime={runtime} client={client}><WorkspaceDisplaySurface document={source} clock={createDisplayClock(0)}/></DisplayWorkspaceProvider>);
    await act(async () => render(first));
    await act(async () => render(second));
    await act(async () => newRequest.resolve(completeDocument(second, "new result")));
    expect(container.textContent).toBe("new result");
    await act(async () => oldRequest.resolve(completeDocument(first, "obsolete result")));
    expect(container.textContent).toBe("new result");
    runtime.dispose();
  });

  it("shows a placeholder for malformed documents without polling", async () => {
    const runtime = makeRuntime();
    const client = {get: jest.fn(async () => []), post: jest.fn()} as unknown as DisplayWorkspaceClient;
    await act(async () => root.render(<DisplayWorkspaceProvider runtime={runtime} client={client}><WorkspaceDisplaySurface document={null as unknown as DisplayDocument} clock={createDisplayClock(0)}/></DisplayWorkspaceProvider>));
    expect(container.querySelector('[data-display-placeholder="invalid-document"]')).not.toBeNull();
    expect(client.post).not.toHaveBeenCalled();
    runtime.dispose();
  });
});
