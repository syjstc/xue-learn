import type { InteractiveBlock } from "@xue-learn/core/source/src/shared/llm/schemas.ts";

export type IllustrationRegenHandlers = {
  unitId: string;
  /** Unit-global index used by section-backed material persistence. */
  blockOffset?: number;
  /** Figure within the parent stage block, when regenerating a nested image. */
  figureIndex?: number;
  parentBlockIndex?: number;
  onBlockRegenerated?: (blockIndex: number, block: InteractiveBlock) => void;
  /** Desktop-dev editing surface: remove one persisted block by local index. */
  onBlockDeleted?: (blockIndex: number) => void;
  onIllustrationRegenerated?: (
    blockIndex: number,
    patch: { imageUrl: string; imageId: string },
    figureIndex?: number,
  ) => void;
};

export type MaterialCheckQuestionType = "mcq" | "mcq_multi" | "true_false";

export type VerifiedMaterialAnswer = {
  blockIndex: number;
  checkId?: string;
  itemIndex?: number;
  answer: number | number[] | boolean;
};

export type MaterialCheckResult = {
  checkId: string;
  blockIndex: number;
  itemIndex?: number;
  selectedAnswer: number | number[] | boolean;
  correct: boolean;
  outcome?: "correct" | "partial" | "incorrect";
  score?: number;
  questionType?: MaterialCheckQuestionType;
  explanation?: string;
  submittedAt: string;
  firstSubmission: boolean;
};

export type VerifiedMaterialAnswerHandler = (
  answer: VerifiedMaterialAnswer,
) =>
  | void
  | MaterialCheckResult
  | null
  | Promise<void | MaterialCheckResult | null>;

export const BLOCK_ICON_CLASS = "size-3.5 shrink-0 opacity-90";
