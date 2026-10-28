/** @jest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { DesktopPluginSummary } from "../../../packages/plugin-sdk/src/index";
import type { DesktopPluginsBridge } from "./bridge";
import { DesktopPluginManager } from "./plugin-manager";

jest.mock("@xue-learn/core/i18n", () => ({
  useI18n: () => ({ locale: "en" }),
}));
jest.mock("react-router-dom", () => ({
  Link: ({
    to,
    children,
    ...props
  }: React.PropsWithChildren<{ to: string }>) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

function plugin(
  overrides: Partial<DesktopPluginSummary> = {},
): DesktopPluginSummary {
  return {
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      id: "org.xuelearn.video",
      name: "Video Studio",
      version: "1.0.0",
      description: "Create course videos",
      runtime: { entry: "main.cjs" },
      integrity: {},
      requires: { "workspace.connection": 1 },
      contributes: {
        commands: [{ id: "open", title: "Open Studio" }],
        views: [{ id: "studio", title: "Open Video Studio", command: "open" }],
      },
    },
    enabled: false,
    status: "disabled",
    installedAt: "2026-10-10T08:00:00.000Z",
    missingCapabilities: [],
    ...overrides,
  };
}

describe("Desktop plugin manager", () => {
  let container: HTMLDivElement;
  let root: Root;
  let bridge: jest.Mocked<DesktopPluginsBridge>;
  const button = (label: string) =>
    Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent === label,
    )!;
  const click = async (label: string) => {
    await act(async () => button(label).click());
  };

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    bridge = {
      list: jest.fn().mockResolvedValue([plugin()]),
      install: jest.fn().mockResolvedValue(null),
      enable: jest
        .fn()
        .mockResolvedValue([plugin({ enabled: true, status: "active" })]),
      disable: jest.fn().mockResolvedValue([plugin()]),
      remove: jest.fn().mockResolvedValue([]),
      execute: jest.fn().mockResolvedValue(undefined),
      openView: jest.fn(),
      callView: jest.fn(),
      executeView: jest.fn(),
      closeView: jest.fn(),
    };
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT;
  });

  it("enables reviewed packages, exposes each view once, then disables before removal", async () => {
    await act(async () =>
      root.render(<DesktopPluginManager bridge={bridge} />),
    );
    expect(container.textContent).toContain("executable code");
    expect(button("Open Studio")).toBeUndefined();
    await click("Trust and enable");
    expect(bridge.enable).toHaveBeenCalledWith("org.xuelearn.video");
    expect(button("Remove").disabled).toBe(true);
    expect(button("Open Video Studio")).toBeDefined();
    expect(button("Open Studio")).toBeUndefined();
    bridge.list.mockResolvedValue([
      plugin({ enabled: true, status: "active" }),
    ]);
    await click("Open Video Studio");
    expect(bridge.execute).toHaveBeenCalledWith("org.xuelearn.video", "open");
    await click("Disable");
    expect(button("Open Video Studio")).toBeUndefined();
    await click("Remove");
    expect(container.textContent).toContain("No desktop plugins installed");
  });

  it("shows missing dependencies and prevents activation", async () => {
    bridge.list.mockResolvedValue([
      plugin({ missingCapabilities: ["workspace.connection@1"] }),
    ]);
    await act(async () =>
      root.render(<DesktopPluginManager bridge={bridge} />),
    );
    expect(container.textContent).toContain("Unavailable capabilities");
    expect(container.textContent).toContain("workspace.connection@1");
    expect(button("Trust and enable").disabled).toBe(true);
    await click("Trust and enable");
    expect(bridge.enable).not.toHaveBeenCalled();
  });

  it("preserves packages and gives no success notice when installation is cancelled", async () => {
    await act(async () =>
      root.render(<DesktopPluginManager bridge={bridge} />),
    );
    await click("Install local plugin");
    expect(bridge.install).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Video Studio");
    expect(container.textContent).not.toContain("Plugin installed.");
  });

  it("reconciles failed activation and provides retry and disable controls", async () => {
    await act(async () =>
      root.render(<DesktopPluginManager bridge={bridge} />),
    );
    bridge.enable.mockRejectedValue(new Error("Plugin worker could not start"));
    bridge.list.mockResolvedValue([
      plugin({
        enabled: true,
        status: "failed",
        error: "Missing runtime dependency: ffmpeg",
      }),
    ]);
    await click("Trust and enable");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Plugin worker could not start",
    );
    expect(container.textContent).toContain(
      "Missing runtime dependency: ffmpeg",
    );
    expect(button("Retry").disabled).toBe(false);
    expect(button("Disable").disabled).toBe(false);
    expect(button("Open Video Studio")).toBeUndefined();
  });

  it("locks mutations while a command runs and recovers controls after failure", async () => {
    bridge.list.mockResolvedValue([
      plugin({ enabled: true, status: "active" }),
    ]);
    await act(async () =>
      root.render(<DesktopPluginManager bridge={bridge} />),
    );
    let reject!: (error: Error) => void;
    bridge.execute.mockReturnValue(
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
    );
    await click("Open Video Studio");
    expect(button("Disable").disabled).toBe(true);
    expect(button("Install local plugin").disabled).toBe(true);
    await click("Open Video Studio");
    expect(bridge.execute).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error("Video launch failed")));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Video launch failed",
    );
    expect(button("Disable").disabled).toBe(false);
  });

  it("keeps loading errors distinct from an empty installation", async () => {
    bridge.list.mockRejectedValue(new Error("Plugin registry unavailable"));
    await act(async () =>
      root.render(<DesktopPluginManager bridge={bridge} />),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Plugin registry unavailable",
    );
    expect(container.textContent).not.toContain("No desktop plugins installed");
    bridge.list.mockResolvedValue([]);
    await click("Refresh");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("No desktop plugins installed");
  });

  it("explains an unavailable native bridge and keeps display extensions reachable", async () => {
    await act(async () => root.render(<DesktopPluginManager />));
    expect(container.textContent).toContain("updated XueLearn Desktop app");
    expect(button("Install local plugin").disabled).toBe(true);
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/local/display-plugins",
    );
  });
  it("trusts embedded code and opens its host route without launching a command", async () => {
    const embedded = plugin();
    delete embedded.manifest.runtime;
    embedded.manifest.contributes = { commands: [], views: [{ id: "courses", title: "Browse courses", entry: "view.mjs" }] };
    bridge.list.mockResolvedValue([embedded]);
    bridge.enable.mockResolvedValue([{ ...embedded, enabled: true, status: "active" }]);
    await act(async () => root.render(<DesktopPluginManager bridge={bridge} />));
    expect(container.textContent).toContain("executable code");
    await click("Trust and enable");
    const link = container.querySelector('a[href="/local/plugins/org.xuelearn.video/views/courses"]');
    expect(link?.textContent).toBe("Browse courses");
    expect(bridge.execute).not.toHaveBeenCalled();
  });
});
