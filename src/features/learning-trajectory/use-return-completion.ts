import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/shared/api";
import type { LearningVisit } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { useRefreshLearningTrajectory } from "./use-learning-trajectory.ts";
/** Replay only user-authored return actions, resolving stale position-save revisions. */
export function useReturnCompletion(unitId: string) {
  const refresh = useRefreshLearningTrajectory();
  const [adjusted, setAdjusted] = useState(false);
  const [bridge, setBridge] = useState<{
    title: string;
    returnGoal: string;
  } | null>(() => {
    try {
      return JSON.parse(
        sessionStorage.getItem(`xuelearn.learning-bridge:${unitId}`) ?? "null",
      );
    } catch {
      return null;
    }
  });
  useEffect(() => {
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const adjust = () => setAdjusted(true);
    window.addEventListener("learning-return-adjusted", adjust);
    const replay = async () => {
      let pending = false;
      for (const key of Object.keys(sessionStorage).filter((k) =>
        k.startsWith("xuelearn.learning-return-pending:"),
      )) {
        try {
          const id = key.slice("xuelearn.learning-return-pending:".length),
            action = JSON.parse(sessionStorage.getItem(key) ?? "null");
          if (!action || !["pause", "return"].includes(action.action)) continue;
          const current = await apiGet<LearningVisit>(
            `/api/learning-trajectory/visits/${id}`,
          );
          if (current.unitId !== unitId) continue;
          if (
            current.state !== "returned" &&
            current.state !==
              (action.action === "pause" ? "paused" : "returned")
          )
            await apiPost(`/api/learning-trajectory/visits/${id}/actions`, {
              ...action,
              revision: current.revision,
            });
          sessionStorage.removeItem(key);
          await refresh();
        } catch {
          pending = true;
          /* Offline leaves an explicit replayable action for the next page open. */
        }
      }
      if (pending && !stopped) retry = setTimeout(() => void replay(), 3000);
    };
    void replay();
    window.addEventListener("online", replay);
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      window.removeEventListener("learning-return-adjusted", adjust);
      window.removeEventListener("online", replay);
    };
  }, [unitId]);
  return {
    adjusted,
    bridge,
    dismissBridge: () => {
      sessionStorage.removeItem(`xuelearn.learning-bridge:${unitId}`);
      setBridge(null);
    },
  };
}
