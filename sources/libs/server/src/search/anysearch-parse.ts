/** Parse AnySearch MCP markdown tool responses into structured web hits. */

export type AnySearchWebResult = {
  title: string;
  url: string;
  content: string;
};

const RESULT_HEADER_RE =
  /^##\s+Search Results\s*\((\d+)\s+results?(?:,\s*(\d+)ms)?\)/i;
const RESULT_START_RE = /^###\s+(\d+)\.\s+(.+)$/gm;

/**
 * AnySearch `search` returns markdown like:
 * ## Search Results (N results, Xms)
 * ### 1. Title
 * - **URL**: https://...
 * - snippet...
 */
export function parseAnySearchResultsMarkdown(text: string): {
  results: AnySearchWebResult[];
  resultCount?: number;
  responseTimeMs?: number;
} {
  const trimmed = text.trim();
  if (!trimmed) return { results: [] };

  const header = trimmed.match(RESULT_HEADER_RE);
  const resultCount = header?.[1] ? Number(header[1]) : undefined;
  const responseTimeMs = header?.[2] ? Number(header[2]) : undefined;

  const starts: Array<{ index: number; title: string }> = [];
  RESULT_START_RE.lastIndex = 0;
  let startMatch: RegExpExecArray | null;
  while ((startMatch = RESULT_START_RE.exec(trimmed)) !== null) {
    starts.push({
      index: startMatch.index,
      title: startMatch[2]?.trim() ?? "",
    });
  }

  const results: AnySearchWebResult[] = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i]!;
    const end = starts[i + 1]?.index ?? trimmed.length;
    const block = trimmed.slice(start.index, end);
    const urlMatch = block.match(/-\s+\*\*URL\*\*:\s+(\S+)/);
    const url = urlMatch?.[1]?.trim() ?? "";
    if (!url) continue;

    const afterUrl = urlMatch
      ? block.slice(urlMatch.index! + urlMatch[0].length)
      : "";
    const content = afterUrl
      .replace(/^-\s+/gm, "")
      .replace(/\s+/g, " ")
      .trim();

    results.push({
      title: start.title || url,
      url,
      content,
    });
  }

  return { results, resultCount, responseTimeMs };
}

/**
 * AnySearch `extract` returns markdown with an optional **Source**: URL line.
 */
export function parseAnySearchExtractMarkdown(
  text: string,
  fallbackUrl: string,
): { url: string; title: string | null; rawContent: string } {
  const trimmed = text.trim();
  const sourceMatch = trimmed.match(/\*\*Source\*\*:\s*(\S+)/i);
  const url = sourceMatch?.[1]?.trim() || fallbackUrl;

  let body = trimmed;
  const sep = body.indexOf("\n---\n");
  if (sep >= 0) {
    body = body.slice(sep + 5).trim();
  } else {
    body = body
      .replace(/^##\s+.+$/m, "")
      .replace(/\*\*Source\*\*:\s*\S+/i, "")
      .trim();
  }

  const titleMatch = body.match(/^#\s+(.+)$/m);
  const title = titleMatch?.[1]?.trim() || null;

  return {
    url,
    title,
    rawContent: body,
  };
}
