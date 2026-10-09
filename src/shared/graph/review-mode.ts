import { parseJson } from "@xue-learn/core/utils";

import { FEATURE_FEYNMAN } from "@xue-learn/core/features";
import type { SocraticThread } from "./socratic-threads.ts";

export type ReviewPracticeStep = "active_recall" | "feynman" | "socratic";

export type FeynmanFeedbackSnapshot = {
  passed: boolean;
  strengths: string[];
  blindSpots: string[];
  suggestions: string[];
  plainLanguagePrompt?: string;
};

export type QuizGradeSnapshot = {
  index: number;
  status: "correct" | "partial" | "incorrect";
  userAnswerLabel: string;
  correctAnswerLabel?: string;
  rubric?: string;
};

export const REVIEW_PRACTICE_STEPS: ReviewPracticeStep[] = [
  "active_recall",
  ...(FEATURE_FEYNMAN ? (["feynman"] as const) : []),
  "socratic",
];

export function parseSessionGraphState(raw: string) {
  return parseJson<{
    reviewMode?: boolean;
    quiz?: unknown;
    quizSetId?: string;
    quizAttemptId?: string;
    score?: number;
    weakTags?: string[];
    quizResults?: QuizGradeSnapshot[];
    feynmanFeedback?: FeynmanFeedbackSnapshot;
    socraticQuestion?: string;
    socraticThreads?: SocraticThread[];
    activeSocraticThreadId?: string;
    drills?: unknown;
    materialPresentation?: {
      slideIndex: number;
      hasCompletedSlides: boolean;
    };
    lastActivityAt?: string;
    learningTime?: {
      totalActiveSeconds: number;
      lastTickAt?: string;
      byTab?: Record<string, number>;
    };
    sqQuestionAnswers?: string[];
  }>(raw, {});
}

export function graphStateWithoutReviewMode(
  state: ReturnType<typeof parseSessionGraphState>
) {
  const { reviewMode: _reviewMode, ...rest } = state;
  return rest;
}

export function graphStateWithoutMaterialPresentation(
  state: ReturnType<typeof parseSessionGraphState>,
) {
  const { materialPresentation: _materialPresentation, ...rest } = state;
  return rest;
}

export function isReviewPracticeStep(step: string): step is ReviewPracticeStep {
  return REVIEW_PRACTICE_STEPS.includes(step as ReviewPracticeStep);
}

export type SessionNavStep = ReviewPracticeStep | "structured_input" | "complete";

export function isSessionNavStep(step: string): step is SessionNavStep {
  return (
    step === "structured_input" ||
    step === "complete" ||
    isReviewPracticeStep(step)
  );
}
