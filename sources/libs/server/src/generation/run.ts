import { getActivePresentationCapabilities } from "../llm/display-capabilities.js";
import { presentationCapabilitiesSchema } from "../../../domain/src/presentation-capabilities.js";
import {
  safeJsonStringify,
  stripLoneSurrogates,
  tBackend,
} from "../../../common/src/index.js";
import { randomUUID } from "node:crypto";
import type { SseEvent } from "../llm/sse.js";
import { applyMaterialDelta, type MaterialLike } from "../../../contracts/src/index.js";
import { parseJson } from "../utils.js";
import { GenerationCancelledError } from "./errors.js";
import { publishRunEvent } from "./event-publish.js";
import { getCurrentUserId } from "../user-context.js";
import {
  GENERATION_RUN_INTERRUPTED_CODE,
  generationRunLeaseCutoff,
  isGenerationRunLeaseStale,
  startGenerationRunHeartbeat,
} from "./run-lease.js";
import { DEFAULT_GENERATION_INTERRUPTED_MESSAGE } from "./run-recovery.js";
import { requireGenerationRunPersistence } from "./run-persistence.js";

export type GenerationScope = "goal" | "module" | "unit" | "goal_creation";
export type GenerationRunStatus =
  "running" | "completed" | "cancelled" | "error";

const abortControllers = new Map<string, AbortController>();
const liveSubscribers = new Map<string, Set<(event: StoredRunEvent) => void>>();

/** Batch token deltas so long streams do not block SQLite on every chunk. */
const TOKEN_FLUSH_MS = 300;

/** High-frequency partial snapshots are debounced to DB so reconnect can restore JIT UI. */
const LIVE_ONLY_SSE_EVENTS = new Set<SseEvent["type"]>([
  "map_partial",
  "material_partial",
  "cornell_partial",
  "sq_partial",
  "quiz_partial",
  "micro_unit_partial",
  "derivation_partial",
  "teaching_derivation_partial",
]);
const PARTIAL_FLUSH_MS = 300;
const partialBuffers = new Map<
  string,
  {
    event: SseEvent | null;
    snapshotKey: string | null;
    timer: ReturnType<typeof setTimeout> | null;
    flushPromise: Promise<void> | null;
  }
>();
const materialDeltaSnapshots = new Map<string, MaterialLike>();

export type StoredRunEvent = {
  sequence: number;
  event: SseEvent;
};
const tokenBuffers = new Map<
  string,
  {
    delta: string;
    timer: ReturnType<typeof setTimeout> | null;
    flushPromise: Promise<void> | null;
  }
>();

export function registerRunAbort(runId: string): AbortSignal {
  const existing = abortControllers.get(runId);
  if (existing) existing.abort();

  const controller = new AbortController();
  abortControllers.set(runId, controller);
  return controller.signal;
}

export function unregisterRunAbort(runId: string) {
  abortControllers.delete(runId);
  liveSubscribers.delete(runId);
  const buf = tokenBuffers.get(runId);
  if (buf?.timer) clearTimeout(buf.timer);
  tokenBuffers.delete(runId);
  const partial = partialBuffers.get(runId);
  if (partial?.timer) clearTimeout(partial.timer);
  partialBuffers.delete(runId);
  materialDeltaSnapshots.delete(runId);
}

export function subscribeLiveRunEvents(
  runId: string,
  listener: (event: StoredRunEvent) => void,
): () => void {
  let set = liveSubscribers.get(runId);
  if (!set) {
    set = new Set();
    liveSubscribers.set(runId, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set && set.size === 0) liveSubscribers.delete(runId);
  };
}

function emitLiveRunEvent(runId: string, event: StoredRunEvent) {
  const subscribers = liveSubscribers.get(runId);
  if (!subscribers) return;

  for (const listener of [...subscribers]) {
    try {
      listener(event);
    } catch (err) {
      subscribers.delete(listener);
      console.warn(
        `[generation] dropped live subscriber for run ${runId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (subscribers.size === 0) {
    liveSubscribers.delete(runId);
  }
}

function sanitizeRunEvent(event: SseEvent): SseEvent {
  switch (event.type) {
    case "token":
      return { ...event, delta: stripLoneSurrogates(event.delta) };
    case "status":
    case "progress":
      return event.message
        ? { ...event, message: stripLoneSurrogates(event.message) }
        : event;
    case "cancelled":
    case "error":
      return { ...event, message: stripLoneSurrogates(event.message) };
    default:
      return event;
  }
}

export function abortRunLocally(runId: string) {
  abortControllers.get(runId)?.abort();
}

export async function createGenerationRun(params: {
  scope: GenerationScope;
  scopeId: string;
  operation: string;
}): Promise<string> {
  const id = randomUUID();
  await requireGenerationRunPersistence().create({
    id,
    userId: getCurrentUserId() ?? null,
    scope: params.scope,
    scopeId: params.scopeId,
    operation: params.operation,
    now: new Date(),
  });
  const presentationCapabilities = getActivePresentationCapabilities();
  if (presentationCapabilities) await requireGenerationRunPersistence().appendEvent({
    runId: id, type: "generation_context", payload: safeJsonStringify({version: 1, presentationCapabilities}),
    snapshotKey: "generation_context.v1", now: new Date(),
  });
  return id;
}

/** Re-enter accepted facts before provider work; metadata is never a learner SSE. */
export async function readGenerationRunPresentationCapabilities(runId: string) {
  const rows = await requireGenerationRunPersistence().listEventsAfter(runId, -1);
  const saved = rows.find(row => row.type === "generation_context");
  if (!saved) return undefined;
  const context = JSON.parse(saved.payload) as {version?: number; presentationCapabilities?: unknown};
  if (context.version !== 1) throw new Error("Unsupported persisted generation presentation context");
  return presentationCapabilitiesSchema.parse(context.presentationCapabilities);
}

export async function cancelActiveRuns(
  scope: GenerationScope,
  scopeId: string,
  operation: string,
) {
  const active = await requireGenerationRunPersistence().listRunning({
    scope,
    scopeId,
    operation,
  });
  for (const run of active) {
    await cancelGenerationRun(run.id);
  }
}

export async function cancelGenerationRun(runId: string) {
  abortRunLocally(runId);
  await flushRunTokenBuffer(runId);
  await flushRunPartialBuffer(runId);
  await transitionRun(runId, {
    type: "cancelled",
    message: tBackend("error.generation.cancelled"),
  });
}

export async function assertRunActive(runId: string, signal: AbortSignal) {
  if (signal.aborted) throw new GenerationCancelledError();

  const run = await requireGenerationRunPersistence().find(runId);
  if (!run) throw new Error(tBackend("error.generation.notFound"));
  if (run.status === "cancelled") {
    abortRunLocally(runId);
    throw new GenerationCancelledError();
  }
  if (run.status !== "running") {
    throw new Error(tBackend("error.generation.ended"));
  }
}

function logRunPersistError(runId: string, err: unknown) {
  console.error(
    `[generation] failed to persist run ${runId}:`,
    err instanceof Error ? err.message : err,
  );
}

async function persistPartialSnapshot(
  runId: string,
  event: SseEvent,
  snapshotKey: string,
) {
  try {
    const stored = await persistEventRow(runId, event, snapshotKey);
    if (stored) {
      void publishRunEvent(runId, stored.event, stored.sequence);
      emitLiveRunEvent(runId, stored);
    }
  } catch (err) {
    logRunPersistError(runId, err);
  }
}

export async function flushRunPartialBuffer(runId: string): Promise<void> {
  const buf = partialBuffers.get(runId);
  if (!buf) return;

  if (buf.flushPromise) {
    await buf.flushPromise;
    if (buf.event) await flushRunPartialBuffer(runId);
    return;
  }

  if (buf.timer) {
    clearTimeout(buf.timer);
    buf.timer = null;
  }

  const event = buf.event;
  if (!event) return;
  const snapshotKey = buf.snapshotKey ?? event.type;
  // Clear before awaiting so a newer snapshot can be detected and flushed.
  buf.event = null;
  buf.snapshotKey = null;
  const work = persistPartialSnapshot(runId, event, snapshotKey);
  buf.flushPromise = work;
  try {
    await work;
  } finally {
    if (buf.flushPromise === work) buf.flushPromise = null;
  }
  if (buf.event) await flushRunPartialBuffer(runId);
}

function schedulePartialPersist(runId: string, event: SseEvent) {
  const sanitized = sanitizeRunEvent(event);
  // Live UIs need the latest JIT snapshot immediately. DB persistence stays
  // debounced for reconnect restore and does not gate the first paint.
  emitLiveRunEvent(runId, { sequence: -1, event: sanitized });
  let buf = partialBuffers.get(runId);
  if (!buf) {
    buf = {
      event: sanitized,
      snapshotKey: sanitized.type,
      timer: null,
      flushPromise: null,
    };
    partialBuffers.set(runId, buf);
  } else {
    buf.event = sanitized;
    buf.snapshotKey = sanitized.type;
  }
  if (buf.timer) return;
  buf.timer = setTimeout(() => {
    const current = partialBuffers.get(runId);
    if (current) current.timer = null;
    void flushRunPartialBuffer(runId);
  }, PARTIAL_FLUSH_MS);
}

/**
 * Deltas stay small on the wire, but reconnect recovery must be independent of
 * every prior live event. Accumulate a full snapshot only in server memory and
 * persist that snapshot through the existing debounced partial-event slot.
 */
function scheduleMaterialDeltaPersist(
  runId: string,
  event: Extract<SseEvent, { type: "material_delta" }>,
) {
  const sanitized = sanitizeRunEvent(event) as typeof event;
  emitLiveRunEvent(runId, { sequence: -1, event: sanitized });
  // Distributed subscribers receive the same compact live event. The full
  // snapshot below is recovery-only and is never required for normal paint.
  void publishRunEvent(runId, sanitized);
  const material = applyMaterialDelta(
    materialDeltaSnapshots.get(runId) ?? null,
    sanitized.delta,
  );
  materialDeltaSnapshots.set(runId, material);
  const snapshot: SseEvent = {
    ...sanitized,
    type: "material_partial",
    material,
  };
  delete (snapshot as Record<string, unknown>).delta;

  let buf = partialBuffers.get(runId);
  if (!buf) {
    buf = {
      event: snapshot,
      snapshotKey: "material_delta_recovery",
      timer: null,
      flushPromise: null,
    };
    partialBuffers.set(runId, buf);
  } else {
    buf.event = snapshot;
    buf.snapshotKey = "material_delta_recovery";
  }
  if (buf.timer) return;
  buf.timer = setTimeout(() => {
    const current = partialBuffers.get(runId);
    if (current) current.timer = null;
    void flushRunPartialBuffer(runId);
  }, PARTIAL_FLUSH_MS);
}

export function extractLatestPartialEvent(eventsJson: string): SseEvent | null {
  const events = parseJson<SseEvent[]>(eventsJson, []);
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event && LIVE_ONLY_SSE_EVENTS.has(event.type)) {
      return event;
    }
  }
  return null;
}

async function persistRunEvent(runId: string, event: SseEvent) {
  if (event.type === "run") return;

  try {
    const stored = await persistEventRow(runId, event);
    if (!stored) return;
    void publishRunEvent(runId, stored.event, stored.sequence);
    emitLiveRunEvent(runId, stored);
  } catch (err) {
    logRunPersistError(runId, err);
  }
}

export async function flushRunTokenBuffer(runId: string): Promise<void> {
  const buf = tokenBuffers.get(runId);
  if (!buf) return;

  if (buf.flushPromise) {
    await buf.flushPromise;
    if (buf.delta) await flushRunTokenBuffer(runId);
    return;
  }

  if (buf.timer) {
    clearTimeout(buf.timer);
    buf.timer = null;
  }

  const delta = buf.delta;
  if (!delta) return;
  buf.delta = "";

  const work = persistRunEvent(runId, { type: "token", delta });
  buf.flushPromise = work;
  try {
    await work;
  } finally {
    if (buf.flushPromise === work) buf.flushPromise = null;
  }
  if (buf.delta) await flushRunTokenBuffer(runId);
}

function scheduleTokenFlush(runId: string) {
  const buf = tokenBuffers.get(runId);
  if (!buf || buf.timer) return;
  buf.timer = setTimeout(() => {
    const current = tokenBuffers.get(runId);
    if (current) current.timer = null;
    void flushRunTokenBuffer(runId);
  }, TOKEN_FLUSH_MS);
}

export async function appendRunEvent(runId: string, event: SseEvent) {
  if (event.type === "run") return;
  if (event.type === "done") {
    await completeGenerationRun(runId, event);
    materialDeltaSnapshots.delete(runId);
    return;
  }
  if (event.type === "error") {
    await failGenerationRun(runId, event.message);
    materialDeltaSnapshots.delete(runId);
    return;
  }
  if (event.type === "cancelled") {
    abortRunLocally(runId);
    await flushRunTokenBuffer(runId);
    await flushRunPartialBuffer(runId);
    await transitionRun(runId, event);
    materialDeltaSnapshots.delete(runId);
    return;
  }

  if (event.type === "material_delta") {
    scheduleMaterialDeltaPersist(runId, event);
    return;
  }

  if (LIVE_ONLY_SSE_EVENTS.has(event.type)) {
    schedulePartialPersist(runId, event);
    return;
  }

  if (event.type === "token") {
    const sanitized = sanitizeRunEvent(event) as Extract<
      SseEvent,
      { type: "token" }
    >;
    emitLiveRunEvent(runId, { sequence: -1, event: sanitized });
    let buf = tokenBuffers.get(runId);
    if (!buf) {
      buf = { delta: "", timer: null, flushPromise: null };
      tokenBuffers.set(runId, buf);
    }
    buf.delta += sanitized.delta;
    scheduleTokenFlush(runId);
    return;
  }

  await flushRunTokenBuffer(runId);
  await persistRunEvent(runId, event);
}

export async function completeGenerationRun(
  runId: string,
  doneEvent: Extract<SseEvent, { type: "done" }>,
) {
  await flushRunTokenBuffer(runId);
  await flushRunPartialBuffer(runId);
  await transitionRun(runId, doneEvent);
  materialDeltaSnapshots.delete(runId);
}

export async function failGenerationRun(
  runId: string,
  message: string,
  code?: string,
) {
  await flushRunTokenBuffer(runId);
  await flushRunPartialBuffer(runId);
  await transitionRun(runId, {
    type: "error",
    message,
    ...(code ? { code } : {}),
  });
  materialDeltaSnapshots.delete(runId);
}

export async function getGenerationRun(runId: string) {
  return requireGenerationRunPersistence().find(runId);
}

export async function listGenerationRunEvents(runId: string, after: number) {
  return (await requireGenerationRunPersistence().listEventsAfter(runId, after)).filter(row => row.type !== "generation_context");
}

export function heartbeatGenerationRun(runId: string): () => Promise<void> {
  return startGenerationRunHeartbeat(() =>
    requireGenerationRunPersistence().touchRunning(runId, new Date()),
  );
}

export async function failGenerationRunIfStale(
  run: { id: string; status: string; updatedAt: Date | string },
  message = DEFAULT_GENERATION_INTERRUPTED_MESSAGE,
): Promise<boolean> {
  if (run.status !== "running" || !isGenerationRunLeaseStale(run.updatedAt)) {
    return false;
  }

  const transitioned = await transitionRun(
    run.id,
    {
      type: "error",
      message,
      code: GENERATION_RUN_INTERRUPTED_CODE,
    },
    { staleBefore: generationRunLeaseCutoff() },
  );
  if (!transitioned) return false;
  await requireGenerationRunPersistence().failRunningLlmRequests(
    run.id,
    message,
  );
  return true;
}

export async function listActiveRuns(scope: GenerationScope, scopeId: string) {
  return requireGenerationRunPersistence().listRunning({ scope, scopeId });
}

export function parseRunEvents(eventsJson: string): SseEvent[] {
  return parseJson<SseEvent[]>(eventsJson, []).filter(event => String(event.type) !== "generation_context");
}

async function persistEventRow(
  runId: string,
  rawEvent: SseEvent,
  snapshotKey?: string,
): Promise<StoredRunEvent | null> {
  const event = sanitizeRunEvent(rawEvent);
  const stored = await requireGenerationRunPersistence().appendEvent({
    runId,
    type: event.type,
    payload: safeJsonStringify(event),
    snapshotKey,
    tokenDelta: event.type === "token" ? event.delta : undefined,
    statusMessage:
      (event.type === "status" || event.type === "progress") && event.message
        ? stripLoneSurrogates(event.message)
        : undefined,
    now: new Date(),
  });
  return stored ? { sequence: stored.sequence, event } : null;
}

async function transitionRun(
  runId: string,
  rawEvent: Extract<SseEvent, { type: "done" | "error" | "cancelled" }>,
  options?: { staleBefore?: Date },
): Promise<boolean> {
  const event = sanitizeRunEvent(rawEvent);
  try {
    const stored = await requireGenerationRunPersistence().transition({
      runId,
      status:
        event.type === "done"
          ? "completed"
          : event.type === "cancelled"
            ? "cancelled"
            : "error",
      type: event.type,
      payload: safeJsonStringify(event),
      statusMessage: event.type === "done" ? "" : undefined,
      errorMessage:
        event.type === "error" || event.type === "cancelled"
          ? event.message
          : undefined,
      resultJson:
        event.type === "done"
          ? safeJsonStringify(
              Object.fromEntries(
                Object.entries(event).filter(([key]) => key !== "type"),
              ),
            )
          : undefined,
      staleBefore: options?.staleBefore,
      now: new Date(),
    });
    if (!stored) return false;
    void publishRunEvent(runId, event, stored.sequence);
    emitLiveRunEvent(runId, { sequence: stored.sequence, event });
    return true;
  } catch (err) {
    logRunPersistError(runId, err);
    return false;
  }
}
