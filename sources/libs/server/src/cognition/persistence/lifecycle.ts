import type {
  EvidenceLifecycleProjectionStatus,
  LifecycleEventProjection,
} from "./types.js";

type PersistedLifecycleClaim = {
  status: string;
  validFrom?: Date;
  lifecycleEvents?: readonly LifecycleEventProjection[];
};

function lifecycleEventsThrough(
  events: readonly LifecycleEventProjection[],
  asOf: Date,
): LifecycleEventProjection[] {
  return events
    .filter((event) => event.createdAt.getTime() <= asOf.getTime())
    .sort(
      (left, right) =>
        left.createdAt.getTime() - right.createdAt.getTime() ||
        left.id.localeCompare(right.id),
    );
}

export function latestEvidenceLifecycleEvent(
  claim: PersistedLifecycleClaim,
  asOf = new Date(),
): LifecycleEventProjection | null {
  if (!Array.isArray(claim.lifecycleEvents)) return null;
  return lifecycleEventsThrough(claim.lifecycleEvents, asOf).at(-1) ?? null;
}

/** Lifecycle events are authoritative; EvidenceClaim.status is a projection. */
export function evidenceLifecycleStatus(
  claim: PersistedLifecycleClaim,
  asOf = new Date(),
): EvidenceLifecycleProjectionStatus {
  if (claim.validFrom && claim.validFrom.getTime() > asOf.getTime()) {
    return "invalidated";
  }
  // Unit-test doubles created before lifecycle loading omit the relation. A
  // real persistence read always includes it; an explicitly empty event list
  // therefore remains inactive instead of trusting the mutable status column.
  if (!Array.isArray(claim.lifecycleEvents)) {
    return claim.status === undefined || claim.status === "active"
      ? "active"
      : claim.status === "superseded"
        ? "superseded"
        : claim.status === "retracted"
          ? "retracted"
          : "invalidated";
  }
  let status: EvidenceLifecycleProjectionStatus = "invalidated";
  for (const event of lifecycleEventsThrough(claim.lifecycleEvents, asOf)) {
    if (event.eventType === "created" || event.eventType === "restored") {
      status = "active";
    } else if (event.eventType === "retracted") {
      status = "retracted";
    } else if (event.eventType === "superseded") {
      status = "superseded";
    } else if (event.eventType === "invalidated") {
      status = "invalidated";
    }
  }
  return status;
}

export function evidenceClaimIsActive(
  claim: PersistedLifecycleClaim,
  asOf = new Date(),
): boolean {
  return evidenceLifecycleStatus(claim, asOf) === "active";
}
