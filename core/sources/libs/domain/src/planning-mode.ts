export const PLANNING_MODES = ["fast", "deep", "docs_first"] as const;

export type PlanningMode = (typeof PLANNING_MODES)[number];

export function isPlanningMode(value: unknown): value is PlanningMode {
  return (
    typeof value === "string" &&
    (PLANNING_MODES as readonly string[]).includes(value)
  );
}
