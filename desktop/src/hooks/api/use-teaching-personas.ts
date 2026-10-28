import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/shared/api";

export type TeachingPersonaInstructions = {
  version: 2;
  base: string;
  course?: string;
  assessment?: string;
  followUp?: string;
};
export type TeachingPersona = {
  ref: string;
  kind: "builtin" | "custom";
  code: string;
  archetypeCode?: string | null;
  name: string;
  avatarCode: string;
  gender: "male" | "female";
  tagline: string;
  introduction: string;
  traits: string[];
  bestFor: string[];
  learnerAddress: string;
  instructions: TeachingPersonaInstructions;
  editable: boolean;
};
export type TeachingPersonaDraft = Pick<
  TeachingPersona,
  "name" | "avatarCode" | "tagline" | "learnerAddress" | "instructions"
>;
export type TeachingPersonaPreviewSample =
  { status: "success"; text: string } | { status: "error"; message: string };
export type TeachingPersonaPreview = {
  samples: Partial<
    Record<"course" | "assessment" | "follow_up", TeachingPersonaPreviewSample>
  >;
};
export type TeachingPersonaCatalog = {
  current: TeachingPersona;
  globalRef: string;
  goalPersonaRef?: string | null;
  builtin: TeachingPersona[];
  custom: TeachingPersona[];
};

const key = ["teaching-personas"] as const;
export function useTeachingPersonas(
  options: boolean | { enabled?: boolean; goalId?: string } = true,
) {
  const { enabled, goalId } =
    typeof options === "boolean"
      ? { enabled: options, goalId: undefined }
      : { enabled: options.enabled ?? true, goalId: options.goalId };

  return useQuery({
    queryKey: goalId ? [...key, goalId] : key,
    queryFn: () =>
      apiGet<TeachingPersonaCatalog>(
        goalId
          ? `/api/teaching-personas?goalId=${encodeURIComponent(goalId)}`
          : "/api/teaching-personas",
      ),
    enabled,
  });
}
export function useSelectTeachingPersona() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (personaRef: string) =>
      apiPatch("/api/settings/teaching-persona", { personaRef }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
}
export function useCreateTeachingPersona() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TeachingPersonaDraft) =>
      apiPost<TeachingPersona>("/api/teaching-personas", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
}
export function useUpdateTeachingPersona() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: TeachingPersonaDraft }) =>
      apiPatch<TeachingPersona>(`/api/teaching-personas/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
}
export function usePreviewTeachingPersona() {
  return useMutation({
    mutationFn: (
      body: TeachingPersonaDraft & {
        previewScenes?: Array<"course" | "assessment" | "follow_up">;
      },
    ) =>
      apiPost<TeachingPersonaPreview>("/api/teaching-personas/preview", body),
  });
}
export function useDeleteTeachingPersona() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/api/teaching-personas/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
}
