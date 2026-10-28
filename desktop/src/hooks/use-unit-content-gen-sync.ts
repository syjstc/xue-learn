import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  patchGoalUnitContentGen,
  queryKeys,
  type GoalDetail,
} from "@/shared/api";
import type { UnitContentGenStatus } from "@/shared/domain/unit-content-status";
import { deriveUnitContentGenStatus } from "@/shared/domain/unit-content-status";
import type { SseEvent } from "@/shared/llm/sse";

export type UnitContentGenEvent = {
  type: "unit_content_gen";
  unitId: string;
  hasSurvey?: boolean;
  hasMaterial?: boolean;
};

export function mergeContentGenPatch(
  base: UnitContentGenStatus | undefined,
  patch: Omit<UnitContentGenEvent, "type" | "unitId">,
): UnitContentGenStatus {
  const prev = base ?? { hasSurvey: false, hasMaterial: false };
  return {
    hasSurvey: patch.hasSurvey ?? prev.hasSurvey,
    hasMaterial: patch.hasMaterial ?? prev.hasMaterial,
  };
}

export function isUnitContentGenEvent(
  event: SseEvent,
): event is UnitContentGenEvent {
  return event.type === "unit_content_gen";
}

export function useUnitContentGenSync(goalId: string) {
  const queryClient = useQueryClient();

  const syncFromEvent = useCallback(
    (event: SseEvent): UnitContentGenEvent | null => {
      if (!isUnitContentGenEvent(event)) return null;
      const { unitId, type: _, ...patch } = event;
      const goal = queryClient.getQueryData<GoalDetail>(
        queryKeys.goals.detail(goalId),
      );
      const unit = goal?.units.find((row) => row.id === unitId);
      const base =
        unit?.contentGen ??
        (unit ? (deriveUnitContentGenStatus(unit) ?? undefined) : undefined);
      patchGoalUnitContentGen(
        queryClient,
        goalId,
        unitId,
        mergeContentGenPatch(base, patch),
      );
      return event;
    },
    [goalId, queryClient],
  );

  return { syncFromEvent };
}
