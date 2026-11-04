import { z } from "zod";
import * as providers from "../providers/llm/index.js";
import * as chat from "./chat-stream.js";
import * as native from "./structured-native.js";
import * as logs from "./logger.js";
import { runValidatedStructuredGeneration } from "./validated-structured-generation.js";

const operation = "test.host-transport";
const contract = {
  mode: "item-array" as const,
  operation,
  prompt: "Return learning steps",
  itemSchema: z.object({ value: z.number() }),
  resultSchema: z.array(z.object({ value: z.number() })).min(1),
  assemble: (items: Array<{ value: number }>) => items,
  nativeAttemptLimit: 0,
  deepseekStrictOnly: true,
  maxRepairAttempts: 0,
};

beforeEach(() => {
  // This is the effective persisted route; a host may replace its transport.
  jest.spyOn(providers, "getActiveLlmOperationRoute").mockReturnValue({
    operationKey: operation, provider: "deepseek", model: "deepseek-flash",
  } as ReturnType<typeof providers.getActiveLlmOperationRoute>);
  jest.spyOn(logs, "patchActiveLlmStructuredOutcome").mockResolvedValue(undefined);
  jest.spyOn(logs, "patchActiveLlmRecoveryMetadata").mockResolvedValue(undefined);
  jest.spyOn(native, "streamStructuredNative").mockResolvedValue(null);
});
afterEach(() => jest.restoreAllMocks());

function textStream(value: string) {
  return jest.spyOn(chat, "streamChat").mockImplementation(async (_prompt, options) => {
    await options.onToken?.(value);
    return value;
  });
}

it("validates host text results even when the saved route names DeepSeek", async () => {
  const host = providers.createHostLlmProvider({
    id: "custom", async *stream() { yield "unused by this isolated raw-stream fixture"; },
    getEmbeddings: () => { throw new Error("No embeddings needed"); },
  });
  const dispose = providers.registerHostLlmProvider(() => host);
  const raw = textStream('[{"value":3}]');
  try {
    await expect(runValidatedStructuredGeneration(contract)).resolves.toEqual([{ value: 3 }]);
    expect(raw).toHaveBeenCalledTimes(1);
  } finally { dispose(); }
});

it("still rejects invalid host results through the business schema", async () => {
  jest.spyOn(providers, "getLlmProvider").mockReturnValue({ id: "custom" } as ReturnType<typeof providers.getLlmProvider>);
  textStream('[{"value":"invalid number"}]');
  await expect(runValidatedStructuredGeneration(contract)).rejects.toThrow();
});

it("keeps native DeepSeek strict-only operations closed to prompt JSON fallback", async () => {
  jest.spyOn(providers, "getLlmProvider").mockReturnValue({ id: "deepseek" } as ReturnType<typeof providers.getLlmProvider>);
  const raw = textStream('[{"value":3}]');
  await expect(runValidatedStructuredGeneration(contract)).rejects.toThrow(/strict structured output is required/);
  expect(raw).not.toHaveBeenCalled();
});
