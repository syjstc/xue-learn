import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiRequest } from "@/shared/api";
import type {
  GoalCreationSessionEventsResponse,
  GoalCreationSessionResponse,
} from "@/shared/agent/goal-creation-session";

export const goalCreationSessionKeys = {
  all: ["goal-creation-session"] as const,
  active: () => [...goalCreationSessionKeys.all, "active"] as const,
  goal: (goalId: string) =>
    [...goalCreationSessionKeys.all, "goal", goalId] as const,
  detail: (sessionId: string) =>
    [...goalCreationSessionKeys.all, "detail", sessionId] as const,
  events: (sessionId: string) =>
    [...goalCreationSessionKeys.all, "events", sessionId] as const,
};

function shouldPoll(data?: GoalCreationSessionResponse) {
  const status = data?.session?.status;
  return Boolean(status && status !== "completed");
}

export function useGoalCreationSessionEvents(
  sessionId: string,
  enabled = true,
  polling = true,
) {
  return useQuery({
    queryKey: goalCreationSessionKeys.events(sessionId),
    queryFn: () =>
      apiGet<GoalCreationSessionEventsResponse>(
        `/api/agent/goal-creation-sessions/${encodeURIComponent(sessionId)}/events?after=0`,
      ),
    enabled: enabled && Boolean(sessionId),
    refetchInterval: enabled && polling ? 2000 : false,
  });
}

export function useActiveGoalCreationSession(enabled = true) {
  return useQuery({
    queryKey: goalCreationSessionKeys.active(),
    queryFn: () =>
      apiGet<GoalCreationSessionResponse>(
        "/api/agent/goal-creation-sessions/active",
      ),
    enabled,
    refetchInterval: (query) => (shouldPoll(query.state.data) ? 2000 : false),
  });
}

export function useGoalCreationSessionByGoal(goalId: string) {
  return useQuery({
    queryKey: goalCreationSessionKeys.goal(goalId),
    queryFn: () =>
      apiGet<GoalCreationSessionResponse>(
        `/api/agent/goal-creation-sessions/by-goal/${encodeURIComponent(goalId)}`,
      ),
    enabled: Boolean(goalId),
    refetchInterval: (query) => (shouldPoll(query.state.data) ? 2000 : false),
  });
}

export function useGoalCreationSessionActions() {
  const client = useQueryClient();
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: goalCreationSessionKeys.all });
  };
  const create = useMutation({
    mutationFn: () =>
      apiPost<GoalCreationSessionResponse>(
        "/api/agent/goal-creation-sessions",
        {},
      ),
    onSuccess: refresh,
  });
  const retry = useMutation({
    mutationKey: ["goal-creation-session", "retry"],
    mutationFn: (sessionId: string) =>
      apiPost<GoalCreationSessionResponse>(
        `/api/agent/goal-creation-sessions/${sessionId}/retry`,
        {},
      ),
    onSuccess: refresh,
  });
  const stop = useMutation({
    mutationFn: (sessionId: string) =>
      apiPost<GoalCreationSessionResponse>(
        `/api/agent/goal-creation-sessions/${sessionId}/stop`,
        {},
      ),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (sessionId: string) =>
      apiRequest<{ ok: boolean; deletedGoalId: string | null }>(
        `/api/agent/goal-creation-sessions/${encodeURIComponent(sessionId)}`,
        { method: "DELETE", body: JSON.stringify({ confirm: "DELETE" }) },
      ),
    onMutate: async (sessionId) => {
      await client.cancelQueries({
        queryKey: goalCreationSessionKeys.events(sessionId),
      });
    },
    onSuccess: async (_result, sessionId) => {
      client.removeQueries({
        queryKey: goalCreationSessionKeys.events(sessionId),
      });
      client.removeQueries({
        queryKey: goalCreationSessionKeys.detail(sessionId),
      });
      await Promise.all([
        client.invalidateQueries({
          queryKey: goalCreationSessionKeys.active(),
        }),
        client.invalidateQueries({
          queryKey: [...goalCreationSessionKeys.all, "goal"],
        }),
      ]);
    },
  });
  return { create, retry, stop, remove };
}
