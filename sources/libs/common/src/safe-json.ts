/** True when the string needs Postgres-safe cleanup (NUL or lone UTF-16 surrogates). */
function needsDbStringSanitize(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0 || (code >= 0xd800 && code <= 0xdfff)) {
      return true;
    }
  }
  return false;
}

/**
 * Remove NUL bytes and lone UTF-16 surrogates that break JSON/Postgres text columns.
 * Fast path: returns the same string when already clean (no allocation).
 */
export function stripLoneSurrogates(text: string): string {
  if (!needsDbStringSanitize(text)) {
    return text;
  }

  let result = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0) {
      continue;
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      if (i + 1 < text.length) {
        const next = text.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          result += text[i] + text[i + 1];
          i++;
          continue;
        }
      }
      result += "\uFFFD";
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      result += "\uFFFD";
    } else {
      result += text[i];
    }
  }
  return result;
}

/** Postgres rejects JSON with unpaired \\uD8xx/\\uDxxx escapes. */
const LONE_HIGH_SURROGATE_ESCAPE =
  /\\u[dD][89aAbB][0-9a-fA-F]{2}(?!\\u[dD][cCdDeEfF][0-9a-fA-F]{2})/g;
const LONE_LOW_SURROGATE_ESCAPE =
  /(?<!\\u[dD][89aAbB][0-9a-fA-F]{2})\\u[dD][cCdDeEfF][0-9a-fA-F]{2}/g;

function stripLoneSurrogateEscapes(json: string): string {
  return json
    .replace(LONE_HIGH_SURROGATE_ESCAPE, "\\uFFFD")
    .replace(LONE_LOW_SURROGATE_ESCAPE, "\\uFFFD");
}

export function safeJsonStringify(value: unknown): string {
  const json = JSON.stringify(value, (_key, val) =>
    typeof val === "string" ? stripLoneSurrogates(val) : val
  );
  return stripLoneSurrogateEscapes(json);
}

/** Sanitize a text column value before writing to Postgres. */
export function sanitizeDbString(value: string): string {
  const stripped = stripLoneSurrogates(value);
  const first = stripped.trimStart()[0];
  if (first === "{" || first === "[") {
    return stripLoneSurrogateEscapes(stripped);
  }
  return stripped;
}

/** Recursively sanitize strings in Persistence create/update payloads. */
export function sanitizeWriteData<T>(data: T): T {
  if (typeof data === "string") {
    return sanitizeDbString(data) as T;
  }
  if (data instanceof Date) {
    return data;
  }
  if (Array.isArray(data)) {
    return data.map((item) => sanitizeWriteData(item)) as T;
  }
  if (data !== null && typeof data === "object") {
    return Object.fromEntries(
      Object.entries(data).map(([key, value]) => [key, sanitizeWriteData(value)])
    ) as T;
  }
  return data;
}
