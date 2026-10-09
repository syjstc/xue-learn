/**
 * Frontend content types — sourced from contracts (run `pnpm run codegen`).
 */
export type {
  SqPreview,
  LearningMaterial,
  GoalMapPlan,
  CornellNotes,
  Quiz,
  LearningGoal,
} from "../api/generated/index.js";

export type { InteractiveBlock } from "../api/generated/learning-material.js";
export type { QuizQuestion } from "../api/generated/quiz.js";

export type { LearningMaterial as LearningMaterialContent } from "../api/generated/index.js";

export const MAX_TOP_LEVEL_UNITS = 12;
export const MIN_TOP_LEVEL_UNITS = 1;

export type PresentationPhase =
  | "question"
  | "think"
  | "principle"
  | "example"
  | "check"
  | "transition"
  | "summary";

export type LearningMode =
  | "skill_practice"
  | "conceptual_understanding"
  | "research_scholarship"
  | "professional_applied"
  | "creative_expression"
  | "mixed";
