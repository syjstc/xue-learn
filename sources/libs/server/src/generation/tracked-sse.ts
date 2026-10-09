import { runWithPresentationCapabilities } from "../llm/display-capabilities.js";
import {
  getCurrentLocale,
  runWithBackendLocale,
  tBackend,
  type BackendLocale,
} from "../../../common/src/i18n/backend-i18n.js";
import { formatApiException } from "../../../common/src/api-exception.js";
import {
  appendRunEvent,
  cancelActiveRuns,
  cancelGenerationRun,
  completeGenerationRun,
  createGenerationRun,
  failGenerationRun,
  failGenerationRunIfStale,
  getGenerationRun,
  readGenerationRunPresentationCapabilities,
  heartbeatGenerationRun,
  listGenerationRunEvents,
  parseRunEvents,
  registerRunAbort,
  subscribeLiveRunEvents,
  unregisterRunAbort,
  type GenerationScope,
} from "./run.js";
import { isGenerationCancelled } from "./errors.js";
import {
  encodeSseEvent,
  sseResponse,
  type SseEvent,
} from "../llm/sse.js";
import { runWithLlmTraceAsync } from "../llm/trace-context.js";

export type TrackedWorkContext = {
  send: (event: SseEvent) => Promise<void>;
  signal: AbortSignal;
  runId: string;
};

const FALLBACK_POLL_MS = 5_000;
const KEEP_ALIVE_MS = 15_000;

export function learnerFacingGenerationRunError(input: {
  status: string;
  /** Retained for observability only; intentionally excluded from the result. */
  errorMessage?: string | null;
}): string {
  return input.status === "cancelled"
    ? tBackend("error.generation.cancelled")
    : tBackend("error.generation.failedFriendly");
}

export function createRunSubscribeStream(
  runId: string,
  after = 0,
  locale: BackendLocale = getCurrentLocale(),
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let closed = false;
  let wake: (() => void) | null = null;
  let unsubscribe: (() => void) | null = null;

  return new ReadableStream({
    start(controller) {
      let initialRowsScanned = false;
      let lastMaterialRevision = 0;
      const pendingMaterialDeltas: Array<
        Extract<SseEvent, { type: "material_delta" }>
      > = [];
      const enqueue = (event: SseEvent, id?: number) => {
        if (!closed) {
          const payload = runWithBackendLocale(locale, () =>
            encodeSseEvent(event, id),
          );
          controller.enqueue(encoder.encode(payload));
        }
      };
      void (async () => {
        let cursor = after;
        let signalled = true;
        let keepAliveDue = false;
        unsubscribe = subscribeLiveRunEvents(runId, (stored) => {
          // Ephemeral JIT snapshots (sequence < 0) are pushed directly so the
          // client does not wait for the debounced DB poll.
          if (stored.sequence < 0) {
            if (stored.event.type === "material_delta") {
              if (!initialRowsScanned) {
                pendingMaterialDeltas.push(stored.event);
              } else if (
                stored.event.streamRevision === undefined ||
                stored.event.streamRevision > lastMaterialRevision
              ) {
                lastMaterialRevision =
                  stored.event.streamRevision ?? lastMaterialRevision;
                enqueue(stored.event);
              }
            } else {
              enqueue(stored.event);
            }
          }
          signalled = true;
          wake?.();
        });
        const keepAlive = setInterval(() => {
          keepAliveDue = true;
          wake?.();
        }, KEEP_ALIVE_MS);

        try {
          enqueue({ type: "run", runId });
          const initial = await getGenerationRun(runId);
          if (!initial) {
            enqueue({
              type: "error",
              message: tBackend("error.generation.notFound"),
            });
            return;
          }
          if (await failGenerationRunIfStale(initial)) {
            signalled = true;
          }
          if (after === 0 && initial.eventsJson !== "[]") {
            for (const event of parseRunEvents(initial.eventsJson)) {
              enqueue(event);
              if (["done", "error", "cancelled"].includes(event.type)) return;
            }
          }

          while (!closed) {
            signalled = false;
            const rows = await listGenerationRunEvents(runId, cursor);
            for (const row of rows) {
              cursor = Math.max(cursor, row.sequence);
              let event: SseEvent;
              try {
                event = JSON.parse(row.payload) as SseEvent;
              } catch {
                continue;
              }
              if (row.snapshotKey === "material_delta_recovery") {
                const revision =
                  event.type === "material_partial"
                    ? event.streamRevision
                    : undefined;
                if (
                  revision !== undefined &&
                  revision <= lastMaterialRevision
                ) {
                  continue;
                }
                lastMaterialRevision = revision ?? lastMaterialRevision;
              }
              enqueue(event, row.sequence);
              if (["done", "error", "cancelled"].includes(event.type)) return;
            }
            if (!initialRowsScanned) {
              initialRowsScanned = true;
              for (const event of pendingMaterialDeltas.splice(0)) {
                if (
                  event.streamRevision !== undefined &&
                  event.streamRevision <= lastMaterialRevision
                ) {
                  continue;
                }
                lastMaterialRevision =
                  event.streamRevision ?? lastMaterialRevision;
                enqueue(event);
              }
            }

            const run = await getGenerationRun(runId);
            if (!run) {
              enqueue({
                type: "error",
                message: tBackend("error.generation.notFound"),
              });
              return;
            }
            if (await failGenerationRunIfStale(run)) {
              continue;
            }
            if (run.status !== "running") {
              if (run.status === "completed") {
                const result = JSON.parse(run.resultJson || "{}") as Record<
                  string,
                  unknown
                >;
                enqueue({ type: "done", ...result });
              } else {
                enqueue({
                  type: run.status === "cancelled" ? "cancelled" : "error",
                  // `errorMessage` is retained on the run for operators. It may
                  // contain provider, schema-validation, or repair diagnostics
                  // and must never cross the learner-facing SSE boundary.
                  message: learnerFacingGenerationRunError(run),
                });
              }
              return;
            }
            if (keepAliveDue && !closed) {
              keepAliveDue = false;
              controller.enqueue(encoder.encode(": keepalive\n\n"));
            }
            if (signalled) continue;
            await new Promise<void>((resolve) => {
              const timer = setTimeout(resolve, FALLBACK_POLL_MS);
              wake = () => {
                clearTimeout(timer);
                resolve();
              };
            });
            wake = null;
          }
        } catch (e) {
          if (!closed) {
            const formatted = formatApiException(e);
            enqueue({
              type: "error",
              // Subscription/read failures are operational diagnostics too;
              // keep the formatted detail in logs instead of exposing it.
              message: tBackend("error.generation.failedFriendly"),
              ...(formatted.code ? { code: formatted.code } : {}),
            });
          }
        } finally {
          clearInterval(keepAlive);
          unsubscribe?.();
          unsubscribe = null;
          if (!closed) {
            closed = true;
            controller.close();
          }
        }
      })();
    },
    cancel() {
      closed = true;
      wake?.();
      unsubscribe?.();
      unsubscribe = null;
    },
  });
}

type TraceMeta = {
  scope: GenerationScope;
  scopeId: string;
  operation: string;
  goalId?: string;
};

async function executeTrackedWork(
  runId: string,
  traceMeta: TraceMeta,
  work: (ctx: TrackedWorkContext) => Promise<void>,
) {
  const signal = registerRunAbort(runId);
  const stopHeartbeat = heartbeatGenerationRun(runId);

  const send = async (event: SseEvent) => {
    if (event.type === "done") {
      await completeGenerationRun(runId, event);
      return;
    }
    if (event.type === "error") {
      await failGenerationRun(runId, event.message, event.code);
      return;
    }
    if (event.type === "cancelled") {
      await cancelGenerationRun(runId);
      return;
    }
    await appendRunEvent(runId, event);
  };

  try {
    const goalId =
      traceMeta.goalId ??
      (traceMeta.scope === "goal" ? traceMeta.scopeId : undefined);
    const presentationCapabilities = await readGenerationRunPresentationCapabilities(runId);
    await runWithLlmTraceAsync(
      {
        traceId: runId,
        meta: {
          scope: traceMeta.scope,
          scopeId: traceMeta.scopeId,
          operation: traceMeta.operation,
          ...(goalId ? { goalId } : {}),
        },
      },
      async () => runWithPresentationCapabilities(presentationCapabilities, () => work({ send, signal, runId })),
    );

    const run = await getGenerationRun(runId);
    if (run?.status === "running") {
      const message = tBackend("error.generation.failed");
      await failGenerationRun(runId, message);
    }
  } catch (e) {
    if (isGenerationCancelled(e)) {
      await cancelGenerationRun(runId);
      return;
    }
    const formatted = formatApiException(e);
    await failGenerationRun(runId, formatted.message, formatted.code);
  } finally {
    await stopHeartbeat();
    unregisterRunAbort(runId);
  }
}

export async function handleTrackedStreamPost(
  body: { runId?: string },
  meta: TraceMeta,
  work: (ctx: TrackedWorkContext) => Promise<void>,
): Promise<Response> {
  const locale = getCurrentLocale();
  if (body.runId) {
    const existing = await getGenerationRun(body.runId);
    if (
      existing?.status === "running" &&
      !(await failGenerationRunIfStale(existing))
    ) {
      return sseResponse(createRunSubscribeStream(existing.id, 0, locale));
    }
  }

  await cancelActiveRuns(meta.scope, meta.scopeId, meta.operation);
  const runId = await createGenerationRun(meta);

  void executeTrackedWork(runId, meta, async (ctx) =>
    runWithBackendLocale(locale, async () => {
      await work(ctx);
      const run = await getGenerationRun(runId);
      if (run?.status !== "running") return;

      const events = parseRunEvents(run.eventsJson);
      const last = events.at(-1);
      if (last?.type === "done") {
        await completeGenerationRun(runId, last);
        return;
      }
      if (last?.type === "cancelled" || last?.type === "error") return;

      await failGenerationRun(runId, "生成未正常结束");
    }),
  );

  return sseResponse(createRunSubscribeStream(runId, 0, locale));
}
