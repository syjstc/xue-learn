import {
  getLanguagePromptInstruction,
  resolveGoalContentLanguage,
} from "../llm/content-language.js";
import {
  streamChat,
  type StreamTokenHandler,
} from "../llm/chat-stream.js";
import { stripThinkingTags } from "../llm/sanitize-response.js";
import type { QuizQuestion } from "../llm/schemas.js";
import { retrieveContextForUnit } from "../rag/retrieve.js";
import type { QuizGradeItem } from "./unit-session.js";
import { prepareQuizQuestionExplanation } from "../quiz/explanation.js";
import { reviewPersistence } from "../learning-systems/capabilities/support/runtime.js";

export type QuizQuestionExplanation = {
  questionIndex: number;
  explanation: string;
};

const RAG_K = 3;

async function loadUnitNotesContext(
  userId: string,
  unitId: string,
): Promise<string | undefined> {
  const cornell = await reviewPersistence().findUnitNotes(userId, unitId);
  if (!cornell) return undefined;

  const parts: string[] = [];
  if (cornell.summary.trim()) {
    parts.push(
      `Summary: ${cornell.summary.replace(/\s+/g, " ").trim().slice(0, 220)}`,
    );
  }
  if (cornell.cues.trim()) {
    parts.push(
      `Recall cues: ${cornell.cues.replace(/\s+/g, " ").trim().slice(0, 360)}`,
    );
  }
  if (cornell.notes.trim()) {
    parts.push(
      `Notes: ${cornell.notes.replace(/\s+/g, " ").trim().slice(0, 360)}`,
    );
  }

  return parts.length > 0 ? parts.join("\n") : undefined;
}

async function loadRagContext(
  goalId: string,
  unitTitle: string,
  item: {
    question: QuizQuestion;
    userAnswerLabel: string;
    correctAnswerLabel?: string | null;
  },
): Promise<string | undefined> {
  const query = [
    item.question.question,
    item.userAnswerLabel,
    item.correctAnswerLabel,
  ]
    .filter(Boolean)
    .join(" ");
  const context = await retrieveContextForUnit(goalId, unitTitle, query, RAG_K);
  return context.trim() || undefined;
}

/** One LLM call with compact notes + RAG fetched in parallel beforehand. */
export async function streamExplainQuizQuestion(params: {
  userId: string;
  goalId: string;
  unitId: string;
  unitTitle: string;
  contentLanguage?: string | null;
  questions: QuizQuestion[];
  results: QuizGradeItem[];
  questionIndex: number;
  onToken?: StreamTokenHandler;
  signal?: AbortSignal;
}): Promise<QuizQuestionExplanation> {
  const result = params.results.find(
    (row) => row.index === params.questionIndex,
  );
  const question = params.questions[params.questionIndex];
  if (!result || !question) throw new Error("该题无需解析或题目不存在");
  const item = { ...result, question };
  const [notesContext, ragContext] = await Promise.all([
    loadUnitNotesContext(params.userId, params.unitId),
    loadRagContext(params.goalId, params.unitTitle, item),
  ]);

  const lang = getLanguagePromptInstruction(
    resolveGoalContentLanguage(params.contentLanguage, params.unitTitle),
  );

  const prepared = prepareQuizQuestionExplanation({
    unitTitle: params.unitTitle,
    languageInstruction: lang,
    questions: params.questions,
    results: params.results,
    questionIndex: params.questionIndex,
    notesContext,
    referenceContext: ragContext,
  });
  const raw = await streamChat(prepared.prompt, {
    operation: "unit.quiz_explain",
    meta: {
      goalId: params.goalId,
      unitId: params.unitId,
      unitTitle: params.unitTitle,
      questionIndex: params.questionIndex,
      hasNotes: Boolean(notesContext),
      hasRag: Boolean(ragContext),
    },
    onToken: params.onToken,
    signal: params.signal,
    contextSubject: {
      goalId: params.goalId,
      unitId: params.unitId,
    },
    contextQuery: `${params.unitTitle}: ${item.question.question}`,
    contextInvocation: prepared.contextInvocation,
  });

  return {
    questionIndex: params.questionIndex,
    explanation: stripThinkingTags(raw).trim(),
  };
}
