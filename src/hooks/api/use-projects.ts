import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, queryKeys } from "@/shared/api";
import {
  buildProjectMilestoneAttemptRequest,
  type ProjectAttemptResponse,
  type ProjectDetailResponse,
  type ProjectListResponse,
  type ProjectMilestoneSubmissionDraft,
} from "@/shared/domain/projects";

export function useGoalProjects(goalId: string) {
  return useQuery({
    queryKey: queryKeys.projects.goal(goalId),
    queryFn: () =>
      apiGet<ProjectListResponse>(
        `/api/goals/${encodeURIComponent(goalId)}/projects`,
      ),
    enabled: Boolean(goalId),
  });
}

export function useProjectDetail(projectId: string) {
  return useQuery({
    queryKey: queryKeys.projects.detail(projectId),
    queryFn: () =>
      apiGet<ProjectDetailResponse>(
        `/api/projects/${encodeURIComponent(projectId)}`,
      ),
    enabled: Boolean(projectId),
  });
}

export function useSubmitProjectMilestoneAttempt(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      milestoneId,
      draft,
    }: {
      milestoneId: string;
      draft: ProjectMilestoneSubmissionDraft;
    }) => {
      const body = buildProjectMilestoneAttemptRequest(draft);
      return apiPost<ProjectAttemptResponse>(
        `/api/projects/${encodeURIComponent(projectId)}/milestones/${encodeURIComponent(milestoneId)}/attempts`,
        body,
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.projects.detail(projectId),
      });
      void queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === queryKeys.projects.all[0] &&
          query.queryKey[1] === "goal",
      });
      void queryClient.invalidateQueries({ queryKey: ["cognition"] });
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey.includes("cognitive-model"),
      });
    },
  });
}
