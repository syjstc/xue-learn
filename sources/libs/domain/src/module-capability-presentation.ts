export type ModuleCapabilityRequirementInput = Readonly<{
  cognitiveEntityId: string;
  dimension: string;
  threshold: number;
  required: boolean;
  gate: boolean;
  weight: number;
  estimate: number | null;
  evidenceSufficiency: number;
  stateStatus: string;
}>;

export type ModuleCapabilityPresentationInput = Readonly<{
  id: string;
  localRef: string;
  title: string;
  description: string;
  learningObjective: string;
  assessmentCriteria: unknown;
  importance: string;
  targetCognitiveLevel: string;
  required: boolean;
  requirements: readonly ModuleCapabilityRequirementInput[];
  practiceUnitId?: string | null;
  practiceUnitTitle?: string | null;
}>;

const PRACTICE_UNIT_ROLE_RANK: Readonly<Record<string, number>> = {
  verify: 0,
  integrate: 1,
  practice: 2,
  introduce: 3,
  support: 4,
};

export function pickModuleCapabilityPracticeUnit(
  units: readonly Readonly<{
    id: string;
    title: string;
    orderIndex: number;
    moduleCapabilityRefs: readonly string[];
    moduleMilestoneRole?: string | null;
  }>[],
  capabilityIndex: number,
): { practiceUnitId: string; practiceUnitTitle: string } | null {
  const ref = `mc_${capabilityIndex + 1}`;
  const ranked = units
    .filter((unit) => unit.moduleCapabilityRefs.includes(ref))
    .sort((left, right) => {
      const leftRank =
        PRACTICE_UNIT_ROLE_RANK[left.moduleMilestoneRole ?? ""] ?? 50;
      const rightRank =
        PRACTICE_UNIT_ROLE_RANK[right.moduleMilestoneRole ?? ""] ?? 50;
      return leftRank === rightRank
        ? left.orderIndex - right.orderIndex
        : leftRank - rightRank;
    });
  const best = ranked[0];
  return best
    ? { practiceUnitId: best.id, practiceUnitTitle: best.title }
    : null;
}

/** Shared hosted/local learner DTO policy. Unobserved evidence never becomes mastery. */
export function presentModuleCapability(
  input: ModuleCapabilityPresentationInput,
) {
  const requirements = input.requirements.map((requirement) => ({
    ...requirement,
    passed:
      requirement.estimate != null &&
      requirement.estimate >= requirement.threshold &&
      requirement.evidenceSufficiency >= 0.5,
  }));
  const missingRequirements = requirements.filter(
    (requirement) =>
      (requirement.required || requirement.gate) && !requirement.passed,
  );
  return {
    id: input.id,
    localRef: input.localRef,
    title: input.title,
    description: input.description,
    learningObjective: input.learningObjective,
    assessmentCriteria: input.assessmentCriteria,
    importance: input.importance,
    targetCognitiveLevel: input.targetCognitiveLevel,
    required: input.required,
    requirements,
    missingRequirements,
    practiceUnitId: input.practiceUnitId ?? null,
    practiceUnitTitle: input.practiceUnitTitle ?? null,
    readiness: requirements.every((requirement) => requirement.estimate == null)
      ? ("unobserved" as const)
      : missingRequirements.length === 0
        ? ("demonstrated" as const)
        : ("needs_evidence" as const),
  };
}
