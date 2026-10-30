/** @jest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LocalEmbeddingSetupGate } from "./local-embedding-setup-gate";

let mockPathname = "/local/plugins";
const mockGetStatuses = jest
  .fn()
  .mockResolvedValue([
    { providerId: "deepseek", configuredFields: ["apiKey"] },
  ]);
const mockGetStatus = jest.fn().mockResolvedValue({
  state: "not-installed",
  downloadedBytes: 0,
  totalBytes: 1,
});
const mockGetBridge = jest.fn(() => ({
  credentials: { getStatuses: mockGetStatuses },
  embeddingModel: { getStatus: mockGetStatus },
}));
jest.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: mockPathname }),
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
jest.mock("@xue-learn/core/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
jest.mock("@xue-learn/core/runtime-contracts", () => ({
  BUILTIN_EMBEDDING_MODEL_ID: "builtin-model",
}));
jest.mock("./runtime.ts", () => ({ getDesktopBridge: () => mockGetBridge() }));

describe("plugin management before embedding setup", () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: jest.Mock;
  const originalFetch = globalThis.fetch;
  const render = async () => {
    await act(async () =>
      root.render(
        <LocalEmbeddingSetupGate>
          <p data-testid="content">Route content</p>
        </LocalEmbeddingSetupGate>,
      ),
    );
  };

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mockPathname = "/local/plugins";
    mockGetBridge.mockClear();
    mockGetStatus.mockClear();
    mockGetStatuses.mockClear();
    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        chatProvider: "deepseek",
        chatModel: "deepseek-flash",
        embeddingProvider: "builtin",
        embeddingModel: "builtin-model",
      }),
    });
    globalThis.fetch = fetchMock;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    globalThis.fetch = originalFetch;
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT;
  });

  it("renders plugin management without reading model setup or credentials", async () => {
    await render();
    expect(container.querySelector('[data-testid="content"]')).not.toBeNull();
    expect(mockGetBridge).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("opens embedded plugin views before embedding setup", async () => {
    mockPathname = "/local/plugins/org.example.courses/views/catalog";
    await render();
    expect(container.querySelector('[data-testid="content"]')).not.toBeNull();
    expect(mockGetBridge).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("opens Display previews without reading model setup or credentials", async () => {
    mockPathname = "/local/display-plugins";
    await render();
    expect(container.querySelector('[data-testid="content"]')).not.toBeNull();
    expect(mockGetBridge).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps provider settings reachable before any models are configured", async () => {
    mockPathname = "/local/api-keys";
    await render();
    expect(container.querySelector('[data-testid="content"]')).not.toBeNull();
    expect(mockGetBridge).not.toHaveBeenCalled();
  });

  it("starts with a provider choice instead of a model download for an unconfigured user", async () => {
    mockGetStatuses.mockResolvedValueOnce([]);
    mockPathname = "/spaces";
    await render();
    expect(container.textContent).toContain("DeepSeek");
    expect(container.querySelector('select#quick-provider')).not.toBeNull();
    expect(container.querySelector('[data-testid="content"]')).toBeNull();
    expect(container.querySelector('a[href="/local/api-keys"]')).not.toBeNull();
  });

  it.each([
    "/spaces",
    "/local/resources",
    "/local/display-plugins-other",
    "/local/plugins-other",
  ])("continues to require model setup on %s", async (pathname) => {
    mockPathname = pathname;
    await render();
    expect(fetchMock).toHaveBeenCalledWith("/api/local/ai-models");
    expect(container.querySelector('[data-testid="content"]')).toBeNull();
    expect(container.textContent).toContain("Prepare knowledge search");
    expect(
      container.querySelector('a[href="/local/plugins"]')?.textContent,
    ).toBe("Manage desktop plugins");
  });

  it("allows management then restores the setup gate when navigating back to learning", async () => {
    mockPathname = "/spaces";
    await render();
    expect(container.querySelector('[data-testid="content"]')).toBeNull();
    mockPathname = "/local/plugins";
    await render();
    expect(container.querySelector('[data-testid="content"]')).not.toBeNull();
    mockPathname = "/spaces";
    await render();
    expect(container.querySelector('[data-testid="content"]')).toBeNull();
    expect(container.textContent).toContain("Prepare knowledge search");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
