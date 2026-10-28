import type { QuizQuestion } from "./authoring.js";
import type { QuizGradeItem } from "../graph/grade-quiz.js";
import { buildTeachingDialogueInvocationPrompt } from "../learning-systems/capabilities/teaching-dialogue/capability.js";
import { TEACHING_DIALOGUE_VIEW_KEYS } from "../learning-systems/capabilities/teaching-dialogue/keys.js";

export type QuizQuestionExplanationInput = {
  unitTitle: string;
  languageInstruction?: string;
  questions: readonly QuizQuestion[];
  results: readonly QuizGradeItem[];
  questionIndex: number;
  notesContext?: string;
  referenceContext?: string;
};

export type PreparedQuizQuestionExplanation = {
  operation: "unit.quiz_explain";
  questionIndex: number;
  prompt: string;
  contextInvocation: Record<string, unknown>;
};

type ExplainQuizItem = QuizGradeItem & { question: QuizQuestion };

function truncateText(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}…`;
}

function resolveExplainItem(
  questions: readonly QuizQuestion[],
  results: readonly QuizGradeItem[],
  questionIndex: number,
): ExplainQuizItem | null {
  const result = results.find((row) => row.index === questionIndex);
  const question = questions[questionIndex];
  if (!result || !question) return null;
  return { ...result, question };
}

function correctAnswerLabel(question: QuizQuestion): string {
  if (question.type === "true_false") {
    return question.correctAnswer ? "true" : "false";
  }
  if (question.type === "mcq") {
    return question.options[question.correctIndex] ?? "(missing)";
  }
  return question.correctIndices
    .map((index) => question.options[index] ?? `option ${index + 1}`)
    .join(" | ");
}

function formatQuizQuestionBlock(item: ExplainQuizItem): string {
  const statusLabel =
    item.status === "correct"
      ? "correct"
      : item.status === "partial"
        ? "partially correct"
        : "incorrect";
  const options =
    item.question.type === "true_false"
      ? ["true", "false"]
      : item.question.options;
  const lines = [
    `(${statusLabel}) ${item.question.question}`,
    `Options: ${options.join(" | ")}`,
    `Learner answer: ${item.userAnswerLabel}`,
  ];
  lines.push(
    `Correct answer: ${item.correctAnswerLabel ?? correctAnswerLabel(item.question)}`,
  );
  return lines.join("\n");
}

function referenceBlock(
  notesContext?: string,
  referenceContext?: string,
): string {
  const parts: string[] = [];
  if (notesContext?.trim()) {
    parts.push(`[Unit notes]\n${truncateText(notesContext, 720)}`);
  }
  if (referenceContext?.trim()) {
    parts.push(`[Reference material]\n${truncateText(referenceContext, 1200)}`);
  }
  return parts.length
    ? `\n\n${parts.join("\n\n")}\n\nGround your explanation in the reference above when helpful.`
    : "";
}

/**
 * Shared, persistence-free preparation for the hosted and local quiz
 * explanation operation. The caller owns notes/RAG loading and transport.
 */
export function prepareQuizQuestionExplanation(
  input: QuizQuestionExplanationInput,
): PreparedQuizQuestionExplanation {
  const item = resolveExplainItem(
    input.questions,
    input.results,
    input.questionIndex,
  );
  if (!item) throw new Error("题目不存在或尚未批改");

  const contextInvocation = {
    unitTitle: input.unitTitle,
    languageInstruction: input.languageInstruction ?? "",
    questionBlock: formatQuizQuestionBlock(item),
    referenceBlock: referenceBlock(input.notesContext, input.referenceContext),
  } satisfies Record<string, unknown>;
  const prompt = buildTeachingDialogueInvocationPrompt(
    TEACHING_DIALOGUE_VIEW_KEYS.quizExplainInstructionContext,
    contextInvocation,
  );
  if (!prompt) throw new Error("Quiz explanation prompt is unavailable");
  return {
    operation: "unit.quiz_explain",
    questionIndex: input.questionIndex,
    prompt,
    contextInvocation,
  };
}
