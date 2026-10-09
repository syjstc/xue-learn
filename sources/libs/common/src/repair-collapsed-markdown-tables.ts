/** GFM separator cell fragment: `| --- |`, `|:---|`, `| ---: |`, etc. */
const TABLE_SEPARATOR_FRAGMENT_RE = /\|\s*:?-{3,}:?\s*\|/;
const TABLE_SEPARATOR_ROW_RE =
  /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;

/**
 * A frequent companion failure is prose glued to an emphasized first header:
 * `Use this format: **Date:** ... | Task |`.
 *
 * Even after `||` row repair, GFM treats that whole line as prose instead of a
 * table header. Detach only this narrow, high-confidence shape.
 */
function detachProseFromTableHeader(text: string): string {
  const lines = text.split("\n");

  for (let index = 0; index < lines.length - 1; index += 1) {
    const header = lines[index] ?? "";
    const separator = lines[index + 1] ?? "";
    if (
      header.trimStart().startsWith("|") ||
      !header.includes("|") ||
      !TABLE_SEPARATOR_ROW_RE.test(separator)
    ) {
      continue;
    }

    const match = header.match(
      /^(.+?[：:])\s+((\*\*|__)[^|\n]+?\3[^|\n]*\|.*)$/,
    );
    if (!match) continue;

    lines[index] = `${match[1].trimEnd()}\n\n| ${match[2].trimStart()}`;
  }

  return lines.join("\n");
}

/**
 * Repair GFM tables that LLMs often emit as one line with `||` between rows:
 * `| A | B || --- | --- || 1 | 2 |` → proper newline-separated rows.
 *
 * Only rewrites lines that already contain a separator-row fragment, so
 * ordinary `A || B` prose and code fences are left alone.
 */
export function repairCollapsedMarkdownTables(text: string): string {
  if (!text.includes("||") || !TABLE_SEPARATOR_FRAGMENT_RE.test(text)) {
    return text;
  }

  const fences: string[] = [];
  const withoutFences = text.replace(/```[\s\S]*?```/g, (match) => {
    const token = `\0FENCE${fences.length}\0`;
    fences.push(match);
    return token;
  });

  const repaired = detachProseFromTableHeader(
    withoutFences
      .split("\n")
      .map((line) => {
        if (!line.includes("||") || !TABLE_SEPARATOR_FRAGMENT_RE.test(line)) {
          return line;
        }
        return line.replace(/\|\|/g, "|\n|");
      })
      .join("\n"),
  );

  return repaired.replace(/\0FENCE(\d+)\0/g, (_, index: string) => {
    return fences[Number(index)] ?? "";
  });
}
