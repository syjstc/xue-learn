import type {
  LearningTargetAssessment,
  LearningTargetDimensionAssessment,
} from "./target.js";
import type { CognitiveDimension, CombinationGapKind } from "./types.js";

export const COMBINATION_GAP_REASON_CODES = [
  "component_unobserved",
  "component_dimension_unobserved",
  "component_insufficient_evidence",
  "component_revalidation_required",
  "component_below_threshold",
  "integration_unobserved",
  "integration_dimension_unobserved",
  "integration_insufficient_evidence",
  "integration_revalidation_required",
  "integration_dimension_below_threshold",
  "integration_overall_below_threshold",
] as const;

export type CombinationGapReasonCode =
  (typeof COMBINATION_GAP_REASON_CODES)[number];

export type CombinationGapReason = {
  code: CombinationGapReasonCode;
  targetId: string;
  dimension?: CognitiveDimension;
};

export type CombinationGapClassification = {
  kind: CombinationGapKind;
  affectedTargetIds: readonly string[];
  dimensions: readonly CognitiveDimension[];
  reasons: readonly CombinationGapReason[];
};

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

function hasFailure(
  assessment: LearningTargetAssessment,
  code: LearningTargetAssessment["failures"][number]["code"],
): boolean {
  return assessment.failures.some((failure) => failure.code === code);
}

function hasAnyFailure(
  assessment: LearningTargetAssessment,
  codes: readonly LearningTargetAssessment["failures"][number]["code"][],
): boolean {
  return assessment.failures.some((failure) => codes.includes(failure.code));
}

function failingDimensions(
  assessment: LearningTargetAssessment,
): LearningTargetDimensionAssessment[] {
  return assessment.dimensions.filter((dimension) =>
    dimension.failures.some(
      (failure) =>
        failure.code === "below_dimension_threshold" ||
        failure.code === "revalidation_required",
    ),
  );
}

function dimensionGapKind(
  dimension: CognitiveDimension,
): Exclude<
  CombinationGapKind,
  | "none"
  | "unobserved"
  | "insufficient_evidence"
  | "component_gap"
  | "mixed_gap"
> {
  switch (dimension) {
    case "transfer":
      return "transfer_gap";
    case "independence":
      return "independence_gap";
    case "fluency":
      return "fluency_gap";
    case "stability":
      return "stability_gap";
    case "memory":
    case "understanding":
    case "application":
      return "combination_gap";
  }
}

/**
 * Components are evaluated before their integrated target. This separates
 * "does not know a part" from "knows the parts but cannot coordinate them".
 */
export function classifyCombinationGap(
  components: readonly LearningTargetAssessment[],
  integration: LearningTargetAssessment,
): CombinationGapClassification {
  if (components.length < 2) {
    throw new RangeError(
      "combination classification requires two or more components",
    );
  }
  const learnerIds = new Set([
    ...components.map((component) => component.learnerId),
    integration.learnerId,
  ]);
  if (learnerIds.size !== 1) {
    throw new TypeError("combination classification cannot mix learners");
  }

  const unobservedComponents = components.filter(
    (component) => component.state === "unobserved",
  );
  if (unobservedComponents.length > 0) {
    return {
      kind: "unobserved",
      affectedTargetIds: unobservedComponents.map(
        (component) => component.target.id,
      ),
      dimensions: [],
      reasons: unobservedComponents.map((component) => ({
        code: "component_unobserved",
        targetId: component.target.id,
      })),
    };
  }

  const insufficientComponents = components.filter((component) =>
    hasAnyFailure(component, [
      "missing_dimension",
      "unobserved_dimension",
      "insufficient_evidence",
      "revalidation_required",
    ]),
  );
  if (insufficientComponents.length > 0) {
    const reasons = insufficientComponents.map((component) => ({
      code: hasFailure(component, "revalidation_required")
        ? ("component_revalidation_required" as const)
        : hasAnyFailure(component, [
              "missing_dimension",
              "unobserved_dimension",
            ])
          ? ("component_dimension_unobserved" as const)
          : ("component_insufficient_evidence" as const),
      targetId: component.target.id,
    }));
    return {
      kind: "insufficient_evidence",
      affectedTargetIds: insufficientComponents.map(
        (component) => component.target.id,
      ),
      dimensions: unique(
        insufficientComponents.flatMap((component) =>
          component.failures.flatMap((failure) =>
            failure.dimension ? [failure.dimension] : [],
          ),
        ),
      ),
      reasons,
    };
  }

  const failedComponents = components.filter((component) => !component.passed);
  if (failedComponents.length > 0) {
    const failedDimensions = unique(
      failedComponents.flatMap((component) =>
        component.failures.flatMap((failure) =>
          failure.dimension ? [failure.dimension] : [],
        ),
      ),
    );
    return {
      kind: "component_gap",
      affectedTargetIds: failedComponents.map(
        (component) => component.target.id,
      ),
      dimensions: failedDimensions,
      reasons: failedComponents.map((component) => ({
        code: "component_below_threshold",
        targetId: component.target.id,
      })),
    };
  }

  if (integration.state === "unobserved") {
    return {
      kind: "unobserved",
      affectedTargetIds: [integration.target.id],
      dimensions: [],
      reasons: [
        {
          code: "integration_unobserved",
          targetId: integration.target.id,
        },
      ],
    };
  }
  if (
    hasAnyFailure(integration, [
      "missing_dimension",
      "unobserved_dimension",
      "insufficient_evidence",
    ])
  ) {
    const hasUnobservedDimension = hasAnyFailure(integration, [
      "missing_dimension",
      "unobserved_dimension",
    ]);
    return {
      kind: "insufficient_evidence",
      affectedTargetIds: [integration.target.id],
      dimensions: unique(
        integration.failures.flatMap((failure) =>
          failure.dimension ? [failure.dimension] : [],
        ),
      ),
      reasons: [
        {
          code: hasUnobservedDimension
            ? "integration_dimension_unobserved"
            : "integration_insufficient_evidence",
          targetId: integration.target.id,
        },
      ],
    };
  }

  const weakDimensions = failingDimensions(integration);
  const gapKinds = new Set<CombinationGapKind>();
  const reasons: CombinationGapReason[] = [];
  for (const dimension of weakDimensions) {
    gapKinds.add(dimensionGapKind(dimension.rule.dimension));
    reasons.push({
      code: dimension.failures.some(
        (failure) => failure.code === "revalidation_required",
      )
        ? "integration_revalidation_required"
        : "integration_dimension_below_threshold",
      targetId: integration.target.id,
      dimension: dimension.rule.dimension,
    });
  }

  if (hasFailure(integration, "below_overall_threshold")) {
    gapKinds.add("combination_gap");
    reasons.push({
      code: "integration_overall_below_threshold",
      targetId: integration.target.id,
    });
  }

  if (gapKinds.size === 0) {
    return {
      kind: "none",
      affectedTargetIds: [],
      dimensions: [],
      reasons: [],
    };
  }

  return {
    kind: gapKinds.size === 1 ? [...gapKinds][0] : "mixed_gap",
    affectedTargetIds: [integration.target.id],
    dimensions: unique(weakDimensions.map((item) => item.rule.dimension)),
    reasons,
  };
}
