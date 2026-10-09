import type { FlashcardReviewScope, FsrsRating } from "../../../domain/src/index.js";
import type { MaterialAnchor } from "../domain/material-anchor.js";
import type { LearningMaterialContent } from "../llm/schemas.js";

export type { FlashcardReviewScope, FsrsRating };

export type FlashCardAnchor = MaterialAnchor;

export type FlashCardDto = {
  id: string;
  front: string;
  back: string;
  anchor: FlashCardAnchor;
  sourceExcerpt: string;
  origin: string;
  sortOrder: number;
  due: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  state: string;
  lastReview: string | null;
  cognitiveEntity: { id: string; title: string } | null;
  unit: {
    id: string;
    title: string;
    goal: { id: string; title: string };
  };
  deck: { id: string; cardCount: number };
};

export type FlashCardDeckDto = {
  id: string;
  unitId: string;
  cardCount: number;
  generatedAt: string;
  sourceHash: string;
  stale: boolean;
  stats: {
    due: number;
    new: number;
    learning: number;
    total: number;
  };
};

export type FlashCardDeckListItem = {
  deckId: string;
  unitId: string;
  unitTitle: string;
  goalId: string;
  goalTitle: string;
  dueCount: number;
  newCount: number;
  learningCount: number;
  reviewCount: number;
  totalCount: number;
  generatedAt: string;
  stale: boolean;
  lastReviewAt: string | null;
};

export type FlashCardSourcePayload = {
  label: string;
  excerpt: string;
  anchor: MaterialAnchor;
  material: LearningMaterialContent | null;
  unitTitle: string;
  highlightKey?: string;
  blockIndex?: number;
  stale: boolean;
};

export type FlashcardSessionStats = {
  reviewedCount: number;
  againCount: number;
  hardCount: number;
  goodCount: number;
  easyCount: number;
  weakTopics: string[];
  goalIds: string[];
  unitIds: string[];
};

export function parseReviewScope(
  scope?: string,
  goalId?: string,
  unitId?: string
): FlashcardReviewScope {
  if (scope === 'goal' && goalId) return { type: 'goal', goalId };
  if (scope === 'unit' && unitId) return { type: 'unit', unitId };
  return { type: 'all' };
}
