import { parseJson } from "../utils.js";
import type { z } from "zod";
import type { feynmanFeedbackSchema } from "../llm/schemas.js";

import { FEATURE_FEYNMAN } from "../features.js";
import type { SocraticThread } from "./socratic-threads.js";

export type ReviewPracticeStep = "active_recall" | "feynman" | "socratic";

export type FeynmanFeedbackSnapshot = z.infer<typeof feynmanFeedbackSchema>;

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
    weakLearningTargetIds?: string[];
    quizResults?: QuizGradeSnapshot[];
    feynmanFeedback?: FeynmanFeedbackSnapshot;
    socraticQuestion?: string;
    socraticThreads?: SocraticThread[];
    activeSocraticThreadId?: string;
    drills?: unknown;
    materialPresentation?: {
      slideIndex: number;
      hasCompletedSlides: boolean;
      sectionSteps?: Record<string, number>;
      sectionCursors?: Record<
        string,
        { contentRevision: number; cursor: number }
      >;
    };
    lastActivityAt?: string;
    learningTime?: {
      totalActiveSeconds: number;
      lastTickAt?: string;
      byTab?: Record<string, number>;
    };
    sqQuestionAnswers?: string[];
    materialDslText?: string;
    materialDslParseError?: string;
    materialSourceItems?: unknown[];
  }>(raw, {});
}

export function graphStateWithoutReviewMode(
  state: ReturnType<typeof parseSessionGraphState>,
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

export type SessionNavStep =
  ReviewPracticeStep | "structured_input" | "complete";

export function isSessionNavStep(step: string): step is SessionNavStep {
  return (
    step === "structured_input" ||
    step === "complete" ||
    isReviewPracticeStep(step)
  );
}
