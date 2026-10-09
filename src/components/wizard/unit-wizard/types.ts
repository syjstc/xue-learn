import type { PostQuizStep } from "@xue-learn/core/source/src/shared/features.ts";
import type {
  LearningMaterialContent,
  SqPreview,
} from "@xue-learn/core/source/src/shared/llm/schemas.ts";
import type { QuizGradeSummary } from "@/shared/domain/quiz-sets";
import type { LearningAccess } from "@/shared/domain/learning-access";
import type { UnitSectionManifest } from "@/shared/api";

export type Step =
  | "structured_input"
  | "active_recall"
  | "feynman"
  | "socratic"
  | "complete";

export type StructuredSubStep =
  | "sq"
  | "material"
  | "theater"
  | "questions"
  | "cornell"
  | "done";

export type StructuredTab = "sq" | "material" | "map" | "questions" | "notes";

export type GenStreamContext =
  | "sq"
  | "material"
  | "notes"
  | "quiz"
  | "flashcards"
  | "feynman"
  | "socratic"
  | "theater"
  | "lab";

export type ContextGenState = {
  status: string;
  phase?: string;
  preview: string;
  progress: { current: number; total: number } | null;
  materialContentReady: boolean;
  partialCount: number;
  placeholderBlockCount: number;
  knowledgeActivity?: import("@xue-learn/core/source/libs/domain/src/index.ts").KnowledgeActivity;
};

export interface QuizQ {
  type: "mcq" | "mcq_multi" | "true_false";
  question: string;
  options?: string[];
  correctIndex?: number;
  correctIndices?: number[];
  correctAnswer?: boolean;
}

export type QuizAnswerValue = string | number | boolean | number[];

export type QuizGradeItem = {
  index: number;
  status: "correct" | "partial" | "incorrect";
  userAnswerLabel: string;
  correctAnswerLabel?: string;
  rubric?: string;
};

export type QuizGradeView = QuizGradeSummary & {
  nextStep: PostQuizStep;
};

export type QuizExplainItemState = {
  text: string;
  loading: boolean;
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

/** Loosely-typed session action result; fields depend on the action. */
export type SessionActionResponse = Record<string, unknown> & {
  sq?: SqPreview;
  material?: LearningMaterialContent;
  cornell?: { notes: string; cues: string; summary: string };
  questions?: QuizQ[];
  recallProgress?: RecallProgress;
  feedback?: Record<string, unknown>;
  question?: string;
};

export type UnitWizardProps = {
  unitId: string;
  goalId: string;
  unitTitle: string;
  domainTag: string;
  initialStep: string;
  unitKind?: string;
  startNewQuiz?: boolean;
  instantMicro?: boolean;
  instantRunId?: string;
  reviewMode?: boolean;
  onReviewScoreChange?: (score: number | null) => void;
  onReviewReadyChange?: (ready: boolean) => void;
  onLearningAccessChange?: (access: LearningAccess | null) => void;
  onCurrentStepChange?: (step: string) => void;
  sections?: UnitSectionManifest[];
  initialSectionId?: string | null;
  initialSectionAnchor?: string | null;
  presentationMode?: "chat" | "reading";
};
