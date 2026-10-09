import {
  goalMapSummarySchema,
  type GoalMapSummary,
} from "../llm/schemas.js";
import { parseJson } from "../utils.js";

export function parseMapSummary(json: string): GoalMapSummary | null {
  const raw = parseJson<unknown>(json, null);
  if (!raw) return null;
  return coerceGoalMapSummary(raw);
}

export function coerceGoalMapSummary(value: unknown): GoalMapSummary | null {
  if (!value || typeof value !== "object") return null;
  const parsed = goalMapSummarySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function serializeMapSummary(summary: GoalMapSummary): string {
  return JSON.stringify(summary);
}

export function buildMapSummaryPromptBlock(summary: GoalMapSummary): string {
  return `Approved lightweight map summary:

${summary.topicOverview}

Assumptions:
${summary.assumptions.length ? summary.assumptions.map((x) => `- ${x}`).join("\n") : "- Use goal level and daily time."}`;
}
