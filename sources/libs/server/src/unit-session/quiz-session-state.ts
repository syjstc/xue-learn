const QUIZ_OUTCOME_KEYS = [
  "score",
  "weakTags",
  "quizResults",
  "quizAttemptId",
  "socraticQuestion",
  "socraticThreads",
  "activeSocraticThreadId",
] as const;

type QuizOutcomeKey = (typeof QUIZ_OUTCOME_KEYS)[number];

/** A freshly generated quiz cannot inherit an earlier attempt or correction. */
export function clearQuizOutcomeState<T extends object>(
  state: T,
): Omit<T, QuizOutcomeKey> {
  const cleared = { ...state } as Record<string, unknown>;
  for (const key of QUIZ_OUTCOME_KEYS) delete cleared[key];
  return cleared as Omit<T, QuizOutcomeKey>;
}
