import type {
  ContextAuthority,
  ContextEnvelope,
  LearningSystemCapability,
  LearningSystemSubject,
} from "../../types.js";

export const VERSION = "1.0.0";

export const OPTIONAL_CONTEXT_VIEW_KEYS = {
  assessmentHistory: "assessment.history.v1",
  scenarioTheaterCurrent: "scenario_theater.current.v1",
} as const;

export function envelope<T>(params: {
  ownerCapabilityId: string;
  ownerCapabilityVersion?: string;
  authority: ContextAuthority;
  scope: LearningSystemSubject;
  data: T;
  asOf?: Date | null;
}): ContextEnvelope<T> {
  return {
    ownerCapabilityId: params.ownerCapabilityId,
    ownerCapabilityVersion: params.ownerCapabilityVersion ?? VERSION,
    schemaVersion: 1,
    authority: params.authority,
    scope: { ...params.scope },
    freshness: {
      asOf: (params.asOf ?? new Date()).toISOString(),
      stale: false,
    },
    data: params.data,
  };
}
