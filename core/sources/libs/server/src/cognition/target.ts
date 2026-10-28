import type { DimensionInference } from "./inference.js";
import {
  type CognitiveDimension,
  type CognitiveEntityRef,
  type EvidenceSignal,
  type EvidenceSufficiencyState,
  type LearnerCognitiveState,
  isCognitiveDimension,
  isCognitiveEntityKind,
} from "./types.js";

export type LearningTargetDimensionRule = {
  dimension: CognitiveDimension;
  weight: number;
  minimumScore: number;
  /** Missing or unobserved evidence blocks the target when true. */
  required: boolean;
  requireSufficientEvidence: boolean;
};

/**
 * A LearningTarget is an assessment rule over one cognitive entity. It is not
 * another entity kind, so projects and combinations do not pollute ontology.
 */
export type LearningTarget = {
  id: string;
  entity: CognitiveEntityRef;
  dimensions: readonly LearningTargetDimensionRule[];
  minimumOverallScore: number;
  robustOverallScore: number;
};

export type LearningTargetValidationIssue = {
  path: string;
  code: "required" | "invalid_value" | "out_of_range" | "duplicate";
  message: string;
};

export type LearningTargetValidationResult =
  | { success: true; target: LearningTarget; issues: [] }
  | { success: false; issues: LearningTargetValidationIssue[] };

export class LearningTargetValidationError extends Error {
  readonly issues: readonly LearningTargetValidationIssue[];

  constructor(issues: readonly LearningTargetValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    this.name = "LearningTargetValidationError";
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function score(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

export function validateLearningTarget(
  value: unknown,
): LearningTargetValidationResult {
  if (!isRecord(value)) {
    return {
      success: false,
      issues: [
        {
          path: "$",
          code: "invalid_value",
          message: "must be an object",
        },
      ],
    };
  }

  const issues: LearningTargetValidationIssue[] = [];
  if (!nonEmpty(value.id)) {
    issues.push({ path: "id", code: "required", message: "must be non-empty" });
  }

  if (!isRecord(value.entity)) {
    issues.push({
      path: "entity",
      code: "required",
      message: "must be an object",
    });
  } else {
    if (!nonEmpty(value.entity.id)) {
      issues.push({
        path: "entity.id",
        code: "required",
        message: "must be non-empty",
      });
    }
    if (!isCognitiveEntityKind(value.entity.kind)) {
      issues.push({
        path: "entity.kind",
        code: "invalid_value",
        message: "must be atom, concept, skill, or competency",
      });
    }
    if (
      value.entity.definitionVersion !== undefined &&
      (typeof value.entity.definitionVersion !== "number" ||
        !Number.isInteger(value.entity.definitionVersion) ||
        value.entity.definitionVersion < 1)
    ) {
      issues.push({
        path: "entity.definitionVersion",
        code: "out_of_range",
        message: "must be a positive integer",
      });
    }
  }

  if (!Array.isArray(value.dimensions) || value.dimensions.length === 0) {
    issues.push({
      path: "dimensions",
      code: "required",
      message: "must contain at least one dimension rule",
    });
  } else {
    const seen = new Set<CognitiveDimension>();
    value.dimensions.forEach((rule, index) => {
      const path = `dimensions[${index}]`;
      if (!isRecord(rule)) {
        issues.push({
          path,
          code: "invalid_value",
          message: "must be an object",
        });
        return;
      }
      if (!isCognitiveDimension(rule.dimension)) {
        issues.push({
          path: `${path}.dimension`,
          code: "invalid_value",
          message: "must be a controlled cognitive dimension",
        });
      } else if (seen.has(rule.dimension)) {
        issues.push({
          path: `${path}.dimension`,
          code: "duplicate",
          message: `duplicate ${rule.dimension} rule`,
        });
      } else {
        seen.add(rule.dimension);
      }
      if (
        typeof rule.weight !== "number" ||
        !Number.isFinite(rule.weight) ||
        rule.weight <= 0
      ) {
        issues.push({
          path: `${path}.weight`,
          code: "out_of_range",
          message: "must be greater than zero",
        });
      }
      if (!score(rule.minimumScore)) {
        issues.push({
          path: `${path}.minimumScore`,
          code: "out_of_range",
          message: "must be between zero and one",
        });
      }
      if (typeof rule.required !== "boolean") {
        issues.push({
          path: `${path}.required`,
          code: "invalid_value",
          message: "must be boolean",
        });
      }
      if (typeof rule.requireSufficientEvidence !== "boolean") {
        issues.push({
          path: `${path}.requireSufficientEvidence`,
          code: "invalid_value",
          message: "must be boolean",
        });
      }
    });
  }

  if (!score(value.minimumOverallScore)) {
    issues.push({
      path: "minimumOverallScore",
      code: "out_of_range",
      message: "must be between zero and one",
    });
  }
  if (!score(value.robustOverallScore)) {
    issues.push({
      path: "robustOverallScore",
      code: "out_of_range",
      message: "must be between zero and one",
    });
  } else if (
    typeof value.minimumOverallScore === "number" &&
    value.robustOverallScore < value.minimumOverallScore
  ) {
    issues.push({
      path: "robustOverallScore",
      code: "out_of_range",
      message: "must not be lower than minimumOverallScore",
    });
  }

  if (issues.length > 0) return { success: false, issues };
  return { success: true, target: value as LearningTarget, issues: [] };
}

export function assertLearningTarget(
  value: unknown,
): asserts value is LearningTarget {
  const result = validateLearningTarget(value);
  if (!result.success) throw new LearningTargetValidationError(result.issues);
}

export const TARGET_GATE_FAILURE_CODES = [
  "missing_dimension",
  "unobserved_dimension",
  "insufficient_evidence",
  "revalidation_required",
  "below_dimension_threshold",
  "below_overall_threshold",
  "no_observed_dimensions",
] as const;

export type TargetGateFailureCode = (typeof TARGET_GATE_FAILURE_CODES)[number];

export type TargetGateFailure = {
  code: TargetGateFailureCode;
  dimension?: CognitiveDimension;
  actual?: number;
  required?: number;
};

export type LearningTargetDimensionAssessment = {
  rule: LearningTargetDimensionRule;
  score: number | null;
  state: LearnerCognitiveState;
  evidenceSignal: EvidenceSignal;
  sufficiency: EvidenceSufficiencyState;
  includedInAggregate: boolean;
  passed: boolean;
  failures: readonly TargetGateFailure[];
};

export type LearningTargetAssessment = {
  target: LearningTarget;
  learnerId: string;
  state: LearnerCognitiveState;
  evidenceSignal: EvidenceSignal;
  overallScore: number | null;
  passed: boolean;
  failures: readonly TargetGateFailure[];
  dimensions: readonly LearningTargetDimensionAssessment[];
};

function geometricMean(
  values: readonly { value: number; weight: number }[],
): number {
  const totalWeight = values.reduce((sum, item) => sum + item.weight, 0);
  const weightedLog = values.reduce(
    (sum, item) => sum + item.weight * Math.log(Math.max(item.value, 1e-12)),
    0,
  );
  return Math.exp(weightedLog / totalWeight);
}

function aggregateEvidenceSignal(
  dimensions: readonly LearningTargetDimensionAssessment[],
): EvidenceSignal {
  const observed = dimensions.filter((item) => item.includedInAggregate);
  if (observed.length === 0) return "unobserved";
  if (observed.some((item) => item.evidenceSignal === "failure")) {
    return "failure";
  }
  if (observed.every((item) => item.evidenceSignal === "success")) {
    return "success";
  }
  return "mixed";
}

export function assessLearningTarget(
  target: LearningTarget,
  learnerId: string,
  inferences: readonly DimensionInference[],
): LearningTargetAssessment {
  assertLearningTarget(target);
  if (!nonEmpty(learnerId)) {
    throw new TypeError("learnerId must be a non-empty string");
  }
  const relevant = inferences.filter(
    (inference) =>
      inference.entityId === target.entity.id &&
      inference.learnerId === learnerId,
  );
  const byDimension = new Map<CognitiveDimension, DimensionInference>();
  for (const inference of relevant) {
    if (
      inference.entityKind !== undefined &&
      inference.entityKind !== target.entity.kind
    ) {
      throw new TypeError(
        `entity kind mismatch for ${target.entity.id}: ${inference.entityKind}`,
      );
    }
    if (byDimension.has(inference.dimension)) {
      throw new TypeError(`duplicate ${inference.dimension} inference`);
    }
    byDimension.set(inference.dimension, inference);
  }

  const failures: TargetGateFailure[] = [];
  const dimensions = target.dimensions.map((rule) => {
    const inference = byDimension.get(rule.dimension);
    const localFailures: TargetGateFailure[] = [];
    if (!inference) {
      if (rule.required) {
        localFailures.push({
          code: "missing_dimension",
          dimension: rule.dimension,
        });
      }
      const assessment: LearningTargetDimensionAssessment = {
        rule,
        score: null,
        state: "unobserved",
        evidenceSignal: "unobserved",
        sufficiency: "unobserved",
        includedInAggregate: false,
        passed: !rule.required,
        failures: localFailures,
      };
      failures.push(...localFailures);
      return assessment;
    }

    if (inference.state === "unobserved" && rule.required) {
      localFailures.push({
        code: "unobserved_dimension",
        dimension: rule.dimension,
      });
    }
    if (
      inference.state !== "unobserved" &&
      rule.requireSufficientEvidence &&
      inference.sufficiency.state !== "sufficient"
    ) {
      localFailures.push({
        code: "insufficient_evidence",
        dimension: rule.dimension,
      });
    }
    if (inference.state === "revalidate") {
      localFailures.push({
        code: "revalidation_required",
        dimension: rule.dimension,
      });
    }
    if (
      inference.state !== "unobserved" &&
      inference.posteriorMean < rule.minimumScore
    ) {
      localFailures.push({
        code: "below_dimension_threshold",
        dimension: rule.dimension,
        actual: inference.posteriorMean,
        required: rule.minimumScore,
      });
    }

    const assessment: LearningTargetDimensionAssessment = {
      rule,
      score: inference.state === "unobserved" ? null : inference.posteriorMean,
      state: inference.state,
      evidenceSignal: inference.evidenceSignal,
      sufficiency: inference.sufficiency.state,
      includedInAggregate: inference.state !== "unobserved",
      passed: localFailures.length === 0,
      failures: localFailures,
    };
    failures.push(...localFailures);
    return assessment;
  });

  const requiredUnobserved = dimensions.some(
    (item) => item.rule.required && !item.includedInAggregate,
  );
  const contributors = dimensions
    .filter(
      (item): item is LearningTargetDimensionAssessment & { score: number } =>
        item.includedInAggregate && item.score !== null,
    )
    .map((item) => ({ value: item.score, weight: item.rule.weight }));
  const overallScore =
    contributors.length === 0 || requiredUnobserved
      ? null
      : geometricMean(contributors);

  if (contributors.length === 0)
    failures.push({ code: "no_observed_dimensions" });
  if (overallScore !== null && overallScore < target.minimumOverallScore) {
    failures.push({
      code: "below_overall_threshold",
      actual: overallScore,
      required: target.minimumOverallScore,
    });
  }

  const evidenceSignal = aggregateEvidenceSignal(dimensions);
  const passed = overallScore !== null && failures.length === 0;
  let state: LearnerCognitiveState;
  if (contributors.length === 0 || requiredUnobserved) state = "unobserved";
  else if (dimensions.some((item) => item.state === "revalidate")) {
    state = "revalidate";
  } else if (!passed) state = "forming";
  else if (
    overallScore !== null &&
    overallScore >= target.robustOverallScore &&
    dimensions
      .filter((item) => item.rule.required)
      .every((item) => item.state === "robust")
  ) {
    state = "robust";
  } else {
    state = "demonstrated";
  }

  return {
    target,
    learnerId,
    state,
    evidenceSignal,
    overallScore,
    passed,
    failures,
    dimensions,
  };
}
