import type { CognitiveDimension } from "../module-objective-authority.js";
import type {
  VerifiedEvidenceContextDistance,
  VerifiedEvidenceStrength,
} from "./verified-evidence-append-port.js";

export type QuizSubmissionJsonObject = Readonly<Record<string, unknown>>;

export type QuizSubmissionTaskRequirement = Readonly<{
  learningTargetId: string;
  cognitiveEntityId: string;
  dimension: Extract<CognitiveDimension, "memory" | "understanding">;
  criterionRef: string;
  definitionVersion: number;
  required: boolean;
  weight: number;
  orderIndex: number;
  rubricCriterion: QuizSubmissionJsonObject;
}>;

export type QuizSubmissionTask = Readonly<{
  stableKey: string;
  taskType: "quiz" | "review";
  title: string;
  instructions: string;
  context: QuizSubmissionJsonObject;
  rubric: QuizSubmissionJsonObject;
  difficulty: string;
  definitionVersion: number;
  origin: "generated_quiz";
  evidencePolicy: Readonly<{
    source: "quiz" | "review_quiz";
    taskKind: "recall" | "explanation";
    contextKey: string;
    contextDistance: VerifiedEvidenceContextDistance;
    rubricId: string;
    assessmentFormat: "mcq" | "mcq_multi" | "true_false";
  }>;
  requirements: readonly QuizSubmissionTaskRequirement[];
}>;

export type QuizSubmissionItem = Readonly<{
  index: number;
  task: QuizSubmissionTask;
  idempotencyKey: string;
  response: QuizSubmissionJsonObject;
  score: number;
  outcome: string;
  evaluatorRunId: string;
  rawResult: QuizSubmissionJsonObject;
  evidenceStrength: VerifiedEvidenceStrength;
}>;

export type RecordQuizSubmissionInput = Readonly<{
  userId: string;
  goalId: string;
  unitId: string;
  quizSetId: string;
  activityAttemptId: string;
  questionsJson: string;
  answersJson: string;
  resultsJson: string;
  weakTagsJson: string;
  perLearningTargetResultsJson: string;
  score: number;
  purpose: "learning" | "review";
  passed?: boolean;
  nextGraphStateJson: string;
  nextStep: string;
  items: readonly QuizSubmissionItem[];
}>;

export type RecordQuizSubmissionResult = Readonly<{
  quizAttemptId: string;
  observationCount: number;
  skippedQuestionCount: number;
}>;

/**
 * Atomic persistence for one bounded active-recall submission. The reference
 * adapter owns the legacy quiz snapshot, immutable task declarations,
 * evaluated attempts, verified evidence/state replay, and session transition.
 */
export interface QuizSubmissionRepository {
  record(input: RecordQuizSubmissionInput): Promise<RecordQuizSubmissionResult>;
}
