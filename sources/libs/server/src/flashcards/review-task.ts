const LEARNER_STATE_STATUSES = [
  'unobserved',
  'forming',
  'demonstrated',
  'robust',
  'revalidate',
] as const;

export type LearnerStateStatus = (typeof LEARNER_STATE_STATUSES)[number];

export type ReviewEntityCandidate = {
  entity: {
    id: string;
    title: string;
    description: string;
    atom: { explanation: string } | null;
  };
  state: {
    estimate: number | null;
    evidenceSufficiency: number;
    status: string;
  } | null;
  gate: boolean;
  required: boolean;
  mappingRole: string;
  mappingOrder: number;
  requirementOrder: number;
};

const STATUS_PRIORITY: Record<LearnerStateStatus, number> = {
  revalidate: 0,
  forming: 1,
  unobserved: 2,
  demonstrated: 3,
  robust: 4,
};

export function learnerStateStatus(
  value: string | undefined,
): LearnerStateStatus {
  return LEARNER_STATE_STATUSES.includes(value as LearnerStateStatus)
    ? (value as LearnerStateStatus)
    : 'unobserved';
}

/** Select one deterministic direct entity for a unit-level ReviewCard. */
export function selectReviewEntity(
  candidates: readonly ReviewEntityCandidate[],
): ReviewEntityCandidate | null {
  const unique = new Map<string, ReviewEntityCandidate>();
  for (const candidate of candidates) {
    const current = unique.get(candidate.entity.id);
    if (!current || compareReviewCandidates(candidate, current) < 0) {
      unique.set(candidate.entity.id, candidate);
    }
  }
  return [...unique.values()].sort(compareReviewCandidates)[0] ?? null;
}

function compareReviewCandidates(
  left: ReviewEntityCandidate,
  right: ReviewEntityCandidate,
): number {
  const leftStatus = learnerStateStatus(left.state?.status);
  const rightStatus = learnerStateStatus(right.state?.status);
  return (
    STATUS_PRIORITY[leftStatus] - STATUS_PRIORITY[rightStatus] ||
    Number(right.gate) - Number(left.gate) ||
    Number(right.required) - Number(left.required) ||
    (left.state?.evidenceSufficiency ?? 0) -
      (right.state?.evidenceSufficiency ?? 0) ||
    (left.state?.estimate ?? -1) - (right.state?.estimate ?? -1) ||
    (left.mappingRole === 'primary' ? 0 : 1) -
      (right.mappingRole === 'primary' ? 0 : 1) ||
    left.mappingOrder - right.mappingOrder ||
    left.requirementOrder - right.requirementOrder ||
    left.entity.id.localeCompare(right.entity.id)
  );
}
