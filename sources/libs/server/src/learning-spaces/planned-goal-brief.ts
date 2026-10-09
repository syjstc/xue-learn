import { z } from "zod";
import {
  PLANNED_GOAL_ACTIVATION_CONTEXT_END,
  PLANNED_GOAL_ACTIVATION_CONTEXT_START,
  type PlannedGoalBrief,
} from "../../../domain/src/index.js";

const compactText = z.string().trim().min(1).max(1_000);

export const plannedGoalBriefSchema = z.object({
  schemaVersion: z.literal(1),
  originalRequest: z.string().trim().min(1).max(4_000),
  intendedOutcome: z.string().trim().min(1).max(1_000),
  scopeIncluded: z.array(compactText).max(12).default([]),
  scopeExcluded: z.array(compactText).max(12).default([]),
  prerequisites: z.array(compactText).max(12).default([]),
  desiredOutputs: z.array(compactText).max(12).default([]),
  suggestedLevel: z.enum(["zero", "basic", "advanced"]),
  suggestedLearningMode: z.enum(["exploration", "mastery"]),
  suggestedPlanningMode: z.enum(["fast", "deep", "docs_first"]),
  suggestedContentLanguage: z.string().trim().min(1).max(40),
});

export function parsePlannedGoalBrief(value: unknown): PlannedGoalBrief | null {
  if (typeof value === "string") {
    try {
      return plannedGoalBriefSchema.parse(JSON.parse(value));
    } catch {
      return null;
    }
  }
  const parsed = plannedGoalBriefSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function formatPlannedGoalBrief(brief: PlannedGoalBrief): string {
  const line = (label: string, values: readonly string[]) =>
    values.length ? `${label}: ${values.join("; ")}` : "";
  return [
    "Planned goal brief (assistant-proposed; learner may edit during confirmation):",
    `Original request: ${brief.originalRequest}`,
    `Intended outcome: ${brief.intendedOutcome}`,
    line("Include", brief.scopeIncluded),
    line("Exclude", brief.scopeExcluded),
    line("Prerequisites", brief.prerequisites),
    line("Desired outputs", brief.desiredOutputs),
    `Suggested level: ${brief.suggestedLevel}`,
    `Suggested learning mode: ${brief.suggestedLearningMode}`,
    `Suggested planning mode: ${brief.suggestedPlanningMode}`,
    `Suggested content language: ${brief.suggestedContentLanguage}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatPlannedGoalActivationContext(input: {
  title: string;
  rationale: string;
  suggestedGoalKind: "full" | "micro";
  goalBrief: PlannedGoalBrief | null;
}): string {
  return [
    PLANNED_GOAL_ACTIVATION_CONTEXT_START,
    "This run was started by the learner clicking an existing roadmap placeholder. It materializes that exact placeholder into its real learning goal; it is not a request to propose a separate new goal, and the selected placeholder must not be treated as a duplicate or conflict with itself.",
    "Treat the persisted metadata as complete intake. Ask no clarification, discovery, or form questions; proceed directly to learner confirmation.",
    `Planned title: ${input.title}`,
    input.rationale ? `Roadmap rationale: ${input.rationale}` : "",
    `Suggested goal kind: ${input.suggestedGoalKind}`,
    input.goalBrief ? formatPlannedGoalBrief(input.goalBrief) : "",
    PLANNED_GOAL_ACTIVATION_CONTEXT_END,
  ]
    .filter(Boolean)
    .join("\n");
}
