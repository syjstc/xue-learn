// @ts-nocheck -- unbound compatibility implementation; hosted callers use repositories.
import type { Persistence, PersistenceClient } from "../persistence/persistence-compat.js";
import { parsePrereqs } from "../domain/unit-status.js";
import {
  canonicalizeAllowlistedEntityReuse,
  scopedStableKey,
  unitCognitiveModelProposalSchema,
  validateExternalEntityReferences,
  type ExternalCognitiveEntityReference,
  type UnitCognitiveModelProposal,
} from "./generation.js";
/*
 * Keep the persistence boundary independently defensive: generation is one
 * caller, but only a validated server proposal and allowlist may reach writes.
 */
import { orderCurriculumUnits, validateCognitiveModelSnapshot } from "./pure.js";
import {
  COGNITIVE_MODEL_SCHEMA_VERSION,
  type CognitiveDimension,
  type CognitiveModelSnapshot,
  type SnapshotEntity,
  type SnapshotLearningTarget,
  type SnapshotRelation,
} from "./types.js";

export type CognitiveModelTransaction = Persistence.TransactionClient;

function inputJson(value: unknown): Persistence.InputJsonValue {
  return value as Persistence.InputJsonValue;
}

function jsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeSemanticKey(value: string): string {
  return value.normalize("NFC").trim().toLowerCase();
}

function definitionDigest(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, child]) => [key, normalize(child)]),
      );
    }
    return typeof item === "string" ? item.normalize("NFC").trim() : item;
  };
  return JSON.stringify(normalize(value));
}

function aggregationPolicy(
  components: Array<{ requirementMode: string; gate: boolean }>,
): "all_required" | "weighted_geometric" | "alternative_paths" {
  if (
    components.some(
      (component) => component.requirementMode === "alternative_path",
    )
  ) {
    return "alternative_paths";
  }
  if (
    components.length > 0 &&
    components.every(
      (component) => component.requirementMode === "required" && component.gate,
    )
  ) {
    return "all_required";
  }
  return "weighted_geometric";
}

export async function buildObjectiveSnapshot(
  client: PersistenceClient | CognitiveModelTransaction,
  goalId: string,
  inputHash: string,
  audit: Record<string, unknown> = {},
): Promise<CognitiveModelSnapshot> {
  const [goal, entityRows, relationRows, componentRows, targetRows] =
    await Promise.all([
      client.learningGoal.findUnique({
        where: { id: goalId },
        include: {
          units: {
            where: { unitKind: { not: "overview" } },
            include: { learningTargets: { orderBy: { orderIndex: "asc" } } },
          },
        },
      }),
      client.cognitiveEntity.findMany({
        where: { goalId, status: "active" },
        include: { atom: true, construct: true },
        orderBy: [{ kind: "asc" }, { stableKey: "asc" }],
      }),
      client.cognitiveRelation.findMany({
        where: {
          status: "active",
          source: { goalId, status: "active" },
          target: { goalId, status: "active" },
        },
        orderBy: [
          { relationType: "asc" },
          { sourceEntityId: "asc" },
          { targetEntityId: "asc" },
        ],
      }),
      client.constructComponent.findMany({
        where: {
          construct: { entity: { goalId, status: "active" } },
          componentEntity: { status: "active" },
        },
        orderBy: [{ constructId: "asc" }, { orderIndex: "asc" }],
      }),
      client.learningTarget.findMany({
        where: { goalId, status: "active" },
        include: {
          requirements: { orderBy: { orderIndex: "asc" } },
          units: { orderBy: { orderIndex: "asc" } },
        },
        orderBy: { stableKey: "asc" },
      }),
    ]);
  if (!goal) throw new Error("Goal not found");

  const componentsByConstruct = new Map<string, typeof componentRows>();
  for (const component of componentRows) {
    componentsByConstruct.set(component.constructId, [
      ...(componentsByConstruct.get(component.constructId) ?? []),
      component,
    ]);
  }
  const entities: SnapshotEntity[] = entityRows.map((entity) => {
    const components = componentsByConstruct.get(entity.id) ?? [];
    return {
      id: entity.id,
      stableKey: entity.stableKey,
      kind: entity.kind as SnapshotEntity["kind"],
      title: entity.title,
      description: entity.description,
      language: entity.language,
      definitionVersion: entity.definitionVersion,
      status: "active",
      atom: entity.atom
        ? {
            statement: entity.atom.statement,
            explanation: entity.atom.explanation,
            boundary: entity.atom.boundary,
            knowledgeForm: entity.atom.atomType,
          }
        : null,
      construct: entity.construct
        ? {
            objective: entity.construct.objective,
            inputs: jsonArray<string>(entity.construct.inputs),
            outputs: jsonArray<string>(entity.construct.outputs),
            qualityCriteria: jsonArray<string>(
              entity.construct.qualityCriteria,
            ),
            compositionStrategy: entity.construct.compositionStrategy,
            aggregationPolicy: aggregationPolicy(components),
          }
        : null,
    };
  });
  const relations: SnapshotRelation[] = relationRows.map((relation) => ({
    id: relation.id,
    fromEntityId: relation.sourceEntityId,
    toEntityId: relation.targetEntityId,
    relationType: relation.relationType as SnapshotRelation["relationType"],
    strength: relation.required ? "required" : "recommended",
    rationale: relation.rationale,
    status: "active",
  }));
  const learningTargets: SnapshotLearningTarget[] = targetRows.map(
    (target) => ({
      id: target.id,
      stableKey: target.stableKey,
      title: target.title,
      description: target.explanation,
      learningObjective: target.learningObjective,
      assessmentCriteria: jsonArray<{ ref: string; text: string }>(
        target.assessmentCriteria,
      ),
      targetCognitiveLevel: target.targetCognitiveLevel,
      importance: target.importance,
      importanceWeight: target.importanceWeight,
      difficulty: target.difficulty,
      planningOutcomeRefs: jsonArray<string>(target.planningOutcomeRefs),
      requirements: target.requirements.map((requirement) => ({
        entityId: requirement.cognitiveEntityId,
        dimension: requirement.dimension as CognitiveDimension,
        required: requirement.required,
        weight: requirement.weight,
        threshold: requirement.threshold,
        gate: requirement.gate,
      })),
      mappings: target.units.map((mapping) => ({
        unitId: mapping.unitId,
        localRef: mapping.localRef,
        required: mapping.required,
        weight: mapping.weight,
        orderIndex: mapping.orderIndex,
        role: mapping.role,
        isEntry: mapping.isEntry,
        isExit: mapping.isExit,
      })),
    }),
  );
  const targetIdsByUnit = new Map<string, string[]>();
  for (const target of learningTargets) {
    for (const mapping of target.mappings) {
      targetIdsByUnit.set(mapping.unitId, [
        ...(targetIdsByUnit.get(mapping.unitId) ?? []),
        target.id,
      ]);
    }
  }
  const orderedUnits = orderCurriculumUnits(goal.units);
  const units = orderedUnits.map((unit, curriculumOrder) => ({
    unitId: unit.id,
    curriculumKey: unit.curriculumKey,
    title: unit.title,
    parentUnitId: unit.parentUnitId,
    unitKind: unit.unitKind,
    curriculumOrder,
    modelStatus: unit.cognitiveModelStatus,
    planAreaRef: unit.planAreaRef,
    planningOutcomeRefs: jsonArray<string>(unit.planningOutcomeRefs),
    prerequisiteUnitIds: parsePrereqs(unit.prerequisites),
    learningTargetIds: targetIdsByUnit.get(unit.id) ?? [],
  }));
  const snapshot: CognitiveModelSnapshot = {
    schemaVersion: COGNITIVE_MODEL_SCHEMA_VERSION,
    goalId,
    inputHash,
    entities,
    relations,
    components: componentRows.map((component) => ({
      id: component.id,
      constructId: component.constructId,
      componentEntityId: component.componentEntityId,
      relationType: component.relationType,
      role: component.role,
      requirementMode: component.requirementMode as
        | "required"
        | "optional"
        | "alternative_path",
      componentGroup: component.componentGroup,
      threshold: component.threshold,
      gate: component.gate,
      weight: component.weight,
      orderIndex: component.orderIndex,
      rationale: component.rationale,
    })),
    learningTargets,
    units,
    audit,
  };
  validateCognitiveModelSnapshot(snapshot);
  return snapshot;
}

type ExistingEntity = Awaited<
  ReturnType<CognitiveModelTransaction["cognitiveEntity"]["findMany"]>
>[number];

/** Persist one validated unit proposal without touching private learner data. */
export async function persistUnitCognitiveProposal(params: {
  client: CognitiveModelTransaction;
  goalId: string;
  unit: { id: string; curriculumKey: string };
  language: string;
  modelVersion: number;
  proposal: UnitCognitiveModelProposal;
  externalEntities: ExternalCognitiveEntityReference[];
}): Promise<void> {
  const proposal = unitCognitiveModelProposalSchema.parse(
    canonicalizeAllowlistedEntityReuse(
      params.proposal,
      params.externalEntities,
    ),
  );
  validateExternalEntityReferences(proposal, params.externalEntities);
  const existing = await params.client.cognitiveEntity.findMany({
    where: { goalId: params.goalId },
    include: { atom: true, construct: true },
    orderBy: { stableKey: "asc" },
  });
  const semanticExisting = new Map<string, (typeof existing)[number]>();
  for (const entity of existing) {
    const provenance = jsonRecord(entity.provenance);
    const semanticKey =
      typeof provenance.semanticKey === "string"
        ? provenance.semanticKey
        : null;
    if (
      semanticKey &&
      !semanticExisting.has(
        `${entity.kind}:${normalizeSemanticKey(semanticKey)}`,
      )
    )
      semanticExisting.set(
        `${entity.kind}:${normalizeSemanticKey(semanticKey)}`,
        entity,
      );
  }
  const externalIds = new Set(
    params.externalEntities.map((entity) => entity.id),
  );
  if (externalIds.size !== params.externalEntities.length) {
    throw new Error("Duplicate external cognitive entity identity");
  }
  const verifiedExternalRows =
    params.externalEntities.length === 0
      ? []
      : await params.client.cognitiveEntity.findMany({
          where: {
            id: { in: [...externalIds] },
            goalId: params.goalId,
            status: "active",
          },
          select: { id: true, stableKey: true, kind: true },
        });
  const verifiedExternalById = new Map(
    verifiedExternalRows.map((entity) => [entity.id, entity]),
  );
  const idsByRef = new Map<string, string>();
  for (const external of params.externalEntities) {
    const verified = verifiedExternalById.get(external.id);
    if (
      !verified ||
      verified.stableKey !== external.stableKey ||
      verified.kind !== external.kind ||
      idsByRef.has(external.ref)
    ) {
      throw new Error(`Invalid external cognitive entity ${external.ref}`);
    }
    idsByRef.set(external.ref, external.id);
  }
  const retainedEntityIds = new Set<string>();

  for (const proposalEntity of proposal.entities) {
    const normalizedKey = normalizeSemanticKey(proposalEntity.semanticKey);
    const previous = semanticExisting.get(
      `${proposalEntity.kind}:${normalizedKey}`,
    );
    if (previous && externalIds.has(previous.id)) {
      throw new Error(
        `Generated entity ${proposalEntity.ref} duplicates allowlisted external identity; use its x_N alias`,
      );
    }
    const stableKey =
      previous?.stableKey ??
      scopedStableKey(
        params.unit.curriculumKey,
        proposalEntity.kind,
        normalizedKey,
      );
    const nextDefinition =
      proposalEntity.kind === "atom"
        ? {
            title: proposalEntity.title,
            description: proposalEntity.description,
            statement: proposalEntity.statement,
            explanation: proposalEntity.explanation,
            boundary: proposalEntity.boundary,
            atomType: proposalEntity.knowledgeForm,
            assessmentHints: proposalEntity.assessmentHints,
          }
        : {
            title: proposalEntity.title,
            description: proposalEntity.description,
            objective: proposalEntity.objective,
            inputs: proposalEntity.inputs,
            outputs: proposalEntity.outputs,
            qualityCriteria: proposalEntity.qualityCriteria,
            compositionStrategy: proposalEntity.compositionStrategy,
          };
    const previousDefinition = previous
      ? previous.atom
        ? {
            title: previous.title,
            description: previous.description,
            statement: previous.atom.statement,
            explanation: previous.atom.explanation,
            boundary: previous.atom.boundary,
            atomType: previous.atom.atomType,
            assessmentHints: previous.atom.assessmentHints,
          }
        : previous.construct
          ? {
              title: previous.title,
              description: previous.description,
              objective: previous.construct.objective,
              inputs: previous.construct.inputs,
              outputs: previous.construct.outputs,
              qualityCriteria: previous.construct.qualityCriteria,
              compositionStrategy: previous.construct.compositionStrategy,
            }
          : null
      : null;
    const definitionChanged =
      previousDefinition != null &&
      definitionDigest(previousDefinition) !== definitionDigest(nextDefinition);
    const previousProvenance = previous ? jsonRecord(previous.provenance) : {};
    const usedBy = new Set(
      jsonArray<string>(previousProvenance.usedByCurriculumKeys),
    );
    usedBy.add(params.unit.curriculumKey);
    const entity = await params.client.cognitiveEntity.upsert({
      where: { goalId_stableKey: { goalId: params.goalId, stableKey } },
      create: {
        stableKey,
        scopeKey: `goal:${params.goalId}`,
        scope: "goal",
        goalId: params.goalId,
        kind: proposalEntity.kind,
        title: proposalEntity.title,
        description: proposalEntity.description,
        language: params.language,
        provenance: inputJson({
          semanticKey: normalizedKey,
          ownerCurriculumKey: params.unit.curriculumKey,
          usedByCurriculumKeys: [...usedBy].sort(),
        }),
      },
      update: {
        title: proposalEntity.title,
        description: proposalEntity.description,
        language: params.language,
        status: "active",
        ...(definitionChanged ? { definitionVersion: { increment: 1 } } : {}),
        provenance: inputJson({
          ...previousProvenance,
          semanticKey: normalizedKey,
          ownerCurriculumKey:
            typeof previousProvenance.ownerCurriculumKey === "string"
              ? previousProvenance.ownerCurriculumKey
              : params.unit.curriculumKey,
          usedByCurriculumKeys: [...usedBy].sort(),
        }),
      },
      select: { id: true },
    });
    idsByRef.set(proposalEntity.ref, entity.id);
    retainedEntityIds.add(entity.id);
    if (proposalEntity.kind === "atom") {
      await params.client.cognitiveConstruct.deleteMany({
        where: { entityId: entity.id },
      });
      await params.client.knowledgeAtom.upsert({
        where: { entityId: entity.id },
        create: {
          entityId: entity.id,
          atomType: proposalEntity.knowledgeForm,
          statement: proposalEntity.statement,
          explanation: proposalEntity.explanation,
          boundary: inputJson(proposalEntity.boundary),
          assessmentHints: inputJson(proposalEntity.assessmentHints),
        },
        update: {
          atomType: proposalEntity.knowledgeForm,
          statement: proposalEntity.statement,
          explanation: proposalEntity.explanation,
          boundary: inputJson(proposalEntity.boundary),
          assessmentHints: inputJson(proposalEntity.assessmentHints),
        },
      });
    } else {
      await params.client.knowledgeAtom.deleteMany({
        where: { entityId: entity.id },
      });
      await params.client.cognitiveConstruct.upsert({
        where: { entityId: entity.id },
        create: {
          entityId: entity.id,
          constructType: proposalEntity.kind,
          objective: proposalEntity.objective,
          inputs: inputJson(proposalEntity.inputs),
          outputs: inputJson(proposalEntity.outputs),
          qualityCriteria: inputJson(proposalEntity.qualityCriteria),
          compositionStrategy: inputJson({
            summary: proposalEntity.compositionStrategy,
          }),
        },
        update: {
          constructType: proposalEntity.kind,
          objective: proposalEntity.objective,
          inputs: inputJson(proposalEntity.inputs),
          outputs: inputJson(proposalEntity.outputs),
          qualityCriteria: inputJson(proposalEntity.qualityCriteria),
          compositionStrategy: inputJson({
            summary: proposalEntity.compositionStrategy,
          }),
        },
      });
    }
  }

  const constructIds = proposal.entities
    .filter((entity) => entity.kind !== "atom")
    .map((entity) => idsByRef.get(entity.ref)!)
    .filter(Boolean);
  if (constructIds.length > 0) {
    await params.client.constructComponent.deleteMany({
      where: { constructId: { in: constructIds } },
    });
  }
  for (const [index, component] of proposal.components.entries()) {
    const constructId = idsByRef.get(component.constructRef);
    const componentEntityId = idsByRef.get(component.componentRef);
    if (!constructId || !componentEntityId)
      throw new Error("Unresolved construct component");
    // Alias-level validation cannot see two distinct refs that resolve to the
    // same durable entity (for example after semantic identity reuse). The
    // component collection is optional model-authored structure, so discard
    // the invalid self-edge instead of aborting the unit transaction.
    if (constructId === componentEntityId) continue;
    await params.client.constructComponent.create({
      data: {
        constructId,
        componentEntityId,
        relationType: "composed_of",
        requirementMode: component.requirementMode,
        componentGroup: component.componentGroup,
        threshold: component.threshold,
        gate: component.gate,
        weight: component.weight,
        orderIndex: index,
        rationale: component.rationale,
      },
    });
  }

  const resolvedRelations = proposal.relations.map((relation) => {
    let sourceEntityId = idsByRef.get(relation.fromRef);
    let targetEntityId = idsByRef.get(relation.toRef);
    if (!sourceEntityId || !targetEntityId)
      throw new Error("Unresolved cognitive relation");
    if (sourceEntityId === targetEntityId) {
      throw new Error("Cognitive relation cannot merge an external alias");
    }
    if (
      relation.relationType === "contrasts" &&
      sourceEntityId > targetEntityId
    ) {
      [sourceEntityId, targetEntityId] = [targetEntityId, sourceEntityId];
    }
    return { relation, sourceEntityId, targetEntityId };
  });
  const retainedRelationKeys = new Set(
    resolvedRelations.map(
      ({ relation, sourceEntityId, targetEntityId }) =>
        `${sourceEntityId}\n${targetEntityId}\n${relation.relationType}`,
    ),
  );
  const priorRelations = await params.client.cognitiveRelation.findMany({
    where: {
      status: "active",
      ownerCurriculumKey: params.unit.curriculumKey,
    },
    select: {
      id: true,
      sourceEntityId: true,
      targetEntityId: true,
      relationType: true,
    },
  });
  const staleRelationIds = priorRelations
    .filter(
      (relation) =>
        !retainedRelationKeys.has(
          `${relation.sourceEntityId}\n${relation.targetEntityId}\n${relation.relationType}`,
        ),
    )
    .map((relation) => relation.id);
  if (staleRelationIds.length > 0) {
    await params.client.cognitiveRelation.updateMany({
      where: { id: { in: staleRelationIds } },
      data: {
        status: "deprecated",
        deprecatedModelVersion: params.modelVersion,
      },
    });
  }

  for (const {
    relation,
    sourceEntityId,
    targetEntityId,
  } of resolvedRelations) {
    const previousRelation = await params.client.cognitiveRelation.findUnique({
      where: {
        sourceEntityId_targetEntityId_relationType: {
          sourceEntityId,
          targetEntityId,
          relationType: relation.relationType,
        },
      },
      select: { status: true, ownerCurriculumKey: true },
    });
    if (
      previousRelation?.status === "active" &&
      previousRelation.ownerCurriculumKey !== params.unit.curriculumKey
    ) {
      // The identical objective relation is already published by another
      // unit. Referencing it does not grant this unit authority to rewrite it.
      continue;
    }
    const ownerCurriculumKey =
      !previousRelation || previousRelation.status === "deprecated"
        ? params.unit.curriculumKey
        : previousRelation.ownerCurriculumKey;
    await params.client.cognitiveRelation.upsert({
      where: {
        sourceEntityId_targetEntityId_relationType: {
          sourceEntityId,
          targetEntityId,
          relationType: relation.relationType,
        },
      },
      create: {
        ownerCurriculumKey,
        sourceEntityId,
        targetEntityId,
        relationType: relation.relationType,
        strength: relation.strength === "required" ? 1 : 0.65,
        required: relation.strength === "required",
        rationale: relation.rationale,
        introducedModelVersion: params.modelVersion,
      },
      update: {
        ownerCurriculumKey,
        strength: relation.strength === "required" ? 1 : 0.65,
        required: relation.strength === "required",
        rationale: relation.rationale,
        status: "active",
        deprecatedModelVersion: null,
      },
    });
  }

  const currentOwnedIds = existing
    .filter(
      (entity) =>
        jsonRecord(entity.provenance).ownerCurriculumKey ===
        params.unit.curriculumKey,
    )
    .map((entity) => entity.id);

  const previousMappings = await params.client.unitLearningTarget.findMany({
    where: { unitId: params.unit.id },
    select: { learningTargetId: true },
  });
  await params.client.unitLearningTarget.deleteMany({
    where: { unitId: params.unit.id },
  });
  const retainedTargetIds = new Set<string>();
  for (const [targetIndex, target] of proposal.learningTargets.entries()) {
    const stableKey = scopedStableKey(
      params.unit.curriculumKey,
      "target",
      target.semanticKey,
    );
    const targetRow = await params.client.learningTarget.upsert({
      where: { goalId_stableKey: { goalId: params.goalId, stableKey } },
      create: {
        goalId: params.goalId,
        stableKey,
        title: target.title,
        explanation: target.explanation,
        learningObjective: target.learningObjective,
        assessmentCriteria: inputJson(target.assessmentCriteria),
        language: params.language,
        importance: target.importance,
        importanceWeight: target.importanceWeight,
        difficulty: target.difficulty,
        targetCognitiveLevel: target.targetCognitiveLevel,
        planningOutcomeRefs: inputJson(target.planningOutcomeRefs),
        introducedModelVersion: params.modelVersion,
      },
      update: {
        title: target.title,
        explanation: target.explanation,
        learningObjective: target.learningObjective,
        assessmentCriteria: inputJson(target.assessmentCriteria),
        language: params.language,
        importance: target.importance,
        importanceWeight: target.importanceWeight,
        difficulty: target.difficulty,
        targetCognitiveLevel: target.targetCognitiveLevel,
        planningOutcomeRefs: inputJson(target.planningOutcomeRefs),
        status: "active",
        deprecatedModelVersion: null,
      },
      select: { id: true },
    });
    retainedTargetIds.add(targetRow.id);
    await params.client.learningTargetRequirement.deleteMany({
      where: { learningTargetId: targetRow.id },
    });
    await params.client.learningTargetRequirement.createMany({
      data: target.requirements.map((requirement, index) => ({
        learningTargetId: targetRow.id,
        cognitiveEntityId: idsByRef.get(requirement.entityRef)!,
        dimension: requirement.dimension,
        required: requirement.required,
        weight: requirement.weight,
        threshold: requirement.threshold,
        gate: requirement.gate,
        orderIndex: index,
      })),
    });
    await params.client.unitLearningTarget.create({
      data: {
        unitId: params.unit.id,
        learningTargetId: targetRow.id,
        localRef: target.ref,
        required: target.importance !== "enrichment",
        weight: target.importanceWeight,
        orderIndex: targetIndex,
        role: target.role,
        isEntry: target.isEntry,
        isExit: target.isExit,
      },
    });
  }
  const staleTargetIds = previousMappings
    .map((mapping) => mapping.learningTargetId)
    .filter((id) => !retainedTargetIds.has(id));
  if (staleTargetIds.length > 0) {
    await params.client.learningTarget.updateMany({
      where: { id: { in: staleTargetIds } },
      data: {
        status: "deprecated",
        deprecatedModelVersion: params.modelVersion,
      },
    });
  }

  const staleOwnedIds = currentOwnedIds.filter(
    (id) => !retainedEntityIds.has(id),
  );
  if (staleOwnedIds.length > 0) {
    const [targetUsage, relationUsage, componentUsage, taskUsage] =
      await Promise.all([
        params.client.learningTargetRequirement.findMany({
          where: {
            cognitiveEntityId: { in: staleOwnedIds },
            learningTarget: {
              status: "active",
              units: { some: { unitId: { not: params.unit.id } } },
            },
          },
          select: { cognitiveEntityId: true },
        }),
        params.client.cognitiveRelation.findMany({
          where: {
            status: "active",
            ownerCurriculumKey: { not: params.unit.curriculumKey },
            OR: [
              { sourceEntityId: { in: staleOwnedIds } },
              { targetEntityId: { in: staleOwnedIds } },
            ],
          },
          select: { sourceEntityId: true, targetEntityId: true },
        }),
        params.client.constructComponent.findMany({
          where: {
            componentEntityId: { in: staleOwnedIds },
            constructId: { notIn: staleOwnedIds },
          },
          select: { componentEntityId: true },
        }),
        params.client.taskRequirement.findMany({
          where: {
            cognitiveEntityId: { in: staleOwnedIds },
            task: { status: "active" },
          },
          select: { cognitiveEntityId: true },
        }),
      ]);
    const usedIds = new Set([
      ...targetUsage.map((row) => row.cognitiveEntityId),
      ...componentUsage.map((row) => row.componentEntityId),
      ...taskUsage.map((row) => row.cognitiveEntityId),
      ...relationUsage.flatMap((row) => [
        row.sourceEntityId,
        row.targetEntityId,
      ]),
    ]);
    const deprecateIds = staleOwnedIds.filter((id) => !usedIds.has(id));
    if (deprecateIds.length > 0) {
      await params.client.cognitiveEntity.updateMany({
        where: { id: { in: deprecateIds } },
        data: { status: "deprecated" },
      });
    }
  }
}
