import { useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost, patchGoalActivityTouch } from "@/shared/api";

export type TouchUnitActivityInput = {
  tab?: string;
  slideIndex?: number;
  hasCompletedSlides?: boolean;
  sectionSteps?: Record<number, number>;
  activeSeconds?: number;
  sectionId?: string;
  sectionContentRevision?: number;
  sectionCursor?: number;
  timeFlush?: boolean;
};

export function useTouchUnitActivity(unitId: string, goalId: string) {
  const queryClient = useQueryClient();
  const lastPayloadRef = useRef<string>("");

  const flush = useCallback(
    async (input: TouchUnitActivityInput) => {
      const { activeSeconds, timeFlush, ...rest } = input;
      const payloadKey = JSON.stringify({
        ...rest,
        activeSeconds,
        timeFlush,
      });
      if (payloadKey === lastPayloadRef.current) return;
      lastPayloadRef.current = payloadKey;

      try {
        const result = await apiPost<{
          totalActiveSeconds: number;
          acceptedActiveSeconds: number;
        }>(`/api/units/${unitId}/session`, {
          action: "touch_activity",
          payload: input,
        });
        patchGoalActivityTouch(queryClient, goalId, unitId, {
          activeSeconds: result.acceptedActiveSeconds,
          tab: input.tab,
        });
      } catch {
        lastPayloadRef.current = "";
      }
    },
    [goalId, queryClient, unitId],
  );

  const touch = useCallback(
    (input: TouchUnitActivityInput) => {
      void flush(input);
    },
    [flush],
  );

  return { touch };
}
