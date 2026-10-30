import { randomUUID } from "node:crypto";
import type { KnowledgeActivity } from "../../../domain/src/web-knowledge.js";
import type { WebKnowledgeResult } from "./web-knowledge.js";

/** Intake search is optional. Bound the entire lookup (including local recall),
 * cancel network work, and ignore late progress after the terminal event. */
export async function runOptionalKnowledgeSearch(options: {
  query: string;
  reason: string;
  timeoutMs?: number;
  onActivity(activity: KnowledgeActivity): Promise<void>;
  lookup(
    signal: AbortSignal,
    onActivity: (activity: KnowledgeActivity) => Promise<void>,
  ): Promise<WebKnowledgeResult>;
}): Promise<
  WebKnowledgeResult & { continueWithoutSearch?: true; nextStep?: string }
> {
  const controller = new AbortController();
  let closed = false;
  let timedOut = false;
  let latest: KnowledgeActivity = {
    id: randomUUID(),
    mode: "web_search",
    status: "searching",
    query: options.query,
    reason: options.reason,
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error("SEARCH_TIMEOUT"));
    }, options.timeoutMs ?? 8_000);
  });
  try {
    const result = await Promise.race([
      options.lookup(controller.signal, async (activity) => {
        if (closed) return;
        latest = activity;
        // Only publish the final skipped status for an unsuccessful lookup.
        if (activity.status !== "error") await options.onActivity(activity);
      }),
      timeout,
    ]);
    if (
      result.activity.status !== "error" &&
      result.activity.status !== "skipped"
    )
      return result;
    latest = result.activity;
  } catch {
    // This tool must never turn an optional search into a failed intake run.
  } finally {
    closed = true;
    if (timer) clearTimeout(timer);
    controller.abort();
  }
  const activity: KnowledgeActivity = {
    ...latest,
    status: "skipped",
    sources: [],
    sourceCount: 0,
    saved: false,
    stale: false,
    error: undefined,
    skipReason: timedOut ? "timeout" : "unavailable",
  };
  await options.onActivity(activity);
  return {
    context: "",
    sources: [],
    stale: false,
    activity,
    continueWithoutSearch: true,
    nextStep:
      "Web search was skipped. Continue goal intake using the learner's information and stable existing knowledge. Ask the next clarification or show the confirmation now. Do not retry search or claim current web verification.",
  };
}
