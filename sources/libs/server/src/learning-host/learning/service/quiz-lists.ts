import type {
  FlashcardExperienceRepository,
  QuizSessionRepository,
} from "../../../../../domain/src/index.js";
import { runGenerationContextScope } from "../../../generation/kernel.js";

export async function getQuizSets(
  repository: QuizSessionRepository,
  userId: string,
  unitId: string,
) {
  const unit = await repository.findOwnedUnit({ userId, unitId });
  if (!unit) throw new Error("Unit not found");
  const sets = await repository.listQuizSets({ userId, unitId });
  return { sets };
}

export async function getUnitFlashcards(
  repository: QuizSessionRepository,
  flashcards: FlashcardExperienceRepository,
  userId: string,
  unitId: string,
) {
  const unit = await repository.findOwnedUnit({ userId, unitId });
  if (!unit) throw new Error("Unit not found");
  const { getUnitFlashcardDeck } = await import(
    "../../../flashcards/deck.js"
  );
  const deck = await getUnitFlashcardDeck(flashcards, unitId, userId);
  return { deck };
}

export async function generateUnitFlashcards(
  repository: QuizSessionRepository,
  flashcards: FlashcardExperienceRepository,
  userId: string,
  unitId: string,
) {
  const unit = await repository.findOwnedUnit({ userId, unitId });
  if (!unit) throw new Error("Unit not found");
  const { generateFlashcardDeckForUnit, getUnitFlashcardDeck } = await import(
    "../../../flashcards/deck.js"
  );
  await runGenerationContextScope(
    {
      subject: { userId, goalId: unit.goalId, unitId },
      query: `${unit.title}: generate flashcards`,
    },
    () => generateFlashcardDeckForUnit(flashcards, unitId, userId),
  );
  const deck = await getUnitFlashcardDeck(flashcards, unitId, userId);
  return { deck };
}
