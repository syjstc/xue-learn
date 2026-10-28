"use client";

import { useCallback, useRef, useState } from "react";
import { GenerationCancelledError, isGenerationCancelled } from "@/shared/generation/errors";
import { apiGet, apiPost } from "@/shared/api";
import { consumeSseGet, consumeSsePost } from "@/shared/client/consume-sse";
import type { SseEvent } from "@/shared/llm/sse";

export type ActiveGenerationRun = {
  id: string;
  operation: string;
  statusMessage: string;
  tokenPreview: string;
  /** Latest persisted partial snapshot for JIT UI restore after refresh. */
  partialEvent?: SseEvent | null;
};

type UseAiGenerationOptions = {
  scope: "goal" | "unit";
  scopeId: string;
  onRestore?: (run: ActiveGenerationRun) => void;
};

type RunSlot = {
  runId: string | null;
  loading: boolean;
};

export const DEFAULT_GENERATION_OPERATION = "__default__";

type GenerationEventHandler = (
  event: SseEvent,
  operation?: string
) => void;

export function useAiGeneration({
  scope,
  scopeId,
  onRestore,
}: UseAiGenerationOptions) {
  const [runs, setRuns] = useState<Record<string, RunSlot>>({});
  const abortRefs = useRef<Record<string, AbortController>>({});
  const reconnectingRef = useRef(false);
  // Keep latest onRestore without putting it in reconnectActive deps — callers often pass inline lambdas.
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;

  const patchRun = useCallback(
    (operation: string, patch: Partial<RunSlot>) => {
      setRuns((prev) => ({
        ...prev,
        [operation]: {
          ...(prev[operation] ?? { runId: null, loading: false }),
          ...patch,
        },
      }));
    },
    []
  );

  const isLoading = useCallback(
    (operation?: string) => {
      if (operation) return runs[operation]?.loading ?? false;
      return Object.values(runs).some((slot) => slot.loading);
    },
    [runs]
  );

  const loading = isLoading();

  const getRunId = useCallback(
    (operation: string = DEFAULT_GENERATION_OPERATION) =>
      runs[operation]?.runId ?? null,
    [runs]
  );

  const runId = getRunId();

  const canStop = useCallback(
    (operation?: string) => {
      if (operation) {
        const slot = runs[operation];
        return Boolean(slot?.loading && slot?.runId);
      }
      return Object.values(runs).some((slot) => slot.loading && slot.runId);
    },
    [runs]
  );

  const detach = useCallback((operation?: string) => {
    const targets = operation
      ? [operation]
      : Object.entries(runs)
          .filter(([, slot]) => slot?.loading)
          .map(([op]) => op);

    for (const op of targets) {
      abortRefs.current[op]?.abort();
      delete abortRefs.current[op];
      patchRun(op, { loading: false });
    }
  }, [patchRun, runs]);

  const stop = useCallback(
    async (operation?: string) => {
      const targets = operation
        ? [[operation, runs[operation]] as const]
        : (Object.entries(runs) as [string, RunSlot | undefined][]).filter(
            ([, slot]) => slot?.loading
          );

      for (const [op, slot] of targets) {
        abortRefs.current[op]?.abort();
        delete abortRefs.current[op];
        patchRun(op, { loading: false, runId: null });
        if (slot?.runId) {
          await apiPost(`/api/generation-runs/${slot.runId}/cancel`);
        }
      }
    },
    [patchRun, runs]
  );

  const followRun = useCallback(
    async (
      id: string,
      onEvent: GenerationEventHandler,
      operation: string = DEFAULT_GENERATION_OPERATION
    ): Promise<SseEvent | null> => {
      patchRun(operation, { loading: true, runId: id });
      const ac = new AbortController();
      abortRefs.current[operation] = ac;
      let lastEventId = 0;
      try {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            const suffix = lastEventId > 0 ? `?after=${lastEventId}` : "";
            return await consumeSseGet(
              `/api/generation-runs/${id}/stream${suffix}`,
              (event, eventId) => {
                if (eventId !== undefined) lastEventId = eventId;
                if (event.type === "run") {
                  patchRun(operation, { runId: event.runId });
                }
                onEvent(event, operation);
              },
              ac.signal
            );
          } catch (error) {
            if (ac.signal.aborted || attempt === 2) throw error;
            await new Promise((resolve) =>
              setTimeout(resolve, 500 * (attempt + 1))
            );
          }
        }
        return null;
      } catch (e) {
        if (isGenerationCancelled(e) || e instanceof GenerationCancelledError) {
          return null;
        }
        throw e;
      } finally {
        patchRun(operation, { loading: false, runId: null });
        delete abortRefs.current[operation];
      }
    },
    [patchRun]
  );

  const startPost = useCallback(
    async (
      url: string,
      body: Record<string, unknown>,
      onEvent: GenerationEventHandler,
      operation: string = DEFAULT_GENERATION_OPERATION
    ): Promise<SseEvent | null> => {
      patchRun(operation, { loading: true, runId: null });
      const ac = new AbortController();
      abortRefs.current[operation] = ac;
      try {
        return await consumeSsePost(
          url,
          body,
          (event) => {
            if (event.type === "run") {
              patchRun(operation, { runId: event.runId });
            }
            onEvent(event, operation);
          },
          ac.signal
        );
      } catch (e) {
        if (isGenerationCancelled(e) || e instanceof GenerationCancelledError) {
          return null;
        }
        throw e;
      } finally {
        patchRun(operation, { loading: false, runId: null });
        delete abortRefs.current[operation];
      }
    },
    [patchRun]
  );

  const reconnectActive = useCallback(
    async (
      onEvent: GenerationEventHandler,
      filterOperation?: (operation: string) => boolean
    ): Promise<(SseEvent | null)[]> => {
      if (reconnectingRef.current) return [];
      reconnectingRef.current = true;
      try {
        const data = await apiGet<{ runs?: ActiveGenerationRun[] }>(
          `/api/generation-runs/active?scope=${scope}&scopeId=${encodeURIComponent(scopeId)}`
        );
        const activeRuns =
          data.runs?.filter((run) =>
            filterOperation ? filterOperation(run.operation) : true
          ) ?? [];
        if (activeRuns.length === 0) return [];

        for (const run of activeRuns) {
          onRestoreRef.current?.(run);
        }

        return Promise.all(
          activeRuns.map((run) =>
            followRun(
              run.id,
              (event, operation) => onEvent(event, operation ?? run.operation),
              run.operation
            )
          )
        );
      } finally {
        reconnectingRef.current = false;
      }
    },
    [scope, scopeId, followRun]
  );

  return {
    loading,
    isLoading,
    runId,
    getRunId,
    canStop,
    startPost,
    followRun,
    reconnectActive,
    detach,
    stop,
  };
}
