import type { PostQuizStep } from "@xue-learn/core/source/src/shared/features.ts";

export type QuizSetTypeCounts = {
  mcq: number;
  mcq_multi: number;
  true_false: number;
};

export type QuizSetSummary = {
  id: string;
  createdAt: string;
  questionCount: number;
  preview: string;
  attemptCount: number;
  bestScore: number | null;
  latestScore: number | null;
  latestAttemptAt: string | null;
  typeCounts?: QuizSetTypeCounts;
};

export type QuizGradeItem = {
  index: number;
  status: "correct" | "partial" | "incorrect";
  userAnswerLabel: string;
  correctAnswerLabel?: string;
  rubric?: string;
};

export type QuizGradeSummary = {
  score: number;
  weakTags: string[];
  results: QuizGradeItem[];
  nextStep?: PostQuizStep;
};

export type QuizQuestionExplanation = {
  questionIndex: number;
  explanation: string;
};

export type RecallProgress = {
  completedBatches: number;
  totalAnswers: number;
  recommendation: "continue_now" | "review_later";
  targets?: Array<{
    learningTargetId: string;
    localRef: string;
    title: string;
    evidenceSufficiency: number;
    cognitiveStatus?: string;
  }>;
};

export type ActiveQuizState = {
  quizSetId: string | null;
  quizAttemptId?: string | null;
  questions: Array<{
    type: "mcq" | "mcq_multi" | "true_false";
    question: string;
    options?: string[];
    correctIndex?: number;
    correctIndices?: number[];
    correctAnswer?: boolean;
  }>;
  interleaved?: ActiveQuizState["questions"];
  quizGrade: QuizGradeSummary | null;
  quizExplanations?: Record<number, string>;
};
