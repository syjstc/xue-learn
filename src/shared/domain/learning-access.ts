export type LearningAccess = {
  modelPhase:
    | "pending"
    | "building"
    | "targets_ready"
    | "ready"
    | "failed"
    | "stale";
  contentMode: "none" | "draft" | "canonical";
  assessmentMode: "locked" | "ready";
  lockReason?: "model_building" | "model_failed" | "model_stale";
  activeRunId?: string;
  inputHash?: string;
  prefixHash?: string;
};

/** Missing access data means a legacy server, where assessment remains available. */
export function parseLearningAccess(value: unknown): LearningAccess | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    ![
      "pending",
      "building",
      "targets_ready",
      "ready",
      "failed",
      "stale",
    ].includes(String(candidate.modelPhase)) ||
    !["none", "draft", "canonical"].includes(String(candidate.contentMode)) ||
    !["locked", "ready"].includes(String(candidate.assessmentMode))
  ) {
    return null;
  }
  return {
    modelPhase: candidate.modelPhase as LearningAccess["modelPhase"],
    contentMode: candidate.contentMode as LearningAccess["contentMode"],
    assessmentMode: candidate.assessmentMode as LearningAccess["assessmentMode"],
    ...(["model_building", "model_failed", "model_stale"].includes(
      String(candidate.lockReason),
    )
      ? { lockReason: candidate.lockReason as LearningAccess["lockReason"] }
      : {}),
    ...(typeof candidate.activeRunId === "string"
      ? { activeRunId: candidate.activeRunId }
      : {}),
    ...(typeof candidate.inputHash === "string"
      ? { inputHash: candidate.inputHash }
      : {}),
    ...(typeof candidate.prefixHash === "string"
      ? { prefixHash: candidate.prefixHash }
      : {}),
  };
}

export function learningAccessFromEvent(event: unknown): LearningAccess | null {
  if (!event || typeof event !== "object") return null;
  const candidate = event as Record<string, unknown>;
  return parseLearningAccess(candidate.access) ?? parseLearningAccess(candidate);
}

export function isAssessmentLocked(access: LearningAccess | null | undefined) {
  return access?.assessmentMode === "locked";
}
