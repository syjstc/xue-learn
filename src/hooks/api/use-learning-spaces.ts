import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiRequest,
  queryKeys,
} from "@/shared/api";

export type LearningSpaceGoal = {
  id: string;
  title: string;
  goalKind: "full" | "micro";
  status: string;
  iconSvg: string;
  iconTint: string;
  parentGoalId: string | null;
  goalRelationType: string | null;
  updatedAt: string;
};

export type PlannedGoalBriefV1 = {
  schemaVersion: 1;
  originalRequest: string;
  intendedOutcome: string;
  scopeIncluded: string[];
  scopeExcluded: string[];
  prerequisites: string[];
  desiredOutputs: string[];
  suggestedLevel: "zero" | "basic" | "advanced";
  suggestedLearningMode: "exploration" | "mastery";
  suggestedPlanningMode: "fast" | "deep" | "docs_first";
  suggestedContentLanguage: string;
};

export type LearningSpaceItem = {
  id: string;
  spaceId: string;
  itemType: "goal" | "planned_goal";
  goalId: string | null;
  plannedTitle: string;
  rationale: string;
  suggestedGoalKind: "full" | "micro";
  goalBrief?: PlannedGoalBriefV1 | null;
  source: string;
  sortIndex: number;
  goal: LearningSpaceGoal | null;
};

export type LearningSpaceRelation = {
  id: string;
  fromItemId: string;
  toItemId: string;
  relationType: "prerequisite" | "supports" | "follow_up" | "related";
  source: string;
};

export type LearningSpace = {
  id: string;
  name: string;
  purpose: string;
  sortIndex: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  items: LearningSpaceItem[];
  relations: LearningSpaceRelation[];
};

export type LearningSpacePortfolio = {
  fingerprint: string;
  spaces: LearningSpace[];
  unorganizedGoals: LearningSpaceGoal[];
};

type MoveGoalInput = {
  goalId: string;
  spaceId: string | null;
  includeFoundationGoalIds?: string[];
};

function put<T>(path: string, body: unknown) {
  return apiRequest<T>(path, { method: "PUT", body: JSON.stringify(body) });
}

function useSpaceMutation<TInput, TOutput>(
  mutationFn: (input: TInput) => Promise<TOutput>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.learningSpaces.all,
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.goals.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agenda.all });
    },
  });
}

export function useLearningSpaces() {
  return useQuery({
    queryKey: queryKeys.learningSpaces.portfolio(),
    queryFn: () => apiGet<LearningSpacePortfolio>("/api/learning-spaces"),
  });
}

export function useCreateLearningSpace() {
  return useSpaceMutation((input: { name: string; purpose?: string }) =>
    apiPost<LearningSpace>("/api/learning-spaces", input),
  );
}

export function useUpdateLearningSpace() {
  return useSpaceMutation(
    (input: { spaceId: string; name?: string; purpose?: string }) => {
      const { spaceId, ...body } = input;
      return apiPatch<LearningSpace>(
        `/api/learning-spaces/${encodeURIComponent(spaceId)}`,
        body,
      );
    },
  );
}

export function useDeleteLearningSpace() {
  return useSpaceMutation((spaceId: string) =>
    apiDelete<{ ok: true }>(
      `/api/learning-spaces/${encodeURIComponent(spaceId)}`,
    ),
  );
}

export function useCreatePlannedGoal() {
  return useSpaceMutation(
    (input: {
      spaceId: string;
      title: string;
      rationale?: string;
      suggestedGoalKind?: "full" | "micro";
      goalBrief?: PlannedGoalBriefV1;
    }) => {
      const { spaceId, ...body } = input;
      return apiPost<LearningSpaceItem>(
        `/api/learning-spaces/${encodeURIComponent(spaceId)}/planned-goals`,
        body,
      );
    },
  );
}

export function useRemoveLearningSpaceItem() {
  return useSpaceMutation((itemId: string) =>
    apiDelete<{ ok: true }>(
      `/api/learning-spaces/items/${encodeURIComponent(itemId)}`,
    ),
  );
}

export function useMoveGoalToLearningSpace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: MoveGoalInput) => {
      const { goalId, ...body } = input;
      return put<{ ok: true }>(
        `/api/learning-spaces/goals/${encodeURIComponent(goalId)}`,
        body,
      );
    },
    onMutate: async (input) => {
      const cancelPortfolioQuery = queryClient.cancelQueries({
        queryKey: queryKeys.learningSpaces.portfolio(),
      });
      const previous = queryClient.getQueryData<LearningSpacePortfolio>(
        queryKeys.learningSpaces.portfolio(),
      );
      if (!previous) {
        await cancelPortfolioQuery;
        return { previous };
      }

      const sourceSpace = previous.spaces.find((space) =>
        space.items.some((item) => item.goalId === input.goalId),
      );
      const sourceSpaceId = sourceSpace?.id ?? null;
      const foundationGoalIds =
        input.includeFoundationGoalIds ??
        [
          ...previous.unorganizedGoals,
          ...previous.spaces.flatMap((space) =>
            space.items.flatMap((item) => (item.goal ? [item.goal] : [])),
          ),
        ]
          .filter(
            (goal) =>
              goal.parentGoalId === input.goalId &&
              goal.goalRelationType === "foundation_support" &&
              (previous.spaces.find((space) =>
                space.items.some((item) => item.goalId === goal.id),
              )?.id ?? null) === sourceSpaceId,
          )
          .map((goal) => goal.id);
      const movedGoalIds = new Set([input.goalId, ...foundationGoalIds]);
      const movedItems = previous.spaces.flatMap((space) =>
        space.items.filter(
          (item) => item.goalId && movedGoalIds.has(item.goalId),
        ),
      );
      const movedGoals = [
        ...previous.unorganizedGoals,
        ...movedItems.flatMap((item) => (item.goal ? [item.goal] : [])),
      ].filter((goal) => movedGoalIds.has(goal.id));
      const movedItemIds = new Set(movedItems.map((item) => item.id));

      queryClient.setQueryData<LearningSpacePortfolio>(
        queryKeys.learningSpaces.portfolio(),
        {
          ...previous,
          unorganizedGoals:
            input.spaceId === null
              ? [
                  ...previous.unorganizedGoals.filter(
                    (goal) => !movedGoalIds.has(goal.id),
                  ),
                  ...movedGoals,
                ]
              : previous.unorganizedGoals.filter(
                  (goal) => !movedGoalIds.has(goal.id),
                ),
          spaces: previous.spaces.map((space) => {
            const remainingItems = space.items.filter(
              (item) => !item.goalId || !movedGoalIds.has(item.goalId),
            );
            if (space.id !== input.spaceId) {
              return {
                ...space,
                items: remainingItems,
                relations: space.relations.filter(
                  (relation) =>
                    !movedItemIds.has(relation.fromItemId) &&
                    !movedItemIds.has(relation.toItemId),
                ),
              };
            }

            const startingIndex = remainingItems.length;
            const targetItems = movedGoals.map((goal, index) => {
              const existing = movedItems.find(
                (item) => item.goalId === goal.id,
              );
              return existing
                ? {
                    ...existing,
                    spaceId: space.id,
                    sortIndex: startingIndex + index,
                  }
                : {
                    id: `optimistic:${goal.id}`,
                    spaceId: space.id,
                    itemType: "goal" as const,
                    goalId: goal.id,
                    plannedTitle: "",
                    rationale: "",
                    suggestedGoalKind: goal.goalKind,
                    source: "manual",
                    sortIndex: startingIndex + index,
                    goal,
                  };
            });
            return {
              ...space,
              items: [...remainingItems, ...targetItems],
              relations: space.relations.filter(
                (relation) =>
                  !movedItemIds.has(relation.fromItemId) &&
                  !movedItemIds.has(relation.toItemId),
              ),
            };
          }),
        },
      );
      await cancelPortfolioQuery;
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          queryKeys.learningSpaces.portfolio(),
          context.previous,
        );
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.learningSpaces.all,
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.goals.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agenda.all });
    },
  });
}

export function useReorderLearningSpaceItems() {
  return useSpaceMutation(
    (input: { spaceId: string; orderedItemIds: string[] }) =>
      put<{ ok: true }>(
        `/api/learning-spaces/${encodeURIComponent(input.spaceId)}/items/order`,
        {
          orderedItemIds: input.orderedItemIds,
        },
      ),
  );
}

export function useCreateLearningSpaceRelation() {
  return useSpaceMutation(
    (input: {
      spaceId: string;
      fromItemId: string;
      toItemId: string;
      relationType: LearningSpaceRelation["relationType"];
    }) => {
      const { spaceId, ...body } = input;
      return apiPost<LearningSpaceRelation>(
        `/api/learning-spaces/${encodeURIComponent(spaceId)}/relations`,
        body,
      );
    },
  );
}

export function useDeleteLearningSpaceRelation() {
  return useSpaceMutation((relationId: string) =>
    apiDelete<{ ok: true }>(
      `/api/learning-spaces/relations/${encodeURIComponent(relationId)}`,
    ),
  );
}
