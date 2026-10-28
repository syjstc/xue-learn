import { materialTeachingSchema, materialTeachingCueIssues } from "./material-teaching.js";

/** Shared by normal topic authoring and video-only preparation. Saved facts
 * and narrated operation bindings have the same semantics on both paths. */
export function materialTeachingTreeIssues(value: unknown, cues?: readonly {targetIds?: readonly string[]; figureId?: string}[], nested = false): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const block = value as {type?: string; figures?: unknown[]};
  if (block.type === "stage" && Array.isArray(block.figures)) {
    const figures = block.figures.filter((figure): figure is {type: "teaching"; id: string} =>
      !!figure && typeof figure === "object" && (figure as {type?: unknown}).type === "teaching");
    return [
      ...(figures.length > 1 ? ["Use one teaching animation per display; give independent demonstrations their own topic and narration."] : []),
      ...figures.flatMap(figure => materialTeachingTreeIssues(figure, cues, true)),
    ];
  }
  if (block.type !== "teaching") return [];
  const parsed = materialTeachingSchema.safeParse(value);
  if (!parsed.success) return parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`);
  return cues ? materialTeachingCueIssues(parsed.data, cues, {scopedFocus: nested}) : [];
}
