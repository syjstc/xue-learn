/** JSON examples for LLM structured output. Some contracts use compact keys to save tokens. */

export const COMPACT_JSON_INSTRUCTION =
  "Use the EXACT field names shown in the JSON shape above. Do not rename fields or pretty-print.";

export const SQ_QUESTION_ANSWERS_JSON_SHAPE = `{"a":["short reference answer 1","short reference answer 2"]}`;

export const SQ_PREVIEW_JSON_SHAPE = `{"items":[{"kind":"outline","text":"section title","scope":"narrow teaching scope","learningTargetIds":["lt_1"],"checkpointAfter":false},{"kind":"question","text":"guiding question","learningTargetIds":["lt_1"]}]}`;

const LEARNING_MATERIAL_ILLUSTRATION_SHAPE = `{"t":"illustration","cap":"diagram caption","pr":"Educational diagram of …","st":"diagram","ar":"16:9"}`;

export function learningMaterialJsonShape(options?: {
  includeIllustrations?: boolean;
}): string {
  const includeIllustrations = options?.includeIllustrations !== false;
  const illustration = includeIllustrations
    ? `,${LEARNING_MATERIAL_ILLUSTRATION_SHAPE}`
    : "";
  return `{"intro":"unit introduction (2-4 sentences)","b":[{"t":"heading","lv":2,"tx":"section 1 title"},{"t":"paragraph","tx":"section 1 teaching paragraph: definition, cause, example"},{"t":"callout","v":"example","ti":"section 1 example","bd":"concrete situation showing how to decide"},{"t":"check","q":"section 1 self-check","opt":["A","B","C"],"ci":1,"ex":"explanation"},{"t":"heading","lv":2,"tx":"section 2 title"},{"t":"paragraph","tx":"section 2 teaching paragraph, not a heading only"},{"t":"accordion","ti":"Deep dive: why?","bd":"additional explanation"},{"t":"callout","v":"example","ti":"Apply the distinction","bd":"Explain the useful relationship in a concrete example."}${illustration}}],"kt":["key point 1","key point 2","key point 3"]}`;
}

/** @deprecated Use learningMaterialJsonShape() so illustration blocks can be omitted when images are off. */
export const LEARNING_MATERIAL_JSON_SHAPE = learningMaterialJsonShape();

export const CORNELL_JSON_SHAPE = `{"n":"study note text","cu":"recall cue keywords","sm":"bottom summary"}`;

export const UNIT_KEY_POINTS_JSON_SHAPE = `{"points":["one-sentence course takeaway"]}`;

export const QUIZ_JSON_SHAPE = `[{"t":"mcq","q":"...","opt":["A","B","C","D"],"ci":0,"lti":["lt_1"],"pti":"lt_1","ed":"understanding","cr":"lt_1:c1","cd":"same"},{"t":"mcq_multi","q":"...","opt":["A","B","C","D"],"cis":[0,2],"lti":["lt_2"],"pti":"lt_2","ed":"memory","cr":"lt_2:c1","cd":"near"}]`;

export const FEYNMAN_JSON_SHAPE = `{"pass":true,"str":["strength 1"],"bs":["blind spot 1"],"sg":["suggestion 1"],"pl":"optional: explain it in simpler words…","obs":[{"lt":"lt_1","cr":"lt_1:c1","sc":0.8,"ra":"brief reason under this criterion"}]}`;

export const SOCRATIC_JSON_SHAPE = `{"q":"guiding question","et":"concept","dn":false}`;

export const DRILLS_JSON_SHAPE = `{"qs":[{"t":"mcq","q":"question 1","opt":["A","B"],"ci":0,"lti":["lt_1"],"pti":"lt_1","ed":"understanding","cr":"lt_1:c1","cd":"same"},{"t":"mcq","q":"question 2","opt":["A","B"],"ci":1,"lti":["lt_1"],"pti":"lt_1","ed":"understanding","cr":"lt_1:c1","cd":"near"},{"t":"mcq","q":"question 3","opt":["A","B"],"ci":0,"lti":["lt_1"],"pti":"lt_1","ed":"memory","cr":"lt_1:c1","cd":"same"}]}`;

export const FLASHCARD_DECK_JSON_SHAPE = `{"cs":[{"fr":"What is this concept's main role in this unit?","bk":"concise answer","lti":["lt_1"],"an":{"sc":"block","bi":0,"bt":"paragraph","sp":"text"},"ex":"optional course reference"}]}`;

export function isPromptJsonShape(schemaShape?: string): boolean {
  const trimmed = schemaShape?.trim() ?? "";
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

export function appendCompactJsonPrompt(
  prompt: string,
  schemaShape?: string,
): string {
  if (!isPromptJsonShape(schemaShape)) return prompt;
  return `${prompt}

Required JSON shape (use these EXACT field names):
${schemaShape!.trim()}

${COMPACT_JSON_INSTRUCTION}`;
}
