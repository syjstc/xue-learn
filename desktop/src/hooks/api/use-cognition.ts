import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/shared/api";
import type {
  GetCognitiveEntityEvidenceResponse,
  GetCognitiveEntityStateResponse,
  GetUnitLearningTargetsResponse,
} from "@/shared/domain/cognitive-model";
import type { GetUnitConceptMapResponse } from "@/shared/domain/unit-concept-map";

export function useUnitConceptMap(
  unitId: string,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ["units", unitId, "concept-map"],
    queryFn: () =>
      apiGet<GetUnitConceptMapResponse>(
        `/api/units/${encodeURIComponent(unitId)}/concept-map`,
      ),
    enabled: Boolean(unitId) && (options?.enabled ?? true),
    retry: false,
  });
}

export function useUnitLearningTargets(
  unitId: string,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ["units", unitId, "learning-targets"],
    queryFn: () =>
      apiGet<GetUnitLearningTargetsResponse>(
        `/api/units/${encodeURIComponent(unitId)}/learning-targets`,
      ),
    enabled: Boolean(unitId) && (options?.enabled ?? true),
  });
}

export function useCognitiveEntityState(
  entityId: string | null,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ["cognition", "entities", entityId, "state"],
    queryFn: () =>
      apiGet<GetCognitiveEntityStateResponse>(
        `/api/cognition/entities/${encodeURIComponent(entityId!)}/state`,
      ),
    enabled: Boolean(entityId) && (options?.enabled ?? true),
  });
}

export function useCognitiveEntityEvidence(
  entityId: string | null,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ["cognition", "entities", entityId, "evidence"],
    queryFn: () =>
      apiGet<GetCognitiveEntityEvidenceResponse>(
        `/api/cognition/entities/${encodeURIComponent(entityId!)}/evidence`,
      ),
    enabled: Boolean(entityId) && (options?.enabled ?? true),
  });
}
