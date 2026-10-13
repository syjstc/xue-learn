/** @jest-environment jsdom */
import React, { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { builtinDisplayManifests } from "../display-plugins/catalog.js";
import {
  DisplayPluginManager,
  type DisplayPluginRecord,
  type DisplayWorkspaceClient,
} from "./plugin-manager.js";
jest.mock("./workspace.css", () => ({}));
jest.mock("../display-runtime/display-runtime.css", () => ({}));
jest.mock("./plugin-preview.js", () => ({
  DisplayPluginPreview: ({ document, poster }: any) => (
    <div data-preview-kind={document.root.kind} data-poster={poster} />
  ),
}));

let container: HTMLDivElement, root: Root;
const records: DisplayPluginRecord[] = builtinDisplayManifests.map(
  (manifest) => ({ manifest, builtin: true, enabled: true, sha256: "hash" }),
);
const client = {
  get: jest.fn(async () => records),
  post: jest.fn(),
} as unknown as DisplayWorkspaceClient;
const click = async (text: string) => {
  const button = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === text,
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
};
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  HTMLElement.prototype.scrollIntoView = jest.fn();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
});

test("library cards enter previews and navigation reaches all components", async () => {
  await act(async () =>
    root.render(
      <StrictMode>
        <DisplayPluginManager client={client} />
      </StrictMode>,
    ),
  );
  expect(container.querySelectorAll(".display-plugin-card")).toHaveLength(6);
  expect(container.textContent).toContain("27 个组件");
  await click("运动场景");
  expect(
    container.querySelector('[data-preview-kind="physics:motion-scene"]'),
  ).not.toBeNull();
  expect(container.querySelector('[aria-current="page"]')?.textContent).toBe(
    "运动场景",
  );
  await act(async () =>
    (
      container.querySelector('[aria-label="下一个组件"]') as HTMLButtonElement
    ).click(),
  );
  expect(
    container.querySelector('[data-preview-kind="physics:occlusion-lab"]'),
  ).not.toBeNull();
  await click("← 全部插件");
  expect(container.querySelectorAll(".display-plugin-card")).toHaveLength(6);
});

test("search uses readable component names and filters can be cleared", async () => {
  await act(async () => root.render(<DisplayPluginManager client={client} />));
  const input = container.querySelector(
    'input[type="search"]',
  ) as HTMLInputElement;
  const set = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    set.call(input, "乐谱");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.querySelectorAll(".display-plugin-card")).toHaveLength(1);
  expect(container.textContent).toContain("音乐与乐谱");
  await act(async () => {
    set.call(input, "no-result");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.textContent).toContain("没有找到匹配的插件");
  await click("清除筛选");
  expect(container.querySelectorAll(".display-plugin-card")).toHaveLength(6);
});

test("controlled selection follows the host and reports the versioned next component", async () => {
  const manifest = builtinDisplayManifests[1],
    component = manifest.components[0],
    onSelectionChange = jest.fn();
  const selection = {
    pluginId: manifest.id,
    pluginVersion: manifest.version,
    kind: component.kind,
    componentVersion: component.version,
  };
  await act(async () =>
    root.render(
      <DisplayPluginManager
        client={client}
        selection={selection}
        onSelectionChange={onSelectionChange}
      />,
    ),
  );
  expect(
    container.querySelector('[data-preview-kind="math:formula"]'),
  ).not.toBeNull();
  await act(async () =>
    (
      container.querySelector('[aria-label="下一个组件"]') as HTMLButtonElement
    ).click(),
  );
  expect(onSelectionChange).toHaveBeenCalledWith({
    ...selection,
    kind: "math:chart",
  });
  await act(async () =>
    root.render(
      <DisplayPluginManager
        client={client}
        selection={null}
        onSelectionChange={onSelectionChange}
      />,
    ),
  );
  expect(container.querySelectorAll(".display-plugin-card")).toHaveLength(6);
});
