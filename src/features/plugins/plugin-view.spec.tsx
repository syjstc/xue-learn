/** @jest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { DesktopPluginSummary } from "../../../packages/plugin-sdk/src/index";
import type { DesktopPluginRendererHost, DesktopPluginRendererModule } from "../../../packages/plugin-sdk/src/renderer";
import type { DesktopPluginsBridge } from "./bridge";
import { DesktopPluginView } from "./plugin-view";

jest.mock("react-dom/server", () => ({ renderToStaticMarkup: jest.fn() }));
const mockNavigate = jest.fn();
jest.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
  Link: ({ to, children }: React.PropsWithChildren<{ to: string }>) => <a href={to}>{children}</a>,
}));
jest.mock("@xue-learn/core/i18n", () => ({ useI18n: () => ({ locale: "en" }) }));
jest.mock("@xue-learn/core/ui/button", () => ({ Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} /> }));
jest.mock("@xue-learn/core/display/teaching-display", () => ({ TeachingDisplay: () => null }));
jest.mock("@/components/markdown/inline-math-text", () => ({ InlineMathText: () => null }));
jest.mock("@/components/ui/input", () => ({ Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} /> }));
jest.mock("@/components/ui/badge", () => ({ Badge: (props: React.HTMLAttributes<HTMLSpanElement>) => <span {...props} /> }));

const activePlugin = (): DesktopPluginSummary => ({
  manifest: {
    id: "org.example.courses", name: "Courses", version: "1.0.0", schemaVersion: 1, apiVersion: 1,
    requires: { "workspace.courses": 1 }, integrity: { "view.mjs": "a".repeat(64) },
    contributes: { commands: [], views: [{ id: "catalog", title: "Course browser", entry: "view.mjs" }] },
  },
  status: "active", enabled: true, installedAt: "2026-10-10", missingCapabilities: [],
});

describe("embedded Desktop plugin views", () => {
  let container: HTMLDivElement;
  let root: Root;
  let bridge: jest.Mocked<DesktopPluginsBridge>;
  let host: DesktopPluginRendererHost;
  let change: () => void;
  let disposeEffect: jest.Mock;
  let loadModule: jest.Mock<Promise<DesktopPluginRendererModule>, [string]>;
  const render = () => act(async () => root.render(<DesktopPluginView pluginId="org.example.courses" viewId="catalog" bridge={bridge} loadModule={loadModule} />));

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    bridge = {
      list: jest.fn().mockResolvedValue([activePlugin()]), install: jest.fn(), enable: jest.fn(), disable: jest.fn(), remove: jest.fn(), execute: jest.fn(),
      openView: jest.fn().mockResolvedValue({ sessionId: "session-a", workspaceId: "workspace-a", moduleUrl: "xuelearn-plugin://view/session-a/module.mjs" }),
      callView: jest.fn().mockResolvedValue([{ unitId: "unit-a" }]), executeView: jest.fn().mockResolvedValue("done"), closeView: jest.fn().mockResolvedValue(undefined),
      onChanged: jest.fn(callback => { change = callback; return jest.fn(); }),
    };
    disposeEffect = jest.fn();
    loadModule = jest.fn(async () => ({
      createView(context) {
        host = context;
        host.onDispose(disposeEffect);
        return function View() {
          const [count, setCount] = host.React.useState(0);
          return host.React.createElement(host.ui.Button, { onClick: () => setCount(value => value + 1) }, `Count ${count}`);
        };
      },
    }));
    mockNavigate.mockClear();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it("mounts an interactive component with the host React singleton and scoped Core services", async () => {
    await render();
    expect(host.React.useState).toBe(React.useState);
    expect(host.workspaceId).toBe("workspace-a");
    expect(bridge.execute).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Course browser");
    await act(async () => container.querySelector("button")!.click());
    expect(container.textContent).toContain("Count 1");
    await host.core.courseSource.catalog();
    await host.core.courseSource.readUnit("unit-a");
    expect(bridge.callView.mock.calls).toEqual([
      ["session-a", "workspace.courses", "catalog", undefined],
      ["session-a", "workspace.courses", "readUnit", { unitId: "unit-a" }],
    ]);
    await host.execute("generate", { unitId: "unit-a" });
    expect(bridge.executeView).toHaveBeenCalledWith("session-a", "generate", { unitId: "unit-a" });
    host.navigate("/spaces");
    expect(mockNavigate).toHaveBeenCalledWith("/spaces");
    expect(() => host.navigate("//other-host.example")).toThrow("local route");
  });

  it("keeps local state across unrelated plugin changes, then disposes when this plugin stops", async () => {
    await render();
    await act(async () => container.querySelector("button")!.click());
    await act(async () => change());
    expect(bridge.openView).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Count 1");
    bridge.list.mockResolvedValue([{ ...activePlugin(), enabled: false, status: "disabled" }]);
    await act(async () => change());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Enable this plugin");
    expect(host.signal.aborted).toBe(true);
    expect(disposeEffect).toHaveBeenCalledTimes(1);
    expect(bridge.closeView).toHaveBeenCalledWith("session-a");
    await expect(host.core.courseSource.catalog()).rejects.toBeDefined();
    expect(bridge.callView).not.toHaveBeenCalled();
  });

  it("closes an open request that completes after navigation away without importing its module", async () => {
    let finish!: (value: unknown) => void;
    bridge.openView.mockReturnValue(new Promise(resolve => { finish = resolve as typeof finish; }));
    await render();
    await act(async () => root.render(<p>Another route</p>));
    await act(async () => finish({ sessionId: "late-session", workspaceId: "workspace-a", moduleUrl: "xuelearn-plugin://view/late/module.mjs" }));
    expect(bridge.closeView).toHaveBeenCalledWith("late-session");
    expect(loadModule).not.toHaveBeenCalled();
  });

  it("reopens revoked views even when the plugin has already returned to the same active version", async () => {
    bridge.list.mockResolvedValue([{ ...activePlugin(), viewRevision: "generation-a" }]);
    await render();
    const previousHost = host;
    await act(async () => container.querySelector("button")!.click());
    bridge.list.mockResolvedValue([{ ...activePlugin(), viewRevision: "generation-b" }]);
    bridge.openView.mockResolvedValue({ sessionId: "session-b", workspaceId: "workspace-a", moduleUrl: "xuelearn-plugin://view/session-b/module.mjs" });
    await act(async () => change());
    expect(previousHost.signal.aborted).toBe(true);
    expect(bridge.closeView).toHaveBeenCalledWith("session-a");
    expect(bridge.openView).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Count 0");
    await host.core.courseSource.catalog();
    expect(bridge.callView).toHaveBeenLastCalledWith("session-b", "workspace.courses", "catalog", undefined);
    await act(async () => container.querySelector("button")!.click());
    await act(async () => change());
    expect(bridge.openView).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Count 1");
  });

  it("waits for verified CSS and reports load failure while closing the view", async () => {
    bridge.openView.mockResolvedValue({ sessionId: "session-css", workspaceId: "workspace-a", moduleUrl: "xuelearn-plugin://view/session-css/module.mjs", stylesheetUrl: "xuelearn-plugin://view/session-css/style.css" });
    await render();
    expect(loadModule).not.toHaveBeenCalled();
    const stylesheet = document.querySelector('link[data-desktop-plugin="org.example.courses"]')!;
    expect(stylesheet).not.toBeNull();
    await act(async () => stylesheet.dispatchEvent(new Event("error")));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("stylesheet could not be loaded");
    expect(bridge.closeView).toHaveBeenCalledWith("session-css");
    expect(document.querySelector('link[data-desktop-plugin]')).toBeNull();
    expect(loadModule).not.toHaveBeenCalled();
  });

  it("contains component failures and disposes the view without crashing the host", async () => {
    const report = jest.spyOn(console, "error").mockImplementation(() => undefined);
    loadModule.mockImplementation(async () => ({ createView(context) {
      host = context;
      context.onDispose(disposeEffect);
      return () => { throw Error("Broken plugin component"); };
    } }));
    try {
      await render();
      expect(container.querySelector('[role="alert"]')?.textContent).toContain("Broken plugin component");
      expect(container.querySelector('a[href="/local/plugins"]')).not.toBeNull();
      expect(disposeEffect).toHaveBeenCalledTimes(1);
      expect(bridge.closeView).toHaveBeenCalledWith("session-a");
    } finally { report.mockRestore(); }
  });
});
