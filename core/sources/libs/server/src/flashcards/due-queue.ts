// @ts-nocheck -- unbound compatibility implementation; hosted callers use repositories.
import type { Persistence, PersistenceClient } from "../persistence/persistence-compat.js";
import type { FlashcardReviewScope } from "../../../domain/src/index.js";

export function buildFlashcardScopeWhere(
  userId: string,
  scope: FlashcardReviewScope,
  now = new Date()
): Persistence.FlashCardWhereInput {
  const unitScope: Persistence.LearningUnitWhereInput = {
    goal: { userId },
  };

  if (scope.type === 'goal') {
    unitScope.goalId = scope.goalId;
  } else if (scope.type === 'unit') {
    unitScope.id = scope.unitId;
  }

  return {
    unit: unitScope,
    due: { lte: now },
  };
}

export function isFlashcardDue(
  card: { due: Date; state: string },
  now = new Date()
): boolean {
  return card.due <= now;
}

export function flashcardDueOrderBy(): Persistence.FlashCardOrderByWithRelationInput[] {
  return [{ due: 'asc' }, { lapses: 'desc' }, { id: 'asc' }];
}

export async function countDueFlashcards(
  persistence: PersistenceClient,
  userId: string,
  scope: FlashcardReviewScope,
  now = new Date()
): Promise<number> {
  return persistence.flashCard.count({
    where: buildFlashcardScopeWhere(userId, scope, now),
  });
}

export async function countNewFlashcards(
  persistence: PersistenceClient,
  userId: string,
  scope: FlashcardReviewScope
): Promise<number> {
  const unitScope: Persistence.LearningUnitWhereInput = {
    goal: { userId },
  };
  if (scope.type === 'goal') unitScope.goalId = scope.goalId;
  if (scope.type === 'unit') unitScope.id = scope.unitId;

  return persistence.flashCard.count({
    where: {
      unit: unitScope,
      state: 'New',
    },
  });
}
