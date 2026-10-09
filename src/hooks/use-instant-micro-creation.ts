"use client";

import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  markUnitInstantMicro,
  parseInstantMicroShellReady,
  streamInstantMicroCreation,
} from "@/shared/goals/instant-micro-creation";
import type { SseEvent } from "@/shared/llm/sse";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";

export function useInstantMicroCreation() {
  const t = useT();
  const navigate = useNavigate();
  const abortRef = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const start = useCallback(
    async (input: { topic?: string; files?: File[] }) => {
      cancel();
      setLoading(true);
      setError("");
      setStatus(t("assistant.workspace.startingMicro"));

      const ac = new AbortController();
      abortRef.current = ac;
      let navigated = false;
      let backgroundRunId: string | undefined;

      try {
        let settled = false;
        await new Promise<void>((resolve, reject) => {
          void streamInstantMicroCreation(
            input,
            (event: SseEvent) => {
              if (event.type === "run" && event.runId) {
                backgroundRunId = event.runId;
              }
              if (event.type === "status" && event.message) {
                setStatus(event.message);
              }
              const shell = parseInstantMicroShellReady(event);
              if (shell && !navigated) {
                navigated = true;
                const isOverview = shell.navigateTo.includes("/overview");
                if (!isOverview) {
                  markUnitInstantMicro(shell.unitId);
                }
                // Hand off to the unit page subscriber; abort local POST read only.
                ac.abort();
                navigate(shell.navigateTo, {
                  state: {
                    instantMicro: !isOverview,
                    runId: shell.runId ?? backgroundRunId,
                  },
                });
                setLoading(false);
                setStatus("");
                if (!settled) {
                  settled = true;
                  resolve();
                }
              }
            },
            ac.signal,
          )
            .then(() => {
              if (!settled) {
                settled = true;
                resolve();
              }
            })
            .catch(reject);
        });
      } catch (e) {
        if (!ac.signal.aborted) {
          setStatus("");
          setError(e instanceof Error ? e.message : "创建失败");
        }
        throw e;
      } finally {
        if (abortRef.current === ac) {
          abortRef.current = null;
        }
        setLoading(false);
        if (navigated) {
          setStatus("");
        }
      }
    },
    [cancel, navigate, t],
  );

  return { start, cancel, loading, status, error };
}
