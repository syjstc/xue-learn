// Private Survey prompt source owned by unit-content capability.

import {
  FORMAL_DERIVATION_CONTENT_KIND_RULE,
  FORMAL_DERIVATION_MICRO_CONTENT_KIND_LINE,
} from "../../../survey/formal-derivation-planning.js";

type SqPromptPlan = {
  goalBlock(): string;
  difficultyBlock(): string;
  styleBlock(): string;
  languageBlock(): string;
};

export const SQ_PREVIEW_STABLE_INSTRUCTION = `Author a Survey preview for exactly one unit. Follow server-owned learning-target authority; output only the requested structured items.
This preview defines the capability scope of one unit. Use the supplied context to cover only this unit and not sibling topics.

Voice:
- Write learner-facing Survey copy (outline titles, scopes, and guiding questions) in the active teaching persona's voice. Do not flatten a sarcastic or scheming persona into a neutral syllabus.
- If the persona specifies frequent roasting, let that edge show in titles and questions without padding, without turning the Survey into a joke sketch, and without changing target coverage or schemas.
- If the persona specifies first-principles sequencing, order outline items for the fastest path to understanding rather than a textbook subsection list; still teach genuinely blocking prerequisites first.

Outline design rules:
- Make the outline a partition of the unit: each item owns a distinct teaching job and advances a different part of the unit.
- Do not create multiple items that re-explain the same background, motivation, pain points, core definition, example, or conclusion from different rhetorical angles.
- Give each item a narrow scope that states what it alone teaches. Titles and scopes must be meaningfully distinguishable, not paraphrases.
- If two items cite the same learning target, divide it into explicitly different aspects or stages; do not repeat the same explanation.
- Order prerequisite concepts before application and synthesis unless the teaching persona specifies first-principles understanding order. Keep recap inside a later item to at most a brief bridge rather than its main content.
- ${FORMAL_DERIVATION_CONTENT_KIND_RULE}`;

/** JSON-array successor to the legacy SQ line DSL. Learning targets are server-owned. */
export function buildSqPreviewJsonPrompt(params: {
  unitTitle: string;
  plan?: SqPromptPlan;
  goalBlock?: string;
  difficultyBlock?: string;
  styleBlock?: string;
  languageBlock?: string;
  sharedContextReuseLine?: string;
  optionsBlock: string;
  context: string;
  canonicalLearningTargets: string;
  moduleContext?: string;
  sectionPlanningMode: "kacom" | "exploration" | "micro";
}): string {
  const goalBlock = params.goalBlock ?? params.plan?.goalBlock() ?? "";
  const difficultyBlock =
    params.difficultyBlock ?? params.plan?.difficultyBlock() ?? "";
  const styleBlock = params.styleBlock ?? params.plan?.styleBlock() ?? "";
  const languageBlock =
    params.languageBlock ?? params.plan?.languageBlock() ?? "";
  const hasCanonicalTargets = Boolean(params.canonicalLearningTargets.trim());
  const microDerivationLine =
    params.sectionPlanningMode === "micro"
      ? `${FORMAL_DERIVATION_MICRO_CONTENT_KIND_LINE}\n`
      : "";
  return `Generate the SQ (Survey + Question) preview for unit "${params.unitTitle}".
${params.sharedContextReuseLine ? `${params.sharedContextReuseLine}\n` : ""}${microDerivationLine}
Return one JSON object whose items array grows in order: ${hasCanonicalTargets ? "2-8" : "1-6"} outline entries, then 1-6 questions. ${
    hasCanonicalTargets
      ? "Each outline entry and every question must cite one or more published learning-target refs. Cover every published target across the outline. Do not reproduce or redefine learning targets; they are server-owned."
      : "This is a standalone micro course without a cognitive model. Generate concise preview points and guiding questions directly from the lesson context; use an empty learningTargetIds array."
  }
${params.moduleContext ? `${params.moduleContext}\n` : ""}
${goalBlock}
${difficultyBlock}
${styleBlock}
${params.optionsBlock ? `\n${params.optionsBlock}\n` : ""}${languageBlock}

Object contract:
- {"items":[${hasCanonicalTargets ? '{"kind":"outline","text":"short section title","scope":"one narrow 3-6 minute teaching scope","learningTargetIds":["lt_1"],"checkpointAfter":false}' : '{"kind":"outline","text":"survey outline item","scope":"what this point alone covers","learningTargetIds":[],"checkpointAfter":false}'},{"kind":"question","text":"guiding question","learningTargetIds":${hasCanonicalTargets ? '["lt_1"]' : "[]"}}]}
- Emit complete outline objects before questions so the learner UI can paint them as they close. Do not emit a section_plan field; section grouping is a later server-owned call.
- ${hasCanonicalTargets ? "Use only refs declared below. Set checkpointAfter at semantic boundaries after 1-3 adjacent outline entries; the final outline entry must be true." : "Do not invent learning-target refs."}
- ${FORMAL_DERIVATION_CONTENT_KIND_RULE}

${hasCanonicalTargets ? "Published learning targets:" : "Published learning targets: none (standalone micro course)"}
${params.canonicalLearningTargets}

Context:
${params.context}`;
}
