import type { MaterialAnchor } from "@xue-learn/core/shared/domain/material-anchor";
import type { LearningMaterialContent } from "@xue-learn/core/schemas";
import {
  scheduleReview,
  type FlashCardFsrsState,
} from "@xue-learn/core/domain";

export type FsrsRating = "Again" | "Hard" | "Good" | "Easy";

export type FlashcardReviewScope =
  | { type: "all" }
  | { type: "goal"; goalId: string }
  | { type: "unit"; unitId: string };

export type FlashCardDto = {
  id: string;
  front: string;
  back: string;
  anchor: MaterialAnchor;
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

export const FLASHCARD_SCOPE_STORAGE_KEY = "flashcard-review-scope";

export function scopeToQuery(
  scope: FlashcardReviewScope,
): Record<string, string> {
  if (scope.type === "goal") {
    return { scope: "goal", goalId: scope.goalId };
  }
  if (scope.type === "unit") {
    return { scope: "unit", unitId: scope.unitId };
  }
  return { scope: "all" };
}

export function parseScopeFromQuery(
  scope?: string | null,
  goalId?: string | null,
  unitId?: string | null,
): FlashcardReviewScope {
  if (scope === "goal" && goalId) return { type: "goal", goalId };
  if (scope === "unit" && unitId) return { type: "unit", unitId };
  return { type: "all" };
}

function flashCardDtoToFsrsState(card: FlashCardDto): FlashCardFsrsState {
  return {
    due: new Date(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsedDays,
    scheduledDays: card.scheduledDays,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReview: card.lastReview ? new Date(card.lastReview) : null,
  };
}

export function previewFlashcardNextReview(
  card: FlashCardDto,
  rating: FsrsRating,
  now = new Date(),
): Date {
  return scheduleReview(flashCardDtoToFsrsState(card), rating, now).due;
}

export function formatFlashcardReviewInterval(
  due: Date,
  now = new Date(),
  locale = getCurrentUiLocale(),
): string {
  const format = (value: number, unit: string) =>
    new Intl.NumberFormat(locale, {
      style: "unit",
      unit,
      unitDisplay: "long",
    }).format(value);
  const diffMs = Math.max(0, due.getTime() - now.getTime());
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return `<${format(1, "minute")}`;
  if (minutes < 60) return format(minutes, "minute");

  const hours = Math.round(minutes / 60);
  if (hours < 24) return format(hours, "hour");

  const days = Math.round(hours / 24);
  if (days < 30) return format(days, "day");

  const months = Math.round(days / 30);
  if (months < 12) return format(months, "month");

  const years = Math.round(months / 12);
  return format(years, "year");
}
import { getCurrentUiLocale } from "@xue-learn/core/i18n";
