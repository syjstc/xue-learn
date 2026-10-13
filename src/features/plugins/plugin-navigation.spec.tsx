/** @jest-environment jsdom */
import React, { act } from "react";
import { randomUUID } from "node:crypto";
import { createRoot, type Root } from "react-dom/client";
import { apiGet, apiPost } from "@/shared/api";
import { MainlineProvider } from "../learning-mainline/provider";
import { DesktopPluginView } from "./plugin-view";
import type { DesktopPluginsBridge } from "./bridge";
import type { DesktopPluginRendererModule } from "../../../packages/plugin-sdk/src/renderer";

const mockNavigate = jest.fn();
const hostPath = "/local/plugins/org.example.courses/views/catalog";
jest.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: hostPath }),
  Link: ({ to, children }: React.PropsWithChildren<{ to: string }>) => <a href={to}>{children}</a>,
}));
jest.mock("@/shared/api", () => ({ apiGet: jest.fn(), apiPost: jest.fn() }));
jest.mock("../learning-mainline/enabled.ts", () => ({ mainlineEnabled: () => true }));
jest.mock("../learning-trajectory/navigation", () => ({
  learningSessionId: () => "session-a",
  currentLearningPosition: (position: unknown) => position,
}));
jest.mock("@/components/ui/api-error-notice", () => ({ ApiErrorNotice: () => <p>Save failed</p> }));
jest.mock("react-dom/server", () => ({ renderToStaticMarkup: jest.fn() }));
jest.mock("@xue-learn/core/i18n", () => ({ useI18n: () => ({ locale: "en" }), useT: () => (key: string) => key }));
jest.mock("@xue-learn/core/ui/button", () => ({ Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} /> }));
jest.mock("@xue-learn/core/display/teaching-display", () => ({ TeachingDisplay: () => null }));
jest.mock("@/components/markdown/inline-math-text", () => ({ InlineMathText: () => null }));
jest.mock("@/components/ui/input", () => ({ Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} /> }));
jest.mock("@/components/ui/badge", () => ({ Badge: (props: React.HTMLAttributes<HTMLSpanElement>) => <span {...props} /> }));

const snapshot = {
  focus: { sessionId: "session-a", activityId: "activity-a", revision: 1 },
  activities: [{ id: "activity-a", goalId: "goal-a", unitId: "unit-a", kind: "lesson", state: "active", revision: 1, position: { unitId: "unit-a" } }],
  preferences: [],
};
const internalRoutes = ["/?space=physics", "/?space=physics&goal=goal-a", "/?goal=goal-a&module=chapter-a", "/goals/goal-a/units/unit-a/lesson-performance", "/local/video-production", "/local/image-settings", "/"];

describe("plugin navigation with an active host learning session", () => {
  let container: HTMLDivElement;
  let root: Root;
  let bridge: DesktopPluginsBridge;
  let loadModule: () => Promise<DesktopPluginRendererModule>;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.history.replaceState(null, "", hostPath);
    Object.defineProperty(crypto, "randomUUID", { configurable: true, value: randomUUID });
    jest.clearAllMocks();
    jest.mocked(apiGet).mockResolvedValue(snapshot);
    jest.mocked(apiPost).mockResolvedValue(snapshot);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    bridge = {
      list: jest.fn().mockResolvedValue([{ manifest: { id: "org.example.courses", version: "1.0.0", contributes: { views: [{ id: "catalog", title: "Courses", entry: "view.mjs" }] } }, status: "active" }]),
      openView: jest.fn().mockResolvedValue({ sessionId: "view-a", workspaceId: "workspace-a", moduleUrl: "xuelearn-plugin://view/view-a/module.mjs" }),
      closeView: jest.fn().mockResolvedValue(undefined),
    } as unknown as DesktopPluginsBridge;
    loadModule = async () => ({ createView(host) {
      return function View() {
        const [path, setPath] = host.React.useState("/");
        return <>
          <output>{path}</output>
          {internalRoutes.map(to => <a key={to} href={to} onClick={event => { event.preventDefault(); setPath(to); }}><span>{to}</span></a>)}
          <button onClick={() => host.navigate("/local/api-keys")}>Host settings</button>
        </>;
      };
    } });
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });
  const render = () => act(async () => root.render(
    <MainlineProvider><DesktopPluginView pluginId="org.example.courses" viewId="catalog" bridge={bridge} loadModule={loadModule} /></MainlineProvider>,
  ));

  it("leaves classification, course, lesson and tab links to the plugin's own navigation", async () => {
    await render();
    expect(apiGet).toHaveBeenCalled();
    for (const to of internalRoutes) {
      const anchor = [...container.querySelectorAll("a")].find(item => item.getAttribute("href") === to)!;
      // The real host listener runs on document capture before React's handler.
      await act(async () => anchor.querySelector("span")!.click());
      expect(container.querySelector("output")?.textContent).toBe(to);
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(apiPost).not.toHaveBeenCalled();
      expect(window.location.pathname).toBe(hostPath);
      expect(bridge.openView).toHaveBeenCalledTimes(1);
      expect(bridge.closeView).not.toHaveBeenCalled();
    }
  });

  it("still saves host learning progress before the host's Back to plugins link navigates", async () => {
    await render();
    let finish!: (value: unknown) => void;
    jest.mocked(apiPost).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => container.querySelector<HTMLAnchorElement>('a[href="/local/plugins"]')!.click());
    expect(apiPost).toHaveBeenCalledWith(expect.stringContaining("/commands"), expect.objectContaining({ action: "position", activityId: "activity-a" }));
    expect(mockNavigate).not.toHaveBeenCalled();
    await act(async () => finish(snapshot));
    expect(mockNavigate).toHaveBeenCalledWith("/local/plugins");
  });

  it("keeps the current page when saving host learning progress fails", async () => {
    await render();
    jest.mocked(apiPost).mockRejectedValueOnce(new Error("Offline"));
    await act(async () => container.querySelector<HTMLAnchorElement>('a[href="/local/plugins"]')!.click());
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Save failed");
    expect(bridge.closeView).not.toHaveBeenCalled();
  });

  it("allows explicit navigation to host settings through the plugin SDK", async () => {
    await render();
    await act(async () => container.querySelector("button")!.click());
    expect(mockNavigate).toHaveBeenCalledWith("/local/api-keys");
  });
});
