import { NotFoundException } from "@nestjs/common";
import { LocalObservabilityController } from "./local-observability.controller.ts";

describe("LocalObservabilityController development log boundary", () => {
  const previousDev = process.env.XUELEARN_DESKTOP_DEV;
  const llmLogs = {
    recoverStaleRunning: jest.fn(),
    query: jest.fn(() => ({ items: [] })),
    queryLocalTokenUsage: jest.fn(() => ({ days: [] })),
  };
  const controller = new LocalObservabilityController(
    llmLogs as never,
    {} as never,
  );

  afterEach(() => {
    if (previousDev === undefined) delete process.env.XUELEARN_DESKTOP_DEV;
    else process.env.XUELEARN_DESKTOP_DEV = previousDev;
    jest.clearAllMocks();
  });

  it("returns not found for LLM log reads outside development", async () => {
    delete process.env.XUELEARN_DESKTOP_DEV;

    await expect(controller.listLlmLogs()).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(llmLogs.query).not.toHaveBeenCalled();
  });

  it("allows LLM log reads in desktop development", async () => {
    process.env.XUELEARN_DESKTOP_DEV = "1";

    await expect(controller.listLlmLogs()).resolves.toEqual({ items: [] });
    expect(llmLogs.recoverStaleRunning).toHaveBeenCalledTimes(1);
    expect(llmLogs.query).toHaveBeenCalledTimes(1);
  });

  it("keeps token usage available in normal local builds", () => {
    delete process.env.XUELEARN_DESKTOP_DEV;

    expect(controller.tokenUsage("30")).toEqual({ days: [] });
    expect(llmLogs.queryLocalTokenUsage).toHaveBeenCalledWith(30);
  });
});
