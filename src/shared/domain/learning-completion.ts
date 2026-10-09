import { isUnitLearningDone } from "./unit-status.ts";
import type { UnitStatus } from "./types.ts";

/** Whether a session action response means the unit is learning-complete. */
export function sessionPatchMarksLearningDone(
  data: Record<string, unknown> | null | undefined,
): boolean {
  if (!data) return false;
  if (data.isLearningDone === true) return true;
  if (data.nextStep === "complete") return true;
  return (
    typeof data.unitStatus === "string" && isUnitLearningDone(data.unitStatus)
  );
}

export function sessionPatchUnitStatus(
  data: Record<string, unknown> | null | undefined,
): UnitStatus | undefined {
  if (!data || typeof data.unitStatus !== "string") return undefined;
  return data.unitStatus as UnitStatus;
}
