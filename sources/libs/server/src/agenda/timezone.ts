import { DEFAULT_TIMEZONE } from "./types.js";

/** Format a Date as YYYY-MM-DD in the given IANA timezone. */
export function localDateKey(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || DEFAULT_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: DEFAULT_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }
}

/** Local hour (0-23) and minute in timezone. */
export function localTimeParts(
  date: Date,
  timeZone: string,
): { hour: number; minute: number; dateKey: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone || DEFAULT_TIMEZONE,
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "0";
  const year = get("year");
  const month = get("month").padStart(2, "0");
  const day = get("day").padStart(2, "0");
  return {
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    dateKey: `${year}-${month}-${day}`,
  };
}

/** Add N calendar days to a YYYY-MM-DD key (UTC noon anchor; date-only arithmetic). */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function dateKeysForWindow(
  startDateKey: string,
  days: number,
): string[] {
  return Array.from({ length: days }, (_, i) =>
    addDaysToDateKey(startDateKey, i),
  );
}

/** Approximate start-of-day UTC instant for a local date key in a timezone. */
export function localDateKeyToApproxUtc(
  dateKey: string,
  timeZone: string,
): Date {
  // Use noon UTC of that calendar date as a stable anchor for comparisons.
  const [y, m, d] = dateKey.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const keyAtProbe = localDateKey(probe, timeZone);
  if (keyAtProbe === dateKey) return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  // Fallback: return UTC midnight of the key.
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}
