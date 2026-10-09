import type { LearningMaterialContent } from "../../../llm/schemas.js";

const ABSOLUTE_MAX_CARDS = 15;

export type FlashcardTarget = {
  min: number;
  max: number;
};

/** Card budget from unit content — not session duration. */
export function flashcardTargetCountFromMaterial(
  material: LearningMaterialContent,
): FlashcardTarget {
  const sections = material.blocks.filter(
    (b) => b.type === "heading" && b.level === 2,
  ).length;
  const checks = material.blocks.filter((b) => b.type === "check").length;

  const spine = Math.max(sections || 3, 3);
  const practice = Math.min(3, checks);
  const max = Math.min(ABSOLUTE_MAX_CARDS, Math.max(4, spine + practice));
  const min = Math.max(3, Math.min(max, spine));

  return { min, max };
}

/** Turn material flip-card fronts into contextual recall questions. */
export function toRecallQuestion(front: string, unitTitle: string): string {
  const text = front.trim();
  if (!text) return text;
  if (/[?？]$/.test(text)) return text;
  if (/^(什么|如何|为什么|怎样|哪些|哪个|是否|请|根据|在.+中)/.test(text)) {
    return text.endsWith("?") || text.endsWith("？") ? text : `${text}？`;
  }
  if (text.length <= 48 && !/\s{2,}/.test(text)) {
    return `在学习「${unitTitle}」时，「${text}」指的是什么？`;
  }
  return `请回忆：${text}？`;
}

// Private flashcard prompt source owned by unit-content capability.
export function buildFlashcardGenerationPrompt(
  unitTitle: string,
  materialJson: string,
  extras: {
    lang: string;
    style?: string;
    cornellCues?: string;
    learningTargetsBlock?: string;
  },
  target: FlashcardTarget,
): string {
  const countLine =
    target.min === target.max
      ? `Generate exactly ${target.max} card${target.max === 1 ? "" : "s"}.`
      : `Generate ${target.min}–${target.max} cards.`;

  const styleBlock = extras.style ? `${extras.style}\n` : "";
  const cornellBlock = extras.cornellCues
    ? `Cornell cues (optional recall prompts):\n${extras.cornellCues}\n`
    : "";
  const learningTargetsBlock = extras.learningTargetsBlock
    ? `Learning-target competency definitions (source of truth):\n${extras.learningTargetsBlock}\n`
    : "";

  return `Generate spaced-repetition flashcards for unit "${unitTitle}".

CRITICAL — learning-target grounding:
- Every card MUST test one listed learning target and include exactly one matching id in "learningTargetIds".
- Follow each learning target's server-calculated "Flashcards" allocation. The allocation is already prioritized and bounded for this deck.
- Do not leave a core or supporting point uncovered. Enrichment cards are optional.
- Ask about the durable competency, not exact course wording or slide order.
- A lesson anchor is optional. When the course contains a useful supporting passage, point to it with:
  - scope "introduction" for intro facts
  - scope "block" with blockIndex (0-based), blockType, blockKey optional, subPath "text" or "body"
- sourceExcerpt is optional and should only be present when it helps locate a lesson reference.

Card design (quality bar):
- "front" MUST be a complete recall question with enough context that the learner knows what to answer without seeing the back.
  - Good: "In this unit, what is the mitochondrion's main role in cellular respiration?"
  - Bad: "mitochondria" or "cellular respiration" (bare terms with no question frame)
- Questions should reference the unit topic when helpful; prefer complete frames such as "why", "how", "what", or "what is the difference" over single-word cues.
- "back": concise answer grounded in the material (1–3 sentences or a short list).
- ${countLine}
- Cover distinct sections and important checks; skip trivia and duplicates.
- Prefer important definitions, steps, contrasts, and causal links.

${extras.lang}
${styleBlock}${learningTargetsBlock}${cornellBlock}Optional learning material reference (Compact JSON):
${materialJson}`;
}
