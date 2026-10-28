import {
  DOMAIN_TAG_LABELS,
  LEARNING_MODE_LABELS,
} from "./domain-labels.js";
import { normalizeGoalMapPlan } from "./normalize-goal-map-plan.js";
import { formatStructuredParseError } from "../llm/parse-structured.js";
import type { GoalMapPlan } from "../llm/schemas.js";
import { goalMapPlanSchema } from "../llm/schemas.js";
import { parseJson } from "../utils.js";

/** Parse LLM plan JSON — coerces minor schema violations instead of failing the flow. */
export function parseGoalMapPlanFromLlm(raw: unknown): GoalMapPlan {
  const parsed = goalMapPlanSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw new Error(
    `学习计划解析失败: ${formatStructuredParseError(parsed.error)}`,
  );
}

export function parseMapPlan(json: string): GoalMapPlan | null {
  const raw = parseJson<unknown>(json, null);
  if (!raw) return null;
  const parsed = goalMapPlanSchema.safeParse(raw);
  return parsed.success ? normalizeGoalMapPlan(parsed.data) : null;
}

export function serializeMapPlan(plan: GoalMapPlan): string {
  return JSON.stringify(plan);
}

function formatMajorArea(
  area: GoalMapPlan["majorAreas"][number],
  index: number,
): string {
  const role =
    area.mapRole === "branch"
      ? `branch pillar (learnable now; ~${area.estimatedChildCount ?? "?"} children if subdivided${
          area.groupingAxis ? `; group by: ${area.groupingAxis}` : ""
        })`
      : "session unit";
  return `a_${index + 1}. ${area.title} [${role}]: ${area.description}`;
}

export function buildMapPlanPromptBlock(plan: GoalMapPlan): string {
  const areas = plan.majorAreas.map(formatMajorArea).join("\n");
  const domain = plan.domainAnalysis;
  const structure = plan.mapStructure;

  return `Approved cognitive-map plan (MUST follow domain + layering strategy):

Domain analysis (pedagogy for this goal):
- Field: ${domain.field} → ${domain.subdomain}
- Learning mode: ${domain.learningMode} (${LEARNING_MODE_LABELS[domain.learningMode]})
- Domain tag: ${domain.domainTag} (${DOMAIN_TAG_LABELS[domain.domainTag]})
- Topic category: ${domain.topicCategory} (drives specialist content markup in generated lessons)
- Mode clarification: ${domain.modeClarification}
${
  domain.alternateInterpretations.length
    ? `- Rejected alternate readings:\n${domain.alternateInterpretations
        .map((a) => `  • ${a.label}: ${a.whyNotChosen}`)
        .join("\n")}`
    : ""
}

Map structure (multi-layer when needed):
- Recommended depth: ${structure.recommendedDepth} layer(s)
- Estimated leaf sessions (all layers): ~${structure.estimatedLeafUnits}
- Layering strategy: ${structure.layeringStrategy}
- Nesting rationale: ${structure.nestingRationale}

Topic overview:
${plan.topicOverview}

Learner will gain:
${plan.whatYouWillLearn.map((x, index) => `- o_${index + 1}: ${x}`).join("\n")}

Major pillars → top-level session units (cover all; mapRole branch vs leaf is planning only — every unit uses scope session):
${areas}

Out of scope (do NOT add units for these):
${plan.outOfScope.length ? plan.outOfScope.map((x) => `- ${x}`).join("\n") : "- (none listed)"}

Assumed prerequisites:
${plan.prerequisitesAssumed.length ? plan.prerequisitesAssumed.map((x) => `- ${x}`).join("\n") : "- As stated by user level"}`;
}
