/** @jest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  DesktopPluginSlot,
  DesktopPluginUiProvider,
  useDesktopPluginUi,
} from "./ui-extensions";
import { desktopPluginViewLaunch } from "../../../packages/plugin-sdk/src/renderer";
import type { DesktopPluginSummary } from "../../../packages/plugin-sdk/src/index";
import type { DesktopPluginsBridge } from "./bridge";

jest.mock("react-router-dom", () => ({
  useLocation: () => ({
    pathname: "/goals/goal-a/units/unit-a",
    search: "?section=section-a",
    hash: "#beat-2",
  }),
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
jest.mock("@xue-learn/core/ui/button", () => ({
  buttonVariants: () => "button",
}));
jest.mock("./plugin-view", () => ({
  DesktopPluginView: ({
    initialPath,
    context,
  }: {
    initialPath: string;
    context: unknown;
  }) => <output data-path={initialPath}>{JSON.stringify(context)}</output>,
}));

function plugin(): DesktopPluginSummary {
  return {
    manifest: {
      id: "test.plugin",
      version: "1.0.0",
      name: "Video",
      schemaVersion: 1,
      apiVersion: 1,
      requires: { "ui.extensions": 1 },
      integrity: { "view.mjs": "a".repeat(64) },
      contributes: {
        commands: [],
        views: [{ id: "studio", title: "Studio", entry: "view.mjs" }],
        ui: [
          {
            id: "open",
            title: "Open video",
            slot: "unit.content.actions",
            viewId: "studio",
            path: "/units/{unitId}?goal={goalId}",
          },
          {
            id: "panel",
            title: "Preview",
            slot: "unit.content.panels",
            viewId: "studio",
            path: "/preview/{sectionId}",
          },
          {
            id: "settings",
            title: "Video",
            slot: "settings.tabs",
            viewId: "studio",
          },
        ],
      },
    },
    enabled: true,
    status: "active",
    installedAt: "2026-10-13",
    missingCapabilities: [],
    viewRevision: "generation-a",
  };
}
function RegistryTabs() {
  const registry = useDesktopPluginUi();
  return (
    <aside data-ready={registry.ready}>
      {registry.entries
        .filter((item) => item.contribution.slot === "settings.tabs")
        .map((item) => (
          <span key={item.key}>{item.key}</span>
        ))}
    </aside>
  );
}

describe("live plugin UI placements", () => {
  let container: HTMLDivElement;
  let root: Root;
  let bridge: jest.Mocked<DesktopPluginsBridge>;
  let changed: () => void;
  const render = () =>
    act(async () =>
      root.render(
        <DesktopPluginUiProvider bridge={bridge}>
          <DesktopPluginSlot
            slot="unit.content.actions"
            context={{
              goalId: "goal-a",
              unitId: "unit-a",
              sectionId: "section-a",
            }}
          />
          <DesktopPluginSlot
            slot="unit.content.panels"
            context={{
              goalId: "goal-a",
              unitId: "unit-a",
              sectionId: "section-a",
            }}
          />
          <RegistryTabs />
        </DesktopPluginUiProvider>,
      ),
    );
  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    bridge = {
      list: jest.fn().mockResolvedValue([plugin()]),
      execute: jest.fn().mockResolvedValue(undefined),
      onChanged: jest.fn((callback) => {
        changed = callback;
        return jest.fn();
      }),
    } as unknown as jest.Mocked<DesktopPluginsBridge>;
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT;
  });

  it("declares a contextual body button, panel and namespaced settings tab without loading action code", async () => {
    await render();
    const anchor = container.querySelector("a")!;
    expect(anchor.textContent).toBe("Open video");
    const href = anchor.getAttribute("href")!;
    expect(href).toContain("pluginPath=%2Funits%2Funit-a%3Fgoal%3Dgoal-a");
    const launch = desktopPluginViewLaunch(href.slice(href.indexOf("?")));
    expect(launch.initialPath).toBe("/units/unit-a?goal=goal-a");
    expect(launch.context).toEqual({
      slot: "unit.content.actions",
      goalId: "goal-a",
      unitId: "unit-a",
      sectionId: "section-a",
      returnTo: "/goals/goal-a/units/unit-a?section=section-a#beat-2",
    });
    expect(container.querySelector("output")?.getAttribute("data-path")).toBe(
      "/preview/section-a",
    );
    expect(container.querySelector("aside")?.textContent).toBe(
      "plugin:test.plugin:settings",
    );
    expect(bridge.execute).not.toHaveBeenCalled();
    expect(bridge.onChanged).toHaveBeenCalledTimes(1);
  });
  it.each(["disabled", "failed", "stopping"] as const)(
    "removes all placements when the plugin is %s",
    async (status) => {
      await render();
      bridge.list.mockResolvedValue([{ ...plugin(), status }]);
      await act(async () => changed());
      expect(container.querySelector("a")).toBeNull();
      expect(container.querySelector("output")).toBeNull();
      expect(container.querySelector("aside")?.textContent).toBe("");
    },
  );
  it("ignores an old refresh that finishes after a new lifecycle event", async () => {
    await render();
    let finish!: (value: DesktopPluginSummary[]) => void;
    bridge.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => changed());
    bridge.list.mockResolvedValue([{ ...plugin(), status: "disabled" }]);
    await act(async () => changed());
    await act(async () => finish([plugin()]));
    expect(container.querySelector("a")).toBeNull();
  });
  it("hides stale entries on reconciliation failure and recovers on the next change", async () => {
    await render();
    bridge.list.mockRejectedValueOnce(Error("Workspace changed"));
    await act(async () => changed());
    expect(container.querySelector("a")).toBeNull();
    await act(async () => changed());
    expect(container.querySelector("a")).not.toBeNull();
  });
  it("runs declared commands with presentation context and displays failures", async () => {
    const candidate = plugin();
    candidate.manifest.contributes.ui = [
      {
        id: "inspect",
        title: "Inspect",
        slot: "unit.content.actions",
        command: "inspect",
      },
    ];
    bridge.list.mockResolvedValue([candidate]);
    bridge.execute.mockRejectedValue(Error("Command failed"));
    await render();
    await act(async () => container.querySelector("button")!.click());
    expect(bridge.execute).toHaveBeenCalledWith("test.plugin", "inspect", {
      context: expect.objectContaining({ unitId: "unit-a", goalId: "goal-a" }),
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Command failed",
    );
  });
});
