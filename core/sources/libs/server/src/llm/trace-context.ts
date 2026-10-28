import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/** Mutable ref so child logs can attach to the active LLM span in the same trace. */
export type ActiveSpanRef = { id?: string };

export type LlmTraceContext = {
  traceId: string;
  meta?: Record<string, unknown>;
  activeSpan?: ActiveSpanRef;
};

const storage = new AsyncLocalStorage<LlmTraceContext>();

export function getLlmTrace(): LlmTraceContext | undefined {
  return storage.getStore();
}

export function getActiveParentLogId(): string | undefined {
  return storage.getStore()?.activeSpan?.id;
}

export function setActiveParentLogId(logId: string | undefined): void {
  const store = storage.getStore();
  if (!store?.activeSpan) return;
  store.activeSpan.id = logId;
}

/** Run work under a trace id (e.g. generation run) for grouped LLM logs. */
export function runWithLlmTrace<T>(
  trace: { traceId?: string; meta?: Record<string, unknown> },
  fn: () => T,
): T {
  const parent = storage.getStore();
  const traceId = trace.traceId ?? randomUUID();
  const meta = { ...parent?.meta, ...trace.meta };
  const activeSpan: ActiveSpanRef = { id: parent?.activeSpan?.id };
  return storage.run(
    {
      traceId,
      meta: Object.keys(meta).length ? meta : undefined,
      activeSpan,
    },
    fn,
  );
}

export async function runWithLlmTraceAsync<T>(
  trace: { traceId?: string; meta?: Record<string, unknown> },
  fn: () => Promise<T>,
): Promise<T> {
  return runWithLlmTrace(trace, fn);
}

/**
 * Keep an asynchronous side effect in the current trace while isolating its
 * mutable active-span reference. Its logs can remain children of the caller,
 * but they can never overwrite the caller's active LLM log.
 */
export function runWithIsolatedLlmSpan<T>(fn: () => T): T {
  const parent = storage.getStore();
  if (!parent) return fn();
  return storage.run(
    {
      ...parent,
      activeSpan: { id: parent.activeSpan?.id },
    },
    fn,
  );
}

export async function runWithIsolatedLlmSpanAsync<T>(
  fn: () => Promise<T>,
): Promise<T> {
  return runWithIsolatedLlmSpan(fn);
}

/** Pin parse/tool logs under a specific parent LLM log id for the duration of `fn`. */
export function runWithLogParent<T>(
  parentLogId: string | undefined,
  fn: () => T,
): T {
  const store = storage.getStore();
  if (!store) return fn();
  const prev = store.activeSpan?.id;
  if (store.activeSpan) store.activeSpan.id = parentLogId;
  try {
    return fn();
  } finally {
    if (store.activeSpan) store.activeSpan.id = prev;
  }
}

export async function runWithLogParentAsync<T>(
  parentLogId: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return runWithLogParent(parentLogId, fn);
}
