import { setTimeout as sleep } from "node:timers/promises";
import { displayBuildRetryReason } from "../../display-build/retry.js";
import { GenerationCancelledError } from "../errors.js";
import { StructuredGenerationError } from "../../llm/validated-structured-generation.js";

const OVERLOAD_DELAYS_MS = [15_000, 45_000, 90_000] as const;

function isProviderOverload(error: unknown): boolean {
  if (error instanceof StructuredGenerationError) {
    return error.issues.length > 0
      && error.issues.every((issue) => displayBuildRetryReason(issue) === "provider-busy");
  }
  return error instanceof Error && displayBuildRetryReason(error.message) === "provider-busy";
}

/** Retry only a known transient overload; authoring itself resumes its durable transcript. */
export async function retryOverloadedAuthoring<T>(
  run: () => Promise<T>,
  options: {
    signal?: AbortSignal;
    delaysMs?: readonly number[];
    wait?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  } = {},
): Promise<T> {
  const wait = options.wait ?? (async (delayMs, signal) => {
    try { await sleep(delayMs, undefined, { signal }); }
    catch (error) {
      if (signal?.aborted) throw new GenerationCancelledError();
      throw error;
    }
  });
  const delays = options.delaysMs ?? OVERLOAD_DELAYS_MS;
  for (let attempt = 0; ; attempt++) {
    if (options.signal?.aborted) throw new GenerationCancelledError();
    try { return await run(); }
    catch (error) {
      if (options.signal?.aborted) throw new GenerationCancelledError();
      if (!isProviderOverload(error) || attempt >= delays.length) throw error;
      await wait(delays[attempt]!, options.signal);
    }
  }
}
