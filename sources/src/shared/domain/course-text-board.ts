type TextFigure = Readonly<{
  type?: string;
  variant?: unknown;
  title?: unknown;
  body?: unknown;
}>;

/** Only explicitly authored, bold Markdown labels form dimensions. Ordinary
 * prose, colons in code/math, and unequal dimensions are never guessed. */
export function courseTextDimensions(
  body: string,
): { label: string; text: string }[] | null {
  const rows = body
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (rows.length < 2 || rows.length > 6) return null;
  const parsed: { label: string; text: string }[] = [];
  for (const row of rows) {
    const match = /^(?:[-*] )?\*\*([^*\n:：]{1,24})\*\*\s*[:：]\s*(\S.*)$/.exec(
      row,
    );
    if (!match) return null;
    const label = match[1]!.trim();
    if (!label || parsed.some((item) => item.label === label)) return null;
    parsed.push({ label, text: match[2]! });
  }
  return parsed;
}

/** A display-only projection. Original figure order, text and cue IDs survive. */
export function courseTextBoard(figures: readonly TextFigure[]) {
  if (
    figures.length < 2 ||
    figures.length > 4 ||
    figures.some((f) => f.type !== "callout")
  )
    return null;
  const columns = figures.flatMap((figure, index) =>
    figure.variant === "definition" &&
    typeof figure.title === "string" &&
    figure.title.trim() &&
    typeof figure.body === "string" &&
    figure.body.trim()
      ? [index]
      : [],
  );
  const notes = figures
    .map((_, index) => index)
    .filter((index) => !columns.includes(index));
  // A trailing authored note can summarize a set of definitions. Mixed card
  // types and main/rail compositions retain their ordinary semantic rendering.
  if (
    columns.length < 2 ||
    notes.length > 1 ||
    notes.some(
      (index) =>
        index !== figures.length - 1 ||
        !["tip", "warning"].includes(String(figures[index]!.variant)),
    )
  )
    return null;
  const dimensions = columns.map((index) =>
    courseTextDimensions(String(figures[index]!.body)),
  );
  const first = dimensions[0];
  const aligned =
    first &&
    dimensions.every(
      (rows) =>
        rows &&
        rows.length === first.length &&
        rows.every((row, index) => row.label === first[index]!.label),
    );
  return {
    columns,
    notes,
    rows: aligned
      ? first.map((row, index) => ({
          label: row.label,
          cells: dimensions.map((rows) => rows![index]!.text),
        }))
      : null,
  };
}
