import type { FlashcardReviewScope, FsrsRating } from "../fsrs.js";

export type FlashcardMaterialRecord = Readonly<{
  introduction: string;
  sections: string;
  keyTakeaways: string;
  contextSources: string;
}>;

export type FlashcardRecord = Readonly<{
  id: string;
  deckId: string;
  unitId: string;
  cognitiveEntityId: string;
  front: string;
  back: string;
  anchorJson: string;
  sourceExcerpt: string;
  origin: string;
  sortOrder: number;
  due: Date;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  state: string;
  lastReview: Date | null;
  unit: Readonly<{
    id: string;
    goalId: string;
    title: string;
    goal: Readonly<{ id: string; title: string }>;
    learningMaterial: FlashcardMaterialRecord | null;
  }>;
  deck: Readonly<{ id: string; cardCount: number }>;
  cognitiveEntity: Readonly<{
    id: string;
    title: string;
    description: string;
    kind: "atom" | "concept" | "skill" | "competency";
    atom: Readonly<{ explanation: string }> | null;
  }> | null;
}>;

export type FlashcardDeckRecord = Readonly<{
  id: string;
  unitId: string;
  unitTitle: string;
  goalId: string;
  goalTitle: string;
  generatedAt: Date;
  sourceHash: string;
  material: FlashcardMaterialRecord | null;
  cards: readonly Readonly<{
    id: string;
    due: Date;
    state: string;
    lastReview: Date | null;
  }>[];
}>;

export type FlashcardGenerationContext = Readonly<{
  unit: Readonly<{ id: string; goalId: string; title: string }>;
  goal: Readonly<{
    id: string;
    title: string;
    level: string;
    contentLanguage: string;
    generationOptions: string;
  }>;
  material: FlashcardMaterialRecord;
  cornellCues: string | null;
  anchors: readonly Readonly<{
    learningTargetId: string;
    targetTitle: string;
    learningObjective: string;
    assessmentCriteria: string;
    importance: string;
    difficulty: string;
    targetCognitiveLevel: string;
    cognitiveEntityId: string;
    entityTitle: string;
  }>[];
}>;

export type GeneratedFlashcardRecord = Readonly<{
  front: string;
  back: string;
  cognitiveEntityId: string;
  anchorJson: string;
  sourceExcerpt: string;
  sortOrder: number;
  due: Date;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  state: string;
  lastReview: Date | null;
}>;

export type FlashcardMutationResult<T> =
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "forbidden" }>
  | Readonly<{ status: "ok"; value: T }>;

export interface FlashcardExperienceRepository {
  findGenerationContext(
    userId: string,
    unitId: string,
  ): Promise<FlashcardGenerationContext | null>;
  replaceGeneratedDeck(input: {
    userId: string;
    unitId: string;
    sourceHash: string;
    generatedAt: Date;
    cards: readonly GeneratedFlashcardRecord[];
  }): Promise<{ deckId: string; cardCount: number }>;
  getUnitDeck(userId: string, unitId: string): Promise<Readonly<{
    id: string;
    unitId: string;
    cardCount: number;
    generatedAt: Date;
    sourceHash: string;
    material: FlashcardMaterialRecord | null;
    stats: { due: number; newCount: number; learning: number; total: number };
  }> | null>;
  listDecks(userId: string): Promise<readonly FlashcardDeckRecord[]>;
  listDeckCards(
    userId: string,
    deckId: string,
  ): Promise<FlashcardMutationResult<readonly FlashcardRecord[]>>;
  deleteDeck(
    userId: string,
    deckId: string,
  ): Promise<FlashcardMutationResult<{ deletedDeckId: string }>>;
  updateCard(
    userId: string,
    cardId: string,
    front: string,
    back: string,
  ): Promise<FlashcardMutationResult<FlashcardRecord>>;
  deleteCard(
    userId: string,
    cardId: string,
  ): Promise<
    FlashcardMutationResult<{
      deletedCardId: string;
      deletedDeckId: string | null;
      deckDeleted: boolean;
    }>
  >;
  countDue(
    userId: string,
    scope: FlashcardReviewScope,
    now: Date,
  ): Promise<Readonly<{ due: number; newCount: number }>>;
  listDue(
    userId: string,
    scope: FlashcardReviewScope,
    now: Date,
    limit: number,
    offset: number,
  ): Promise<Readonly<{ cards: readonly FlashcardRecord[]; total: number }>>;
  submitReview(
    userId: string,
    cardId: string,
    rating: FsrsRating,
    now: Date,
  ): Promise<FlashcardMutationResult<FlashcardRecord>>;
  findCard(
    userId: string,
    cardId: string,
  ): Promise<FlashcardMutationResult<FlashcardRecord>>;
}
