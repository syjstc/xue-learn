export type GoalTextbookPdfLayout = "desktop" | "mobile";

export function isGoalTextbookPdfLayout(
  value: string,
): value is GoalTextbookPdfLayout {
  return value === "desktop" || value === "mobile";
}
