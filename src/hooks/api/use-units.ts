import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, queryKeys, type UnitPageData } from "@/shared/api";
export function useUnitPage(unitId: string, goalId: string) {
  return useQuery({
    queryKey: queryKeys.units.page(unitId, goalId),
    queryFn: () =>
      apiGet<UnitPageData>(
        `/api/units/${unitId}/page?goalId=${encodeURIComponent(goalId)}`,
      ),
    enabled: Boolean(unitId && goalId),
  });
}

/** Remove a unit's sub-map and restore it to a single lesson. */
export function useRemoveSubMap() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (unitId: string) =>
      apiPost<{ ok?: boolean }>(`/api/units/${unitId}/subdivide/remove`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.goals.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.units.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agenda.all });
    },
  });
}
