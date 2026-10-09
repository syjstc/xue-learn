import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  getCurrentLocale,
  localizeBackendPayload,
  runWithBackendLocale,
  safeJsonStringify,
  stripLoneSurrogates,
  tBackend,
  type BackendLocale,
} from "../../../../common/src/index.js";
import { getCurrentUserId } from "../../user-context.js";
import { recordBackendError } from "../../observability/index.js";
import {
  encodeSseEvent,
  GenerationScope,
  SseEvent,
} from "../../../../contracts/src/index.js";
import { GenerationEventTransport } from "./event-transport.js";
import {
  GenerationCancelledError,
  isGenerationCancelled,
} from "./generation.errors.js";
import {
  generationRunLeaseCutoff,
  isGenerationRunLeaseStale,
  startGenerationRunHeartbeat,
} from "../../generation/run-lease.js";
import { requireGenerationRunPersistence } from "../../generation/run-persistence.js";

const TOKEN_FLUSH_MS = 300;
const FALLBACK_POLL_MS = 5_000;
const KEEP_ALIVE_MS = 15_000;
const SNAPSHOT_EVENT_TYPES = new Set<SseEvent['type']>([
  'map_partial',
  'material_partial',
  'cornell_partial',
  'sq_partial',
  'quiz_partial',
  'micro_unit_partial',
  'derivation_partial',
  'teaching_derivation_partial',
]);

type TokenBuffer = {
  delta: string;
  timer: ReturnType<typeof setTimeout> | null;
  flushPromise: Promise<void> | null;
};

export type TrackedWorkContext = {
  send: (event: SseEvent) => Promise<void>;
  signal: AbortSignal;
  runId: string;
};

type TraceMeta = {
  scope: GenerationScope;
  scopeId: string;
  operation: string;
  goalId?: string;
};

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function isTerminalEvent(event: SseEvent): boolean {
  return (
    event.type === 'error' ||
    event.type === 'cancelled' ||
    event.type === 'done'
  );
}

function encodeLocalizedSseEvent(
  event: SseEvent,
  id?: number,
  locale: BackendLocale = getCurrentLocale(),
): string {
  return runWithBackendLocale(locale, () =>
    encodeSseEvent(localizeBackendPayload(event), id),
  );
}

@Injectable()
export class GenerationService {
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly tokenBuffers = new Map<string, TokenBuffer>();

  constructor(
    private readonly events: GenerationEventTransport,
  ) {}

  registerRunAbort(runId: string): AbortSignal {
    const existing = this.abortControllers.get(runId);
    if (existing) existing.abort();

    const controller = new AbortController();
    this.abortControllers.set(runId, controller);
    return controller.signal;
  }

  unregisterRunAbort(runId: string): void {
    this.abortControllers.delete(runId);
    const buf = this.tokenBuffers.get(runId);
    if (buf?.timer) clearTimeout(buf.timer);
    this.tokenBuffers.delete(runId);
  }

  abortRunLocally(runId: string): void {
    this.abortControllers.get(runId)?.abort();
  }

  async createGenerationRun(params: {
    scope: GenerationScope;
    scopeId: string;
    operation: string;
    userId?: string;
  }): Promise<string> {
    const id = randomUUID();
    await requireGenerationRunPersistence().create({
      id,
      userId: params.userId ?? getCurrentUserId() ?? null,
      scope: params.scope,
      scopeId: params.scopeId,
      operation: params.operation,
      now: new Date(),
    });
    return id;
  }

  async cancelActiveRuns(
    scope: GenerationScope,
    scopeId: string,
    operation: string,
  ): Promise<void> {
    const active = await requireGenerationRunPersistence().listRunning({
      scope,
      scopeId,
      operation,
    });
    for (const run of active) {
      await this.cancelGenerationRun(run.id);
    }
  }

  async cancelGenerationRun(runId: string): Promise<void> {
    this.abortRunLocally(runId);
    await this.flushRunTokenBuffer(runId);
    await this.transitionRun(runId, {
      type: 'cancelled',
      message: tBackend('status.generation.cancelled'),
    });
  }

  async assertRunActive(runId: string, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new GenerationCancelledError();

    const run = await requireGenerationRunPersistence().find(runId);
    if (!run) throw new Error(tBackend('error.generation.notFound'));
    if (run.status === 'cancelled') {
      this.abortRunLocally(runId);
      throw new GenerationCancelledError();
    }
    if (run.status !== 'running') {
      throw new Error(tBackend('error.generation.ended'));
    }
  }

  parseRunEvents(eventsJson: string): SseEvent[] {
    return parseJson<SseEvent[]>(eventsJson, []);
  }

  private sanitizeRunEvent(event: SseEvent): SseEvent {
    switch (event.type) {
      case 'token':
        return { ...event, delta: stripLoneSurrogates(event.delta) };
      case 'status':
      case 'progress':
        return event.message
          ? { ...event, message: stripLoneSurrogates(event.message) }
          : event;
      case 'cancelled':
      case 'error':
        return { ...event, message: stripLoneSurrogates(event.message) };
      default:
        return event;
    }
  }

  private logRunPersistError(runId: string, err: unknown) {
    console.error(
      `[generation] failed to persist run ${runId}:`,
      err instanceof Error ? err.message : err,
    );
    void recordBackendError(
      {
        source: 'internal',
        service: 'generation-service',
        error: err,
        operation: 'persist-generation-run',
      },
    );
  }

  private async persistRunEvent(runId: string, event: SseEvent): Promise<void> {
    if (event.type === 'run') return;

    try {
      const stored = await this.persistEventRow(runId, event);
      if (!stored) return;
      await this.events.publish(runId, stored.event, stored.sequence);
    } catch (err) {
      this.logRunPersistError(runId, err);
    }
  }

  async flushRunTokenBuffer(runId: string): Promise<void> {
    const buf = this.tokenBuffers.get(runId);
    if (!buf) return;

    if (buf.flushPromise) {
      await buf.flushPromise;
      if (buf.delta) await this.flushRunTokenBuffer(runId);
      return;
    }

    if (buf.timer) {
      clearTimeout(buf.timer);
      buf.timer = null;
    }

    const delta = buf.delta;
    if (!delta) return;
    buf.delta = '';

    const event: SseEvent = { type: 'token', delta };
    const work = (async () => {
      await this.persistRunEvent(runId, event);
      await this.events.publish(runId, event);
    })();

    buf.flushPromise = work;
    try {
      await work;
    } finally {
      if (buf.flushPromise === work) buf.flushPromise = null;
    }
    if (buf.delta) await this.flushRunTokenBuffer(runId);
  }

  private scheduleTokenFlush(runId: string): void {
    const buf = this.tokenBuffers.get(runId);
    if (!buf || buf.timer) return;
    buf.timer = setTimeout(() => {
      const current = this.tokenBuffers.get(runId);
      if (current) current.timer = null;
      void this.flushRunTokenBuffer(runId);
    }, TOKEN_FLUSH_MS);
  }

  async appendRunEvent(runId: string, event: SseEvent): Promise<void> {
    if (event.type === 'run') return;
    if (event.type === 'done') {
      await this.completeGenerationRun(runId, event);
      return;
    }
    if (event.type === 'error') {
      await this.failGenerationRun(runId, event.message);
      return;
    }
    if (event.type === 'cancelled') {
      this.abortRunLocally(runId);
      await this.flushRunTokenBuffer(runId);
      await this.transitionRun(runId, event);
      return;
    }

    if (event.type === 'token') {
      let buf = this.tokenBuffers.get(runId);
      if (!buf) {
        buf = { delta: '', timer: null, flushPromise: null };
        this.tokenBuffers.set(runId, buf);
      }
      buf.delta += event.delta;
      this.scheduleTokenFlush(runId);
      return;
    }

    await this.flushRunTokenBuffer(runId);
    await this.persistRunEvent(runId, event);
    await this.events.publish(runId, event);
  }

  async completeGenerationRun(
    runId: string,
    doneEvent: Extract<SseEvent, { type: 'done' }>,
  ): Promise<void> {
    await this.flushRunTokenBuffer(runId);
    await this.transitionRun(runId, doneEvent);
  }

  async failGenerationRun(runId: string, message: string): Promise<void> {
    await this.flushRunTokenBuffer(runId);
    await this.transitionRun(runId, { type: 'error', message });
  }

  private heartbeatGenerationRun(runId: string): () => Promise<void> {
    return startGenerationRunHeartbeat(() =>
      requireGenerationRunPersistence().touchRunning(runId, new Date()),
    );
  }

  private async failGenerationRunIfStale(run: {
    id: string;
    status: string;
    updatedAt: Date;
  }): Promise<boolean> {
    if (run.status !== 'running' || !isGenerationRunLeaseStale(run.updatedAt)) {
      return false;
    }

    const message = tBackend('error.generation.interrupted');
    const transitioned = await this.transitionRun(
      run.id,
      {
        type: 'error',
        message,
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

  async getGenerationRun(runId: string) {
    return requireGenerationRunPersistence().find(runId);
  }

  async assertRunOwnedBy(runId: string, userId: string): Promise<void> {
    const run = await requireGenerationRunPersistence().find(runId);
    if (!run || run.userId !== userId) {
      throw new NotFoundException(tBackend('error.generation.notFound'));
    }
  }

  async listActiveRuns(
    userId: string,
    scope: GenerationScope,
    scopeId: string,
  ) {
    const running = await requireGenerationRunPersistence().listRunning({
      userId,
      scope,
      scopeId,
    });
    const stale = running.filter(
      (run) => run.updatedAt < generationRunLeaseCutoff(),
    );
    for (const run of stale) {
      await this.failGenerationRunIfStale(run);
    }

    const active = await requireGenerationRunPersistence().listRunning({
      userId,
      scope,
      scopeId,
    });
    return Promise.all(
      active.map(async (run) => {
        const events = await requireGenerationRunPersistence().listEventsAfter(
          run.id,
          0,
        );
        const latest = [...events]
          .reverse()
          .find((event) => event.snapshotKey != null);
        return { ...run, events: latest ? [latest] : [] };
      }),
    );
  }

  async executeTrackedWork(
    runId: string,
    work: (ctx: TrackedWorkContext) => Promise<void>,
  ): Promise<void> {
    const signal = this.registerRunAbort(runId);
    const stopHeartbeat = this.heartbeatGenerationRun(runId);

    const send = async (event: SseEvent) => {
      if (event.type === 'done') {
        await this.completeGenerationRun(runId, event);
        return;
      }
      if (event.type === 'error') {
        await this.failGenerationRun(runId, event.message);
        return;
      }
      if (event.type === 'cancelled') {
        await this.cancelGenerationRun(runId);
        return;
      }
      await this.appendRunEvent(runId, event);
    };

    try {
      await work({ send, signal, runId });

      const run = await this.getGenerationRun(runId);
      if (run?.status === 'running') {
        const message = tBackend('error.generation.failed');
        await this.failGenerationRun(runId, message);
      }
    } catch (e) {
      if (isGenerationCancelled(e)) {
        await this.cancelGenerationRun(runId);
        return;
      }
      const message = tBackend('error.generation.failed');
      await this.failGenerationRun(runId, message);
    } finally {
      await stopHeartbeat();
      this.unregisterRunAbort(runId);
    }
  }

  async startTrackedRun(
    meta: TraceMeta,
    work: (ctx: TrackedWorkContext) => Promise<void>,
    existingRunId?: string,
  ): Promise<string> {
    if (existingRunId) {
      const existing = await this.getGenerationRun(existingRunId);
      if (
        existing?.status === 'running' &&
        !(await this.failGenerationRunIfStale(existing))
      ) {
        return existing.id;
      }
    }

    await this.cancelActiveRuns(meta.scope, meta.scopeId, meta.operation);
    const runId = await this.createGenerationRun(meta);

    void this.executeTrackedWork(runId, async (ctx) => {
      await work(ctx);
      const run = await this.getGenerationRun(runId);
      if (run?.status !== 'running') return;

      const events = this.parseRunEvents(run.eventsJson);
      const last = events.at(-1);
      if (last?.type === 'done') {
        await this.completeGenerationRun(runId, last);
        return;
      }
      if (last?.type === 'cancelled' || last?.type === 'error') return;

      await this.failGenerationRun(runId, '生成未正常结束');
    });

    return runId;
  }

  private async persistEventRow(
    runId: string,
    rawEvent: SseEvent,
  ): Promise<{ sequence: number; event: SseEvent } | null> {
    const event = this.sanitizeRunEvent(rawEvent);
    const stored = await requireGenerationRunPersistence().appendEvent({
      runId,
      type: event.type,
      payload: safeJsonStringify(event),
      snapshotKey: SNAPSHOT_EVENT_TYPES.has(event.type)
        ? event.type
        : undefined,
      tokenDelta: event.type === 'token' ? event.delta : undefined,
      statusMessage:
        (event.type === 'status' || event.type === 'progress') && event.message
          ? event.message
          : undefined,
      now: new Date(),
    });
    return stored ? { sequence: stored.sequence, event } : null;
  }

  private async transitionRun(
    runId: string,
    rawEvent: Extract<SseEvent, { type: 'done' | 'error' | 'cancelled' }>,
    options?: { staleBefore?: Date },
  ): Promise<boolean> {
    const event = this.sanitizeRunEvent(rawEvent);
    try {
      const stored = await requireGenerationRunPersistence().transition({
        runId,
        status:
          event.type === 'done'
            ? 'completed'
            : event.type === 'cancelled'
              ? 'cancelled'
              : 'error',
        type: event.type,
        payload: safeJsonStringify(event),
        statusMessage: event.type === 'done' ? '' : undefined,
        errorMessage:
          event.type === 'error' || event.type === 'cancelled'
            ? event.message
            : undefined,
        resultJson:
          event.type === 'done'
            ? safeJsonStringify(
                Object.fromEntries(
                  Object.entries(event).filter(([key]) => key !== 'type'),
                ),
              )
            : undefined,
        staleBefore: options?.staleBefore,
        now: new Date(),
      });
      if (!stored) return false;
      await this.events.publish(runId, event, stored.sequence);
      return true;
    } catch (err) {
      this.logRunPersistError(runId, err);
      return false;
    }
  }

  async *streamRunEvents(
    runId: string,
    after = 0,
  ): AsyncGenerator<string> {
    const locale = getCurrentLocale();
    let initial = await this.getGenerationRun(runId);
    if (!initial) {
      yield encodeLocalizedSseEvent({
        type: 'error',
        message: tBackend('error.generation.notFound'),
      }, undefined, locale);
      return;
    }
    if (await this.failGenerationRunIfStale(initial)) {
      initial = await this.getGenerationRun(runId);
      if (!initial) return;
    }

    yield encodeLocalizedSseEvent({ type: 'run', runId }, undefined, locale);

    let cursor = after;
    let wake: (() => void) | null = null;
    let redisSignal = false;
    let keepAliveDue = false;
    let initialRowsScanned = false;
    let lastMaterialRevision = 0;
    const pendingMaterialDeltas: Array<
      Extract<SseEvent, { type: 'material_delta' }>
    > = [];
    const notify = (published: { event: SseEvent; sequence?: number }) => {
      if (
        published.sequence === undefined &&
        published.event.type === 'material_delta'
      ) {
        pendingMaterialDeltas.push(published.event);
      }
      redisSignal = true;
      wake?.();
    };
    const unsubscribe = await this.events.subscribe(runId, notify);
    const keepAlive = setInterval(() => {
      keepAliveDue = true;
      wake?.();
    }, KEEP_ALIVE_MS);

    try {
      // Compatibility for runs created before AiGenerationRunEvent existed.
      if (after === 0 && initial.eventsJson !== '[]') {
        for (const event of this.parseRunEvents(initial.eventsJson)) {
          yield encodeLocalizedSseEvent(event, undefined, locale);
          if (isTerminalEvent(event)) return;
        }
      }

      while (true) {
        if (initialRowsScanned) {
          for (const event of pendingMaterialDeltas.splice(0)) {
            if (
              event.streamRevision !== undefined &&
              event.streamRevision <= lastMaterialRevision
            ) {
              continue;
            }
            lastMaterialRevision = event.streamRevision ?? lastMaterialRevision;
            yield encodeLocalizedSseEvent(event, undefined, locale);
          }
        }
        const rows = await requireGenerationRunPersistence().listEventsAfter(
          runId,
          cursor,
        );
        for (const row of rows) {
          const event = parseJson<SseEvent | null>(row.payload, null);
          cursor = Math.max(cursor, row.sequence);
          if (!event) continue;
          if (row.snapshotKey === 'material_delta_recovery') {
            const revision =
              event.type === 'material_partial'
                ? event.streamRevision
                : undefined;
            if (revision !== undefined && revision <= lastMaterialRevision) {
              continue;
            }
            lastMaterialRevision = revision ?? lastMaterialRevision;
          }
          yield encodeLocalizedSseEvent(event, row.sequence, locale);
          if (isTerminalEvent(event)) return;
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
            lastMaterialRevision = event.streamRevision ?? lastMaterialRevision;
            yield encodeLocalizedSseEvent(event, undefined, locale);
          }
        }

        const current = await this.getGenerationRun(runId);
        if (!current) {
          yield encodeLocalizedSseEvent({
            type: 'error',
            message: tBackend('error.generation.notFound'),
          }, undefined, locale);
          return;
        }
        if (await this.failGenerationRunIfStale(current)) {
          continue;
        }
        if (current.status !== 'running') {
          // Old/partially migrated runs may have terminal state without a row.
          if (current.status === 'completed') {
            const result = parseJson<Record<string, unknown>>(
              current.resultJson,
              {},
            );
            yield encodeLocalizedSseEvent({ type: 'done', ...result }, undefined, locale);
          } else {
            yield encodeLocalizedSseEvent({
              type: current.status === 'cancelled' ? 'cancelled' : 'error',
              message:
                current.errorMessage ??
                (current.status === 'cancelled'
                  ? tBackend('status.generation.cancelled')
                  : tBackend('error.generation.failed')),
            }, undefined, locale);
          }
          return;
        }

        if (keepAliveDue) {
          keepAliveDue = false;
          yield ': keepalive\n\n';
        }

        if (redisSignal) {
          redisSignal = false;
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
          const timer = setTimeout(resolve, FALLBACK_POLL_MS);
          const originalWake = wake;
          wake = () => {
            clearTimeout(timer);
            originalWake();
          };
        });
        wake = null;
      }
    } catch (e) {
      yield encodeLocalizedSseEvent({
        type: 'error',
        message: tBackend('error.generation.failed'),
      }, undefined, locale);
    } finally {
      clearInterval(keepAlive);
      await unsubscribe();
    }
  }

  async assertRunExists(runId: string): Promise<void> {
    const run = await this.getGenerationRun(runId);
    if (!run) {
      throw new NotFoundException(tBackend('error.generation.notFound'));
    }
  }
}
