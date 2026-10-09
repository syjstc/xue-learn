import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch, queryKeys } from "@/shared/api";
import { getAuthUser } from "@/shared/auth";
import type { LlmProviderId } from "@/shared/env-types";
import type { DoubaoThinkingMode } from "@/shared/llm/doubao-thinking";
import type { ImageProviderId } from "@/shared/images/provider-ids";

/* ---------- Learning view ---------- */

export type LearningViewMode = "chat" | "reading";

export type LearningViewSettingsResponse = {
  mode: LearningViewMode;
  chatAudioEnabled: boolean;
};

export function useLearningViewSettings() {
  const userId = getAuthUser()?.id;
  return useQuery({
    queryKey: queryKeys.settings.learningView(userId),
    queryFn: () =>
      apiGet<LearningViewSettingsResponse>("/api/settings/learning-view"),
    enabled: Boolean(userId),
    staleTime: 5 * 60 * 1000,
  });
}

export function useSaveLearningViewSettings() {
  const queryClient = useQueryClient();
  const userId = getAuthUser()?.id;
  const queryKey = queryKeys.settings.learningView(userId);
  return useMutation({
    mutationFn: (mode: LearningViewMode) =>
      apiPatch<LearningViewSettingsResponse>("/api/settings/learning-view", {
        mode,
      }),
    onMutate: async (mode) => {
      await queryClient.cancelQueries({ queryKey });
      const previous =
        queryClient.getQueryData<LearningViewSettingsResponse>(queryKey);
      queryClient.setQueryData<LearningViewSettingsResponse>(queryKey, {
        mode,
        chatAudioEnabled: previous?.chatAudioEnabled ?? false,
      });
      return { previous };
    },
    onSuccess: (response) => {
      queryClient.setQueryData<LearningViewSettingsResponse>(
        queryKey,
        response,
      );
    },
    onError: (_error, _mode, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      } else {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });
}

export function useSaveChatAudioSettings() {
  const queryClient = useQueryClient();
  const userId = getAuthUser()?.id;
  const queryKey = queryKeys.settings.learningView(userId);
  return useMutation({
    mutationFn: (chatAudioEnabled: boolean) =>
      apiPatch<LearningViewSettingsResponse>("/api/settings/learning-view", {
        chatAudioEnabled,
      }),
    onMutate: async (chatAudioEnabled) => {
      await queryClient.cancelQueries({ queryKey });
      const previous =
        queryClient.getQueryData<LearningViewSettingsResponse>(queryKey);
      queryClient.setQueryData<LearningViewSettingsResponse>(queryKey, {
        mode: previous?.mode ?? "chat",
        chatAudioEnabled,
      });
      return { previous };
    },
    onSuccess: (response) => {
      queryClient.setQueryData<LearningViewSettingsResponse>(
        queryKey,
        response,
      );
    },
    onError: (_error, _enabled, context) => {
      if (context?.previous)
        queryClient.setQueryData(queryKey, context.previous);
      else void queryClient.invalidateQueries({ queryKey });
    },
  });
}

/* ---------- LLM ---------- */

export type LlmProviderMeta = {
  id: LlmProviderId;
  label: string;
  description?: string;
  models: string[];
  configured: boolean;
};

export type LlmConfig = {
  provider: LlmProviderId;
  chatModel: string;
  minimaxThinkingEnabled: boolean;
  ollamaThinkingEnabled: boolean;
  deepseekThinkingEnabled: boolean;
  doubaoThinkingMode: DoubaoThinkingMode;
};

export type LlmSettingsResponse = {
  config: LlmConfig;
  providers: LlmProviderMeta[];
  unitLearningEstimate: number | null;
  unitLearningEstimateRange?: { min: number; max: number } | null;
  unitLearningEstimates: Array<{
    provider: string;
    model: string;
    estimatedUnitCredits: number;
  }>;
};

export function getSelectedUnitLearningEstimate(
  settings: LlmSettingsResponse | undefined,
  config: Pick<LlmConfig, "provider" | "chatModel"> | null | undefined,
): number | null {
  if (!settings || !config) return settings?.unitLearningEstimate ?? null;
  return (
    (settings.unitLearningEstimates ?? []).find(
      (item) =>
        item.provider === config.provider && item.model === config.chatModel,
    )?.estimatedUnitCredits ??
    settings.unitLearningEstimate ??
    null
  );
}

export function useLlmSettings() {
  const userId = getAuthUser()?.id;
  return useQuery({
    queryKey: queryKeys.settings.llm(userId),
    queryFn: () => apiGet<LlmSettingsResponse>("/api/settings/llm"),
    enabled: Boolean(userId),
  });
}

export function useSaveLlmSettings() {
  const queryClient = useQueryClient();
  const userId = getAuthUser()?.id;
  return useMutation({
    mutationFn: (config: LlmConfig) =>
      apiPatch<{ config: LlmConfig }>("/api/settings/llm", config),
    onSuccess: ({ config }) => {
      queryClient.setQueryData<LlmSettingsResponse>(
        queryKeys.settings.llm(userId),
        (prev) => (prev ? { ...prev, config } : prev),
      );
    },
  });
}

/* ---------- Images ---------- */

export type ImageProviderMeta = {
  id: ImageProviderId;
  label: string;
  description: string;
  models: string[];
  configured: boolean;
};

export type ImageConfig = {
  provider: ImageProviderId;
  model: string;
  enabled: boolean;
  maxIllustrations: number;
};

export type ImageSettingsResponse = {
  config: ImageConfig;
  providers: ImageProviderMeta[];
};

export function useImageSettings(enabled = true) {
  const userId = getAuthUser()?.id;
  return useQuery({
    queryKey: queryKeys.settings.images(userId),
    queryFn: () => apiGet<ImageSettingsResponse>("/api/settings/images"),
    enabled: enabled && Boolean(userId),
  });
}

export function useSaveImageSettings() {
  const queryClient = useQueryClient();
  const userId = getAuthUser()?.id;
  return useMutation({
    mutationFn: (patch: Partial<ImageConfig>) =>
      apiPatch<{ config: ImageConfig }>("/api/settings/images", patch),
    onSuccess: ({ config }) => {
      queryClient.setQueryData<ImageSettingsResponse>(
        queryKeys.settings.images(userId),
        (prev) => (prev ? { ...prev, config } : prev),
      );
    },
  });
}

/* ---------- Search ---------- */

export type SearchConfig = {
  enabled: boolean;
  provider: "tavily" | "doubao" | "anysearch";
};

export type SearchSettingsResponse = {
  config: SearchConfig;
  providers?: Array<{
    id: SearchConfig["provider"];
    label: string;
    description?: string;
    configured?: boolean;
  }>;
};

export function useSearchSettings() {
  const userId = getAuthUser()?.id;
  return useQuery({
    queryKey: queryKeys.settings.search(userId),
    queryFn: () => apiGet<SearchSettingsResponse>("/api/settings/search"),
    enabled: Boolean(userId),
  });
}

export function useSaveSearchSettings() {
  const queryClient = useQueryClient();
  const userId = getAuthUser()?.id;
  return useMutation({
    mutationFn: (config: SearchConfig) =>
      apiPatch<{ config: SearchConfig }>("/api/settings/search", config),
    onSuccess: ({ config }) => {
      queryClient.setQueryData<SearchSettingsResponse>(
        queryKeys.settings.search(userId),
        (prev) => (prev ? { ...prev, config } : prev),
      );
    },
    onError: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.settings.search(userId),
      });
    },
  });
}
