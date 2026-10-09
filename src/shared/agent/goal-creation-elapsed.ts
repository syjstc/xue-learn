const NAIVE_SQL_DATE =
  /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z)?$/i;
const HAS_EXPLICIT_OFFSET = /[+-]\d{2}(?::?\d{2})?$/;

/** Parse an API timestamp, treating timezone-naive SQL clocks as UTC. */
export function parseGoalCreationTimestampMs(
  value: string | undefined,
): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    const ms = Number(trimmed);
    return Number.isFinite(ms) ? ms : null;
  }
  const naive = NAIVE_SQL_DATE.exec(trimmed);
  const normalized =
    naive && !HAS_EXPLICIT_OFFSET.test(trimmed)
      ? `${naive[1]}T${naive[2]}${naive[3] ?? "Z"}`
      : trimmed.includes("T")
        ? trimmed
        : trimmed.replace(" ", "T");
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Live "this step has been running" seconds.
 *
 * Hosted TIMESTAMP-without-TZ values are often serialized as UTC wall-clock
 * then re-read as local time, so a brand-new step shows ~timezone offset
 * (480 minutes in UTC+8). Prefer a sane server delta; otherwise tick from
 * when this client first saw the current step.
 */
export function goalCreationStepElapsedSeconds(input: {
  startedAt?: string;
  nowMs: number;
  seenAtMs: number;
  timeZoneOffsetMinutes?: number;
}): number {
  const clientElapsed = Math.max(
    0,
    Math.floor((input.nowMs - input.seenAtMs) / 1000),
  );
  const startedAt = parseGoalCreationTimestampMs(input.startedAt);
  if (startedAt == null) return clientElapsed;
  const serverElapsed = Math.floor((input.nowMs - startedAt) / 1000);
  const tzSkewSeconds =
    -(
      input.timeZoneOffsetMinutes ?? new Date(input.nowMs).getTimezoneOffset()
    ) * 60;
  const serverLooksSane =
    serverElapsed >= 0 &&
    (tzSkewSeconds === 0 || serverElapsed < tzSkewSeconds - 60);
  if (!serverLooksSane) return clientElapsed;
  return Math.max(serverElapsed, clientElapsed);
}

export function goalCreationStepKey(input: {
  sequence?: number;
  type?: string;
  payload?: Record<string, unknown>;
  phase?: string;
}): string {
  const activityId = input.payload?.id;
  if (
    input.type === "planning_activity" &&
    typeof activityId === "string" &&
    activityId.trim()
  ) {
    return `activity:${activityId}`;
  }
  if (input.sequence != null && input.type) {
    return `event:${input.sequence}:${input.type}`;
  }
  return `phase:${input.phase ?? "unknown"}`;
}
