import {
  Card,
  createEmptyCard,
  FSRS,
  type Grade,
  Rating,
  State,
} from 'ts-fsrs';

export type FsrsRating = 'Again' | 'Hard' | 'Good' | 'Easy';

export type FlashcardReviewScope =
  | { type: 'all' }
  | { type: 'goal'; goalId: string }
  | { type: 'unit'; unitId: string };

export type FlashCardFsrsState = {
  due: Date;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  state: string;
  lastReview: Date | null;
};

export const FSRS_CARD_STATES = ['New', 'Learning', 'Review', 'Relearning'] as const;

const fsrs = new FSRS({});

export function fsrsRatingToGrade(rating: FsrsRating): Grade {
  switch (rating) {
    case 'Again':
      return Rating.Again;
    case 'Hard':
      return Rating.Hard;
    case 'Good':
      return Rating.Good;
    case 'Easy':
      return Rating.Easy;
  }
}

export function gradeToFsrsRating(grade: Grade): FsrsRating {
  switch (grade) {
    case Rating.Again:
      return 'Again';
    case Rating.Hard:
      return 'Hard';
    case Rating.Good:
      return 'Good';
    case Rating.Easy:
      return 'Easy';
    default:
      return 'Good';
  }
}

function stateToString(state: State): string {
  switch (state) {
    case State.New:
      return 'New';
    case State.Learning:
      return 'Learning';
    case State.Review:
      return 'Review';
    case State.Relearning:
      return 'Relearning';
    default:
      return 'New';
  }
}

function stringToState(state: string): State {
  switch (state) {
    case 'Learning':
      return State.Learning;
    case 'Review':
      return State.Review;
    case 'Relearning':
      return State.Relearning;
    default:
      return State.New;
  }
}

export function createInitialFsrsState(now = new Date()): FlashCardFsrsState {
  const card = createEmptyCard(now);
  return cardToFsrsState(card);
}

export function cardToFsrsState(card: Card): FlashCardFsrsState {
  return {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    state: stateToString(card.state),
    lastReview: card.last_review ?? null,
  };
}

export function fsrsStateToCard(state: FlashCardFsrsState): Card {
  return {
    due: state.due,
    stability: state.stability,
    difficulty: state.difficulty,
    elapsed_days: state.elapsedDays,
    scheduled_days: state.scheduledDays,
    reps: state.reps,
    lapses: state.lapses,
    state: stringToState(state.state),
    last_review: state.lastReview ?? undefined,
    learning_steps: 0,
  };
}

export function scheduleReview(
  state: FlashCardFsrsState,
  rating: FsrsRating,
  now = new Date()
): FlashCardFsrsState {
  const card = fsrsStateToCard(state);
  const grade = fsrsRatingToGrade(rating);
  const result = fsrs.next(card, now, grade);
  return cardToFsrsState(result.card);
}
