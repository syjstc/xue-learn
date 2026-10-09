import type { components, operations } from "@xue-learn/core/source/src/shared/api/generated/api.ts";

export type CognitiveDimension = components["schemas"]["CognitiveDimension"];
export type LearnerStateStatus = components["schemas"]["LearnerStateStatus"];
export type LearnerDimensionState =
  components["schemas"]["LearnerDimensionState"];
export type LearnerEntityState = components["schemas"]["LearnerEntityState"];
export type CognitiveEntity = components["schemas"]["CognitiveEntity"];
export type CognitiveEntityKind = CognitiveEntity["kind"];
export type LearningTarget = components["schemas"]["LearningTarget"];
export type LearningTargetList = components["schemas"]["LearningTargetList"];
export type CognitiveRelation = components["schemas"]["CognitiveRelation"];
export type CognitiveModel = components["schemas"]["CognitiveModel"];
export type CognitiveModelUnit = components["schemas"]["CognitiveModelUnit"];
export type EvidenceClaimSummary =
  components["schemas"]["EvidenceClaimSummary"];

export type GetGoalCognitiveModelResponse =
  operations["getGoalCognitiveModel"]["responses"][200]["content"]["application/json"];
export type GetUnitLearningTargetsResponse =
  operations["getUnitLearningTargets"]["responses"][200]["content"]["application/json"];
export type GetCognitiveEntityStateResponse =
  operations["getCognitiveEntityState"]["responses"][200]["content"]["application/json"];
export type GetCognitiveEntityEvidenceResponse =
  operations["getCognitiveEntityEvidence"]["responses"][200]["content"]["application/json"];

export const COGNITIVE_DIMENSIONS = [
  "memory",
  "understanding",
  "application",
  "transfer",
  "fluency",
  "stability",
  "independence",
] as const satisfies readonly CognitiveDimension[];

export const CAPABILITY_DIMENSIONS = [
  "memory",
  "understanding",
  "application",
  "transfer",
] as const satisfies readonly CognitiveDimension[];

export const OPERATION_QUALITY_DIMENSIONS = [
  "fluency",
  "stability",
  "independence",
] as const satisfies readonly CognitiveDimension[];

export const COGNITIVE_LABELS = {
  dimensions: {
    memory: "记忆",
    understanding: "理解",
    application: "应用",
    transfer: "迁移",
    fluency: "熟练",
    stability: "稳定",
    independence: "独立",
  },
  status: {
    unobserved: "未观察",
    forming: "形成中",
    demonstrated: "已证实",
    robust: "稳健",
    revalidate: "待复证",
  },
  kind: {
    atom: "知识原子",
    concept: "概念",
    skill: "技能",
    competency: "能力",
  },
  relation: {
    prerequisite: "前置",
    part_of: "组成",
    causes: "导致",
    contrasts: "对比",
    constrains: "约束",
    supports: "支持",
    enables: "使能",
  },
} as const;

export type CognitiveLayer = "targets" | CognitiveEntityKind;

export type CognitiveUnitGroup = {
  unit: CognitiveModelUnit;
  targets: LearningTarget[];
};

export function cognitivePercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(Math.max(0, Math.min(1, value)) * 100);
}

export function dimensionState(
  state: LearnerEntityState | null | undefined,
  dimension: CognitiveDimension,
) {
  return state?.dimensions.find((item) => item.dimension === dimension) ?? null;
}

export function resolvedStateStatus(
  state: LearnerEntityState | null | undefined,
): LearnerStateStatus {
  return state?.status ?? "unobserved";
}

export function isUnobserved(
  state: LearnerEntityState | null | undefined,
) {
  return !state || state.status === "unobserved" || state.overallEstimate == null;
}

export function groupTargetsByUnit(model: CognitiveModel): CognitiveUnitGroup[] {
  const targets = new Map(
    model.learningTargets.map((target) => [target.id, target]),
  );
  return [...model.units]
    .sort((a, b) => a.curriculumOrder - b.curriculumOrder)
    .map((unit) => ({
      unit,
      targets: unit.learningTargetIds
        .map((id) => targets.get(id))
        .filter((target): target is LearningTarget => Boolean(target)),
    }));
}

export function entitiesForLayer(
  model: CognitiveModel,
  layer: CognitiveEntityKind,
) {
  return model.entities.filter(
    (entity) => entity.kind === layer && entity.status === "active",
  );
}

export function entitiesForTarget(
  model: CognitiveModel,
  target: LearningTarget,
) {
  const entityById = new Map(
    model.entities.map((entity) => [entity.id, entity]),
  );
  const seen = new Set<string>();
  return target.requirements.flatMap((requirement) => {
    if (seen.has(requirement.entityId)) return [];
    seen.add(requirement.entityId);
    const entity = entityById.get(requirement.entityId);
    return entity ? [entity] : [];
  });
}

export function directRelationsForEntity(
  model: CognitiveModel,
  entityId: string,
) {
  return model.relations.filter(
    (relation) =>
      relation.status === "active" &&
      (relation.fromEntityId === entityId || relation.toEntityId === entityId),
  );
}

export function evidenceSufficiencyLabel(value: number) {
  const percent = cognitivePercent(value) ?? 0;
  if (percent >= 80) return "证据充足";
  if (percent >= 45) return "证据积累中";
  if (percent > 0) return "证据不足";
  return "暂无证据";
}

/** Learner-facing mastery status (presentation only; not persisted). */
export type LearnerMasteryStatus =
  | "not_started"
  | "in_progress"
  | "mastered"
  | "secure"
  | "needs_review";

export const LEARNER_MASTERY_LABELS: Record<LearnerMasteryStatus, string> = {
  not_started: "未开始",
  in_progress: "学习中",
  mastered: "已掌握",
  secure: "很稳固",
  needs_review: "需复习",
};

/** Future dimension-aware practice kinds (placeholders; not scheduled yet). */
export type LearnerPracticeKind =
  | "recall_drill"
  | "explain_check"
  | "guided_exercise"
  | "transfer_probe"
  | "timed_practice"
  | "spaced_retest"
  | "unguided_attempt"
  | "capability_challenge";

export const LEARNER_PRACTICE_KIND_LABELS: Record<LearnerPracticeKind, string> =
  {
    recall_drill: "记忆检索",
    explain_check: "理解练习",
    guided_exercise: "应用练习",
    transfer_probe: "迁移挑战",
    timed_practice: "熟练度练习",
    spaced_retest: "间隔复测",
    unguided_attempt: "独立作答",
    capability_challenge: "能力综合挑战",
  };

const PRACTICE_KIND_BY_DIMENSION: Record<
  CognitiveDimension,
  LearnerPracticeKind
> = {
  memory: "recall_drill",
  understanding: "explain_check",
  application: "guided_exercise",
  transfer: "transfer_probe",
  fluency: "timed_practice",
  stability: "spaced_retest",
  independence: "unguided_attempt",
};

/** Matches server `revalidateAfterDays` for presentation freshness only. */
export const LEARNER_REVALIDATE_HORIZON_DAYS = 90;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function daysBetween(fromIso: string, to: Date) {
  const fromMs = Date.parse(fromIso);
  if (!Number.isFinite(fromMs)) return null;
  return Math.max(0, (to.getTime() - fromMs) / 86_400_000);
}

export function latestObservedAt(
  state: LearnerEntityState | null | undefined,
): string | null {
  if (!state?.dimensions?.length) return null;
  let latest: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const dimension of state.dimensions) {
    if (!dimension.lastObservedAt) continue;
    const ms = Date.parse(dimension.lastObservedAt);
    if (!Number.isFinite(ms) || ms < latestMs) continue;
    latestMs = ms;
    latest = dimension.lastObservedAt;
  }
  return latest;
}

export function learnerMasteryStatus(
  state: LearnerEntityState | null | undefined,
): LearnerMasteryStatus {
  const status = resolvedStateStatus(state);
  switch (status) {
    case "unobserved":
      return "not_started";
    case "forming":
      return "in_progress";
    case "demonstrated":
      return "mastered";
    case "robust":
      return "secure";
    case "revalidate":
      return "needs_review";
    default:
      return "not_started";
  }
}

export function learnerMasteryLabel(
  state: LearnerEntityState | null | undefined,
) {
  return LEARNER_MASTERY_LABELS[learnerMasteryStatus(state)];
}

function freshnessFactor(
  state: LearnerEntityState,
  asOf: Date,
): number {
  if (state.status === "revalidate") return 0.35;

  const observedAt = latestObservedAt(state);
  let freshness = 0.5;
  if (observedAt) {
    const ageDays = daysBetween(observedAt, asOf);
    if (ageDays != null && ageDays <= LEARNER_REVALIDATE_HORIZON_DAYS) {
      const t = ageDays / LEARNER_REVALIDATE_HORIZON_DAYS;
      freshness = 1 - t * 0.3;
    }
  }

  const stability = dimensionState(state, "stability");
  if (stability?.estimate != null) {
    freshness = Math.min(freshness, stability.estimate);
  }
  return clamp(freshness, 0, 1);
}

/**
 * Presentation-only mastery progress (0–100).
 * Combines estimate × reliability × freshness; null means unobserved / not tested.
 */
export function learnerMasteryProgress(
  state: LearnerEntityState | null | undefined,
  asOf: Date = new Date(),
): number | null {
  if (!state || state.status === "unobserved") return null;

  const performance = state.overallEstimate ?? 0;
  const reliability = clamp(state.evidenceSufficiency ?? 0, 0, 1);
  const freshness = freshnessFactor(state, asOf);
  const raw =
    100 * performance * (0.45 + 0.55 * reliability) * freshness;

  switch (state.status) {
    case "forming":
      return Math.round(clamp(raw, 5, 69));
    case "demonstrated":
      return Math.round(clamp(Math.max(raw, 75), 75, 89));
    case "robust":
      return Math.round(clamp(Math.max(raw, 90), 90, 100));
    case "revalidate":
      return Math.round(clamp(raw, 10, 60));
    default:
      return null;
  }
}

export function learnerConfidenceLabel(evidenceSufficiency: number) {
  const percent = cognitivePercent(evidenceSufficiency) ?? 0;
  if (percent >= 80) return "较可靠";
  if (percent >= 45) return "可靠度一般";
  if (percent > 0) return "可靠度不足";
  return "尚未验证";
}

export type LearnerFreshnessKind = "recent" | "valid" | "review_soon";

export function learnerFreshnessKind(
  state: LearnerEntityState | null | undefined,
  asOf: Date = new Date(),
): LearnerFreshnessKind | null {
  if (!state || state.status === "unobserved") return null;
  if (state.status === "revalidate") return "review_soon";
  const observedAt = latestObservedAt(state);
  if (!observedAt) return "valid";
  const ageDays = daysBetween(observedAt, asOf);
  if (ageDays == null) return "valid";
  if (ageDays <= 14) return "recent";
  if (ageDays >= LEARNER_REVALIDATE_HORIZON_DAYS * 0.7) return "review_soon";
  return "valid";
}

export const LEARNER_FRESHNESS_LABELS: Record<LearnerFreshnessKind, string> = {
  recent: "刚验证",
  valid: "仍有效",
  review_soon: "建议复习",
};

export function learnerFreshnessLabel(
  state: LearnerEntityState | null | undefined,
  asOf: Date = new Date(),
) {
  const kind = learnerFreshnessKind(state, asOf);
  return kind ? LEARNER_FRESHNESS_LABELS[kind] : null;
}

function dimensionWeaknessScore(
  dimension: LearnerDimensionState | null | undefined,
): number {
  if (!dimension || dimension.status === "unobserved" || dimension.estimate == null) {
    return 2;
  }
  if (dimension.status === "revalidate") return 1.5;
  const estimate = dimension.estimate;
  const sufficiency = dimension.evidenceSufficiency ?? 0;
  return 1 - estimate * (0.5 + 0.5 * sufficiency);
}

/**
 * Placeholder recommender: pick practice kind from the weakest 4+3 dimension.
 * Not scheduled or runnable yet — UI may show “即将推出”.
 */
export function recommendPracticeKind(
  state: LearnerEntityState | null | undefined,
  options?: { entityKind?: CognitiveEntityKind },
): LearnerPracticeKind {
  if (options?.entityKind === "competency") {
    const mastery = learnerMasteryStatus(state);
    if (mastery === "not_started" || mastery === "in_progress" || mastery === "needs_review") {
      return "capability_challenge";
    }
  }

  if (!state || state.status === "unobserved") {
    return "explain_check";
  }
  if (state.status === "revalidate") {
    return "spaced_retest";
  }

  let weakest: CognitiveDimension = "understanding";
  let worst = Number.NEGATIVE_INFINITY;
  for (const dimension of COGNITIVE_DIMENSIONS) {
    const score = dimensionWeaknessScore(dimensionState(state, dimension));
    if (score > worst) {
      worst = score;
      weakest = dimension;
    }
  }
  return PRACTICE_KIND_BY_DIMENSION[weakest];
}

export function learnerPracticeKindLabel(kind: LearnerPracticeKind) {
  return LEARNER_PRACTICE_KIND_LABELS[kind];
}

export function learnerPracticeComingSoonLabel(kind: LearnerPracticeKind) {
  return `建议练习：${LEARNER_PRACTICE_KIND_LABELS[kind]}（即将推出）`;
}
