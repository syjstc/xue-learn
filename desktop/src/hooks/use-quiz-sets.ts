"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, queryKeys } from "@/shared/api";
import type {
  ActiveQuizState,
  QuizGradeSummary,
  QuizSetSummary,
} from "@/shared/domain/quiz-sets";

export function useQuizSets(unitId: string) {
  const queryClient = useQueryClient();

  const setsQuery = useQuery({
    queryKey: queryKeys.units.quizSets(unitId),
    queryFn: async () => {
      const data = await apiGet<{ sets?: QuizSetSummary[] }>(
        `/api/units/${unitId}/quiz-sets`,
      );
      return data.sets ?? [];
    },
    enabled: Boolean(unitId),
  });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.units.quizSets(unitId),
    });
  }, [queryClient, unitId]);

  const selectQuizSet = useCallback(
    async (quizSetId: string, attemptId?: string | null) => {
      const data = await apiPost<{
        quizSetId?: string;
        questions?: ActiveQuizState["questions"];
        quizGrade?: QuizGradeSummary | null;
        quizExplanations?: Record<number, string>;
        readOnly?: boolean;
        selectedAttemptId?: string | null;
      }>(`/api/units/${unitId}/session`, {
        action: "select_quiz_set",
        payload: { quizSetId, attemptId: attemptId ?? undefined },
      });
      await refresh();
      return data;
    },
    [refresh, unitId],
  );

  return {
    sets: setsQuery.data ?? [],
    loading: setsQuery.isPending,
    refresh,
    selectQuizSet,
  };
}
