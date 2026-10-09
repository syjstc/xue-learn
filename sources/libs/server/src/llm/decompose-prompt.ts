import {
  type ContentLanguageCode,
  getLanguagePromptInstruction,
} from "./content-language.js";
import { getGenerationOptionsPromptBlock } from "./generation-options.js";
import { buildExplicitMapScopePromptBlock } from "./explicit-map-scope.js";

type DecomposeMapPlan = {
  majorAreas: Array<unknown>;
  mapStructure: {
    estimatedLeafUnits: number;
    recommendedDepth: number;
    layeringStrategy: string;
  };
  domainAnalysis: { domainTag: string };
};

type DecomposeMapSummary = {
  topicOverview: string;
  assumptions: string[];
};

export const DECOMPOSE_SCHEMA_SHAPE = `{
  "domainTag": "stem",
  "units": [
    {
      "title": "Unit title",
      "contentSummary": "2-3 sentences on what the learner will study in this unit.",
      "parentTitle": "Exact top-level parent title for a child, otherwise null",
      "difficulty": "medium",
      "prerequisiteTitles": [],
      "scope": "session"
    }
  ]
}`;

function buildPlanBlock(
  mapPlan?: DecomposeMapPlan,
  mapSummary?: DecomposeMapSummary,
): string {
  if (mapPlan) {
    const { buildMapPlanPromptBlock } =
      require("../goals/map-plan.js") as typeof import("../goals/map-plan.js");
    return `\n\n${buildMapPlanPromptBlock(mapPlan as Parameters<typeof buildMapPlanPromptBlock>[0])}\n`;
  }
  if (mapSummary) {
    const { buildMapSummaryPromptBlock } =
      require("../goals/map-summary.js") as typeof import("../goals/map-summary.js");
    return `\n\n${buildMapSummaryPromptBlock(mapSummary as Parameters<typeof buildMapSummaryPromptBlock>[0])}\n`;
  }
  return "";
}

export function buildDecomposePrompt(params: {
  title: string;
  level: string;
  context?: string;
  pathSource: "rag" | "search" | "generic";
  contentLanguage: ContentLanguageCode;
  mapPlan?: DecomposeMapPlan;
  mapSummary?: DecomposeMapSummary;
  generationOptions?: string;
  rootsOnly?: boolean;
}): string {
  const contextBlock = params.context
    ? `\n\nReference material (prioritize this structure):\n${params.context.slice(0, 12000)}`
    : "\n\nNo uploaded material — use widely accepted learning order for this topic.";

  const sourceNote =
    params.pathSource === "generic"
      ? "Label path as generic expert outline."
      : `Path source: ${params.pathSource}`;

  const langNote = getLanguagePromptInstruction(params.contentLanguage);

  const planBlock = buildPlanBlock(params.mapPlan, params.mapSummary);
  const optionsBlock = getGenerationOptionsPromptBlock(
    params.generationOptions,
  );
  const explicitScopeBlock = buildExplicitMapScopePromptBlock({
    title: params.title,
    generationOptions: params.generationOptions,
  });
  const effectiveDepth = params.rootsOnly
    ? 1
    : params.mapPlan?.mapStructure.recommendedDepth;
  const structureRules =
    effectiveDepth === 2
      ? `- Generate exactly two layers.
- Top-level units are module roots. Every top-level unit MUST have 2–6 child units.
- A child unit MUST set parentTitle to the exact title of its top-level parent.
- Do not create grandchildren or any third layer.`
      : effectiveDepth === 1
        ? `- Generate exactly one layer.
- Every unit is top-level; parentTitle MUST be null/empty.
- Do not generate child units.`
        : `- Decide whether one or two layers best fit the topic.
- If using two layers, every top-level unit MUST have 2–6 children whose parentTitle exactly matches that root.
- Never create more than two layers.`;

  return `You are XueLearn's cognitive map generation engine.
Generate the goal's cognitive map using the required one- or two-layer structure.
User level: ${params.level}.
${sourceNote}
Goal: ${params.title}
${contextBlock}
${planBlock}${optionsBlock ? `\n${optionsBlock}\n` : ""}
${explicitScopeBlock ? `\n${explicitScopeBlock}\n` : ""}
${langNote}

Rules:
${
  params.mapPlan
    ? `- Output EXACTLY ${params.mapPlan.majorAreas.length} top-level units (approved plan — no more, no fewer unless impossible)
- Align one unit per major pillar from the approved plan (mapRole branch vs leaf is a planning hint only — every unit uses scope session)
- domainTag: use "${params.mapPlan.domainAnalysis.domainTag}" from approved domain analysis`
    : `- Choose a natural number of top-level units based on the topic; there is no fixed minimum or maximum beyond producing at least one root
- If an approved lightweight summary is present, treat it as a review hint, not a fixed plan.`
}
${structureRules}
- Every emitted row MUST use scope "session". Hierarchy is represented only through parentTitle.
- Every unit MUST include contentSummary (2-3 sentences): state what the learner will study in this unit — not just a vague topic label
- Sibling units must have distinct, non-overlapping contentSummary scopes
- domainTag: stem for programming/math/science; humanities for languages/arts; else general (or from approved plan)
- prerequisiteTitles refer to earlier unit titles in this list
- If Learner profile context is present in custom instructions, use it to calibrate unit order, prerequisite bridges, difficulty, and review density. Do not reteach foundations marked strong unless needed as a brief bridge.

Required JSON shape (top-level keys only — no nesting under "curriculum" or similar):
${DECOMPOSE_SCHEMA_SHAPE}`;
}
