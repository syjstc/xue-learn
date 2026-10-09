/** Avoid reteaching course-level or overview-unit background in every leaf session. */
export const UNIT_SHARED_CONTEXT_REUSE_PROMPT =
  "If shared course-level background (author biography, historical period, grammar family, etc.) is established by actual earlier teaching, do NOT reteach it here — use at most a brief reminder and focus on this unit's unique learning task. A course pattern or planned overview title alone is not teaching evidence.";

export const UNIT_SHARED_CONTEXT_REUSE_LINE = UNIT_SHARED_CONTEXT_REUSE_PROMPT;
