// @ts-nocheck -- unbound compatibility implementation; hosted callers use repositories.
import type { PersistenceClient } from "../persistence/persistence-compat.js";
import { parseJson } from "../utils.js";
import type { QuizGradeSnapshot } from "../graph/review-mode.js";
import type { QuizQuestion } from "../llm/schemas.js";
import type { QuizBatchPlannerInput } from "./batch-planner.js";
import type { QuizSessionRepository } from "../../../domain/src/index.js";

export type QuizSetTypeCounts = {
  mcq: number;
  mcq_multi: number;
  true_false: number;
};

export type QuizSetSummary = {
  id: string;
  createdAt: string;
  questionCount: number;
  typeCounts: QuizSetTypeCounts;
  preview: string;
  attemptCount: number;
  bestScore: number | null;
  latestScore: number | null;
  latestAttemptAt: string | null;
};

export type QuizAttemptRecord = {
  id: string;
  quizSetId: string | null;
  score: number;
  weakTags: string[];
  answers: Record<string, string | number | boolean | number[]>;
  results: QuizGradeSnapshot[];
  explanations: Record<number, string>;
  createdAt: string;
};

export type QuizExplanationsByIndex = Record<number, string>;

export function parseQuizExplanations(raw: string): QuizExplanationsByIndex {
  const parsed = parseJson<Record<string, string>>(raw, {});
  const out: QuizExplanationsByIndex = {};
  for (const [key, value] of Object.entries(parsed)) {
    const index = Number(key);
    if (Number.isInteger(index) && typeof value === "string" && value.trim()) {
      out[index] = value;
    }
  }
  return out;
}

function serializeQuizExplanations(
  explanations: QuizExplanationsByIndex,
): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(explanations).map(([key, value]) => [String(key), value]),
    ),
  );
}

export type QuizSetDetail = QuizSetSummary & {
  questions: QuizQuestion[];
  interleaved: QuizQuestion[];
  attempts: QuizAttemptRecord[];
};

function countQuestionTypes(questions: readonly QuizQuestion[]): QuizSetTypeCounts {
  const counts: QuizSetTypeCounts = {
    mcq: 0,
    mcq_multi: 0,
    true_false: 0,
  };
  for (const question of questions) {
    if (question.type === "mcq") counts.mcq += 1;
    else if (question.type === "mcq_multi") counts.mcq_multi += 1;
    else if (question.type === "true_false") counts.true_false += 1;
  }
  return counts;
}

function parseStoredQuiz(raw: string): {
  questions: QuizQuestion[];
  interleaved: QuizQuestion[];
} {
  const parsed = parseJson<unknown>(raw, []);
  if (Array.isArray(parsed)) {
    return { questions: parsed, interleaved: [] };
  }
  if (parsed && typeof parsed === "object") {
    const row = parsed as {
      questions?: unknown;
      interleaved?: unknown;
    };
    return {
      questions: parseJson<QuizQuestion[]>(
        JSON.stringify(row.questions ?? []),
        [],
      ),
      interleaved: parseJson<QuizQuestion[]>(
        JSON.stringify(row.interleaved ?? []),
        [],
      ),
    };
  }
  return { questions: [], interleaved: [] };
}

function questionPreview(quiz: {
  questions: QuizQuestion[];
  interleaved: QuizQuestion[];
}): string {
  const all = [...quiz.questions, ...quiz.interleaved];
  const first = all[0];
  if (!first) return "（无题目）";
  const text = first.question.replace(/\s+/g, " ").trim();
  return text.length > 72 ? `${text.slice(0, 72)}…` : text;
}

function serializeAttempt(row: {
  id: string;
  quizSetId: string | null;
  score: number;
  weakTags: string;
  answers: string;
  results: string;
  explanations: string;
  createdAt: Date;
}): QuizAttemptRecord {
  return {
    id: row.id,
    quizSetId: row.quizSetId,
    score: row.score,
    weakTags: parseJson<string[]>(row.weakTags, []),
    answers: parseJson<Record<string, string | number | boolean | number[]>>(
      row.answers,
      {},
    ),
    results: parseJson<QuizGradeSnapshot[]>(row.results, []),
    explanations: parseQuizExplanations(row.explanations ?? "{}"),
    createdAt: row.createdAt.toISOString(),
  };
}

function summarizeSet(
  row: { id: string; questions: string; createdAt: Date },
  attempts: Array<{ score: number; createdAt: Date }>,
): QuizSetSummary {
  const questions = parseStoredQuiz(row.questions);
  const allQuestions = [...questions.questions, ...questions.interleaved];
  const sortedAttempts = [...attempts].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
  const bestScore =
    attempts.length > 0
      ? Math.max(...attempts.map((attempt) => attempt.score))
      : null;
  const latest = sortedAttempts[0];

  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    questionCount: allQuestions.length,
    typeCounts: countQuestionTypes(allQuestions),
    preview: questionPreview(questions),
    attemptCount: attempts.length,
    bestScore,
    latestScore: latest?.score ?? null,
    latestAttemptAt: latest?.createdAt.toISOString() ?? null,
  };
}

export async function createQuizSet(
  unitId: string,
  quiz: { questions: QuizQuestion[]; interleaved?: QuizQuestion[] },
  persistence: PersistenceClient,
  purpose: "learning" | "diagnostic" | "review" = "learning",
) {
  return persistence.quizSet.create({
    data: {
      unitId,
      questions: JSON.stringify({
        questions: quiz.questions,
        interleaved: quiz.interleaved ?? [],
      }),
      purpose,
    },
  });
}

export async function listQuizSets(
  unitId: string,
  persistence: PersistenceClient,
): Promise<QuizSetSummary[]> {
  const rows = await persistence.quizSet.findMany({
    where: { unitId },
    orderBy: { createdAt: "desc" },
    include: {
      attempts: {
        select: { score: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  return rows.map((row) => summarizeSet(row, row.attempts));
}

export async function getQuizSetDetail(
  unitId: string,
  quizSetId: string,
  persistence?: PersistenceClient,
  repository?: QuizSessionRepository,
  userId?: string,
): Promise<QuizSetDetail | null> {
  if (repository && userId) {
    const row = await repository.findQuizSetDetail({ userId, unitId, quizSetId });
    if (!row) return null;
    const quiz = parseStoredQuiz(row.questionsJson);
    const attempts = row.attempts.map((attempt) =>
      serializeAttempt({
        id: attempt.id,
        quizSetId: attempt.quizSetId,
        score: attempt.score,
        weakTags: attempt.weakTagsJson,
        answers: attempt.answersJson,
        results: attempt.resultsJson,
        explanations: attempt.explanationsJson,
        createdAt: attempt.createdAt,
      }),
    );
    return {
      ...summarizeSet(
        { id: row.id, questions: row.questionsJson, createdAt: row.createdAt },
        attempts.map((attempt) => ({
          score: attempt.score,
          createdAt: new Date(attempt.createdAt),
        })),
      ),
      ...quiz,
      attempts,
    };
  }
  const row = await persistence!.quizSet.findFirst({
    where: { id: quizSetId, unitId },
    include: {
      attempts: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!row) return null;

  return {
    ...summarizeSet(row, row.attempts),
    ...parseStoredQuiz(row.questions),
    attempts: row.attempts.map(serializeAttempt),
  };
}

export async function createQuizAttempt(
  input: {
    unitId: string;
    quizSetId: string;
    questions: QuizQuestion[];
    answers: Record<string, string | number | boolean | number[]>;
    results: QuizGradeSnapshot[];
    score: number;
    weakTags: string[];
    perLearningTargetResults?: unknown[];
    purpose?: "learning" | "diagnostic" | "review";
    passed?: boolean;
  },
  persistence: PersistenceClient,
) {
  return persistence.quizAttempt.create({
    data: {
      unitId: input.unitId,
      quizSetId: input.quizSetId,
      questions: JSON.stringify(input.questions),
      answers: JSON.stringify(input.answers),
      results: JSON.stringify(input.results),
      explanations: "{}",
      score: input.score,
      weakTags: JSON.stringify(input.weakTags),
      perLearningTargetResults: JSON.stringify(
        input.perLearningTargetResults ?? [],
      ),
      purpose: input.purpose ?? "learning",
      passed: input.passed,
    },
  });
}

export async function saveQuizAttemptExplanation(
  input: {
    unitId: string;
    attemptId: string;
    questionIndex: number;
    explanation: string;
  },
  persistence: PersistenceClient,
): Promise<QuizExplanationsByIndex> {
  const row = await persistence.quizAttempt.findFirst({
    where: { id: input.attemptId, unitId: input.unitId },
    select: { explanations: true },
  });
  if (!row) {
    throw new Error("作答记录不存在");
  }

  const merged = {
    ...parseQuizExplanations(row.explanations ?? "{}"),
    [input.questionIndex]: input.explanation,
  };

  await persistence.quizAttempt.update({
    where: { id: input.attemptId },
    data: { explanations: serializeQuizExplanations(merged) },
  });

  return merged;
}

export async function loadPriorUnitQuizQuestions(
  unitId: string,
  persistence: PersistenceClient,
): Promise<NonNullable<QuizBatchPlannerInput["priorQuestions"]>> {
  const rows = await persistence.quizSet.findMany({
    where: { unitId, purpose: "learning" },
    orderBy: { createdAt: "asc" },
    select: { questions: true },
  });
  const out: Array<
    NonNullable<QuizBatchPlannerInput["priorQuestions"]>[number]
  > = [];
  for (const row of rows) {
    const parsed = parseStoredQuiz(row.questions);
    for (const question of [...parsed.questions, ...parsed.interleaved]) {
      out.push({
        type: question.type,
        question: question.question,
        primaryLearningTargetId: question.primaryLearningTargetId,
        learningTargetIds: question.learningTargetIds,
        evidenceDimension: question.evidenceDimension,
        primaryCognitiveEntityId: question.primaryCognitiveEntityId,
        contextDistance: question.contextDistance,
      });
    }
  }
  return out;
}

export async function summarizeUnitRecallAttemptStats(
  unitId: string,
  persistence: PersistenceClient,
): Promise<{ completedBatches: number; totalAnswers: number }> {
  const rows = await persistence.quizSet.findMany({
    where: { unitId, purpose: "learning" },
    include: {
      attempts: {
        select: { questions: true },
      },
    },
  });
  let completedBatches = 0;
  let totalAnswers = 0;
  for (const row of rows) {
    if (row.attempts.length === 0) continue;
    completedBatches += 1;
    for (const attempt of row.attempts) {
      const questions = parseJson<QuizQuestion[]>(attempt.questions, []);
      totalAnswers += questions.length;
    }
  }
  return { completedBatches, totalAnswers };
}
