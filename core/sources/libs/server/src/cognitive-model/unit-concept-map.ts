import type {
  CognitiveModelSnapshot,
  SnapshotEntity,
  SnapshotLearningTarget,
  SnapshotRelation,
} from "./types.js";

export type UnitConceptMapNodeProjection = {
  id: string;
  title: string;
  description: string;
  kind: SnapshotEntity["kind"];
  isDirect: boolean;
};

export type UnitConceptMapEdgeProjection = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  relationType: SnapshotRelation["relationType"];
  strength: SnapshotRelation["strength"];
  rationale: string;
};

export type UnitConceptMapProjection = {
  unitId: string;
  title: string;
  nodes: UnitConceptMapNodeProjection[];
  edges: UnitConceptMapEdgeProjection[];
};

const ROLE_SCORE: Record<string, number> = {
  primary: 300,
  supporting: 200,
  review: 100,
};

const KIND_SCORE: Record<SnapshotEntity["kind"], number> = {
  competency: 4,
  skill: 3,
  concept: 2,
  atom: 1,
};

function targetScore(target: SnapshotLearningTarget, unitId: string) {
  const mapping = target.mappings.find((row) => row.unitId === unitId);
  if (!mapping) return 0;
  return (
    (ROLE_SCORE[mapping.role] ?? 0) +
    target.importanceWeight * 10 +
    mapping.weight * 5 +
    (mapping.required ? 20 : 0)
  );
}

function entityDescription(entity: SnapshotEntity) {
  return (
    entity.description ||
    entity.atom?.statement ||
    entity.atom?.explanation ||
    entity.construct?.objective ||
    ""
  );
}

/**
 * Builds a small objective-only unit graph from the published KACOM snapshot.
 * Direct target requirements win; one-hop context only fills sparse maps.
 */
export function projectUnitConceptMap(
  snapshot: CognitiveModelSnapshot,
  unitId: string,
): UnitConceptMapProjection | null {
  const unit = snapshot.units.find((row) => row.unitId === unitId);
  if (!unit) return null;

  const entitiesById = new Map(
    snapshot.entities
      .filter((entity) => entity.status === "active")
      .map((entity) => [entity.id, entity]),
  );
  const unitTargets = snapshot.learningTargets.filter((target) =>
    target.mappings.some((mapping) => mapping.unitId === unitId),
  );
  const directScores = new Map<string, number>();

  for (const target of unitTargets) {
    const baseScore = targetScore(target, unitId);
    for (const requirement of target.requirements) {
      const entity = entitiesById.get(requirement.entityId);
      if (!entity) continue;
      const score =
        baseScore +
        requirement.weight * 10 +
        (requirement.required ? 40 : 0) +
        (requirement.gate ? 25 : 0) +
        KIND_SCORE[entity.kind];
      directScores.set(
        entity.id,
        Math.max(directScores.get(entity.id) ?? Number.NEGATIVE_INFINITY, score),
      );
    }
  }

  const directIds = [...directScores]
    .sort(
      ([leftId, leftScore], [rightId, rightScore]) =>
        rightScore - leftScore || leftId.localeCompare(rightId),
    )
    .map(([id]) => id)
    .slice(0, 9);
  const selectedIds = new Set(directIds);
  const activeRelations = snapshot.relations.filter(
    (relation) =>
      relation.status === "active" &&
      entitiesById.has(relation.fromEntityId) &&
      entitiesById.has(relation.toEntityId),
  );

  if (selectedIds.size < 5) {
    const contextScores = new Map<string, number>();
    for (const relation of activeRelations) {
      const fromSelected = selectedIds.has(relation.fromEntityId);
      const toSelected = selectedIds.has(relation.toEntityId);
      if (fromSelected === toSelected) continue;
      const contextId = fromSelected
        ? relation.toEntityId
        : relation.fromEntityId;
      const entity = entitiesById.get(contextId);
      if (!entity || selectedIds.has(contextId)) continue;
      const score =
        (relation.strength === "required" ? 100 : 50) +
        KIND_SCORE[entity.kind];
      contextScores.set(
        contextId,
        Math.max(contextScores.get(contextId) ?? 0, score),
      );
    }
    for (const [id] of [...contextScores].sort(
      ([leftId, leftScore], [rightId, rightScore]) =>
        rightScore - leftScore || leftId.localeCompare(rightId),
    )) {
      if (selectedIds.size >= 5 || selectedIds.size >= 9) break;
      selectedIds.add(id);
    }
  }

  const nodes = [...selectedIds].flatMap((id) => {
    const entity = entitiesById.get(id);
    if (!entity) return [];
    return [
      {
        id: entity.id,
        title: entity.title,
        description: entityDescription(entity),
        kind: entity.kind,
        isDirect: directScores.has(entity.id),
      },
    ];
  });
  const selectedNodeIds = new Set(nodes.map((node) => node.id));
  const edges = activeRelations
    .filter(
      (relation) =>
        selectedNodeIds.has(relation.fromEntityId) &&
        selectedNodeIds.has(relation.toEntityId),
    )
    .sort(
      (left, right) =>
        Number(right.strength === "required") -
          Number(left.strength === "required") ||
        left.relationType.localeCompare(right.relationType) ||
        left.id.localeCompare(right.id),
    )
    .map((relation) => ({
      id: relation.id,
      fromNodeId: relation.fromEntityId,
      toNodeId: relation.toEntityId,
      relationType: relation.relationType,
      strength: relation.strength,
      rationale: relation.rationale,
    }));

  return { unitId, title: unit.title, nodes, edges };
}
