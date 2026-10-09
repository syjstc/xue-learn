import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPatch, apiPost, queryKeys } from "@/shared/api";
import { getAuthUser } from "@/shared/auth";

export type MemoryKind =
  "personal_fact" | "preference" | "constraint" | "episode";
export type MemoryStatus = "active" | "superseded" | "archived";
export type MemoryItem = {
  id: string;
  kind: MemoryKind;
  summary: string;
  stableKey: string;
  authority: "learner_declared" | "conversation_derived" | "trusted_workflow";
  status: MemoryStatus;
  confidence: number;
  importance: number;
  scope: {
    productId: string;
    domain: string;
    scopeType: "user" | "goal" | "thread";
    scopeId: string | null;
  };
  evidence: Array<{
    id: string;
    sourceType: "message" | "workflow" | "manual";
    excerpt: string;
    occurredAt: string;
  }>;
  asOf: string;
  createdAt: string;
  updatedAt: string;
};

export type MemoryCandidate = {
  id: string;
  kind: MemoryKind;
  stableKey: string;
  summary: string;
  action: "add" | "reinforce" | "correct" | "noop";
  confidence: number;
  importance: number;
  createdAt: string;
};

function useInvalidateMemory() {
  const queryClient = useQueryClient();
  const userId = getAuthUser()?.id;
  return () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.memories.all(userId) });
}

export function useMemorySettings() {
  const userId = getAuthUser()?.id;
  return useQuery({
    queryKey: queryKeys.settings.memory(userId),
    queryFn: () => apiGet<{ enabled: boolean }>("/api/settings/memory"),
    enabled: Boolean(userId),
  });
}

export function useSaveMemorySettings() {
  const queryClient = useQueryClient();
  const userId = getAuthUser()?.id;
  return useMutation({
    mutationFn: (enabled: boolean) =>
      apiPatch<{ enabled: boolean }>("/api/settings/memory", { enabled }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.settings.memory(userId), data);
    },
  });
}

export function useMemories(status: "active" | "archived") {
  const userId = getAuthUser()?.id;
  return useQuery({
    queryKey: queryKeys.memories.list(userId, status),
    queryFn: () =>
      apiGet<{ items: MemoryItem[]; nextCursor: string | null }>(
        `/api/memories?status=${status}&limit=50`,
      ),
    enabled: Boolean(userId),
  });
}

export function useMemoryCandidates() {
  const userId = getAuthUser()?.id;
  return useQuery({
    queryKey: queryKeys.memories.candidates(userId),
    queryFn: () =>
      apiGet<MemoryCandidate[]>("/api/memory-candidates?status=needs_review"),
    enabled: Boolean(userId),
  });
}

export function useCreateMemory() {
  const invalidate = useInvalidateMemory();
  return useMutation({
    mutationFn: (input: {
      kind: Exclude<MemoryKind, "episode">;
      summary: string;
    }) => apiPost<MemoryItem>("/api/memories", input),
    onSuccess: () => void invalidate(),
  });
}

export function useCorrectMemory() {
  const invalidate = useInvalidateMemory();
  return useMutation({
    mutationFn: (input: { id: string; summary: string }) =>
      apiPatch<MemoryItem>(`/api/memories/${input.id}`, {
        summary: input.summary,
      }),
    onSuccess: () => void invalidate(),
  });
}

export function useArchiveMemory() {
  const invalidate = useInvalidateMemory();
  return useMutation({
    mutationFn: (id: string) =>
      apiPost<MemoryItem>(`/api/memories/${id}/archive`),
    onSuccess: () => void invalidate(),
  });
}

export function useDeleteMemory() {
  const invalidate = useInvalidateMemory();
  return useMutation({
    mutationFn: (id: string) =>
      apiDelete<{ deleted: boolean }>(`/api/memories/${id}`),
    onSuccess: () => void invalidate(),
  });
}

export function useResolveMemoryCandidate() {
  const invalidate = useInvalidateMemory();
  return useMutation({
    mutationFn: (input: { id: string; decision: "accept" | "reject" }) =>
      apiPost(`/api/memory-candidates/${input.id}/resolve`, {
        decision: input.decision,
      }),
    onSuccess: () => void invalidate(),
  });
}
