/** @jest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { LocalAiModelSettings } from "@xue-learn/core/runtime-contracts";
import { ProviderQuickSetupCard } from "./provider-quick-setup-card";
const mockSave = jest.fn(),
  mockList = jest.fn();
jest.mock("@xue-learn/core/i18n", () => ({
  useI18n: () => ({ locale: "en" }),
}));
jest.mock("./runtime", () => ({
  getDesktopBridge: () => ({
    external: { openHttpsUrl: jest.fn() },
    codexAuth: { status: jest.fn() },
  }),
}));
const settings = {
  chatProvider: "minimax",
  chatModel: "existing-model",
  customChatEndpoints: { profiles: [], activeProfileId: null },
} as unknown as LocalAiModelSettings;
describe("provider quick setup", () => {
  let container: HTMLDivElement, root: Root, fetchMock: jest.Mock;
  const onConnected = jest.fn(),
    originalFetch = globalThis.fetch;
  const render = async () =>
    act(async () =>
      root.render(
        <ProviderQuickSetupCard
          settings={settings}
          statuses={[]}
          onConnected={onConnected}
        />,
      ),
    );
  const change = async (selector: string, value: string) =>
    act(async () => {
      const input = container.querySelector<
        HTMLInputElement | HTMLSelectElement
      >(selector)!;
      const prototype =
        input instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
        input,
        value,
      );
      input.dispatchEvent(
        new Event(input instanceof HTMLSelectElement ? "change" : "input", {
          bubbles: true,
        }),
      );
    });
  const read = async () =>
    act(async () => {
      [...container.querySelectorAll("button")]
        .find((b) => /Read available models/.test(b.textContent ?? ""))!
        .click();
    });
  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    onConnected.mockReset();
    mockSave
      .mockReset()
      .mockResolvedValue([
        { providerId: "deepseek", configuredFields: ["apiKey"] },
      ]);
    mockList.mockReset();
    window.xueLearnModelCatalog = { list: mockList, saveCredentials: mockSave };
    fetchMock = jest.fn();
    globalThis.fetch = fetchMock;
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete window.xueLearnModelCatalog;
    globalThis.fetch = originalFetch;
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT;
  });
  it("starts with a provider dropdown and no hardcoded model selection", async () => {
    await render();
    expect(
      container.querySelector<HTMLSelectElement>("#quick-provider")!.value,
    ).toBe("");
    expect(
      container.querySelectorAll("#quick-provider option").length,
    ).toBeGreaterThan(8);
    expect(container.textContent).toContain("DeepSeek · Recommended");
    expect(container.textContent).toContain("Generic / OpenAI-compatible");
    expect(container.querySelector("#quick-model")).toBeNull();
    expect(mockList).not.toHaveBeenCalled();
  });
  it("reads live IDs, lets the learner select, then saves the route before restarting credentials", async () => {
    const order: string[] = [];
    mockList.mockResolvedValue({
      providerId: "deepseek",
      code: "ok",
      models: [{ id: "new-release-model", label: "new-release-model" }],
      source: "provider",
      fetchedAt: 1000,
    });
    fetchMock.mockImplementation(async () => {
      order.push("route");
      return {
        ok: true,
        json: async () => ({
          ...settings,
          chatProvider: "deepseek",
          chatModel: "new-release-model",
        }),
      };
    });
    mockSave.mockImplementation(async () => {
      order.push("credentials");
      return [];
    });
    await render();
    await change("#quick-provider", "deepseek");
    await change("#quick-provider-key", "test-api-key");
    await read();
    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "deepseek",
        apiKey: "test-api-key",
      }),
    );
    expect(mockSave).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      container.querySelector<HTMLSelectElement>("#quick-model")!.value,
    ).toBe("new-release-model");
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    expect(order).toEqual(["route", "credentials"]);
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe(
      "new-release-model",
    );
  });
  it("shows discovery failure and enables manual input without activating a model", async () => {
    mockList.mockResolvedValue({
      providerId: "deepseek",
      code: "unauthorized",
      models: [],
      source: "provider",
      fetchedAt: 1,
    });
    await render();
    await change("#quick-provider", "deepseek");
    await change("#quick-provider-key", "test-key");
    await read();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "did not accept",
    );
    expect(
      container.querySelector<HTMLInputElement>("input#quick-model"),
    ).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("restores the previous model route if the secure credential write fails", async () => {
    mockList.mockResolvedValue({ providerId: "deepseek", code: "ok", models: [{ id: "new-model", label: "new-model" }], source: "provider", fetchedAt: 1 });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...settings, chatProvider: "deepseek", chatModel: "new-model" }) });
    mockSave.mockRejectedValue(Error("secure storage unavailable"));
    await render();
    await change("#quick-provider", "deepseek");
    await change("#quick-provider-key", "test-key");
    await read();
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(onConnected).not.toHaveBeenCalled();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ providerId: "minimax", model: "existing-model" });
  });
  it("discards late results and clears the key when changing providers", async () => {
    let finish!: (value: unknown) => void;
    mockList.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await render();
    await change("#quick-provider", "deepseek");
    await change("#quick-provider-key", "test-key");
    await read();
    await change("#quick-provider", "openai");
    await act(async () =>
      finish({
        providerId: "deepseek",
        code: "ok",
        models: [{ id: "stale-model", label: "stale-model" }],
        fetchedAt: 1,
      }),
    );
    expect(
      container.querySelector<HTMLInputElement>("#quick-provider-key")!.value,
    ).toBe("");
    expect(container.textContent).not.toContain("stale-model");
  });
});
