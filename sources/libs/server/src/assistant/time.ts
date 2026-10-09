const DEFAULT_TIMEZONE = "UTC";

function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function resolveTimezone(timezone?: string): string {
  const trimmed = timezone?.trim();
  if (trimmed && isValidTimezone(trimmed)) return trimmed;
  return DEFAULT_TIMEZONE;
}

export function getCurrentTime(timezone?: string) {
  const now = new Date();
  const resolved = resolveTimezone(timezone);
  const local = new Intl.DateTimeFormat("en-US", {
    timeZone: resolved,
    dateStyle: "full",
    timeStyle: "long",
  }).format(now);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: resolved,
    weekday: "long",
  }).format(now);
  const calendarDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: resolved,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const year = calendarDate.slice(0, 4);

  return {
    utc: now.toISOString(),
    timezone: resolved,
    local,
    weekday,
    calendarDate,
    year,
    unixMs: now.getTime(),
  };
}

/** Inject into agent system prompts so models know the real calendar before searching. */
export function formatCurrentTimePromptBlock(timezone?: string): string {
  const time = getCurrentTime(timezone);
  return `[Current time]
${time.local}; date=${time.calendarDate}; timezone=${time.timezone}.
Use this for time-sensitive answers and searches. Include year ${time.year} when checking current/latest models, versions, or news.`;
}

/** Stable within a local calendar day; prefer this unless wall-clock time matters. */
export function formatCurrentDatePromptBlock(timezone?: string): string {
  const time = getCurrentTime(timezone);
  return `[Current date]
${time.weekday}; date=${time.calendarDate}; timezone=${time.timezone}.
Use this for date-sensitive answers and searches. Include year ${time.year} when checking current/latest models, versions, or news.`;
}

export function queryNeedsExactCurrentTime(query?: string): boolean {
  const value = query?.trim();
  if (!value) return false;
  return /\b(?:current time|what time|time is it|exact time)\b|(?:现在|当前|当地).{0,4}(?:几点|时间)|几点了/i.test(
    value,
  );
}
