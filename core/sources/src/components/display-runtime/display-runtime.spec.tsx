/** @jest-environment jsdom */
import React, {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {createDisplayCatalog, createDisplayClock, createDisplayRuntime, createDisplayStateStore, type DisplayDocument, type DisplayPluginManifest} from "../../../libs/display/src/index.js";
import {DisplayPlaceholder, DisplayRuntimeSurface, type DisplayRenderer} from "./display-runtime.js";
jest.mock("./display-runtime.css", () => ({}));

const manifest: DisplayPluginManifest = {apiVersion: 1, id: "demo", version: "1.0.0", execution: "trusted", components: [
  {kind: "demo:row", version: 1, slots: {children: {multiple: true}}},
  {kind: "demo:value", version: 1, targets: ["value"]},
  {kind: "demo:broken", version: 1},
]};
const document: DisplayDocument = {version: 1, id: "lesson", plugins: [{id: "demo", version: "1.0.0"}], root: {id: "row", kind: "demo:row", version: 1, payload: {}, children: [{id: "v", kind: "demo:value", version: 1, payload: {}}]}, timeline: [{id: "cue", startTick: 48_000, durationTicks: 48_000, targets: ["v/value"]}]};
const components: Record<string, DisplayRenderer> = {
  "demo:row@1": ({children}) => <main>{children}</main>,
  "demo:value@1": ({clock, state, updateState, activeTargets}) => (
    <button data-tick={clock.tick} data-focus={activeTargets.join(",")} onClick={() => updateState({count: Number(state.count ?? 0) + 1})}>{Number(state.count ?? 0)}</button>),
  "demo:broken@1": () => {throw new Error("Broken leaf");},
};

describe("unified display runtime", () => {
  let container: HTMLDivElement, root: Root;
  beforeEach(() => { (globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
    window.document.documentElement.lang = "en"; container = window.document.createElement("div"); window.document.body.appendChild(container); root = createRoot(container); });
  afterEach(async () => {await act(async () => root.unmount()); container.remove(); delete (globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT; jest.restoreAllMocks();});

  it("exposes failed component details to the video export readiness check", async () => {
    await act(async () => root.render(<DisplayPlaceholder failure={{reason: "invalid-payload", message: 'objects.0.kind: expected "shape"', nodeId: "force", kind: "physics:motion-scene", pluginId: "org.xuelearn.display.physics", resourceId: "diagram"}}/>));
    const placeholder = container.querySelector<HTMLElement>('[data-display-placeholder="invalid-payload"]')!;
    expect(placeholder.dataset).toMatchObject({displayNode: "force", displayKind: "physics:motion-scene", displayMessage: 'objects.0.kind: expected "shape"', displayPlugin: "org.xuelearn.display.physics", displayResource: "diagram"});
    expect(placeholder.textContent).toBe("◇Invalid display data");
  });

  it("transitions from lazy loading to a live renderer, preserves state, and samples seek deterministically", async () => {
    let complete!: (value: {components: typeof components}) => void;
    const loader = new Promise<{components: typeof components}>((resolve ) => {complete = resolve;});
    const runtime = createDisplayRuntime({catalog: createDisplayCatalog([manifest]), resolveModule: () => loader});
    const state = createDisplayStateStore();
    const render = (frame: number) => root.render(<DisplayRuntimeSurface document={document} runtime={runtime} clock={createDisplayClock(frame)} state={state}/>);
    await act(async () => render(0));
    expect(container.querySelector('[data-display-placeholder="loading"]')).not.toBeNull();
    await act(async () => complete({components}));
    await act(async () => container.querySelector("button")!.click());
    expect(container.textContent).toBe("1");
    await act(async () => render(40));
    const sampled = container.querySelector("button")!.outerHTML;
    expect(container.querySelector("button")!.dataset.focus).toBe("v/value");
    await act(async () => render(90));
    expect(container.querySelector("button")!.dataset.focus).toBe("");
    await act(async () => render(40));
    expect(container.querySelector("button")!.outerHTML).toBe(sampled);
    runtime.dispose();
  });

  it("renders a load-error placeholder and retries the failed module", async () => {
    const loader = jest.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValue({components});
    const runtime = createDisplayRuntime({catalog: createDisplayCatalog([manifest]), resolveModule: loader});
    await act(async () => root.render(<DisplayRuntimeSurface document={document} runtime={runtime} clock={createDisplayClock(0)}/>));
    expect(container.querySelector('[data-display-placeholder="load-error"]')).not.toBeNull();
    await act(async () => container.querySelector("button")!.click());
    expect(container.querySelector('[data-display-placeholder]')).toBeNull();
    expect(container.querySelector("main button")).not.toBeNull();
    runtime.dispose();
  });

  it("isolates a crashing child while a sibling remains interactive", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    const runtime = createDisplayRuntime({catalog: createDisplayCatalog([manifest]), resolveModule: async () => ({components})});
    const mixed: DisplayDocument = {...document, root: {...document.root, children: [...document.root.children!, {id: "bad", kind: "demo:broken", version: 1, payload: {}}]}};
    const failed = jest.fn();
    await act(async () => root.render(<DisplayRuntimeSurface document={mixed} runtime={runtime} clock={createDisplayClock(0)} onFailure={failed}/>));
    expect(container.querySelector('[data-display-placeholder="render-error"]')).not.toBeNull();
    const button = container.querySelector("main > button")! as HTMLButtonElement;
    await act(async () => button.click());
    expect(button.textContent).toBe("1");
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({nodeId: "bad", reason: "render-error"}));
    runtime.dispose();
  });

  it("loads a newly registered package without remounting the host and disables video mutations", async () => {
    const catalog = createDisplayCatalog();
    const runtime = createDisplayRuntime({catalog, resolveModule: async () => ({components})});
    await act(async () => root.render(<DisplayRuntimeSurface document={document} runtime={runtime} clock={createDisplayClock(0)} mode="video"/>));
    expect(container.querySelector('[data-display-placeholder="missing-plugin"]')).not.toBeNull();
    await act(async () => {catalog.register(manifest);});
    await act(async () => container.querySelector("button")!.click());
    expect(container.querySelector("button")!.textContent).toBe("0");
    runtime.dispose();
  });
});
