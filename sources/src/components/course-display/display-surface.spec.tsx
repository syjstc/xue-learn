/** @jest-environment jsdom */
import React, {act, lazy, useEffect, useState} from "react";
import {createRoot, type Root} from "react-dom/client";
import {createDisplayRegistry, type DisplayNode, type DisplayPlugin} from "./display-registry.js";
import {DisplaySurface} from "./display-surface.js";

type Payload = {label: string};
type Context = {value: number};
const validate = (value: unknown): value is Payload => typeof value === "object" && value !== null && typeof (value as Payload).label === "string";
const node: DisplayNode = {id: "live-1", kind: "host:live", version: 1, payload: {label: "Reading"}};
const plugin = (Component: DisplayPlugin<Payload, Context>["Component"]): DisplayPlugin<Payload, Context> => ({id: "host.live", kind: "host:live", versions: [1], validate, Component});

describe("DisplaySurface", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete (globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT;
    jest.restoreAllMocks();
  });

  it("renders a host plugin and propagates payload/context updates while retaining state", async () => {
    const mounted = jest.fn();
    const cleaned = jest.fn();
    const registry = createDisplayRegistry<Context>();
    registry.register(plugin(({node, context}) => {
      const [count, setCount] = useState(0);
      useEffect(() => {mounted(); return cleaned;}, []);
      return <button onClick={() => setCount(value => value + 1)}>{node.payload.label}: {context.value}, clicks: {count}</button>;
    }));
    await act(async () => root.render(<DisplaySurface registry={registry} node={node} context={{value: 1}}/>));
    await act(async () => container.querySelector("button")!.click());
    await act(async () => root.render(<DisplaySurface registry={registry} node={{...node, payload: {label: "New reading"}}} context={{value: 2}}/>));
    expect(container.textContent).toBe("New reading: 2, clicks: 1");
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(cleaned).not.toHaveBeenCalled();
    await act(async () => root.render(<DisplaySurface registry={registry} node={{...node, id: "live-2"}} context={{value: 3}}/>));
    expect(container.textContent).toBe("Reading: 3, clicks: 0");
    expect(mounted).toHaveBeenCalledTimes(2);
    expect(cleaned).toHaveBeenCalledTimes(1);
  });

  it("reacts to runtime registration/disposal and cleans up host subscriptions", async () => {
    const registry = createDisplayRegistry<Context>();
    const cleaned = jest.fn();
    const onFailure = jest.fn();
    await act(async () => root.render(<DisplaySurface registry={registry} node={node} context={{value: 7}} onFailure={onFailure}/>));
    expect(container.querySelector('[data-display-fallback="unsupported"]')).not.toBeNull();
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({reason: "unsupported"}));
    let dispose!: () => void;
    await act(async () => {
      dispose = registry.register(plugin(({context}) => {
        useEffect(() => cleaned, []);
        return <span>Live {context.value}</span>;
      }));
    });
    expect(container.textContent).toBe("Live 7");
    await act(async () => dispose());
    expect(cleaned).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-display-fallback="unsupported"]')).not.toBeNull();
  });

  it("lets a host customize unsupported and invalid-payload fallback without executing a renderer", async () => {
    const registry = createDisplayRegistry<Context>();
    const render = jest.fn(() => <span>must not render</span>);
    registry.register(plugin(render));
    const fallback = jest.fn(failure => <p>Fallback: {failure.reason}</p>);
    await act(async () => root.render(<DisplaySurface registry={registry} node={{...node, payload: {label: 123}}} context={{value: 0}} fallback={fallback}/>));
    expect(container.textContent).toBe("Fallback: invalid-payload");
    expect(render).not.toHaveBeenCalled();
    await act(async () => root.render(<DisplaySurface registry={registry} node={{...node, kind: "new:unknown"}} context={{value: 0}} fallback={fallback}/>));
    expect(container.textContent).toBe("Fallback: unsupported");
  });

  it("isolates a renderer failure and recovers when new data arrives", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    const registry = createDisplayRegistry<Context>();
    const error = new Error("broken plugin");
    const onFailure = jest.fn();
    registry.register(plugin(({context}) => {
      if (context.value < 0) throw error;
      return <span>Recovered {context.value}</span>;
    }));
    const render = (context: Context) => <><aside>Host navigation</aside><DisplaySurface registry={registry} node={node} context={context} onFailure={onFailure}/></>;
    await act(async () => root.render(render({value: -1})));
    expect(container.querySelector("aside")?.textContent).toBe("Host navigation");
    expect(container.querySelector('[data-display-fallback="render-error"]')).not.toBeNull();
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({reason: "render-error", error}));
    await act(async () => root.render(render({value: 8})));
    expect(container.textContent).toBe("Host navigationRecovered 8");
  });

  it("supports host-owned lazy loading and an explicit loading view", async () => {
    const registry = createDisplayRegistry<Context>();
    let complete!: (value: {default: DisplayPlugin<Payload, Context>["Component"]}) => void;
    const loaded = new Promise<{default: DisplayPlugin<Payload, Context>["Component"]}>(resolve => {complete = resolve;});
    registry.register(plugin(lazy(() => loaded)));
    await act(async () => root.render(<DisplaySurface registry={registry} node={node} context={{value: 4}} loadingFallback={<p>Loading content</p>}/>));
    expect(container.textContent).toBe("Loading content");
    await act(async () => complete({default: ({context}) => <span>Loaded {context.value}</span>}));
    expect(container.textContent).toBe("Loaded 4");
  });

  it("re-registers a plugin with a fresh lifecycle and leaves unrelated surfaces intact", async () => {
    const registry = createDisplayRegistry<Context>();
    const cleaned = jest.fn();
    const mounted = jest.fn();
    const Component: DisplayPlugin<Payload, Context>["Component"] = () => {
      useEffect(() => {mounted(); return cleaned;}, []);
      return <span>Ready</span>;
    };
    const dispose = registry.register(plugin(Component));
    await act(async () => root.render(<DisplaySurface registry={registry} node={node} context={{value: 0}}/>));
    await act(async () => registry.register({...plugin(Component), id: "other", kind: "other:live"}));
    expect(mounted).toHaveBeenCalledTimes(1);
    await act(async () => {dispose(); registry.register(plugin(Component));});
    expect(mounted).toHaveBeenCalledTimes(2);
    expect(cleaned).toHaveBeenCalledTimes(1);
  });

  it("cleans up the old plugin when a mounted surface switches host registries", async () => {
    const first = createDisplayRegistry<Context>();
    const second = createDisplayRegistry<Context>();
    const cleaned = jest.fn();
    const mounted = jest.fn();
    const Component: DisplayPlugin<Payload, Context>["Component"] = ({context}) => {
      useEffect(() => {mounted(); return cleaned;}, []);
      return <span>Host value {context.value}</span>;
    };
    first.register(plugin(Component));
    second.register(plugin(Component));
    await act(async () => root.render(<DisplaySurface registry={first} node={node} context={{value: 1}}/>));
    await act(async () => root.render(<DisplaySurface registry={second} node={node} context={{value: 2}}/>));
    expect(container.textContent).toBe("Host value 2");
    expect(mounted).toHaveBeenCalledTimes(2);
    expect(cleaned).toHaveBeenCalledTimes(1);
  });
});
