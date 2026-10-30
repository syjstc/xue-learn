import { runOptionalKnowledgeSearch } from "./optional-knowledge.js";
import type { KnowledgeActivity } from "../../../domain/src/web-knowledge.js";
import type { WebKnowledgeResult } from "./web-knowledge.js";

const activity: KnowledgeActivity = {
  id: "search-1",
  query: "topic",
  reason: "clarify",
  mode: "web_search",
  status: "complete",
};
describe("optional intake search", () => {
  afterEach(() => jest.useRealTimers());
  it("continues immediately when search is disabled or fails without exposing stale sources", async () => {
    const events: KnowledgeActivity[] = [];
    const result = await runOptionalKnowledgeSearch({
      query: "topic",
      reason: "clarify",
      onActivity: async (event) => {
        events.push(event);
      },
      lookup: async (_signal, emit) => {
        const failed = {
          ...activity,
          status: "error" as const,
          error: "service unavailable",
        };
        await emit(failed);
        return {
          context: "stale web information",
          sources: [{ kind: "web", title: "old" }],
          stale: true,
          activity: failed,
        };
      },
    });
    expect(result).toMatchObject({
      context: "",
      sources: [],
      continueWithoutSearch: true,
      activity: { status: "skipped", skipReason: "unavailable" },
    });
    expect(result.nextStep).toContain("Do not retry");
    expect(events.map((event) => event.status)).toEqual(["skipped"]);
  });
  it("bounds a hung lookup, aborts it, and suppresses its late success/progress", async () => {
    jest.useFakeTimers();
    const events: KnowledgeActivity[] = [];
    let resolve!: (value: WebKnowledgeResult) => void;
    let emit!: (event: KnowledgeActivity) => Promise<void>;
    let signal!: AbortSignal;
    const resultPromise = runOptionalKnowledgeSearch({
      query: "topic",
      reason: "clarify",
      timeoutMs: 100,
      onActivity: async (event) => {
        events.push(event);
      },
      lookup: async (abort, sink) => {
        signal = abort;
        emit = sink;
        return new Promise((done) => {
          resolve = done;
        });
      },
    });
    await jest.advanceTimersByTimeAsync(100);
    expect(await resultPromise).toMatchObject({
      continueWithoutSearch: true,
      activity: { status: "skipped", skipReason: "timeout" },
    });
    expect(signal.aborted).toBe(true);
    await emit(activity);
    resolve({ context: "late", sources: [], stale: false, activity });
    await Promise.resolve();
    expect(events.map((event) => event.status)).toEqual(["skipped"]);
  });
  it("preserves a successful verified result and handles unexpected lookup rejection", async () => {
    const good = { context: "verified", sources: [], stale: false, activity };
    expect(
      await runOptionalKnowledgeSearch({
        query: "topic",
        reason: "clarify",
        onActivity: async () => {},
        lookup: async () => good,
      }),
    ).toEqual(good);
    expect(
      await runOptionalKnowledgeSearch({
        query: "topic",
        reason: "clarify",
        onActivity: async () => {},
        lookup: async () => {
          throw Error("network");
        },
      }),
    ).toMatchObject({ continueWithoutSearch: true });
  });
});
