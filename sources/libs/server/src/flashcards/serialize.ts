import type { FlashcardRecord } from "../../../domain/src/index.js";
import { parseAnchorFromJson } from "./source.js";
import type { FlashCardDto } from "./types.js";

export function serializeFlashCard(card: FlashcardRecord): FlashCardDto {
  return {
    id: card.id,
    front: card.front,
    back: card.back,
    anchor: parseAnchorFromJson(card.anchorJson),
    sourceExcerpt: card.sourceExcerpt,
    origin: card.origin,
    sortOrder: card.sortOrder,
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsedDays,
    scheduledDays: card.scheduledDays,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReview: card.lastReview?.toISOString() ?? null,
    cognitiveEntity: card.cognitiveEntity
      ? { id: card.cognitiveEntity.id, title: card.cognitiveEntity.title }
      : null,
    unit: {
      id: card.unit.id,
      title: card.unit.title,
      goal: {
        id: card.unit.goal.id,
        title: card.unit.goal.title,
      },
    },
    deck: {
      id: card.deck.id,
      cardCount: card.deck.cardCount,
    },
  };
}
