import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  queryKeys,
  ApiError,
  type GoalDetail,
  type GoalModuleDetail,
  type GoalListItem,
  type GoalMapSummary,
  type GoalOverviewUnit,
  type GoalPlanResponse,
  type GoalUnit,
  type SharedGoalPreview,
  type PublicSharedCourseListItem,
  type FoundationGoalsResponse,
} from "@/shared/api";
import type { GoalMapPlan } from "@xue-learn/core/source/src/shared/llm/schemas.ts";
import { consumeSsePost } from "@/shared/client/consume-sse";
import type { SseEvent } from "@/shared/llm/sse";
import { apiFetch } from "@/shared/api-client";
import type { GetGoalCognitiveModelResponse } from "@/shared/domain/cognitive-model";
import type { MasterySummary } from "@/shared/domain/mastery";
import { goalCreationSessionKeys } from "@/hooks/use-goal-creation-session";
import type { GoalCreationSessionResponse } from "@/shared/agent/goal-creation-session";

export function useGoals() {
  return useQuery({
    queryKey: queryKeys.goals.list(),
    queryFn: async () => {
      const data = await apiGet<{ goals: GoalListItem[] }>("/api/goals");
      return data.goals;
    },
  });
}

/**
 * Goal detail for layout + nested pages (`?view=journey`).
 * Shared across GoalLayout and route pages via the same query key — do not set
 * `refetchOnMount: "always"` or each additional observer remount refetches.
 * Freshness comes from the default staleTime, mutation/SSE invalidation, and
 * the generating-module poll below.
 */
export function useGoal(goalId: string) {
  return useQuery({
    queryKey: queryKeys.goals.detail(goalId),
    queryFn: async () => {
      const data = await apiGet<{ goal: GoalDetail }>(
        `/api/goals/${goalId}?view=journey`,
      );
      return data.goal;
    },
    enabled: Boolean(goalId),
    refetchInterval: (query) => {
      if (
        ["queued", "building"].includes(
          query.state.data?.masteryTransition?.status ?? "",
        )
      ) {
        return 4000;
      }
      const modules = query.state.data?.modules;
      if (!modules?.length) return false;
      return modules.some((module) => module.status === "generating")
        ? 4000
        : false;
    },
  });
}

export function useFoundationGoals(goalId: string) {
  return useQuery({
    queryKey: queryKeys.goals.foundations(goalId),
    queryFn: () =>
      apiGet<FoundationGoalsResponse>(
        `/api/goals/${encodeURIComponent(goalId)}/foundation-goals`,
      ),
    enabled: Boolean(goalId),
    refetchInterval: (query) =>
      query.state.data?.foundationGoals.some((goal) =>
        ["queued", "building"].includes(goal.masteryTransition.status),
      )
        ? 4000
        : false,
  });
}

export function useCreateFoundationGoal(goalId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (prerequisiteItems: string[]) =>
      apiPost<
        GoalCreationSessionResponse & {
          created: boolean;
          activeCreationExists: boolean;
        }
      >(`/api/agent/foundation-goals/${encodeURIComponent(goalId)}`, {
        prerequisiteItems,
        learningMode: "exploration",
      }),
    onSuccess: (response) => {
      queryClient.setQueryData<GoalCreationSessionResponse>(
        goalCreationSessionKeys.active(),
        response,
      );
      if (response.session) {
        queryClient.setQueryData<GoalCreationSessionResponse>(
          goalCreationSessionKeys.detail(response.session.id),
          response,
        );
        if (response.session.goalId) {
          queryClient.setQueryData<GoalCreationSessionResponse>(
            goalCreationSessionKeys.goal(response.session.goalId),
            response,
          );
        }
      }
      void queryClient.invalidateQueries({
        queryKey: queryKeys.goals.foundations(goalId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.goals.detail(goalId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.goals.list() });
    },
  });
}

export function useUpgradeFoundationToMastery(parentGoalId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (goalId: string) =>
      apiPost(
        `/api/goals/${encodeURIComponent(goalId)}/learning-mode/mastery`,
        {},
      ),
    onSuccess: (_response, goalId) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.goals.foundations(parentGoalId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.goals.detail(goalId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.goals.list() });
    },
  });
}

export function useEnableGoalMastery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (goalId: string) =>
      apiPost<{
        goalId: string;
        learningMode: "exploration";
        transitionStatus: "queued" | "building" | "failed";
        retryable: boolean;
        error?: string | null;
      }>(`/api/goals/${encodeURIComponent(goalId)}/learning-mode/mastery`, {}),
    onSuccess: (_response, goalId) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.goals.detail(goalId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.goals.plan(goalId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.goals.list() });
    },
  });
}

/** Development-only KACOM detach endpoint; deliberately omitted from OpenAPI. */
export function useDetachKacomForInternalTesting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (goalId: string) =>
      apiPost<{
        goalId: string;
        learningMode: "exploration";
        detached: true;
        alreadyDetached: boolean;
      }>(`/api/goals/${encodeURIComponent(goalId)}/internal/detach-kacom`, {}),
    onSuccess: (_response, goalId) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.goals.detail(goalId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.goals.plan(goalId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.goals.list() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agenda.all });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.profile.learningState(),
      });
    },
  });
}

export function useFullGoal(goalId: string) {
  return useQuery({
    queryKey: [...queryKeys.goals.detail(goalId), "full"],
    queryFn: async () => {
      const data = await apiGet<{ goal: GoalDetail }>(
        `/api/goals/${goalId}?view=full`,
      );
      return data.goal;
    },
    enabled: Boolean(goalId),
  });
}

export function useGoalModule(goalId: string, moduleId: string) {
  return useQuery({
    queryKey: ["goals", goalId, "modules", moduleId],
    queryFn: async () => {
      const data = await apiGet<{ module: GoalModuleDetail }>(
        `/api/goals/${encodeURIComponent(goalId)}/modules/${encodeURIComponent(moduleId)}`,
      );
      return data.module;
    },
    enabled: Boolean(goalId && moduleId),
    retry: false,
    refetchInterval: (query) => {
      const module = query.state.data;
      if (!module) return false;
      return module.generationStatus !== "ready" &&
        module.unlockStatus !== "locked"
        ? 4000
        : false;
    },
  });
}

export function useGoalMastery(
  goalId: string,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ["goals", goalId, "mastery"],
    queryFn: () =>
      apiGet<MasterySummary>(
        `/api/goals/${encodeURIComponent(goalId)}/mastery`,
      ),
    enabled: Boolean(goalId) && (options?.enabled ?? true),
    retry: false,
  });
}

export function useModuleMastery(
  goalId: string,
  moduleId: string,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ["goals", goalId, "modules", moduleId, "mastery"],
    queryFn: () =>
      apiGet<MasterySummary>(
        `/api/goals/${encodeURIComponent(goalId)}/modules/${encodeURIComponent(moduleId)}/mastery`,
      ),
    enabled: Boolean(goalId && moduleId) && (options?.enabled ?? true),
    retry: false,
  });
}

export function useRetryModuleGeneration(goalId: string, moduleId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiPost<{ enqueued: boolean; status: string }>(
        `/api/goals/${encodeURIComponent(goalId)}/modules/${encodeURIComponent(moduleId)}/generation/retry`,
        {},
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["goals", goalId, "modules", moduleId],
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.goals.detail(goalId),
      });
    },
  });
}

export function useModuleCognitiveModel(
  goalId: string,
  moduleId: string,
  view: "capabilities" | "targets" | "full" = "capabilities",
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ["goals", goalId, "modules", moduleId, "cognitive-model", view],
    queryFn: () =>
      apiGet<{
        capabilities: Array<{
          id: string;
          title: string;
          learningObjective: string;
          readiness: string;
          requirements: Array<{
            dimension: string;
            estimate: number | null;
            evidenceSufficiency: number;
            passed: boolean;
            gate: boolean;
          }>;
          missingRequirements: unknown[];
        }>;
      }>(
        `/api/goals/${encodeURIComponent(goalId)}/modules/${encodeURIComponent(moduleId)}/cognitive-model?view=${view}`,
      ),
    enabled: Boolean(goalId && moduleId) && (options?.enabled ?? true),
    retry: false,
  });
}

export function useCognitiveModel(
  goalId: string,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ["goals", goalId, "cognitive-model", "full"],
    queryFn: () =>
      apiGet<GetGoalCognitiveModelResponse>(
        `/api/goals/${encodeURIComponent(goalId)}/cognitive-model?view=full`,
      ),
    enabled: Boolean(goalId) && (options?.enabled ?? true),
    retry: false,
  });
}

export function useGoalPlan(goalId: string) {
  return useQuery({
    queryKey: queryKeys.goals.plan(goalId),
    queryFn: () => apiGet<GoalPlanResponse>(`/api/goals/${goalId}/plan`),
    enabled: Boolean(goalId),
  });
}

export function useSharedGoal(shareId: string) {
  return useQuery({
    queryKey: queryKeys.goals.shared(shareId),
    queryFn: async () => {
      const data = await apiGet<{ goal: SharedGoalPreview }>(
        `/api/goals/shared/${shareId}`,
      );
      return data.goal;
    },
    enabled: Boolean(shareId),
  });
}

export function useSharedGoalCourse(shareId: string) {
  const trimmed = shareId.trim();
  // Catalog and CDN manifest are separate queries so a failed manifest
  // retry does not re-hit `/api/goals/shared/public?shareId=…`.
  const catalogQuery = useQuery({
    queryKey: [...queryKeys.goals.publicShares(), "", trimmed],
    queryFn: async () => {
      const catalog = await apiGet<{
        shares: PublicSharedCourseListItem[];
      }>(`/api/goals/shared/public?shareId=${encodeURIComponent(trimmed)}`);
      const item = catalog.shares[0];
      if (!item?.manifestUrl) {
        throw new ApiError("公开课程不存在或未公开", 404);
      }
      return item;
    },
    enabled: Boolean(trimmed),
  });

  const manifestUrl = catalogQuery.data?.manifestUrl ?? "";
  const manifestQuery = useQuery({
    queryKey: [...queryKeys.goals.sharedCourse(trimmed), manifestUrl],
    queryFn: async () => {
      const { fetchPublicCourseManifest } =
        await import("@/shared/api/public-course-cdn");
      return fetchPublicCourseManifest(manifestUrl);
    },
    enabled: Boolean(trimmed) && catalogQuery.isSuccess && Boolean(manifestUrl),
    // CDN 404 / missing object is permanent; don't retry-storm.
    retry: false,
  });

  const waitingOnManifest =
    catalogQuery.isSuccess && Boolean(manifestUrl) && manifestQuery.isPending;

  return {
    ...manifestQuery,
    data: manifestQuery.data,
    error: catalogQuery.error ?? manifestQuery.error,
    isPending: catalogQuery.isPending || waitingOnManifest,
    isLoading:
      catalogQuery.isLoading ||
      (catalogQuery.isSuccess &&
        Boolean(manifestUrl) &&
        manifestQuery.isLoading),
    isError: catalogQuery.isError || manifestQuery.isError,
    isFetching: catalogQuery.isFetching || manifestQuery.isFetching,
    status: catalogQuery.isError
      ? ("error" as const)
      : catalogQuery.isPending || waitingOnManifest
        ? ("pending" as const)
        : manifestQuery.status,
  };
}

export function usePublicCourseUnit(unitUrl: string | null | undefined) {
  return useQuery({
    queryKey: ["public-course-unit", unitUrl ?? ""],
    queryFn: async () => {
      if (!unitUrl) {
        throw new ApiError("课时不存在", 404);
      }
      const { fetchPublicCourseUnit } =
        await import("@/shared/api/public-course-cdn");
      return fetchPublicCourseUnit(unitUrl);
    },
    enabled: Boolean(unitUrl),
    retry: false,
  });
}

export function usePublicSharedCourses(options?: {
  q?: string;
  shareId?: string;
}) {
  const q = options?.q?.trim() ?? "";
  const shareId = options?.shareId?.trim() ?? "";
  return useQuery({
    queryKey: [...queryKeys.goals.publicShares(), q, shareId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (shareId) params.set("shareId", shareId);
      const suffix = params.toString() ? `?${params}` : "";
      const data = await apiGet<{
        shares: PublicSharedCourseListItem[];
        nextCursor?: string | null;
      }>(`/api/goals/shared/public${suffix}`);
      return data.shares;
    },
  });
}

export function useToggleFeaturedPublicShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      shareId,
      featured,
    }: {
      shareId: string;
      featured: boolean;
    }) =>
      apiPatch<{
        shareId: string;
        featured: boolean;
        featuredOrder: number | null;
      }>(`/api/goals/shared/${shareId}/featured`, { featured }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.goals.publicShares(),
      });
    },
  });
}

export function useSetGoalShareVisibility() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      goalId,
      visibility,
    }: {
      goalId: string;
      visibility: "public" | "off";
    }) => {
      if (visibility === "public") {
        return apiPost<{
          shareId: string;
          goalId: string;
          requestedAt: string;
          shareVisibility: "public" | "pending";
          pendingShareId: string;
          activeShareId: string | null;
          status: "pending";
        }>(`/api/goals/${goalId}/share/publish`);
      }
      return apiPatch<{ goalId: string; shareVisibility: "off" }>(
        `/api/goals/${goalId}/share`,
        { visibility },
      );
    },
    onSuccess: (_data, { goalId }) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.goals.detail(goalId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.goals.list(),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.goals.publicShares(),
      });
    },
  });
}

export function useCancelPendingGoalShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (goalId: string) =>
      apiPost<{
        goalId: string;
        shareVisibility: "public" | "pending" | "off";
        activeShareId: string | null;
      }>(`/api/goals/${goalId}/share/cancel-pending`),
    onSuccess: (_data, goalId) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.goals.detail(goalId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.goals.list(),
      });
    },
  });
}

/**
 * Refresh everything related to one goal (list, detail, plan).
 * Call after SSE generation (decompose / subdivide) completes.
 */
export function useInvalidateGoal() {
  const queryClient = useQueryClient();
  return useCallback(
    (goalId?: string) =>
      goalId
        ? Promise.all([
            queryClient.invalidateQueries({ queryKey: queryKeys.goals.list() }),
            queryClient.invalidateQueries({ queryKey: queryKeys.agenda.all }),
            queryClient.invalidateQueries({
              queryKey: queryKeys.goals.detail(goalId),
            }),
            queryClient.invalidateQueries({
              queryKey: queryKeys.goals.plan(goalId),
            }),
          ])
        : Promise.all([
            queryClient.invalidateQueries({ queryKey: queryKeys.goals.all }),
            queryClient.invalidateQueries({ queryKey: queryKeys.agenda.all }),
          ]),
    [queryClient],
  );
}

export function useDeleteGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (goalId: string) =>
      apiDelete<{ ok?: boolean }>(`/api/goals/${goalId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.goals.all });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.learningSpaces.all,
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agenda.all });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.profile.learningState(),
      });
    },
  });
}

export function useUploadGoalDocuments() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      goalId,
      files,
      onProgress,
    }: {
      goalId: string;
      files: File[];
      onProgress?: (message: string) => void;
    }) => {
      if (files.length === 0) {
        throw new Error("请选择要上传的资料");
      }
      const form = new FormData();
      form.append("goalId", goalId);
      for (const file of files) {
        form.append("files", file);
      }

      const res = await apiFetch("/api/rag/ingest/stream", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as unknown;
        const body =
          payload && typeof payload === "object"
            ? (payload as { error?: unknown; message?: unknown })
            : null;
        const domainMessage =
          typeof body?.message === "string" && body.message.trim()
            ? body.message.trim()
            : typeof body?.error === "string" &&
                body.error.trim() &&
                !/^(NOT_FOUND|BAD_REQUEST|UNAUTHORIZED|FORBIDDEN|INTERNAL_SERVER_ERROR|Not Found|Bad Request)$/i.test(
                  body.error.trim(),
                )
              ? body.error.trim()
              : undefined;
        const message = domainMessage || `资料上传失败（${res.status}）`;
        throw new ApiError(message, res.status, payload);
      }

      type UploadResult = {
        goalId: string;
        fileCount: number;
        chunks: number;
        files: Array<{ filename: string; chunks: number }>;
      };
      type UploadEvent =
        | { type: "progress"; message: string }
        | { type: "result"; data: UploadResult }
        | { type: "error"; status: number; message: string };

      if (!res.body) throw new Error("资料上传进度流不可用");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      let result: UploadResult | undefined;

      const consumeLine = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line) as UploadEvent;
        if (event.type === "progress") onProgress?.(event.message);
        if (event.type === "result") result = event.data;
        if (event.type === "error") {
          throw new ApiError(event.message, event.status, event);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        buffered += decoder.decode(value, { stream: !done });
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const line of lines) consumeLine(line);
        if (done) break;
      }
      consumeLine(buffered);
      if (!result) throw new Error("资料上传结束，但未收到索引结果");
      return result;
    },
    onSuccess: (_data, { goalId }) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.goals.detail(goalId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.goals.list() });
    },
  });
}

export function useIngestGoalUrls() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      goalId,
      urls,
      refresh = false,
    }: {
      goalId: string;
      urls: string[];
      refresh?: boolean;
    }) =>
      apiPost<{
        goalId: string;
        results: Array<{
          status: "success" | "error";
          url: string;
          title?: string;
          warning?: string;
          error?: string;
        }>;
      }>("/api/rag/urls", { goalId, urls, refresh }),
    onSuccess: (_data, { goalId }) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.goals.detail(goalId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.goals.list() });
    },
  });
}

export function useDeleteGoalDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      goalId,
      documentId,
    }: {
      goalId: string;
      documentId: string;
    }) =>
      apiDelete<{ ok?: boolean; filename?: string }>(
        `/api/rag/documents/${documentId}?goalId=${encodeURIComponent(goalId)}`,
      ),
    onSuccess: (_data, { goalId }) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.goals.detail(goalId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.goals.list() });
    },
  });
}

export function useCopySharedGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (shareId: string) =>
      apiPost<{ goalId: string }>(`/api/goals/shared/${shareId}/copy`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.goals.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agenda.all });
    },
  });
}

type SaveGoalPlanInput = {
  goalId: string;
  topicOverview: string;
  outOfScope: string[];
};

type SaveGoalSummaryInput = {
  goalId: string;
  topicOverview: string;
  refinedTitle?: string;
  assumptions?: string[];
};

export function useSaveGoalSummary() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ goalId, ...body }: SaveGoalSummaryInput) =>
      apiPatch<{ summary: GoalMapSummary }>(
        `/api/goals/${goalId}/summary`,
        body,
      ),
    onSuccess: (_data, { goalId }) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.goals.plan(goalId),
      });
    },
  });
}

export function useConfirmGoalSummary() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (goalId: string) =>
      apiPost<{ ok?: boolean }>(`/api/goals/${goalId}/summary`),
    onSuccess: (_data, goalId) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.goals.plan(goalId),
      });
    },
  });
}

export function useSaveGoalPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ goalId, ...body }: SaveGoalPlanInput) =>
      apiPatch<{ plan: GoalMapPlan }>(`/api/goals/${goalId}/plan`, body),
    onSuccess: (_data, { goalId }) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.goals.plan(goalId),
      });
    },
  });
}

export function useUpdateGoalSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      goalId,
      title,
      contentLanguage,
      coursePattern,
    }: {
      goalId: string;
      title?: string;
      contentLanguage?: string;
      coursePattern?: string;
    }) =>
      apiPatch<{
        ok?: boolean;
        title?: string;
        contentLanguage?: string;
        contentLanguageLabel?: string;
        coursePattern?: string;
      }>(`/api/goals/${goalId}/settings`, {
        ...(title !== undefined ? { title } : {}),
        ...(contentLanguage !== undefined ? { contentLanguage } : {}),
        ...(coursePattern !== undefined ? { coursePattern } : {}),
      }),
    onSuccess: (_data, { goalId }) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.goals.plan(goalId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.goals.detail(goalId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.goals.list(),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agenda.all });
    },
  });
}

export function useRegenerateGoalCoursePattern() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (goalId: string) =>
      apiPost<{ ok?: boolean; coursePattern?: string }>(
        `/api/goals/${goalId}/course-pattern/regenerate`,
        {},
      ),
    onSuccess: (_data, goalId) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.goals.detail(goalId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.goals.plan(goalId),
      });
    },
  });
}

export function useConfirmGoalPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (goalId: string) =>
      apiPost<{ ok?: boolean }>(`/api/goals/${goalId}/plan`),
    onSuccess: (_data, goalId) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.goals.plan(goalId),
      });
    },
  });
}

export function useGenerateGoalOverview() {
  const invalidate = useInvalidateGoal();
  return useMutation({
    mutationFn: async ({
      goalId,
      runId,
      onEvent,
      signal,
    }: {
      goalId: string;
      runId?: string;
      onEvent?: (event: SseEvent) => void;
      signal?: AbortSignal;
    }) =>
      consumeSsePost(
        `/api/goals/${goalId}/overview/stream`,
        { runId },
        onEvent ?? (() => {}),
        signal,
      ),
    onSuccess: (_data, { goalId }) => invalidate(goalId),
  });
}

export function useUpdateGoalOverviewUnitProgress() {
  const invalidate = useInvalidateGoal();
  return useMutation({
    mutationFn: ({
      goalId,
      unitId,
      completed,
    }: {
      goalId: string;
      unitId: string;
      completed: boolean;
    }) =>
      apiPatch<{ unit: GoalOverviewUnit }>(
        `/api/goals/${goalId}/overview/units/${unitId}`,
        { completed },
      ),
    onSuccess: (_data, { goalId }) => invalidate(goalId),
  });
}

export function useCreateGoalUnit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      goalId,
      ...body
    }: {
      goalId: string;
      title: string;
      contentSummary?: string;
      note?: string;
      parentUnitId?: string | null;
      unitKind?: string;
    }) => apiPost<{ unit: GoalUnit }>(`/api/goals/${goalId}/units`, body),
    onSuccess: (_data, { goalId }) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.goals.detail(goalId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.goals.list(),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agenda.all });
    },
  });
}

export function useReorderGoalUnits() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      goalId,
      parentUnitId,
      orderedUnitIds,
    }: {
      goalId: string;
      parentUnitId?: string | null;
      orderedUnitIds: string[];
    }) =>
      apiPatch<{ units: GoalUnit[] }>(`/api/goals/${goalId}/units/reorder`, {
        parentUnitId: parentUnitId ?? null,
        orderedUnitIds,
      }),
    onSuccess: (_data, { goalId }) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.goals.detail(goalId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agenda.all });
    },
  });
}

export function useUpdateGoalUnit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      goalId,
      unitId,
      ...body
    }: {
      goalId: string;
      unitId: string;
      title?: string;
      contentSummary?: string;
      note?: string;
      parentUnitId?: string | null;
      orderIndex?: number;
    }) =>
      apiPatch<{ unit: GoalUnit }>(
        `/api/goals/${goalId}/units/${unitId}`,
        body,
      ),
    onSuccess: (_data, { goalId }) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.goals.detail(goalId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agenda.all });
    },
  });
}

export function useDeleteGoalUnit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ goalId, unitId }: { goalId: string; unitId: string }) =>
      apiDelete<{ ok?: boolean }>(`/api/goals/${goalId}/units/${unitId}`),
    onSuccess: (_data, { goalId }) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.goals.detail(goalId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.goals.list(),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agenda.all });
    },
  });
}
