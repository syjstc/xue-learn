const NAIVE_SQL_DATE =
  /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z)?$/i;
const HAS_EXPLICIT_OFFSET = /[+-]\d{2}(?::?\d{2})?$/;

/** Persist UTC wall-clock text as UTC, not the process local timezone. */
export function parsePersistedTimestamp(value: string): Date {
  const trimmed = value.trim();
  const naive = NAIVE_SQL_DATE.exec(trimmed);
  if (naive && !HAS_EXPLICIT_OFFSET.test(trimmed)) {
    return new Date(`${naive[1]}T${naive[2]}${naive[3] ?? "Z"}`);
  }
  return new Date(trimmed);
}

/** Normalize date values returned by raw SQLite queries. */
export function referenceDateValue(
  value: unknown,
  label = "persisted date",
): Date {
  const parsed =
    value instanceof Date
      ? value
      : typeof value === "number" ||
          (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value))
        ? new Date(Number(value))
        : parsePersistedTimestamp(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${label}`);
  }
  return parsed;
}

export function nullableReferenceDateValue(
  value: unknown,
  label = "persisted date",
): Date | null {
  return value == null ? null : referenceDateValue(value, label);
}

/** Normalize an optional raw date while preserving legacy invalid-as-null reads. */
export function safeReferenceDateValue(value: unknown): Date | null {
  if (value == null) return null;
  try {
    return referenceDateValue(value);
  } catch {
    return null;
  }
}

/** SQLite binds raw Date values as epoch numbers; timestamp comparisons need ISO text. */
export function sqlTimestampParameter(_legacyDialectFlag: boolean, input: Date): string { return input.toISOString(); }
