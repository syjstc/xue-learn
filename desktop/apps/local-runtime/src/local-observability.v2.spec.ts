import { BadRequestException } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { LocalObservabilityController } from "./local-observability.controller.ts";

describe("desktop-local observability v2", () => {
  function createController() {
    const llm = {
      recoverStaleRunning: jest.fn().mockResolvedValue({ recovered: 0 }),
      query: jest.fn().mockResolvedValue({ logs: [] }),
      deleteAll: jest.fn(),
      queryGoals: jest.fn(),
      queryTraces: jest.fn(),
      queryStructuredReliability: jest.fn(),
      queryGoalUsage: jest.fn(),
      queryDetail: jest.fn(),
      queryLocalTokenUsage: jest
        .fn()
        .mockResolvedValue({ models: [], daily: [], pricing: [] }),
      saveLocalModelPricing: jest.fn().mockResolvedValue({ saved: true }),
      deleteLocalModelPricing: jest.fn().mockResolvedValue({ deleted: true }),
    };
    const errors = {
      list: jest.fn().mockResolvedValue({ items: [] }),
      detail: jest.fn(),
    };
    return {
      controller: new LocalObservabilityController(
        llm as never,
        errors as never,
      ),
      llm,
      errors,
    };
  }

  it("does not inherit the hosted admin-name guard", () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, LocalObservabilityController),
    ).toBeUndefined();
  });

  it("delegates LLM filters to the shared SQLite query service", async () => {
    const { controller, llm } = createController();
    const previousDev = process.env.XUELEARN_DESKTOP_DEV;
    process.env.XUELEARN_DESKTOP_DEV = "1";

    try {
      await controller.listLlmLogs(
        "25",
        "2",
        "unit.learning_material",
        "generation",
        "llm",
        "failed",
        "openai",
        "trace-1",
        "goal-1",
        "unit",
        "1",
      );
    } finally {
      if (previousDev === undefined) delete process.env.XUELEARN_DESKTOP_DEV;
      else process.env.XUELEARN_DESKTOP_DEV = previousDev;
    }

    expect(llm.query).toHaveBeenCalledWith({
      limit: 25,
      page: 2,
      operation: "unit.learning_material",
      kind: "generation",
      spanType: "llm",
      status: "failed",
      provider: "openai",
      traceId: "trace-1",
      goalId: "goal-1",
      scope: "unit",
      traceTimeline: true,
    });
  });

  it("parses local error filters before querying", async () => {
    const { controller, errors } = createController();

    await controller.listBackendErrors(
      "25",
      "cursor",
      "168",
      "worker",
      "desktop-local",
      "5xx",
      "timeout",
    );

    expect(errors.list).toHaveBeenCalledWith({
      limit: 25,
      cursor: "cursor",
      hours: 168,
      source: "worker",
      service: "desktop-local",
      status: "5xx",
      search: "timeout",
    });
  });

  it("exposes local daily usage and validates editable model prices", async () => {
    const { controller, llm } = createController();

    await controller.tokenUsage("90");
    await controller.saveTokenPricing({
      provider: "openai",
      model: "gpt-local",
      uncachedInputUsdPerMillion: 2.5,
      cachedInputUsdPerMillion: 0.25,
      outputUsdPerMillion: 10,
    });

    expect(llm.queryLocalTokenUsage).toHaveBeenCalledWith(90);
    expect(llm.saveLocalModelPricing).toHaveBeenCalledWith({
      provider: "openai",
      model: "gpt-local",
      uncachedInputUsdPerMillion: 2.5,
      cachedInputUsdPerMillion: 0.25,
      outputUsdPerMillion: 10,
    });
    expect(() => controller.tokenUsage("0")).toThrow(BadRequestException);
    expect(() =>
      controller.saveTokenPricing({
        provider: "openai",
        model: "gpt",
        uncachedInputUsdPerMillion: -1,
        cachedInputUsdPerMillion: 0,
        outputUsdPerMillion: 0,
      }),
    ).toThrow(BadRequestException);
  });
});
