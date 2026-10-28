import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUserId } from "../../../../common/src/index.js";
import type { FsrsRating } from "../../../../domain/src/index.js";
import { FlashcardsService } from "./flashcards.service.js";

@Controller('api/flashcards')
export class FlashcardsController {
  constructor(private readonly flashcards: FlashcardsService) {}

  @Get('decks')
  listDecks(@CurrentUserId() userId: string) {
    return this.flashcards.listDecks(userId);
  }

  @Get('decks/:deckId/cards')
  listDeckCards(
    @CurrentUserId() userId: string,
    @Param('deckId') deckId: string,
  ) {
    return this.flashcards.listDeckCards(userId, deckId);
  }

  @Delete('decks/:deckId')
  deleteDeck(@CurrentUserId() userId: string, @Param('deckId') deckId: string) {
    return this.flashcards.deleteDeck(userId, deckId);
  }

  @Get('due/summary')
  dueSummary(
    @CurrentUserId() userId: string,
    @Query('scope') scope?: string,
    @Query('goalId') goalId?: string,
    @Query('unitId') unitId?: string,
  ) {
    return this.flashcards.dueSummary(userId, scope, goalId, unitId);
  }

  @Get('due')
  getDue(
    @CurrentUserId() userId: string,
    @Query('scope') scope?: string,
    @Query('goalId') goalId?: string,
    @Query('unitId') unitId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.flashcards.getDue(
      userId,
      scope,
      goalId,
      unitId,
      limit ? Number(limit) : 50,
      offset ? Number(offset) : 0,
    );
  }

  @Post('session/complete')
  sessionComplete(
    @CurrentUserId() userId: string,
    @Body()
    body: {
      scope?: { type: string; goalId?: string; unitId?: string };
      reviewedCount: number;
      againCount: number;
      hardCount: number;
      goalIds?: string[];
      unitIds?: string[];
      sessionId?: string;
    },
  ) {
    const scope =
      body.scope?.type === 'goal' && body.scope.goalId
        ? { type: 'goal' as const, goalId: body.scope.goalId }
        : body.scope?.type === 'unit' && body.scope.unitId
          ? { type: 'unit' as const, unitId: body.scope.unitId }
          : { type: 'all' as const };
    return this.flashcards.traceSessionCompleted(userId, {
      scope,
      reviewedCount: body.reviewedCount,
      againCount: body.againCount,
      hardCount: body.hardCount,
      goalIds: body.goalIds,
      unitIds: body.unitIds,
      sessionId: body.sessionId,
    });
  }

  @Post(':cardId/review')
  submitReview(
    @CurrentUserId() userId: string,
    @Param('cardId') cardId: string,
    @Body() body: { rating: FsrsRating },
  ) {
    return this.flashcards.submitReview(userId, cardId, body.rating);
  }

  @Patch(':cardId')
  updateCard(
    @CurrentUserId() userId: string,
    @Param('cardId') cardId: string,
    @Body() body: { front?: unknown; back?: unknown },
  ) {
    return this.flashcards.updateCard(userId, cardId, body);
  }

  @Delete(':cardId')
  deleteCard(@CurrentUserId() userId: string, @Param('cardId') cardId: string) {
    return this.flashcards.deleteCard(userId, cardId);
  }

  @Get(':cardId/source')
  getSource(@CurrentUserId() userId: string, @Param('cardId') cardId: string) {
    return this.flashcards.getSource(userId, cardId);
  }
}
