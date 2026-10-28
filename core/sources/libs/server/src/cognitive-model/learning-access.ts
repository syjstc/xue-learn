export type LearningAccess = {
  modelPhase:
    "pending" | "building" | "targets_ready" | "ready" | "failed" | "stale";
  contentMode: "none" | "draft" | "canonical";
  assessmentMode: "locked" | "ready";
  lockReason?: "model_building" | "model_failed" | "model_stale";
  activeRunId?: string;
  inputHash?: string;
  prefixHash?: string;
};

export type LearningAccessInput = {
  goalKind?: string | null;
  learningMode?: string | null;
  unitStatus: string | null | undefined;
  goalStatus?: string | null;
  goalInputHash?: string | null;
  goalPublishedHash?: string | null;
  buildInputHash?: string | null;
  hasCanonicalTargets?: boolean;
  hasCanonicalTargetsFallback?: boolean;
  hasCanonicalContent?: boolean;
  hasDraftContent?: boolean;
  targetsReady?: boolean;
  activeRunId?: string;
  prefixHash?: string;
  unitModuleUnlockStatus?: string | null;
  unitModuleGenerationStatus?: string | null;
};

/**
 * Learner-facing availability is intentionally separate from KACOM's durable
 * revision state. Draft teaching content may be visible while evidence remains
 * locked, while assessment requires either a published unit hash match or an
 * unlocked module boundary for completed/active modules.
 */
export function deriveLearningAccess(
  input: LearningAccessInput,
): LearningAccess {
  if (input.goalKind === "micro" || input.learningMode === "exploration") {
    return {
      modelPhase: "ready",
      contentMode: input.hasCanonicalContent ? "canonical" : "none",
      assessmentMode: "ready",
    };
  }

  const hasCanonicalTargets =
    input.hasCanonicalTargets || input.hasCanonicalTargetsFallback;
  const moduleBoundary = Boolean(
    input.unitModuleUnlockStatus &&
    input.unitModuleUnlockStatus !== "locked" &&
    input.unitStatus === "expanded" &&
    hasCanonicalTargets,
  );
  const stale = Boolean(
    !moduleBoundary &&
    input.buildInputHash &&
    input.goalInputHash &&
    input.buildInputHash !== input.goalInputHash,
  );
  const moduleAvailable = Boolean(
    moduleBoundary &&
    input.unitModuleGenerationStatus &&
    input.unitModuleGenerationStatus !== "failed",
  );
  const publishedCurrent = Boolean(
    input.goalInputHash &&
    input.goalPublishedHash === input.goalInputHash &&
    input.unitStatus === "expanded" &&
    input.buildInputHash === input.goalInputHash &&
    input.hasCanonicalTargets &&
    input.unitModuleGenerationStatus !== "failed",
  );

  const modelPhase: LearningAccess["modelPhase"] = stale
    ? "stale"
    : publishedCurrent || moduleAvailable
      ? "ready"
      : input.targetsReady
        ? "targets_ready"
        : input.unitStatus === "failed"
          ? "failed"
          : input.unitStatus === "building" ||
              input.unitStatus === "provisional" ||
              input.goalStatus === "building" ||
              input.goalStatus === "needs_reconciliation"
            ? "building"
            : "pending";

  const contentMode: LearningAccess["contentMode"] =
    (publishedCurrent || moduleAvailable) && input.hasCanonicalContent
      ? "canonical"
      : input.hasCanonicalContent || input.hasDraftContent || input.targetsReady
        ? "draft"
        : "none";

  if (publishedCurrent || moduleAvailable) {
    return {
      modelPhase,
      contentMode,
      assessmentMode: "ready",
      ...(input.activeRunId ? { activeRunId: input.activeRunId } : {}),
      ...(input.goalInputHash ? { inputHash: input.goalInputHash } : {}),
      ...(input.prefixHash ? { prefixHash: input.prefixHash } : {}),
    };
  }

  const lockReason: NonNullable<LearningAccess["lockReason"]> = stale
    ? "model_stale"
    : input.unitStatus === "failed"
      ? "model_failed"
      : "model_building";
  return {
    modelPhase,
    contentMode,
    assessmentMode: "locked",
    lockReason,
    ...(input.activeRunId ? { activeRunId: input.activeRunId } : {}),
    ...(input.goalInputHash ? { inputHash: input.goalInputHash } : {}),
    ...(input.prefixHash ? { prefixHash: input.prefixHash } : {}),
  };
}
