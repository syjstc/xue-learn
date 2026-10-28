import { createHash } from "node:crypto";
import { parsePrereqs } from "../domain/unit-status.js";
import {
  COGNITIVE_DIMENSIONS,
  COGNITIVE_MODEL_SCHEMA_VERSION,
  type CognitiveDimension,
  type CognitiveModelSnapshot,
  type PresentedDimensionState,
  type PresentedEntityState,
  type SnapshotLearningTarget,
  type SnapshotRelation,
  type SnapshotUnit,
} from "./types.js";

export type CurriculumFingerprintGoal = {
  title: string;
  level: string;
  domainTag: string;
  topicCategory: string;
  contentLanguage: string;
  pathSource: string;
  curriculumVersion?: number;
  mapPlanJson?: string;
  mapPlanStatus?: string;
};

export type CurriculumFingerprintUnit = {
  id: string;
  curriculumKey: string;
  parentUnitId: string | null;
  unitKind: string;
  title: string;
  contentSummary: string;
  orderIndex: number;
  difficulty: string;
  prerequisites: string;
  planAreaRef?: string;
  planningOutcomeRefs?: unknown;
};

function normalizedText(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ");
}

function compareUnits(
  a: CurriculumFingerprintUnit,
  b: CurriculumFingerprintUnit,
) {
  return (
    a.orderIndex - b.orderIndex ||
    a.curriculumKey.localeCompare(b.curriculumKey) ||
    a.id.localeCompare(b.id)
  );
}

/** Stable pre-order; orderIndex is only meaningful between siblings. */
export function orderCurriculumUnits<T extends CurriculumFingerprintUnit>(
  units: readonly T[],
): T[] {
  const byId = new Map<string, T>();
  for (const unit of units) {
    if (byId.has(unit.id))
      throw new Error(`Duplicate learning unit ${unit.id}`);
    byId.set(unit.id, unit);
  }
  const children = new Map<string | null, T[]>();
  for (const unit of units) {
    const parentId =
      unit.parentUnitId && byId.has(unit.parentUnitId)
        ? unit.parentUnitId
        : null;
    children.set(parentId, [...(children.get(parentId) ?? []), unit]);
  }
  for (const rows of children.values()) rows.sort(compareUnits);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const result: T[] = [];
  const visit = (unit: T) => {
    if (visiting.has(unit.id))
      throw new Error("Learning-unit hierarchy contains a cycle");
    if (visited.has(unit.id)) return;
    visiting.add(unit.id);
    result.push(unit);
    for (const child of children.get(unit.id) ?? []) visit(child);
    visiting.delete(unit.id);
    visited.add(unit.id);
  };
  for (const root of children.get(null) ?? []) visit(root);
  for (const unit of [...units].sort(compareUnits)) visit(unit);
  return result;
}

export function validateUnitPrerequisiteGraph(
  units: readonly CurriculumFingerprintUnit[],
): string[] {
  const ordered = orderCurriculumUnits(units);
  const ids = new Set(ordered.map((unit) => unit.id));
  const indegree = new Map(ordered.map((unit) => [unit.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const unit of ordered) {
    for (const prerequisiteId of parsePrereqs(unit.prerequisites)) {
      if (!ids.has(prerequisiteId)) {
        throw new Error(
          `Learning unit ${unit.id} has dangling prerequisite ${prerequisiteId}`,
        );
      }
      if (prerequisiteId === unit.id) {
        throw new Error(`Learning unit ${unit.id} cannot depend on itself`);
      }
      indegree.set(unit.id, (indegree.get(unit.id) ?? 0) + 1);
      outgoing.set(prerequisiteId, [
        ...(outgoing.get(prerequisiteId) ?? []),
        unit.id,
      ]);
    }
  }
  const index = new Map(ordered.map((unit, position) => [unit.id, position]));
  const queue = ordered
    .filter((unit) => indegree.get(unit.id) === 0)
    .map((unit) => unit.id);
  const result: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    result.push(id);
    for (const dependent of outgoing.get(id) ?? []) {
      const next = (indegree.get(dependent) ?? 1) - 1;
      indegree.set(dependent, next);
      if (next === 0) {
        queue.push(dependent);
        queue.sort((a, b) => (index.get(a) ?? 0) - (index.get(b) ?? 0));
      }
    }
  }
  if (result.length !== ordered.length) {
    throw new Error("Learning map contains a prerequisite cycle");
  }
  return result;
}

export function computeCognitiveModelInputHash(
  goal: CurriculumFingerprintGoal,
  units: readonly CurriculumFingerprintUnit[],
): string {
  const ordered = orderCurriculumUnits(units);
  const byId = new Map(ordered.map((unit) => [unit.id, unit]));
  const hasPlanningBindings = ordered.some(
    (unit) =>
      Boolean(unit.planAreaRef?.trim()) ||
      (Array.isArray(unit.planningOutcomeRefs) &&
        unit.planningOutcomeRefs.length > 0),
  );
  const payload = {
    schemaVersion: COGNITIVE_MODEL_SCHEMA_VERSION,
    goal: {
      title: normalizedText(goal.title),
      level: normalizedText(goal.level),
      domainTag: normalizedText(goal.domainTag),
      topicCategory: normalizedText(goal.topicCategory),
      contentLanguage: normalizedText(goal.contentLanguage),
      pathSource: normalizedText(goal.pathSource),
      ...(hasPlanningBindings &&
      goal.mapPlanStatus === "approved" &&
      goal.curriculumVersion !== 2
        ? { approvedPlan: goal.mapPlanJson ?? "" }
        : {}),
    },
    units: ordered.map((unit) => ({
      curriculumKey: unit.curriculumKey,
      parentCurriculumKey: unit.parentUnitId
        ? (byId.get(unit.parentUnitId)?.curriculumKey ?? null)
        : null,
      unitKind: unit.unitKind,
      title: normalizedText(unit.title),
      contentSummary: normalizedText(unit.contentSummary),
      orderIndex: unit.orderIndex,
      difficulty: normalizedText(unit.difficulty),
      ...(hasPlanningBindings
        ? {
            planAreaRef: normalizedText(unit.planAreaRef ?? ""),
            planningOutcomeRefs: Array.isArray(unit.planningOutcomeRefs)
              ? [...new Set(unit.planningOutcomeRefs.map(String))].sort()
              : [],
          }
        : {}),
      prerequisiteCurriculumKeys: parsePrereqs(unit.prerequisites)
        .map((id) => byId.get(id)?.curriculumKey ?? `missing:${id}`)
        .sort(),
    })),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function projectSymmetricRelations(
  relations: readonly SnapshotRelation[],
): SnapshotRelation[] {
  const result: SnapshotRelation[] = [];
  const seen = new Set<string>();
  const add = (relation: SnapshotRelation) => {
    const key = `${relation.fromEntityId}\n${relation.toEntityId}\n${relation.relationType}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push(relation);
  };
  for (const relation of relations) {
    add(relation);
    if (relation.relationType === "contrasts") {
      add({
        ...relation,
        id: `${relation.id}:symmetric`,
        fromEntityId: relation.toEntityId,
        toEntityId: relation.fromEntityId,
      });
    }
  }
  return result;
}

function assertAcyclic(
  entityIds: readonly string[],
  relations: readonly SnapshotRelation[],
  relationType: "prerequisite" | "part_of",
): void {
  const ids = new Set(entityIds);
  const indegree = new Map(entityIds.map((id) => [id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const relation of relations.filter(
    (row) => row.relationType === relationType,
  )) {
    if (!ids.has(relation.fromEntityId) || !ids.has(relation.toEntityId)) {
      throw new Error(
        `${relationType} relation contains a dangling entity reference`,
      );
    }
    if (relation.fromEntityId === relation.toEntityId) {
      throw new Error(`${relationType} relation cannot reference itself`);
    }
    indegree.set(
      relation.toEntityId,
      (indegree.get(relation.toEntityId) ?? 0) + 1,
    );
    outgoing.set(relation.fromEntityId, [
      ...(outgoing.get(relation.fromEntityId) ?? []),
      relation.toEntityId,
    ]);
  }
  const queue = [...indegree]
    .filter(([, count]) => count === 0)
    .map(([id]) => id);
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    visited += 1;
    for (const nextId of outgoing.get(id) ?? []) {
      const next = (indegree.get(nextId) ?? 1) - 1;
      indegree.set(nextId, next);
      if (next === 0) queue.push(nextId);
    }
  }
  if (visited !== entityIds.length)
    throw new Error(`${relationType} relations contain a cycle`);
}

export function validateCognitiveModelSnapshot(
  snapshot: CognitiveModelSnapshot,
): void {
  if (snapshot.schemaVersion !== COGNITIVE_MODEL_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported cognitive-model schema version ${snapshot.schemaVersion}`,
    );
  }
  const entityIds = snapshot.entities.map((entity) => entity.id);
  if (new Set(entityIds).size !== entityIds.length)
    throw new Error("Duplicate cognitive entity");
  const targetIds = new Set(
    snapshot.learningTargets.map((target) => target.id),
  );
  const entityIdSet = new Set(entityIds);
  for (const relation of snapshot.relations) {
    if (
      !entityIdSet.has(relation.fromEntityId) ||
      !entityIdSet.has(relation.toEntityId)
    ) {
      throw new Error(
        "Cognitive relation contains a dangling entity reference",
      );
    }
    if (relation.fromEntityId === relation.toEntityId) {
      throw new Error("Cognitive relation cannot reference itself");
    }
  }
  for (const component of snapshot.components) {
    if (
      !entityIdSet.has(component.constructId) ||
      !entityIdSet.has(component.componentEntityId)
    ) {
      throw new Error(
        "Construct component contains a dangling entity reference",
      );
    }
  }
  const unitIds = new Set(snapshot.units.map((unit) => unit.unitId));
  for (const target of snapshot.learningTargets) {
    for (const requirement of target.requirements) {
      if (!entityIdSet.has(requirement.entityId)) {
        throw new Error(
          `Learning target ${target.id} has a dangling entity requirement`,
        );
      }
    }
    for (const mapping of target.mappings) {
      if (!unitIds.has(mapping.unitId)) {
        throw new Error(
          `Learning target ${target.id} has a dangling unit mapping`,
        );
      }
    }
  }
  for (const unit of snapshot.units) {
    for (const targetId of unit.learningTargetIds) {
      if (!targetIds.has(targetId))
        throw new Error(`Unit ${unit.unitId} has a dangling target`);
    }
  }
  assertAcyclic(entityIds, snapshot.relations, "prerequisite");
  assertAcyclic(entityIds, snapshot.relations, "part_of");
}

export type DirectDimensionState = {
  dimension: string;
  estimate: number | null;
  evidenceSufficiency: number;
  evidenceWeight: number;
  status: string;
  lastObservedAt: Date | string | null;
};

export type DirectEntityState = {
  cognitiveEntityId: string;
  estimate: number | null;
  evidenceSufficiency: number;
  status: string;
  inferenceVersion: number;
  dimensions: DirectDimensionState[];
};

const VALID_STATE_STATUSES = new Set([
  "unobserved",
  "forming",
  "demonstrated",
  "robust",
  "revalidate",
]);

function status(value: string): PresentedEntityState["status"] {
  return VALID_STATE_STATUSES.has(value)
    ? (value as PresentedEntityState["status"])
    : "unobserved";
}

export function presentDirectEntityState(
  state: DirectEntityState | undefined,
): PresentedEntityState {
  const byDimension = new Map(
    (state?.dimensions ?? []).map((dimension) => [
      dimension.dimension,
      dimension,
    ]),
  );
  const dimensions = COGNITIVE_DIMENSIONS.map(
    (dimensionName): PresentedDimensionState => {
      const dimension = byDimension.get(dimensionName);
      return {
        dimension: dimensionName,
        status: dimension ? status(dimension.status) : "unobserved",
        estimate: dimension?.estimate ?? null,
        evidenceSufficiency: dimension?.evidenceSufficiency ?? 0,
        effectiveEvidenceWeight: dimension?.evidenceWeight ?? 0,
        dueAt: null,
        lastObservedAt:
          dimension?.lastObservedAt instanceof Date
            ? dimension.lastObservedAt.toISOString()
            : (dimension?.lastObservedAt ?? null),
      };
    },
  );
  return {
    status: state ? status(state.status) : "unobserved",
    overallEstimate: state?.estimate ?? null,
    evidenceSufficiency: state?.evidenceSufficiency ?? 0,
    dimensions,
    inferencePolicyVersion: state?.inferenceVersion ?? 1,
    nextAction: null,
  };
}

const EPSILON = 1e-6;

/**
 * Target summary uses only direct per-entity state. Construct components are
 * never read here, preventing component success from manufacturing capability.
 */
export function aggregateLearningTargetState(
  target: SnapshotLearningTarget,
  states: ReadonlyMap<string, DirectEntityState>,
): PresentedEntityState {
  const requirementStates = target.requirements.map((requirement) => {
    const direct = states.get(requirement.entityId);
    const dimension = direct?.dimensions.find(
      (row) => row.dimension === requirement.dimension,
    );
    return {
      requirement,
      direct,
      dimension,
    };
  });
  const dimensions: PresentedDimensionState[] = COGNITIVE_DIMENSIONS.map(
    (dimensionName) => {
      const members = requirementStates.filter(
        (row) => row.requirement.dimension === dimensionName,
      );
      const observed = members.filter((row) => row.dimension?.estimate != null);
      const observedWeight = observed.reduce(
        (sum, row) => sum + row.requirement.weight,
        0,
      );
      const estimate =
        observedWeight === 0
          ? null
          : Math.exp(
              observed.reduce(
                (sum, row) =>
                  sum +
                  row.requirement.weight *
                    Math.log(Math.max(EPSILON, row.dimension!.estimate!)),
                0,
              ) / observedWeight,
            );
      const totalWeight = members.reduce(
        (sum, row) => sum + row.requirement.weight,
        0,
      );
      const evidenceSufficiency =
        totalWeight === 0
          ? 0
          : members.reduce(
              (sum, row) =>
                sum +
                row.requirement.weight *
                  (row.dimension?.evidenceSufficiency ?? 0),
              0,
            ) / totalWeight;
      const dimensionGateFailed = members.some(
        (row) =>
          row.requirement.gate &&
          (row.dimension?.estimate == null ||
            row.dimension.estimate < row.requirement.threshold),
      );
      const mustRevalidate = members.some(
        (row) => row.dimension?.status === "revalidate",
      );
      let dimensionStatus: PresentedDimensionState["status"];
      if (mustRevalidate) dimensionStatus = "revalidate";
      else if (estimate == null) dimensionStatus = "unobserved";
      else if (
        dimensionGateFailed ||
        estimate < 0.7 ||
        evidenceSufficiency < 0.5
      ) {
        dimensionStatus = "forming";
      } else if (estimate >= 0.85 && evidenceSufficiency >= 0.8) {
        dimensionStatus = "robust";
      } else dimensionStatus = "demonstrated";
      const observedDates = members
        .map((row) => row.dimension?.lastObservedAt)
        .filter((value): value is Date | string => value != null)
        .map((value) => (value instanceof Date ? value.toISOString() : value))
        .sort();
      return {
        dimension: dimensionName,
        status: dimensionStatus,
        estimate,
        evidenceSufficiency,
        effectiveEvidenceWeight: members.reduce(
          (sum, row) => sum + (row.dimension?.evidenceWeight ?? 0),
          0,
        ),
        dueAt: null,
        lastObservedAt: observedDates.at(-1) ?? null,
      };
    },
  );
  const observed = requirementStates.filter(
    (row) => row.dimension?.estimate != null,
  );
  const requiredUnobserved = requirementStates.some(
    (row) => row.requirement.required && row.dimension?.estimate == null,
  );
  const totalWeight = observed.reduce(
    (sum, row) => sum + row.requirement.weight,
    0,
  );
  const overallEstimate =
    totalWeight === 0 || requiredUnobserved
      ? null
      : Math.exp(
          observed.reduce(
            (sum, row) =>
              sum +
              row.requirement.weight *
                Math.log(Math.max(EPSILON, row.dimension!.estimate!)),
            0,
          ) / totalWeight,
        );
  const requirementWeight = target.requirements.reduce(
    (sum, requirement) => sum + requirement.weight,
    0,
  );
  const evidenceSufficiency =
    requirementWeight === 0
      ? 0
      : target.requirements.reduce((sum, requirement) => {
          const directDimension = requirementStates.find(
            (row) => row.requirement === requirement,
          )?.dimension;
          return (
            sum +
            requirement.weight * (directDimension?.evidenceSufficiency ?? 0)
          );
        }, 0) / requirementWeight;
  const gateFailed = requirementStates.some(
    (row) =>
      row.requirement.gate &&
      (row.dimension?.estimate == null ||
        row.dimension.estimate < row.requirement.threshold),
  );
  const mustRevalidate = dimensions.some(
    (dimension) => dimension.status === "revalidate",
  );
  const anyObserved = dimensions.some(
    (dimension) => dimension.estimate != null,
  );
  let summaryStatus: PresentedEntityState["status"];
  if (mustRevalidate) summaryStatus = "revalidate";
  else if (!anyObserved) summaryStatus = "unobserved";
  else if (
    gateFailed ||
    overallEstimate == null ||
    overallEstimate < 0.7 ||
    evidenceSufficiency < 0.5
  ) {
    summaryStatus = "forming";
  } else if (overallEstimate >= 0.85 && evidenceSufficiency >= 0.8)
    summaryStatus = "robust";
  else summaryStatus = "demonstrated";
  return {
    status: summaryStatus,
    overallEstimate,
    evidenceSufficiency,
    dimensions,
    inferencePolicyVersion: Math.max(
      1,
      ...requirementStates.map((row) => row.direct?.inferenceVersion ?? 1),
    ),
    nextAction:
      summaryStatus === "unobserved"
        ? "collect_direct_evidence"
        : requiredUnobserved
          ? "collect_required_dimension_evidence"
          : gateFailed
            ? "practice_gated_requirement"
            : null,
  };
}

export function completeness(units: readonly SnapshotUnit[]) {
  const lessons = units.filter((unit) => unit.unitKind === "lesson");
  const expandedUnits = lessons.filter(
    (unit) => unit.modelStatus === "expanded",
  ).length;
  return {
    expandedUnits,
    totalLessonUnits: lessons.length,
    percentage:
      lessons.length === 0
        ? 100
        : Math.round((expandedUnits / lessons.length) * 100),
  };
}
