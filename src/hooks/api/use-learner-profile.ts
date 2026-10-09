import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch, apiPost, queryKeys } from "@/shared/api";
import { getAuthUser } from "@/shared/auth";
import { resolveLearnerDisplayName } from "@/shared/domain/learner-text";
import { isDesktopLocalRuntime } from "@xue-learn/core/source/src/shared/runtime/client-runtime.ts";
import { learnerProfileCacheUserId } from "./learner-profile-cache.ts";

export type LearnerAgeRange =
  "18_24" | "25_34" | "35_44" | "45_plus" | "prefer_not_to_say";

export type LearnerEducationLevel =
  | "high_school"
  | "vocational"
  | "undergraduate"
  | "graduate"
  | "self_taught"
  | "prefer_not_to_say";

export type LearnerKnowledgeLevel = "heard_of" | "basic" | "working" | "strong";

export type LearnerKnowledgeItem = {
  topic: string;
  domain?: string;
  level: LearnerKnowledgeLevel;
  confidence: "user_stated";
  source: "onboarding" | "manual";
  updatedAt: string;
};

export type LearnerProfile = {
  onboardingCompleted: boolean;
  nickname?: string;
  ageRange?: LearnerAgeRange;
  educationLevel?: LearnerEducationLevel;
  majorOrField?: string;
  customInfo?: string;
  generalSkills: string[];
  knowledgeItems: LearnerKnowledgeItem[];
};

export type LearnerProfileResponse = {
  profile: LearnerProfile;
};

export function useLearnerProfile(enabled = true) {
  const userId = getAuthUser()?.id;
  const local = isDesktopLocalRuntime();
  return useQuery({
    queryKey: queryKeys.profile.learner(
      learnerProfileCacheUserId(userId, local),
    ),
    queryFn: () => apiGet<LearnerProfileResponse>("/api/profile/learner"),
    enabled: enabled && (Boolean(userId) || local),
    staleTime: 30_000,
  });
}

/** Nickname for AI address, falling back to login username. */
export function useLearnerDisplayName(enabled = true): string | undefined {
  const user = getAuthUser();
  const learnerProfile = useLearnerProfile(enabled && Boolean(user));
  return resolveLearnerDisplayName(
    learnerProfile.data?.profile.nickname,
    user?.name,
  );
}

export function useSaveLearnerProfile() {
  const queryClient = useQueryClient();
  const userId = getAuthUser()?.id;
  const local = isDesktopLocalRuntime();
  return useMutation({
    mutationFn: (patch: Partial<LearnerProfile>) =>
      apiPatch<LearnerProfileResponse>("/api/profile/learner", patch),
    onSuccess: (data) => {
      queryClient.setQueryData(
        queryKeys.profile.learner(learnerProfileCacheUserId(userId, local)),
        data,
      );
    },
  });
}

export function useSaveLearnerKnowledge() {
  const queryClient = useQueryClient();
  const userId = getAuthUser()?.id;
  const local = isDesktopLocalRuntime();
  return useMutation({
    mutationFn: (
      item: Omit<LearnerKnowledgeItem, "updatedAt"> & { updatedAt?: string },
    ) =>
      apiPost<LearnerProfileResponse>("/api/profile/learner/knowledge", item),
    onSuccess: (data) => {
      queryClient.setQueryData(
        queryKeys.profile.learner(learnerProfileCacheUserId(userId, local)),
        data,
      );
    },
  });
}
