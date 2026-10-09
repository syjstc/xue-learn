import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/shared/api";
import { isDesktopLocalRuntime } from "@xue-learn/core/source/src/shared/runtime/client-runtime.ts";
import type {
  LearningBranch,
  LearningTrajectorySnapshot,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import type { LearningMaterialContent } from "@xue-learn/core/source/src/shared/llm/schemas.ts";
export const trajectoryKey = ["learning-trajectory"] as const;
export function useLearningTrajectory(unitId?: string) {
  return useQuery({
    queryKey: [...trajectoryKey, unitId ?? "all"],
    queryFn: () =>
      apiGet<LearningTrajectorySnapshot>(
        `/api/learning-trajectory${unitId ? `?unitId=${encodeURIComponent(unitId)}` : ""}`,
      ),
    enabled: isDesktopLocalRuntime(),
    refetchInterval: 3000,
  });
}
export function useLearningBranch(id: string) {
  return useQuery({
    queryKey: [...trajectoryKey, "branch", id],
    queryFn: () =>
      apiGet<{
        branch: LearningBranch;
        material: LearningMaterialContent | null;
      }>(`/api/learning-trajectory/branches/${encodeURIComponent(id)}`),
    enabled: isDesktopLocalRuntime() && Boolean(id),
    refetchInterval: (q) =>
      q.state.data?.branch.status === "preparing" ? 1500 : false,
  });
}
export function useRefreshLearningTrajectory() {
  const q = useQueryClient();
  return () => q.invalidateQueries({ queryKey: trajectoryKey });
}
