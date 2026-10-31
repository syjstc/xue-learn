import { retryOverloadedAuthoring } from "./authoring-provider-retry.js";
import { StructuredGenerationError } from "../../llm/validated-structured-generation.js";

const busy = () => new StructuredGenerationError("unit.authoring_agent", "tool-call", 1,
  ["Our servers are currently overloaded. Please try again later."]);

test("continues the same authoring operation after transient overload with bounded backoff", async () => {
  const run = jest.fn().mockRejectedValueOnce(busy()).mockRejectedValueOnce(busy()).mockResolvedValue("saved result");
  const wait = jest.fn().mockResolvedValue(undefined);
  await expect(retryOverloadedAuthoring(run, { wait })).resolves.toBe("saved result");
  expect(run).toHaveBeenCalledTimes(3);
  expect(wait.mock.calls.map(([delay]) => delay)).toEqual([15_000, 45_000]);
});

test("preserves a persistent overload after the bounded retries", async () => {
  const error = busy();
  const run = jest.fn().mockRejectedValue(error);
  await expect(retryOverloadedAuthoring(run, { delaysMs: [1, 2], wait: async () => {} })).rejects.toBe(error);
  expect(run).toHaveBeenCalledTimes(3);
});

test.each([
  new Error("HTTP 401: invalid credentials"),
  new StructuredGenerationError("unit.authoring_agent", "validation", 1, ["配图仍未通过检查：Our servers are currently overloaded. Please try again later."]),
])("does not retry authorization or content failures", async (error) => {
  const run = jest.fn().mockRejectedValue(error);
  const wait = jest.fn();
  await expect(retryOverloadedAuthoring(run, { wait })).rejects.toBe(error);
  expect(run).toHaveBeenCalledTimes(1);
  expect(wait).not.toHaveBeenCalled();
});

test("cancellation interrupts backoff without launching another attempt", async () => {
  const controller = new AbortController();
  const run = jest.fn().mockRejectedValue(busy());
  const result = retryOverloadedAuthoring(run, { signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  await expect(result).rejects.toMatchObject({ name: "GenerationCancelledError" });
  expect(run).toHaveBeenCalledTimes(1);
});
