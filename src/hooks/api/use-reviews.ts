import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  apiGet,
  apiPost,
  queryKeys,
  type PracticeUnit,
  type CognitiveReviewTask,
  type DueCognitiveReviewResponse,
} from "@/shared/api";

export function useDueReviews() {
  return useQuery({
    queryKey: queryKeys.reviews.due(),
    queryFn: async () => {
      const data = await apiGet<DueCognitiveReviewResponse>("/api/reviews/due");
      return data.tasks;
    },
  });
}

export function usePracticeUnits() {
  return useQuery({
    queryKey: queryKeys.reviews.practice(),
    queryFn: async () => {
      const data = await apiGet<{ units?: PracticeUnit[] }>(
        "/api/reviews/practice"
      );
      return data.units ?? [];
    },
  });
}

export function useSubmitReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ cardId, grade }: { cardId: string; grade: number }) =>
      apiPost<{ ok?: boolean }>(`/api/reviews/${cardId}`, { grade }),
    onSuccess: (_data, { cardId }) => {
      queryClient.setQueryData<CognitiveReviewTask[]>(
        queryKeys.reviews.due(),
        (tasks) => tasks?.filter((task) => task.id !== cardId)
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.reviews.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agenda.all });
      void queryClient.invalidateQueries({ queryKey: ["cognition"] });
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey.includes("cognitive-model"),
      });
    },
  });
}
