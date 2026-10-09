import type { LearningMaterialContent } from "./schemas.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function mapObjectKeys(value: unknown, keys: Record<string, string>): unknown {
  if (Array.isArray(value))
    return value.map((item) => mapObjectKeys(item, keys));
  if (!isRecord(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    out[keys[key] ?? key] = mapObjectKeys(child, keys);
  }
  return out;
}

const materialKeys: Record<string, string> = {
  intro: "introduction",
  b: "blocks",
  t: "type",
  lv: "level",
  tx: "text",
  v: "variant",
  ti: "title",
  bd: "body",
  fr: "front",
  bk: "back",
  q: "question",
  opt: "options",
  ci: "correctIndex",
  ex: "explanation",
  it: "items",
  dt: "detail",
  l: "left",
  r: "right",
  lb: "label",
  pt: "points",
  cap: "caption",
  pr: "prompt",
  st: "style",
  ar: "aspectRatio",
  kt: "keyTakeaways",
};

const sq3rKeys: Record<string, string> = {
  s: "survey",
  o: "outline",
  lt: "learningTargets",
  id: "id",
  lb: "label",
  tx: "text",
  lti: "learningTargetIds",
  q: "questions",
  rh: "readHighlights",
  rp: "recitePrompts",
  rs: "reviewSummary",
};

const quizKeys: Record<string, string> = {
  qs: "questions",
  il: "interleaved",
  t: "type",
  q: "question",
  opt: "options",
  ci: "correctIndex",
  cis: "correctIndices",
  lti: "learningTargetIds",
  pti: "primaryLearningTargetId",
  pce: "primaryCognitiveEntityId",
  ed: "evidenceDimension",
  cr: "criterionRef",
  cd: "contextDistance",
};

export function expandLearningMaterialCompact(value: unknown): unknown {
  return mapObjectKeys(value, materialKeys);
}

export function expandSq3rCompact(value: unknown): unknown {
  return mapObjectKeys(value, sq3rKeys);
}

export function expandSqAnswersCompact(value: unknown): unknown {
  return mapObjectKeys(value, { a: "answers" });
}

export function expandCornellCompact(value: unknown): unknown {
  return mapObjectKeys(value, { n: "notes", cu: "cues", sm: "summary" });
}

export function expandQuizCompact(value: unknown): unknown {
  return mapObjectKeys(value, quizKeys);
}

export function expandFeynmanCompact(value: unknown): unknown {
  return mapObjectKeys(value, {
    pass: "passed",
    str: "strengths",
    bs: "blindSpots",
    sg: "suggestions",
    pl: "plainLanguagePrompt",
    obs: "criterionScores",
    lt: "learningTargetId",
    cr: "criterionRef",
    sc: "score",
    ra: "rationale",
  });
}

export function expandSocraticCompact(value: unknown): unknown {
  return mapObjectKeys(value, {
    q: "question",
    et: "errorType",
    dn: "done",
  });
}

export function expandDrillsCompact(value: unknown): unknown {
  return mapObjectKeys(value, quizKeys);
}

const flashcardDeckKeys: Record<string, string> = {
  cs: "cards",
  fr: "front",
  bk: "back",
  lti: "learningTargetIds",
  an: "anchor",
  sc: "scope",
  bi: "blockIndex",
  tai: "takeawayIndex",
  bky: "blockKey",
  bt: "blockType",
  sp: "subPath",
  ex: "sourceExcerpt",
  tg: "tags",
};

export function expandFlashcardDeckCompact(value: unknown): unknown {
  return mapObjectKeys(value, flashcardDeckKeys);
}

export function compactSqJsonArg(value: unknown): string {
  return JSON.stringify(value);
}

export function compactMaterialJsonArg(value: unknown): string {
  return JSON.stringify(value);
}

export function compactLearningMaterialForPrompt(
  material: LearningMaterialContent,
): string {
  return JSON.stringify(material);
}
