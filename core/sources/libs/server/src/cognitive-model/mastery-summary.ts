import {
  ADAPTIVE_ASSESSMENT_POLICY_VERSION,
  type AdaptiveAssessmentTarget,
} from "../assessment/adaptive-blueprint.js";
import type {
  CognitiveDimension,
  LearnerCognitiveState,
} from "../cognition/index.js";

export const MASTERY_PROJECTION_VERSION = 1;

export type MasteryRequirementProjectionInput = {
  cognitiveEntityId: string;
  dimension: CognitiveDimension;
  required: boolean;
  gate: boolean;
  weight: number;
  threshold: number;
  estimate: number | null;
  entityEvidenceSufficiency: number;
  targetEvidenceCoverage?: number;
  stateStatus: LearnerCognitiveState;
};

export type MasteryTargetProjectionInput = Pick<
  AdaptiveAssessmentTarget,
  "id" | "title" | "importance" | "importanceWeight"
> & {
  required: boolean;
  mappingWeight?: number;
  requirements: readonly MasteryRequirementProjectionInput[];
};

export type MasteryTargetSummary = {
  learningTargetId: string;
  title: string;
  status: LearnerCognitiveState;
  verifiedMasteryPercent: number;
  evidenceCoveragePercent: number;
  passed: boolean;
  weakDimensions: CognitiveDimension[];
  unverifiedDimensions: CognitiveDimension[];
};

export type MasterySummary = {
  projectionVersion: typeof MASTERY_PROJECTION_VERSION;
  assessmentPolicyVersion: typeof ADAPTIVE_ASSESSMENT_POLICY_VERSION;
  scope: "goal" | "module";
  scopeId: string;
  status: LearnerCognitiveState;
  verifiedMasteryPercent: number;
  evidenceCoveragePercent: number;
  requiredTargetCount: number;
  demonstratedTargetCount: number;
  formingTargetCount: number;
  unobservedTargetCount: number;
  robustTargetCount: number;
  revalidationTargetCount: number;
  weakDimensions: CognitiveDimension[];
  unverifiedDimensions: CognitiveDimension[];
  targets: MasteryTargetSummary[];
  modelVersion: number;
  inferencePolicyVersion: number;
  evidenceCutoffAt: string | null;
  lifecycleCutoffAt: string | null;
  computedAt: string;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function weightedGeometric(
  values: readonly { value: number; weight: number }[],
): number {
  if (values.length === 0) return 0;
  const totalWeight = values.reduce(
    (sum, item) => sum + Math.max(0, item.weight),
    0,
  );
  if (totalWeight <= 0) return 0;
  if (values.some((item) => item.value <= 0)) return 0;
  return Math.exp(
    values.reduce(
      (sum, item) =>
        sum + Math.max(0, item.weight) * Math.log(clamp01(item.value)),
      0,
    ) / totalWeight,
  );
}

function uniqueDimensions(
  dimensions: readonly CognitiveDimension[],
): CognitiveDimension[] {
  return [...new Set(dimensions)];
}

export function projectMasteryTarget(
  target: MasteryTargetProjectionInput,
): MasteryTargetSummary {
  const applicable = target.requirements.filter(
    (requirement) => requirement.required || requirement.gate,
  );
  const projected = applicable.map((requirement) => {
    const targetCoverage = clamp01(
      requirement.targetEvidenceCoverage ??
        requirement.entityEvidenceSufficiency,
    );
    const freshness = requirement.stateStatus === "revalidate" ? 0 : 1;
    const estimate = clamp01(requirement.estimate ?? 0);
    const verifiedValue = estimate * targetCoverage * freshness;
    const passed =
      requirement.estimate != null &&
      requirement.stateStatus !== "revalidate" &&
      targetCoverage >= 1 &&
      requirement.estimate >= requirement.threshold;
    return {
      requirement,
      targetCoverage,
      verifiedValue,
      passed,
    };
  });
  const verifiedMastery = weightedGeometric(
    projected.map(({ requirement, verifiedValue }) => ({
      value: verifiedValue,
      weight: requirement.weight,
    })),
  );
  const evidenceCoverage =
    projected.length === 0
      ? 0
      : Math.min(...projected.map((item) => item.targetCoverage));
  const hasEvidence = projected.some(
    ({ targetCoverage }) => targetCoverage > 0,
  );
  const revalidate = projected.some(
    ({ requirement }) => requirement.stateStatus === "revalidate",
  );
  const passed = projected.length > 0 && projected.every((item) => item.passed);
  const robust =
    passed &&
    projected.every(({ requirement }) => requirement.stateStatus === "robust");
  const status: LearnerCognitiveState = !hasEvidence
    ? "unobserved"
    : revalidate
      ? "revalidate"
      : robust
        ? "robust"
        : passed
          ? "demonstrated"
          : "forming";

  const weakDimensions = uniqueDimensions(
    projected.flatMap(({ requirement, targetCoverage }) =>
      requirement.estimate != null &&
      targetCoverage >= 1 &&
      requirement.stateStatus !== "revalidate" &&
      requirement.estimate < requirement.threshold
        ? [requirement.dimension]
        : [],
    ),
  );
  const unverifiedDimensions = uniqueDimensions(
    projected.flatMap(({ requirement, targetCoverage }) =>
      requirement.estimate == null ||
      targetCoverage < 1 ||
      requirement.stateStatus === "revalidate"
        ? [requirement.dimension]
        : [],
    ),
  );

  return {
    learningTargetId: target.id,
    title: target.title,
    status,
    verifiedMasteryPercent: Math.round(verifiedMastery * 100),
    evidenceCoveragePercent: Math.round(evidenceCoverage * 100),
    passed,
    weakDimensions,
    unverifiedDimensions,
  };
}

export function projectMasterySummary(params: {
  scope: "goal" | "module";
  scopeId: string;
  targets: readonly MasteryTargetProjectionInput[];
  modelVersion: number;
  inferencePolicyVersion: number;
  evidenceCutoffAt?: Date | string | null;
  lifecycleCutoffAt?: Date | string | null;
  computedAt?: Date;
}): MasterySummary {
  const targetsById = new Map<string, MasteryTargetProjectionInput>();
  for (const target of params.targets) {
    const current = targetsById.get(target.id);
    if (
      !current ||
      (target.mappingWeight ?? 1) > (current.mappingWeight ?? 1)
    ) {
      targetsById.set(target.id, target);
    }
  }
  const inputs = [...targetsById.values()].filter(
    (target) => target.importance !== "enrichment",
  );
  const summaries = inputs.map(projectMasteryTarget);
  const weighted = summaries.map((summary, index) => {
    const target = inputs[index];
    return {
      summary,
      weight:
        Math.max(1, target.importanceWeight) *
        Math.max(0.01, target.mappingWeight ?? 1),
    };
  });
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  const verifiedMastery =
    totalWeight === 0
      ? 0
      : weighted.reduce(
          (sum, item) =>
            sum + item.summary.verifiedMasteryPercent * item.weight,
          0,
        ) / totalWeight;
  const evidenceCoverage =
    totalWeight === 0
      ? 0
      : weighted.reduce(
          (sum, item) =>
            sum + item.summary.evidenceCoveragePercent * item.weight,
          0,
        ) / totalWeight;
  const required = weighted.filter(
    (_, index) =>
      inputs[index]?.required !== false ||
      inputs[index]?.requirements.some((requirement) => requirement.gate),
  );
  const hasEvidence = summaries.some(
    (summary) => summary.status !== "unobserved",
  );
  const revalidationTargetCount = required.filter(
    ({ summary }) => summary.status === "revalidate",
  ).length;
  const demonstratedTargetCount = required.filter(({ summary }) =>
    ["demonstrated", "robust"].includes(summary.status),
  ).length;
  const robustTargetCount = required.filter(
    ({ summary }) => summary.status === "robust",
  ).length;
  const formingTargetCount = required.filter(
    ({ summary }) => summary.status === "forming",
  ).length;
  const unobservedTargetCount = required.filter(
    ({ summary }) => summary.status === "unobserved",
  ).length;
  const allDemonstrated =
    required.length > 0 && demonstratedTargetCount === required.length;
  const core = weighted.filter(
    (_, index) => inputs[index]?.importance === "core",
  );
  const allCoreRobust =
    core.length > 0 && core.every(({ summary }) => summary.status === "robust");
  const status: LearnerCognitiveState = !hasEvidence
    ? "unobserved"
    : revalidationTargetCount > 0
      ? "revalidate"
      : allDemonstrated && allCoreRobust
        ? "robust"
        : allDemonstrated
          ? "demonstrated"
          : "forming";

  const iso = (value?: Date | string | null) =>
    value instanceof Date ? value.toISOString() : (value ?? null);
  return {
    projectionVersion: MASTERY_PROJECTION_VERSION,
    assessmentPolicyVersion: ADAPTIVE_ASSESSMENT_POLICY_VERSION,
    scope: params.scope,
    scopeId: params.scopeId,
    status,
    verifiedMasteryPercent: Math.round(verifiedMastery),
    evidenceCoveragePercent: Math.round(evidenceCoverage),
    requiredTargetCount: required.length,
    demonstratedTargetCount,
    formingTargetCount,
    unobservedTargetCount,
    robustTargetCount,
    revalidationTargetCount,
    weakDimensions: uniqueDimensions(
      summaries.flatMap((summary) => summary.weakDimensions),
    ),
    unverifiedDimensions: uniqueDimensions(
      summaries.flatMap((summary) => summary.unverifiedDimensions),
    ),
    targets: summaries,
    modelVersion: params.modelVersion,
    inferencePolicyVersion: params.inferencePolicyVersion,
    evidenceCutoffAt: iso(params.evidenceCutoffAt),
    lifecycleCutoffAt: iso(params.lifecycleCutoffAt),
    computedAt: (params.computedAt ?? new Date()).toISOString(),
  };
}
