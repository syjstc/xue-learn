/** Authoring policy for the general-education course space; stored material stays compatible. */
export const GENERAL_EDUCATION_DISPLAY_INSTRUCTION = `General-education course display rule (overrides general multi-figure guidance):
- Each display may contain at most ONE picture in total: svg_slot and illustration share this limit, including inside stage.figures. A picture is optional.
- Text, code and brief explanatory helpers may accompany that one picture. Never put two SVG diagrams, two illustrations, or one of each on the same display.
- When teaching requires another picture, use a separate ordered topic/display with its own spoken cues and valid targetIds. Preserve the teaching sequence and all necessary explanation.`;

export function generalEducationDisplayIssues(display: unknown): string[] {
  if (!display || typeof display !== "object") return [];
  const block = display as Record<string, unknown>;
  const figures = block.type === "stage" && Array.isArray(block.figures)
    ? block.figures : [block];
  const pictures = figures.filter((figure) =>
    figure?.type === "svg_slot" || figure?.type === "illustration",
  );
  return pictures.length > 1
    ? ["General-education display allows at most one picture total (svg_slot + illustration, including stage figures). Move additional pictures into separate ordered topics/displays with their own cues."]
    : [];
}
