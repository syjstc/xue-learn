import { isGenerationCancelled } from "./errors.js";
import { assertRunActive } from "./run.js";
import type { TrackedWorkContext } from "./tracked-sse.js";
import type { StreamTokenHandler } from "../llm/chat-stream.js";

const RUN_ACTIVE_CHECK_MS = 2_000;

export function createTrackedTokenHandler(
  ctx: TrackedWorkContext
): StreamTokenHandler {
  let tokenCount = 0;
  let lastActiveCheck = 0;

  return async (delta) => {
    if (ctx.signal.aborted) return;

    tokenCount += 1;
    const now = Date.now();
    if (tokenCount === 1 || now - lastActiveCheck >= RUN_ACTIVE_CHECK_MS) {
      try {
        await assertRunActive(ctx.runId, ctx.signal);
      } catch (e) {
        if (isGenerationCancelled(e)) return;
        throw e;
      }
      lastActiveCheck = now;
    }

    if (ctx.signal.aborted) return;
    await ctx.send({ type: "token", delta });
  };
}
