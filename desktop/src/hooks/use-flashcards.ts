import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  queryKeys,
} from '@/shared/api';
import type {
  FlashCardDeckDto,
  FlashCardDeckListItem,
  FlashCardDto,
  FlashCardSourcePayload,
  FlashcardReviewScope,
  FsrsRating,
} from '@/shared/domain/flashcards';
import { scopeToQuery } from '@/shared/domain/flashcards';

export function useFlashcardDeck(unitId: string) {
  return useQuery({
    queryKey: queryKeys.flashcards.deck(unitId),
    queryFn: async () => {
      const data = await apiGet<{ deck: FlashCardDeckDto | null }>(
        `/api/units/${unitId}/flashcards`
      );
      return data.deck ?? null;
    },
    enabled: Boolean(unitId),
  });
}

export function useGenerateFlashcards(unitId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiPost<{ deck: FlashCardDeckDto | null }>(
        `/api/units/${unitId}/flashcards/generate`,
        {}
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.flashcards.deck(unitId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.flashcards.all });
    },
  });
}

export function useFlashcardDecks() {
  return useQuery({
    queryKey: queryKeys.flashcards.decks(),
    queryFn: async () => {
      const data = await apiGet<{ decks?: FlashCardDeckListItem[] }>(
        '/api/flashcards/decks'
      );
      return data.decks ?? [];
    },
  });
}

export function useFlashcardDeckCards(deckId: string | null) {
  return useQuery({
    queryKey: queryKeys.flashcards.deckCards(deckId ?? ''),
    queryFn: async () => {
      const data = await apiGet<{ cards?: FlashCardDto[] }>(
        `/api/flashcards/decks/${deckId}/cards`
      );
      return data.cards ?? [];
    },
    enabled: Boolean(deckId),
  });
}

export function useFlashcardDueSummary(scope: FlashcardReviewScope) {
  const params = new URLSearchParams(scopeToQuery(scope));
  return useQuery({
    queryKey: queryKeys.flashcards.dueSummary(scope),
    queryFn: async () => {
      const data = await apiGet<{ due: number; new: number; total: number }>(
        `/api/flashcards/due/summary?${params.toString()}`
      );
      return data;
    },
  });
}

export function useFlashcardDueQueue(scope: FlashcardReviewScope, limit = 50) {
  const params = new URLSearchParams({ ...scopeToQuery(scope), limit: String(limit) });
  return useQuery({
    queryKey: queryKeys.flashcards.due(scope, limit),
    queryFn: async () => {
      const data = await apiGet<{ cards?: FlashCardDto[]; total?: number }>(
        `/api/flashcards/due?${params.toString()}`
      );
      return {
        cards: data.cards ?? [],
        total: data.total ?? 0,
      };
    },
  });
}

export function useSubmitFlashcardReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ cardId, rating }: { cardId: string; rating: FsrsRating }) =>
      apiPost<{ card: FlashCardDto }>(`/api/flashcards/${cardId}/review`, {
        rating,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.flashcards.all });
      void queryClient.invalidateQueries({ queryKey: ["cognition"] });
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey.includes("cognitive-model"),
      });
    },
  });
}

export function useUpdateFlashcardCard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      cardId,
      front,
      back,
    }: {
      cardId: string;
      front: string;
      back: string;
    }) =>
      apiPatch<{ card: FlashCardDto }>(`/api/flashcards/${cardId}`, {
        front,
        back,
      }),
    onSuccess: (_data, { cardId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.flashcards.all });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.flashcards.source(cardId),
      });
    },
  });
}

export function useDeleteFlashcardCard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ cardId }: { cardId: string }) =>
      apiDelete<{
        ok: boolean;
        deletedCardId: string;
        deletedDeckId: string | null;
        deckDeleted: boolean;
      }>(`/api/flashcards/${cardId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.flashcards.all });
    },
  });
}

export function useDeleteFlashcardDeck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ deckId }: { deckId: string }) =>
      apiDelete<{ ok: boolean; deletedDeckId: string }>(
        `/api/flashcards/decks/${deckId}`
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.flashcards.all });
    },
  });
}

export function useFlashcardSource(cardId: string | null, enabled = false) {
  return useQuery({
    queryKey: queryKeys.flashcards.source(cardId ?? ''),
    queryFn: async () => {
      const data = await apiGet<{ source: FlashCardSourcePayload }>(
        `/api/flashcards/${cardId}/source`
      );
      return data.source;
    },
    enabled: Boolean(cardId) && enabled,
  });
}

export function useCompleteFlashcardSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      reviewedCount: number;
      againCount: number;
      hardCount: number;
      sessionId: string;
    }) =>
      apiPost('/api/flashcards/session/complete', {
        reviewedCount: body.reviewedCount,
        againCount: body.againCount,
        hardCount: body.hardCount,
        sessionId: body.sessionId,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cognition"] });
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey.includes("cognitive-model"),
      });
    },
  });
}
