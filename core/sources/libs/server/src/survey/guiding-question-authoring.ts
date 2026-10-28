import {
  buildSqQuestionAnswersPrompt,
  SQ_ANSWERS_STABLE_INSTRUCTION,
} from "../learning-systems/capabilities/unit-content/capability.js";
import { sqQuestionAnswersSchema } from "../llm/schemas.js";

export type PrepareGuidingQuestionAuthoringInput = {
  unitTitle: string;
  questions: readonly string[];
  materialJson: string;
  goalBlock: string;
  languageBlock: string;
  styleBlock: string;
  optionsBlock?: string;
};

function parseJson(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced?.[1] ?? trimmed) as unknown;
}

/** Portable prepared contract for grounded SQ guiding-question answers. */
export function prepareGuidingQuestionAuthoring(
  input: PrepareGuidingQuestionAuthoringInput,
) {
  const questions = input.questions
    .map((question) => question.trim())
    .filter(Boolean);
  if (questions.length < 1 || questions.length > 8) {
    throw new Error("Guiding-question authoring requires 1-8 questions");
  }
  const contextInvocation = {
    unitTitle: input.unitTitle,
    goalBlock: input.goalBlock,
    languageBlock: input.languageBlock,
    styleBlock: input.styleBlock,
    optionsBlock: input.optionsBlock ?? "",
    numberedQuestions: questions
      .map((question, index) => `${index + 1}. ${question}`)
      .join("\n"),
    materialJson: input.materialJson,
    answerCount: questions.length,
  };
  const parseResult = (value: unknown) =>
    sqQuestionAnswersSchema.parse(value).answers.slice(0, questions.length);
  return {
    operation: "unit.sq_question_answers" as const,
    prompt: buildSqQuestionAnswersPrompt(contextInvocation),
    standalonePrompt: `${SQ_ANSWERS_STABLE_INSTRUCTION}\n\n${buildSqQuestionAnswersPrompt(contextInvocation)}`,
    contextInvocation,
    schema: sqQuestionAnswersSchema,
    answerCount: questions.length,
    parseResult,
    parseProviderOutput: (content: string) => parseResult(parseJson(content)),
  };
}
