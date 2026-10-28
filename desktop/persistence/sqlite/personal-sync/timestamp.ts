const SQLITE_UTC_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

/** SQLite CURRENT_TIMESTAMP values are UTC even though they have no zone suffix. */
export function personalSyncTimestampIso(raw: unknown): string | null {
  if (raw == null) return null;
  if (raw instanceof Date)
    return Number.isNaN(raw.getTime()) ? null : raw.toISOString();
  const text = String(raw).trim();
  const date = new Date(
    SQLITE_UTC_TIMESTAMP.test(text) ? `${text.replace(" ", "T")}Z` : text,
  );
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
