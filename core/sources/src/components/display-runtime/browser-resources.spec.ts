/** @jest-environment jsdom */
import {createBrowserDisplayResourceResolver} from "./browser-resources.js";

describe("display browser resource readiness", () => {
  const originalFetch = globalThis.fetch;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  afterEach(() => {globalThis.fetch = originalFetch; URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; jest.restoreAllMocks(); jest.useRealTimers();});

  it("renders only integrity-verified bytes and releases the resulting URL", async () => {
    const image = document.createElement("img");
    const decode = jest.fn(async () => {});
    Object.defineProperty(image, "decode", {value: decode});
    jest.spyOn(window, "Image").mockImplementation(() => image);
    const fetch = jest.fn(async () => ({ok: true, status: 200, headers: {get: () => "image/png"}, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer}));
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
    URL.createObjectURL = jest.fn(() => "blob:verified-image");
    URL.revokeObjectURL = jest.fn();
    const resolver = createBrowserDisplayResourceResolver();
    const pending = resolver({id: "figure", kind: "image", uri: "https://assets.example/figure.png", integrity: "sha256-example"});
    for (let index = 0; index < 8; index++) await Promise.resolve();
    expect(fetch).toHaveBeenCalledWith("https://assets.example/figure.png", expect.objectContaining({credentials: "omit", integrity: "sha256-example"}));
    expect(image.src).toBe("blob:verified-image");
    image.dispatchEvent(new Event("load"));
    expect(await pending).toMatchObject({uri: "blob:verified-image"});
    expect(decode).toHaveBeenCalledTimes(1);
    resolver.dispose();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:verified-image");
  });

  it("times out a media load instead of reporting its URL as ready", async () => {
    jest.useFakeTimers();
    const resolver = createBrowserDisplayResourceResolver({timeoutMs: 25});
    const pending = resolver({id: "clip", kind: "audio", uri: "/missing.mp3"});
    const rejected = expect(pending).rejects.toThrow("Timed out loading clip");
    await Promise.resolve();
    jest.advanceTimersByTime(25);
    await rejected;
    resolver.dispose();
  });

  it("cancels pending image readiness when its runtime is disposed", async () => {
    const image = document.createElement("img");
    jest.spyOn(window, "Image").mockImplementation(() => image);
    const resolver = createBrowserDisplayResourceResolver();
    const pending = resolver({id: "figure", kind: "image", uri: "/delayed.png"});
    const rejected = expect(pending).rejects.toThrow("Cancelled display resource figure");
    await Promise.resolve();
    resolver.dispose();
    await rejected;
    expect(image.hasAttribute("src")).toBe(false);
  });
});
