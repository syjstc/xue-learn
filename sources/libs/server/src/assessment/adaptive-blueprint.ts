import type {
  CognitiveDimension,
  CognitiveEntityKind,
  ContextDistance,
} from "../cognition/index.js";

export const ADAPTIVE_ASSESSMENT_POLICY_VERSION = 2;

export type AssessmentScope = "unit" | "module" | "goal";
export type AssessmentDemandTier = "basic" | "standard" | "advanced";
export type AssessmentItemKind =
  | "selected_response"
  | "constructed_response"
  | "performance_case"
  | "integrated_challenge"
  | "synthesis_challenge"
  | "delayed_retention";

export type AdaptiveAssessmentRequirement = {
  cognitiveEntityId: string;
  entityKind: CognitiveEntityKind;
  dimension: CognitiveDimension;
  required: boolean;
  gate: boolean;
  weight: number;
  threshold: number;
};

export type AdaptiveAssessmentTarget = {
  id: string;
  localRef: string;
  title: string;
  importance: "core" | "supporting" | "enrichment";
  importanceWeight: number;
  difficulty: "easy" | "medium" | "hard";
  targetCognitiveLevel:
    | "remember"
    | "understand"
    | "apply"
    | "analyze"
    | "evaluate"
    | "create";
  assessmentCriteria: ReadonlyArray<{ ref: string; text: string }>;
  requirements: readonly AdaptiveAssessmentRequirement[];
};

export type ExistingRequirementEvidence = {
  claimCount: number;
  contextCount?: number;
  independentClaimCount?: number;
  constructedResponseCount?: number;
  hasFarContext?: boolean;
  timeSpanDays?: number;
};

export type AssessmentEvidenceKey = `${string}:${string}:${CognitiveDimension}`;

export function assessmentEvidenceKey(
  learningTargetId: string,
  cognitiveEntityId: string,
  dimension: CognitiveDimension,
): AssessmentEvidenceKey {
  return `${learningTargetId}:${cognitiveEntityId}:${dimension}`;
}

export type AssessmentEvidenceSlot = {
  id: string;
  learningTargetId: string;
  localLearningTargetRef: string;
  cognitiveEntityId: string;
  entityKind: CognitiveEntityKind;
  dimension: CognitiveDimension;
  criterionRef: string;
  tier: AssessmentDemandTier;
  itemKind: AssessmentItemKind;
  contextDistance: ContextDistance;
  estimatedMinutes: number;
  required: boolean;
  gate: boolean;
  minimumTimeSpanDays: number;
  purpose: string;
};

export type AssessmentBlueprint = {
  policyVersion: typeof ADAPTIVE_ASSESSMENT_POLICY_VERSION;
  scope: AssessmentScope;
  timeBudgetMinutes: number;
  estimatedMinutes: number;
  slots: AssessmentEvidenceSlot[];
  deferredSlots: AssessmentEvidenceSlot[];
};

const HIGH_COGNITIVE_LEVELS = new Set(["analyze", "evaluate", "create"]);

export function assessmentDemandTier(
  target: AdaptiveAssessmentTarget,
  requirement: AdaptiveAssessmentRequirement,
): AssessmentDemandTier {
  if (
    target.difficulty === "hard" ||
    HIGH_COGNITIVE_LEVELS.has(target.targetCognitiveLevel) ||
    requirement.entityKind === "competency" ||
    requirement.dimension === "transfer" ||
    (requirement.entityKind === "skill" &&
      ["application", "transfer"].includes(requirement.dimension))
  ) {
    return "advanced";
  }
  if (
    target.importance === "core" ||
    target.difficulty === "medium" ||
    requirement.gate ||
    requirement.entityKind !== "atom" ||
    !["memory", "understanding"].includes(requirement.dimension)
  ) {
    return "standard";
  }
  return "basic";
}

export function requiredEvidenceCount(
  dimension: CognitiveDimension,
  tier: AssessmentDemandTier,
): number {
  switch (dimension) {
    case "memory":
    case "understanding":
      return tier === "basic" ? 2 : tier === "standard" ? 3 : 4;
    case "application":
      return tier === "basic" ? 2 : tier === "standard" ? 3 : 4;
    case "transfer":
      return tier === "advanced" ? 4 : 3;
    case "fluency":
    case "independence":
      return tier === "advanced" ? 3 : 2;
    case "stability":
      return 3;
  }
}

function requiredConstructedResponses(
  dimension: CognitiveDimension,
  tier: AssessmentDemandTier,
): number {
  if (dimension !== "understanding") return 0;
  if (tier === "advanced") return 2;
  if (tier === "standard") return 1;
  return 0;
}

function requiredContextCount(
  dimension: CognitiveDimension,
  tier: AssessmentDemandTier,
): number {
  if (dimension === "transfer") return 3;
  if (dimension === "application") return tier === "advanced" ? 3 : 2;
  if (dimension === "memory" && tier === "advanced") return 2;
  return 1;
}

function contextDistanceFor(
  dimension: CognitiveDimension,
  tier: AssessmentDemandTier,
  slotIndex: number,
  total: number,
): ContextDistance {
  if (dimension === "transfer") {
    return slotIndex === total - 1 ? "far" : slotIndex === 0 ? "same" : "near";
  }
  if (dimension === "application") {
    return slotIndex === 0 ? "same" : "near";
  }
  if (tier === "advanced" && slotIndex >= Math.ceil(total / 2)) return "near";
  return "same";
}

function itemKindFor(params: {
  scope: AssessmentScope;
  dimension: CognitiveDimension;
  constructed: boolean;
}): AssessmentItemKind {
  if (params.dimension === "stability") return "delayed_retention";
  if (params.constructed) return "constructed_response";
  if (params.dimension === "memory" || params.dimension === "understanding") {
    return "selected_response";
  }
  if (params.scope === "goal") return "synthesis_challenge";
  if (params.scope === "module") return "integrated_challenge";
  return "performance_case";
}

function estimatedMinutesFor(kind: AssessmentItemKind): number {
  switch (kind) {
    case "selected_response":
      return 1;
    case "constructed_response":
    case "delayed_retention":
      return 3;
    case "performance_case":
      return 7;
    case "integrated_challenge":
    case "synthesis_challenge":
      return 8;
  }
}

function criterionFor(
  target: AdaptiveAssessmentTarget,
  slotIndex: number,
): string {
  const criteria = target.assessmentCriteria;
  return criteria[slotIndex % Math.max(1, criteria.length)]?.ref ?? "criterion";
}

function slotPurpose(
  dimension: CognitiveDimension,
  kind: AssessmentItemKind,
): string {
  if (kind === "delayed_retention") return "验证跨时间保持";
  if (kind === "constructed_response") return "验证解释、边界或推理";
  if (kind === "performance_case") return "验证直接应用表现";
  if (kind === "integrated_challenge") return "验证模块内协同运行";
  if (kind === "synthesis_challenge") return "验证跨模块综合与迁移";
  return dimension === "memory" ? "验证独立回忆" : "验证理解与辨别";
}

function buildRequirementSlots(params: {
  scope: AssessmentScope;
  target: AdaptiveAssessmentTarget;
  requirement: AdaptiveAssessmentRequirement;
  existing?: ExistingRequirementEvidence;
}): AssessmentEvidenceSlot[] {
  const { target, requirement } = params;
  const tier = assessmentDemandTier(target, requirement);
  const total = requiredEvidenceCount(requirement.dimension, tier);
  const existingCount = Math.max(
    0,
    requirement.dimension === "independence"
      ? (params.existing?.independentClaimCount ?? 0)
      : (params.existing?.claimCount ?? 0),
  );
  const constructedTotal = requiredConstructedResponses(
    requirement.dimension,
    tier,
  );
  const missingConstructed = Math.max(
    0,
    constructedTotal - (params.existing?.constructedResponseCount ?? 0),
  );
  const missingContexts = Math.max(
    0,
    requiredContextCount(requirement.dimension, tier) -
      (params.existing?.contextCount ?? 0),
  );
  const missingFarContext =
    requirement.dimension === "transfer" &&
    params.existing?.hasFarContext !== true
      ? 1
      : 0;
  const missingTimeSpan =
    requirement.dimension === "stability" &&
    (params.existing?.timeSpanDays ?? 0) < 7
      ? 1
      : 0;
  const missingCount = Math.max(
    0,
    total - existingCount,
    missingConstructed,
    missingContexts,
    missingFarContext,
    missingTimeSpan,
  );

  return Array.from({ length: missingCount }, (_, missingIndex) => {
    const absoluteIndex = existingCount + missingIndex;
    const constructed =
      missingIndex >= Math.max(0, missingCount - missingConstructed);
    const itemKind = itemKindFor({
      scope: params.scope,
      dimension: requirement.dimension,
      constructed,
    });
    const contextDistance =
      requirement.dimension === "transfer" &&
      params.existing?.hasFarContext !== true &&
      missingIndex === missingCount - 1
        ? "far"
        : contextDistanceFor(requirement.dimension, tier, absoluteIndex, total);
    return {
      id: [
        `v${ADAPTIVE_ASSESSMENT_POLICY_VERSION}`,
        target.id,
        requirement.cognitiveEntityId,
        requirement.dimension,
        absoluteIndex + 1,
      ].join(":"),
      learningTargetId: target.id,
      localLearningTargetRef: target.localRef,
      cognitiveEntityId: requirement.cognitiveEntityId,
      entityKind: requirement.entityKind,
      dimension: requirement.dimension,
      criterionRef: criterionFor(target, absoluteIndex),
      tier,
      itemKind,
      contextDistance,
      estimatedMinutes: estimatedMinutesFor(itemKind),
      required: requirement.required,
      gate: requirement.gate,
      minimumTimeSpanDays: requirement.dimension === "stability" ? 7 : 0,
      purpose: slotPurpose(requirement.dimension, itemKind),
    };
  });
}

function slotPriority(slot: AssessmentEvidenceSlot): number {
  return (
    (slot.gate ? 100 : 0) +
    (slot.required ? 50 : 0) +
    (slot.tier === "advanced" ? 20 : slot.tier === "standard" ? 10 : 0) +
    (slot.dimension === "transfer" || slot.dimension === "application" ? 5 : 0)
  );
}

export function defaultAssessmentTimeBudget(scope: AssessmentScope): number {
  if (scope === "unit") return 12;
  if (scope === "module") return 25;
  return 30;
}

export function planAdaptiveAssessment(params: {
  scope: AssessmentScope;
  targets: readonly AdaptiveAssessmentTarget[];
  existingEvidence?: ReadonlyMap<
    AssessmentEvidenceKey,
    ExistingRequirementEvidence
  >;
  timeBudgetMinutes?: number;
}): AssessmentBlueprint {
  const timeBudgetMinutes =
    params.timeBudgetMinutes ?? defaultAssessmentTimeBudget(params.scope);
  const candidates = params.targets
    .filter((target) => target.importance !== "enrichment")
    .flatMap((target) =>
      target.requirements
        .filter((requirement) => requirement.required || requirement.gate)
        .flatMap((requirement) =>
          buildRequirementSlots({
            scope: params.scope,
            target,
            requirement,
            existing: params.existingEvidence?.get(
              assessmentEvidenceKey(
                target.id,
                requirement.cognitiveEntityId,
                requirement.dimension,
              ),
            ),
          }),
        ),
    )
    .sort((left, right) => slotPriority(right) - slotPriority(left));

  const slots: AssessmentEvidenceSlot[] = [];
  const deferredSlots: AssessmentEvidenceSlot[] = [];
  let estimatedMinutes = 0;
  for (const slot of candidates) {
    if (
      estimatedMinutes + slot.estimatedMinutes <= timeBudgetMinutes ||
      slots.length === 0
    ) {
      slots.push(slot);
      estimatedMinutes += slot.estimatedMinutes;
    } else {
      deferredSlots.push(slot);
    }
  }
  return {
    policyVersion: ADAPTIVE_ASSESSMENT_POLICY_VERSION,
    scope: params.scope,
    timeBudgetMinutes,
    estimatedMinutes,
    slots,
    deferredSlots,
  };
}
