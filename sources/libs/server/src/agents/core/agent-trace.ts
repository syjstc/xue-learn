import { randomUUID } from "node:crypto";
import { loadCheckpoint, saveCheckpoint } from "./checkpoint.js";

/** One trace id per agent task (user turn + follow-up resumes), not per thread. */
export async function resolveAgentTraceId(
  threadId: string,
  options: { continueTask?: boolean } = {},
): Promise<string> {
  const checkpoint = await loadCheckpoint(threadId);
  const existing = checkpoint.activeTraceId;
  if (options.continueTask && typeof existing === "string" && existing) {
    return existing;
  }
  const traceId = randomUUID();
  await saveCheckpoint(threadId, { ...checkpoint, activeTraceId: traceId });
  return traceId;
}

export async function clearAgentTraceId(threadId: string): Promise<void> {
  const checkpoint = await loadCheckpoint(threadId);
  if (!checkpoint.activeTraceId) return;
  const { activeTraceId: _, ...rest } = checkpoint;
  await saveCheckpoint(threadId, rest);
}

export async function agentTaskStillOpen(threadId: string): Promise<boolean> {
  const checkpoint = await loadCheckpoint(threadId);
  return Boolean(checkpoint.pendingInterrupt);
}
