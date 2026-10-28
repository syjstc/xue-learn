import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { tBackend } from "../../../../common/src/index.js";
import type { FlashcardReviewScope, FsrsRating } from "../../../../domain/src/index.js";
import { isFlashcardDue } from "../../flashcards/due-queue.js";
import { serializeFlashCard } from "../../flashcards/serialize.js";
import { resolveFlashCardSourceFromRow } from "../../flashcards/source.js";
import type { FlashCardDeckListItem } from "../../flashcards/types.js";
import { parseReviewScope } from "../../flashcards/types.js";
import { parseLearningMaterial } from "../../graph/unit-session.js";
import { computeFlashcardSourceHash } from "../../flashcards/source-hash.js";
import { invalidateAgendaForUser } from "../../agenda/index.js";
import { LearningSpaceOrmProvider } from "../../learning-spaces/learning-space-orm.provider.js";

@Injectable()
export class FlashcardsService {
  constructor(private readonly orm: LearningSpaceOrmProvider) {}

  async listDecks(userId: string): Promise<{ decks: FlashCardDeckListItem[] }> {
    const now = new Date();
    const decks = await this.orm.flashcardExperience.listDecks(userId);

    return {
      decks: decks.map((deck) => {
        const dueCount = deck.cards.filter((c) =>
          isFlashcardDue(c, now),
        ).length;
        const newCount = deck.cards.filter((c) => c.state === "New").length;
        const learningCount = deck.cards.filter(
          (c) => c.state === "Learning" || c.state === "Relearning",
        ).length;
        const reviewCount = deck.cards.filter(
          (c) => c.state === "Review",
        ).length;
        const material = deck.material
          ? parseLearningMaterial(deck.material)
          : null;
        const currentHash = material
          ? computeFlashcardSourceHash(material)
          : "";
        const lastReviewAt =
          deck.cards
            .map((c) => c.lastReview)
            .filter((d): d is Date => Boolean(d))
            .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
        return {
          deckId: deck.id,
          unitId: deck.unitId,
          unitTitle: deck.unitTitle,
          goalId: deck.goalId,
          goalTitle: deck.goalTitle,
          dueCount,
          newCount,
          learningCount,
          reviewCount,
          totalCount: deck.cards.length,
          generatedAt: deck.generatedAt.toISOString(),
          stale: Boolean(
            currentHash && deck.sourceHash && currentHash !== deck.sourceHash,
          ),
          lastReviewAt: lastReviewAt?.toISOString() ?? null,
        };
      }),
    };
  }

  async listDeckCards(
    userId: string,
    deckId: string,
  ): Promise<{ cards: ReturnType<typeof serializeFlashCard>[] }> {
    const result = await this.orm.flashcardExperience.listDeckCards(
      userId,
      deckId,
    );
    if (result.status === "not_found")
      throw new NotFoundException(tBackend("error.review.deckNotFound"));
    if (result.status === "forbidden") {
      throw new ForbiddenException(tBackend("error.review.deckForbidden"));
    }
    return { cards: result.value.map(serializeFlashCard) };
  }

  async deleteDeck(userId: string, deckId: string) {
    const result = await this.orm.flashcardExperience.deleteDeck(
      userId,
      deckId,
    );
    if (result.status === "not_found")
      throw new NotFoundException(tBackend("error.review.deckNotFound"));
    if (result.status === "forbidden") {
      throw new ForbiddenException(tBackend("error.review.deckForbidden"));
    }
    return { ok: true, ...result.value };
  }

  async updateCard(
    userId: string,
    cardId: string,
    body: { front?: unknown; back?: unknown },
  ) {
    const front = typeof body.front === "string" ? body.front.trim() : "";
    const back = typeof body.back === "string" ? body.back.trim() : "";
    if (!front || !back) {
      throw new BadRequestException(
        tBackend("error.review.flashcardSidesRequired"),
      );
    }

    const result = await this.orm.flashcardExperience.updateCard(
      userId,
      cardId,
      front,
      back,
    );
    if (result.status === "not_found")
      throw new NotFoundException(tBackend("error.review.flashcardNotFound"));
    if (result.status === "forbidden") {
      throw new ForbiddenException(tBackend("error.review.flashcardForbidden"));
    }
    return { card: serializeFlashCard(result.value) };
  }

  async deleteCard(userId: string, cardId: string) {
    const result = await this.orm.flashcardExperience.deleteCard(
      userId,
      cardId,
    );
    if (result.status === "not_found")
      throw new NotFoundException(tBackend("error.review.flashcardNotFound"));
    if (result.status === "forbidden") {
      throw new ForbiddenException(tBackend("error.review.flashcardForbidden"));
    }
    return { ok: true, ...result.value };
  }

  async dueSummary(
    userId: string,
    scopeRaw?: string,
    goalId?: string,
    unitId?: string,
  ) {
    const scope = parseReviewScope(scopeRaw, goalId, unitId);
    const now = new Date();
    const counts = await this.orm.flashcardExperience.countDue(
      userId,
      scope,
      now,
    );
    return { scope, due: counts.due, new: counts.newCount, total: counts.due };
  }

  async getDue(
    userId: string,
    scopeRaw?: string,
    goalId?: string,
    unitId?: string,
    limit = 50,
    offset = 0,
  ) {
    const scope = parseReviewScope(scopeRaw, goalId, unitId);
    const now = new Date();
    const safeOffset = Math.max(offset, 0);
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const result = await this.orm.flashcardExperience.listDue(
      userId,
      scope,
      now,
      safeLimit,
      safeOffset,
    );

    return {
      cards: result.cards.map(serializeFlashCard),
      total: result.total,
      offset,
      limit,
    };
  }

  async submitReview(userId: string, cardId: string, rating: FsrsRating) {
    if (!["Again", "Hard", "Good", "Easy"].includes(rating)) {
      throw new BadRequestException(tBackend("error.unknown"));
    }
    const result = await this.orm.flashcardExperience.submitReview(
      userId,
      cardId,
      rating,
      new Date(),
    );
    if (result.status === "not_found")
      throw new NotFoundException(tBackend("error.review.flashcardNotFound"));
    if (result.status === "forbidden") {
      throw new ForbiddenException(tBackend("error.review.flashcardForbidden"));
    }
    await invalidateAgendaForUser(userId);

    return { card: serializeFlashCard(result.value) };
  }

  async getSource(userId: string, cardId: string) {
    const result = await this.orm.flashcardExperience.findCard(userId, cardId);
    if (result.status === "not_found")
      throw new NotFoundException(tBackend("error.review.flashcardNotFound"));
    if (result.status === "forbidden") {
      throw new ForbiddenException(tBackend("error.review.flashcardForbidden"));
    }
    const card = result.value;

    if (card.cognitiveEntity) {
      const source = resolveFlashCardSourceFromRow(card);
      const kindLabel = tBackend(
        `label.cognition.kind.${card.cognitiveEntity.kind}`,
      );
      return {
        source: {
          ...source,
          label: `${kindLabel} · ${card.cognitiveEntity.title}`,
          excerpt:
            card.cognitiveEntity.atom?.explanation ||
            card.cognitiveEntity.description,
        },
      };
    }
    return { source: resolveFlashCardSourceFromRow(card) };
  }

  async traceSessionCompleted(
    userId: string,
    payload: {
      scope: FlashcardReviewScope;
      reviewedCount: number;
      againCount: number;
      hardCount: number;
      goalIds?: string[];
      unitIds?: string[];
      sessionId?: string;
    },
  ) {
    await invalidateAgendaForUser(userId);
    return { ok: true, reviewedCount: payload.reviewedCount };
  }
}
