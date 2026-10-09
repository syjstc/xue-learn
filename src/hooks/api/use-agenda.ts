import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch, apiPost, queryKeys } from "@/shared/api";
import type { components } from "@xue-learn/core/source/src/shared/api/generated/api.ts";

export type AgendaItem = components["schemas"]["AgendaItem"];
export type AgendaDay = components["schemas"]["AgendaDay"];
export type AgendaResponse = components["schemas"]["AgendaResponse"];
export type AgendaSettings = components["schemas"]["AgendaSettings"];
export type PatchAgendaSettingsRequest =
  components["schemas"]["PatchAgendaSettingsRequest"];
export type RefreshAgendaResponse =
  components["schemas"]["RefreshAgendaResponse"];
export type AgendaItemExplanation =
  components["schemas"]["AgendaItemExplanation"];

export function useAgenda(goalId?: string, spaceId?: string) {
  return useQuery({
    queryKey: goalId || spaceId
      ? [...queryKeys.agenda.current(), goalId ?? "", spaceId ?? ""]
      : queryKeys.agenda.current(),
    queryFn: () =>
      apiGet<AgendaResponse>(
        goalId
          ? `/api/agenda?goalId=${encodeURIComponent(goalId)}`
          : spaceId
            ? `/api/agenda?spaceId=${encodeURIComponent(spaceId)}`
            : "/api/agenda",
      ),
  });
}

export function useAgendaSettings() {
  return useQuery({
    queryKey: queryKeys.agenda.settings(),
    queryFn: () => apiGet<AgendaSettings>("/api/agenda/settings"),
  });
}

export function usePatchAgendaSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PatchAgendaSettingsRequest) =>
      apiPatch<AgendaSettings>("/api/agenda/settings", body),
    onSuccess: (updated) => {
      qc.setQueryData(queryKeys.agenda.settings(), updated);
      void qc.invalidateQueries({ queryKey: queryKeys.agenda.all });
    },
  });
}

export function usePatchTodayAgendaCapacity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (minutes: number | null) =>
      apiPatch<AgendaSettings>("/api/agenda/today-capacity", { minutes }),
    onSuccess: (updated) => {
      qc.setQueryData(queryKeys.agenda.settings(), updated);
      void qc.invalidateQueries({ queryKey: queryKeys.agenda.all });
    },
  });
}

export function useRefreshAgenda() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (force?: boolean) =>
      apiPost<RefreshAgendaResponse>("/api/agenda/refresh", { force }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.agenda.all });
    },
  });
}

export function useAgendaItemExplanation(
  itemId: string | null,
  enabled = false,
) {
  return useQuery({
    queryKey: [...queryKeys.agenda.all, "explanation", itemId ?? ""],
    queryFn: () =>
      apiGet<AgendaItemExplanation>(`/api/agenda/items/${itemId}/explanation`),
    enabled: enabled && !!itemId,
  });
}
