export type MaterialCalloutDetail = Readonly<{ id: string; text: string }>;

/** Address only independent Markdown units. Complex Markdown stays intact. */
export function materialCalloutDetails(figure: {
  type?: unknown;
  id?: unknown;
  body?: unknown;
}): MaterialCalloutDetail[] {
  if (
    figure.type !== "callout" ||
    typeof figure.id !== "string" ||
    !figure.id.trim() ||
    typeof figure.body !== "string"
  )
    return [];
  const body = figure.body.replace(/\r\n/g, "\n");
  if (
    /^\s*(?:```|~~~|>|#{1,6}\s|\|)|\$\$|\\\[|^\s*\[[^\]]+\]:|^ {2,}\S/m.test(
      body,
    )
  )
    return [];
  const chunks = body.trim().split(/\n\s*\n/);
  const units: string[] = [];
  for (const chunk of chunks) {
    const lines = chunk.split("\n");
    const isList = (line: string) => /^(?:[-+*]|\d+[.)])\s+\S/.test(line);
    if (lines.every(isList)) units.push(...lines);
    else if (lines.some(isList)) return [];
    else units.push(chunk);
  }
  if (units.length < 2 || units.length > 5) return [];
  return units.map((text, index) => ({
    id: `${figure.id}:detail-${index + 1}`,
    text,
  }));
}
