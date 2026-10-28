import { useQuery } from "@tanstack/react-query";
import type { LearningStateResponse } from "@/shared/domain/learning-state-memory";
import { apiGet, queryKeys } from "@/shared/api";
import { getAuthUser } from "@/shared/auth";

export function useLearningState(enabled = true) {
  const userId = getAuthUser()?.id;
  return useQuery({
    queryKey: queryKeys.profile.learningState(userId),
    queryFn: () =>
      apiGet<LearningStateResponse>("/api/profile/learning-state"),
    enabled: enabled && Boolean(userId),
    staleTime: 30_000,
  });
}
