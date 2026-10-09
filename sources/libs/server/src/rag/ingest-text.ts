import { sanitizeDbString } from "../../../common/src/index.js";

/** C0 controls / DEL except TAB and LF (already handled via whitespace rules). */
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function hasControlChars(text: string): boolean {
  CONTROL_CHARS_RE.lastIndex = 0;
  return CONTROL_CHARS_RE.test(text);
}

/**
 * 数据清洗 for uploaded / fetched learning material before LLM, chunking, and DB.
 * Strips NUL/control bytes Postgres rejects, then collapses whitespace.
 * Fast path: skips control-char rewrite when the string is already clean.
 */
export function normalizeIngestText(text: string): string {
  let cleaned = sanitizeDbString(text);
  if (hasControlChars(cleaned)) {
    CONTROL_CHARS_RE.lastIndex = 0;
    cleaned = cleaned.replace(CONTROL_CHARS_RE, "");
  }

  return cleaned
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v\u00a0]+/g, " ")
    .replace(/ +/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
