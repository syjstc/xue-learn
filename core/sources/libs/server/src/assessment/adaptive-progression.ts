export type AdaptiveProgressionRequirement = Readonly<{
  id: string;
  required: boolean;
}>;

export type AdaptiveProgressionDecision = Readonly<{
  status: "incomplete" | "evidence_complete";
  remainingRequirementIds: readonly string[];
  progression: "pending_policy";
}>;

/**
 * Portable adaptive completion policy. A task is evidence-complete only when
 * every required immutable requirement has one active claim. Scores are kept
 * out of this navigation decision: threshold/passing policy belongs to the
 * owning assessment/progression capability and must never be guessed locally.
 */
export function decideAdaptiveEvidenceProgression(input: {
  requirements: readonly AdaptiveProgressionRequirement[];
  activeRequirementIds: ReadonlySet<string>;
}): AdaptiveProgressionDecision {
  const remainingRequirementIds = input.requirements
    .filter(
      (requirement) =>
        requirement.required && !input.activeRequirementIds.has(requirement.id),
    )
    .map((requirement) => requirement.id);
  return {
    status: remainingRequirementIds.length ? "incomplete" : "evidence_complete",
    remainingRequirementIds,
    progression: "pending_policy",
  };
}
