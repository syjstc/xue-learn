import { defineLearningSystemCapability } from "../../define-capability.js";
import type { ContextEnvelope, SystemViewRequest } from "../../types.js";
import {
  buildCourseMaterialJsonPrompt,
  COURSE_MATERIAL_STABLE_INSTRUCTION,
} from "./material-prompt.js";
import {
  buildSqPreviewJsonPrompt,
  SQ_PREVIEW_STABLE_INSTRUCTION,
} from "./sq-prompt.js";
import {
  buildSectionPlanJsonPrompt,
  SECTION_PLAN_STABLE_INSTRUCTION,
} from "../../../survey/section-plan.js";
import { UNIT_CONTENT_VIEW_KEYS } from "./keys.js";
import { buildCornellJsonPrompt } from "./cornell-prompt.js";
import { buildFlashcardGenerationPrompt } from "./flashcard-prompt.js";
import { buildKeyPointsStandalonePrompt } from "../../../key-points/authoring.js";

type SqPreviewInput = Parameters<typeof buildSqPreviewJsonPrompt>[0];
type SectionPlanInput = Parameters<typeof buildSectionPlanJsonPrompt>[0];
type MaterialInput = Parameters<typeof buildCourseMaterialJsonPrompt>[0];
type CornellInput = Parameters<typeof buildCornellJsonPrompt>[0];
type KeyPointsInput = Parameters<typeof buildKeyPointsStandalonePrompt>[0];
type FlashcardsInput = Parameters<typeof buildFlashcardGenerationPrompt>;
type SqAnswersInput = {
  unitTitle: string;
  goalBlock: string;
  languageBlock: string;
  styleBlock: string;
  optionsBlock?: string;
  numberedQuestions: string;
  materialJson: string;
  answerCount: number;
};

export function buildSqQuestionAnswersPrompt(input: SqAnswersInput): string {
  return `The learner finished reading the material for unit "${input.unitTitle}".
Write a SHORT reference answer for each guiding question below (2-4 sentences each).
Answers must be grounded in the learning material only — no outside knowledge.
Keep the same order as the questions; output exactly ${input.answerCount} answers.
${input.goalBlock}
${input.languageBlock}
${input.styleBlock}
${input.optionsBlock ? `\n${input.optionsBlock}\n` : ""}

Guiding questions:
${input.numberedQuestions}

Learning material (Compact JSON):
${input.materialJson}`;
}

export const SQ_ANSWERS_STABLE_INSTRUCTION =
  "Answer the unit's guiding questions only from the supplied published learning material, preserving the requested order and structured output contract. Write the answers in the active teaching persona's voice; if it specifies a roast cadence, keep that edge in these short answers without inventing material.";

const UNIT_CONTENT_OPERATION_INSTRUCTIONS = Object.freeze({
  [UNIT_CONTENT_VIEW_KEYS.authoringAgentInstructionContext]: `${SQ_PREVIEW_STABLE_INSTRUCTION}\n${SECTION_PLAN_STABLE_INSTRUCTION}\n${COURSE_MATERIAL_STABLE_INSTRUCTION}\nTreat Survey, its frozen section plan, and each on-demand section as one durable authoring task. Call only the server-requested commit tool for the current stage. Never rewrite an accepted earlier artifact. Tool results are authoritative. SVG/component intents are placeholders compiled asynchronously by server-owned child work; do not wait for their rendered result before continuing the section.`,
  [UNIT_CONTENT_VIEW_KEYS.sqPreviewInstructionContext]:
    SQ_PREVIEW_STABLE_INSTRUCTION,
  [UNIT_CONTENT_VIEW_KEYS.sectionPlanInstructionContext]:
    SECTION_PLAN_STABLE_INSTRUCTION,
  [UNIT_CONTENT_VIEW_KEYS.materialInstructionContext]:
    COURSE_MATERIAL_STABLE_INSTRUCTION,
  [UNIT_CONTENT_VIEW_KEYS.sqAnswersInstructionContext]:
    SQ_ANSWERS_STABLE_INSTRUCTION,
  [UNIT_CONTENT_VIEW_KEYS.cornellInstructionContext]:
    "Transform the supplied unit material into Cornell notes without adding unsupported knowledge; output only the requested structured items.",
  [UNIT_CONTENT_VIEW_KEYS.keyPointsInstructionContext]:
    "Author a short unit-level list of course key points from accepted topic titles: 1 or 2 one-sentence takeaways per content section, concatenated in section order. Do not rewrite teaching material.",
  [UNIT_CONTENT_VIEW_KEYS.flashcardsInstructionContext]:
    "Author grounded flashcards from the supplied unit material and immutable learning-target context; output only the requested structured items.",
});

export function buildUnitContentInvocationPrompt(
  key: string,
  invocation: unknown,
): string | null {
  if (key === UNIT_CONTENT_VIEW_KEYS.sqPreviewInstructionContext) {
    const input = invocation as SqPreviewInput | undefined;
    return input?.unitTitle ? buildSqPreviewJsonPrompt(input) : null;
  }
  if (key === UNIT_CONTENT_VIEW_KEYS.sectionPlanInstructionContext) {
    const input = invocation as SectionPlanInput | undefined;
    return input?.unitTitle ? buildSectionPlanJsonPrompt(input) : null;
  }
  if (key === UNIT_CONTENT_VIEW_KEYS.materialInstructionContext) {
    const input = invocation as MaterialInput | undefined;
    return input?.unitTitle ? buildCourseMaterialJsonPrompt(input) : null;
  }
  if (key === UNIT_CONTENT_VIEW_KEYS.sqAnswersInstructionContext) {
    const input = invocation as SqAnswersInput | undefined;
    if (!input?.unitTitle || !input.answerCount) return null;
    return buildSqQuestionAnswersPrompt(input);
  }
  if (key === UNIT_CONTENT_VIEW_KEYS.cornellInstructionContext) {
    const input = invocation as CornellInput | undefined;
    return input?.unitTitle ? buildCornellJsonPrompt(input) : null;
  }
  if (key === UNIT_CONTENT_VIEW_KEYS.keyPointsInstructionContext) {
    const input = invocation as KeyPointsInput | undefined;
    return input?.unitTitle ? buildKeyPointsStandalonePrompt(input) : null;
  }
  if (key === UNIT_CONTENT_VIEW_KEYS.flashcardsInstructionContext) {
    const input = invocation as FlashcardsInput | undefined;
    return input?.[0] ? buildFlashcardGenerationPrompt(...input) : null;
  }
  return null;
}

export function createUnitContentCapability() {
  const capabilityId = "unit-content";
  const version = "1.5.0";
  const envelope = (
    subject: SystemViewRequest["subject"],
    promptBlock: string,
  ): ContextEnvelope => ({
    ownerCapabilityId: capabilityId,
    ownerCapabilityVersion: version,
    schemaVersion: 1,
    authority: "server_policy",
    scope: { ...subject },
    freshness: { asOf: new Date(0).toISOString(), stale: false },
    data: { promptBlock },
  });
  return defineLearningSystemCapability({
    id: capabilityId,
    version,
    kind: "learning_system",
    views: {
      ...Object.fromEntries(
        Object.entries(UNIT_CONTENT_OPERATION_INSTRUCTIONS).map(
          ([key, instruction]) => [
            key,
            async ({ subject }: SystemViewRequest) =>
              envelope(subject, instruction),
          ],
        ),
      ),
    },
  });
}
