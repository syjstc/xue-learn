// @ts-nocheck -- unbound compatibility implementation; hosted callers use repositories.
import type { Persistence, PersistenceClient } from "../persistence/persistence-compat.js";
import type {
  LearnerStateProjectionReadRecord,
  LearnerStateProjectionReadRepository,
} from "../../../domain/src/index.js";
import type { LearnerGapType } from "./types.js";

let configuredLearnerStateProjectionRead:
  LearnerStateProjectionReadRepository | undefined;

/** Install the projection reader for hosted gap refreshes. */
export function configureLearnerStateProjectionRead(
  projectionRead: LearnerStateProjectionReadRepository | undefined,
): void {
  configuredLearnerStateProjectionRead = projectionRead;
}

type GapLearnerState = {
  estimate: number | null;
  evidenceSufficiency: number;
  status: string;
  dimensions: Array<{
    dimension: string;
    estimate: number | null;
    evidenceSufficiency: number;
    status: string;
  }>;
  lastEvidenceClaimId: string | null;
  lastEvidenceClaim: { misconceptionPatternId: string | null } | null;
};

type GapConstruct = {
  entityId: string;
  entity: { id: string };
  components: Array<{
    componentEntityId: string;
    requirementMode: string;
    gate: boolean;
    componentEntity: { id: string; learnerStates?: GapLearnerState[] };
  }>;
};

type GapChangedEntity = {
  id: string;
  goalId: string | null;
  kind: string;
  learnerStates: GapLearnerState[];
  componentMemberships: Array<{ construct: GapConstruct }>;
  construct: (Omit<GapConstruct, "entity"> & { entity: { id: string } }) | null;
};

type GapEvidenceClaim = {
  id: string;
  cognitiveEntityId: string;
  misconceptionPatternId: string | null;
  createdAt: Date;
  observation: { observedAt: Date };
};

function projectedState(
  state: LearnerStateProjectionReadRecord,
  claim: GapEvidenceClaim | undefined,
): GapLearnerState {
  return {
    estimate: state.overallEstimate,
    evidenceSufficiency: state.evidenceSufficiency,
    status: state.status,
    dimensions: state.dimensions.map((dimension) => ({
      dimension: dimension.dimension,
      estimate: dimension.estimate,
      evidenceSufficiency: dimension.evidenceSufficiency,
      status: dimension.status,
    })),
    lastEvidenceClaimId: claim?.id ?? null,
    lastEvidenceClaim: claim
      ? { misconceptionPatternId: claim.misconceptionPatternId }
      : null,
  };
}

async function readProjectionStates(
  persistence: PersistenceClient,
  projectionRead: LearnerStateProjectionReadRepository,
  userId: string,
  entityIds: readonly string[],
  asOf: Date,
): Promise<Map<string, GapLearnerState> | null> {
  const projected = await projectionRead.findMany({
    userId,
    cognitiveEntityIds: entityIds,
    asOf,
  });
  if (!projected) return null;
  const claims = (await persistence.evidenceClaim.findMany({
    where: {
      userId,
      cognitiveEntityId: { in: entityIds },
      status: "active",
      validFrom: { lte: asOf },
    },
    select: {
      id: true,
      cognitiveEntityId: true,
      misconceptionPatternId: true,
      createdAt: true,
      observation: { select: { observedAt: true } },
    },
  })) as GapEvidenceClaim[];
  const latestClaimByEntity = new Map<string, GapEvidenceClaim>();
  for (const claim of claims) {
    const current = latestClaimByEntity.get(claim.cognitiveEntityId);
    if (
      !current ||
      claim.observation.observedAt.getTime() >
        current.observation.observedAt.getTime() ||
      (claim.observation.observedAt.getTime() ===
        current.observation.observedAt.getTime() &&
        (claim.createdAt.getTime() > current.createdAt.getTime() ||
          (claim.createdAt.getTime() === current.createdAt.getTime() &&
            claim.id.localeCompare(current.id) > 0)))
    ) {
      latestClaimByEntity.set(claim.cognitiveEntityId, claim);
    }
  }
  const result = new Map(
    projected.map((state) => [
      state.cognitiveEntityId,
      projectedState(state, latestClaimByEntity.get(state.cognitiveEntityId)),
    ]),
  );
  return entityIds.every((entityId) => result.has(entityId)) ? result : null;
}

async function readPersistenceStates(
  persistence: PersistenceClient,
  userId: string,
  entityIds: readonly string[],
): Promise<Map<string, GapLearnerState>> {
  const states = await persistence.learnerEntityState.findMany({
    where: { userId, cognitiveEntityId: { in: entityIds } },
    include: {
      dimensions: true,
      lastEvidenceClaim: {
        select: { id: true, misconceptionPatternId: true },
      },
    },
  });
  return new Map(
    states.map((state) => [state.cognitiveEntityId, state as GapLearnerState]),
  );
}

type GapProposal = {
  primaryEntityId: string;
  cognitiveRelationId?: string | null;
  gapType: LearnerGapType;
  confidence: number;
  severity: number;
  rationale: string;
  supportingEntityIds: string[];
  evidenceClaimIds: string[];
  misconceptionPatternId?: string | null;
  recommendedAction: Record<string, unknown>;
  status?: "active" | "testing";
};

function json(value: unknown): Persistence.InputJsonValue {
  return value as Persistence.InputJsonValue;
}

function isReady(
  state:
    | {
        status: string;
        estimate: number | null;
        evidenceSufficiency: number;
      }
    | null
    | undefined,
): boolean {
  return Boolean(
    state &&
    (state.status === "demonstrated" || state.status === "robust") &&
    state.estimate != null &&
    state.estimate >= 0.7 &&
    state.evidenceSufficiency >= 0.5,
  );
}

/**
 * Persist deterministic, reversible gap hypotheses. These rows describe what
 * the next task should test; they never mutate objective definitions or serve
 * as learner state themselves.
 */
export async function refreshLearnerGapHypotheses(
  persistence: PersistenceClient,
  userId: string,
  changedEntityId: string,
  projectionRead?: LearnerStateProjectionReadRepository,
): Promise<void> {
  projectionRead ??= configuredLearnerStateProjectionRead;
  const changed = await persistence.cognitiveEntity.findUnique({
    where: { id: changedEntityId },
    include: {
      ...(projectionRead
        ? {}
        : {
            learnerStates: {
              where: { userId },
              include: {
                dimensions: true,
                lastEvidenceClaim: {
                  select: { id: true, misconceptionPatternId: true },
                },
              },
              take: 1,
            },
          }),
      componentMemberships: {
        include: {
          construct: {
            include: {
              entity: true,
              components: {
                include: {
                  componentEntity: projectionRead
                    ? true
                    : {
                        include: {
                          learnerStates: {
                            where: { userId },
                            include: {
                              dimensions: true,
                              lastEvidenceClaim: {
                                select: {
                                  id: true,
                                  misconceptionPatternId: true,
                                },
                              },
                            },
                            take: 1,
                          },
                        },
                      },
                },
              },
            },
          },
        },
      },
      construct: {
        include: {
          components: {
            include: {
              componentEntity: projectionRead
                ? true
                : {
                    include: {
                      learnerStates: {
                        where: { userId },
                        include: {
                          dimensions: true,
                          lastEvidenceClaim: {
                            select: { id: true, misconceptionPatternId: true },
                          },
                        },
                        take: 1,
                      },
                    },
                  },
            },
          },
        },
      },
    },
  });
  const changedGraph = changed as unknown as GapChangedEntity | null;
  if (!changedGraph?.goalId) return;

  const initialEntityIds = [
    changedGraph.id,
    ...changedGraph.componentMemberships.flatMap((membership) => [
      membership.construct.entityId,
      ...membership.construct.components.map(
        (component) => component.componentEntityId,
      ),
    ]),
    ...(changedGraph.construct
      ? [
          changedGraph.construct.entityId,
          ...changedGraph.construct.components.map(
            (component) => component.componentEntityId,
          ),
        ]
      : []),
  ];
  const uniqueInitialEntityIds = [...new Set(initialEntityIds)];
  const stateByEntityId = projectionRead
    ? ((await readProjectionStates(
        persistence,
        projectionRead,
        userId,
        uniqueInitialEntityIds,
        new Date(),
      )) ?? (await readPersistenceStates(persistence, userId, uniqueInitialEntityIds)))
    : new Map<string, GapLearnerState>();
  if (!projectionRead) {
    const changedState = changedGraph.learnerStates?.[0];
    if (changedState) stateByEntityId.set(changedGraph.id, changedState);
    for (const membership of changedGraph.componentMemberships) {
      for (const component of membership.construct.components) {
        const state = component.componentEntity.learnerStates?.[0];
        if (state) stateByEntityId.set(component.componentEntityId, state);
      }
    }
    for (const component of changedGraph.construct?.components ?? []) {
      const state = component.componentEntity.learnerStates?.[0];
      if (state) stateByEntityId.set(component.componentEntityId, state);
    }
  }
  const changedState = stateByEntityId.get(changedGraph.id);

  const proposals: GapProposal[] = [];
  const directlyWeakDimensions =
    changedState?.dimensions.filter(
      (dimension) =>
        dimension.estimate != null &&
        dimension.evidenceSufficiency >= 0.5 &&
        dimension.estimate < 0.7,
    ) ?? [];
  const unverifiedPrerequisites =
    directlyWeakDimensions.length > 0
      ? await persistence.cognitiveRelation.findMany({
          where: {
            targetEntityId: changedGraph.id,
            relationType: "prerequisite",
            status: "active",
          },
          include: {
            source: projectionRead
              ? { select: { id: true } }
              : {
                  include: {
                    learnerStates: {
                      where: { userId },
                      include: { dimensions: true },
                      take: 1,
                    },
                  },
                },
          },
        })
      : [];
  const prerequisiteStateIds = unverifiedPrerequisites.map(
    (relation) => relation.sourceEntityId,
  );
  const prerequisiteStates =
    !projectionRead || prerequisiteStateIds.length === 0
      ? new Map<string, GapLearnerState>()
      : ((await readProjectionStates(
          persistence,
          projectionRead,
          userId,
          prerequisiteStateIds,
          new Date(),
        )) ?? (await readPersistenceStates(persistence, userId, prerequisiteStateIds)));
  for (const relation of unverifiedPrerequisites) {
    const sourceState = projectionRead
      ? prerequisiteStates.get(relation.sourceEntityId)
      : (
          relation.source as unknown as {
            learnerStates?: GapLearnerState[];
          }
        ).learnerStates?.[0];
    const sourceVerified = Boolean(
      sourceState?.dimensions.some(
        (dimension) =>
          dimension.estimate != null && dimension.evidenceSufficiency >= 0.5,
      ),
    );
    if (sourceVerified) continue;
    proposals.push({
      primaryEntityId: relation.sourceEntityId,
      cognitiveRelationId: relation.id,
      gapType: "relation",
      status: "testing",
      confidence: 0.25,
      severity: Math.max(
        0.3,
        ...directlyWeakDimensions.map(
          (dimension) => 1 - (dimension.estimate ?? 0.7),
        ),
      ),
      rationale:
        "下游直接任务证据低于门槛，但前提实体仍未验证；当前仅作为待检验假设，不视为基础不足。",
      supportingEntityIds: [changedGraph.id],
      evidenceClaimIds: changedState?.lastEvidenceClaimId
        ? [changedState.lastEvidenceClaimId]
        : [],
      recommendedAction: {
        taskKind: "readiness_probe",
        assessmentPurpose: "readiness",
        prerequisiteEntityId: relation.sourceEntityId,
        downstreamEntityId: changedGraph.id,
        desiredEvidence: ["memory", "understanding"],
      },
    });
  }
  const stability = changedState?.dimensions.find(
    (dimension) => dimension.dimension === "stability",
  );
  if (
    stability &&
    (stability.status === "revalidate" ||
      (stability.estimate != null &&
        stability.evidenceSufficiency >= 0.5 &&
        stability.estimate < 0.65))
  ) {
    proposals.push({
      primaryEntityId: changedGraph.id,
      gapType: "stability",
      confidence: Math.max(0.5, stability.evidenceSufficiency),
      severity:
        stability.status === "revalidate"
          ? Math.max(0.5, 1 - (stability.estimate ?? 0.5))
          : 1 - stability.estimate!,
      rationale:
        stability.status === "revalidate"
          ? "已有掌握证据超过复验间隔，需要延迟复测确认稳定性。"
          : "直接延迟证据显示保持与提取稳定性低于门槛。",
      supportingEntityIds: [],
      evidenceClaimIds: changedState?.lastEvidenceClaimId
        ? [changedState.lastEvidenceClaimId]
        : [],
      recommendedAction: {
        taskKind: "retention",
        desiredEvidence: ["memory", "stability"],
        contextDistance: "same",
      },
    });
  }
  if (
    changedGraph.kind === "atom" &&
    changedState?.estimate != null &&
    changedState.evidenceSufficiency >= 0.5 &&
    changedState.estimate < 0.65
  ) {
    proposals.push({
      primaryEntityId: changedGraph.id,
      gapType: "knowledge",
      confidence: changedState.evidenceSufficiency,
      severity: 1 - changedState.estimate,
      rationale: "原子已有充分直接证据，但当前表现低于知识准备阈值。",
      supportingEntityIds: [],
      evidenceClaimIds: changedState.lastEvidenceClaimId
        ? [changedState.lastEvidenceClaimId]
        : [],
      misconceptionPatternId:
        changedState.lastEvidenceClaim?.misconceptionPatternId ?? null,
      recommendedAction: {
        taskKind: "focused_atom_practice",
        desiredEvidence: ["understanding", "application"],
      },
    });
  }

  const constructContexts = changedGraph.componentMemberships.map(
    (membership) => ({
      construct: membership.construct,
      directState: null as typeof changedState | null,
    }),
  );
  if (changedGraph.construct) {
    constructContexts.push({
      construct: { ...changedGraph.construct, entity: changedGraph },
      directState: changedState ?? null,
    });
  }
  const visitedConstructIds = new Set<string>();
  for (const context of constructContexts) {
    const construct = context.construct.entity;
    if (visitedConstructIds.has(construct.id)) continue;
    visitedConstructIds.add(construct.id);
    const directState =
      context.directState ??
      stateByEntityId.get(construct.id) ??
      (await persistence.learnerEntityState.findUnique({
        where: {
          userId_cognitiveEntityId: {
            userId,
            cognitiveEntityId: construct.id,
          },
        },
        include: {
          dimensions: true,
          lastEvidenceClaim: {
            select: { id: true, misconceptionPatternId: true },
          },
        },
      }));
    const stateForComponent = (
      component: (typeof context.construct.components)[number],
    ) =>
      stateByEntityId.get(component.componentEntityId) ??
      component.componentEntity.learnerStates?.[0] ??
      null;
    const requiredComponents = context.construct.components.filter(
      (component) => component.requirementMode === "required" || component.gate,
    );
    const weakComponents = requiredComponents.filter(
      (component) => !isReady(stateForComponent(component)),
    );
    const componentIds = requiredComponents.map(
      (component) => component.componentEntityId,
    );
    const evidenceClaimIds = requiredComponents.flatMap((component) => {
      const claimId = stateForComponent(component)?.lastEvidenceClaimId;
      return claimId ? [claimId] : [];
    });
    const componentMisconceptionPatternId = weakComponents
      .map(
        (component) =>
          stateForComponent(component)?.lastEvidenceClaim
            ?.misconceptionPatternId,
      )
      .find((patternId): patternId is string => Boolean(patternId));
    const criticalRelations = await persistence.cognitiveRelation.findMany({
      where: {
        status: "active",
        OR: [
          {
            sourceEntityId: { in: [construct.id, ...componentIds] },
            targetEntityId: { in: [construct.id, ...componentIds] },
          },
        ],
        relationType: {
          in: ["prerequisite", "part_of", "constrains", "supports", "enables"],
        },
      },
      orderBy: [{ required: "desc" }, { strength: "desc" }, { id: "asc" }],
    });
    const criticalRelation = criticalRelations[0] ?? null;

    if (weakComponents.length > 0) {
      proposals.push({
        primaryEntityId: construct.id,
        gapType: "knowledge",
        confidence: Math.min(
          0.9,
          Math.max(
            0.25,
            ...weakComponents.map(
              (component) =>
                stateForComponent(component)?.evidenceSufficiency ?? 0,
            ),
          ),
        ),
        severity:
          weakComponents.length / Math.max(1, requiredComponents.length),
        rationale: "高层构造尚未就绪，因为一个或多个必要组件未达到门槛。",
        supportingEntityIds: weakComponents.map(
          (component) => component.componentEntityId,
        ),
        evidenceClaimIds,
        misconceptionPatternId: componentMisconceptionPatternId ?? null,
        recommendedAction: {
          taskKind: "component_remediation",
          componentEntityIds: weakComponents.map(
            (component) => component.componentEntityId,
          ),
        },
      });
      continue;
    }

    if (!directState || directState.estimate == null) {
      proposals.push({
        primaryEntityId: construct.id,
        cognitiveRelationId: criticalRelation?.id ?? null,
        gapType: "combination",
        confidence: 0.45,
        severity: 0.5,
        rationale: "组件已就绪，但尚无直接任务证据验证协同运行。",
        supportingEntityIds: componentIds,
        evidenceClaimIds,
        misconceptionPatternId:
          directState?.lastEvidenceClaim?.misconceptionPatternId ?? null,
        recommendedAction: {
          taskKind: "integration",
          desiredEvidence: ["application", "independence"],
        },
      });
      continue;
    }

    const transfer = directState.dimensions.find(
      (dimension) => dimension.dimension === "transfer",
    );
    const independence = directState.dimensions.find(
      (dimension) => dimension.dimension === "independence",
    );
    if (
      transfer?.estimate != null &&
      transfer.evidenceSufficiency >= 0.5 &&
      transfer.estimate < 0.65
    ) {
      proposals.push({
        primaryEntityId: construct.id,
        gapType: "transfer",
        confidence: transfer.evidenceSufficiency,
        severity: 1 - transfer.estimate,
        rationale: "组件已就绪，但跨情境直接证据显示迁移不足。",
        supportingEntityIds: componentIds,
        evidenceClaimIds,
        misconceptionPatternId:
          directState.lastEvidenceClaim?.misconceptionPatternId ?? null,
        recommendedAction: {
          taskKind: "far_context_transfer",
          contextDistance: "far",
          desiredEvidence: ["transfer"],
        },
      });
    } else if (
      independence?.estimate != null &&
      independence.evidenceSufficiency >= 0.5 &&
      independence.estimate < 0.65
    ) {
      proposals.push({
        primaryEntityId: construct.id,
        gapType: "strategy",
        confidence: independence.evidenceSufficiency,
        severity: 1 - independence.estimate,
        rationale: "组件已就绪，但直接任务显示仍依赖提示或外部支架。",
        supportingEntityIds: componentIds,
        evidenceClaimIds,
        misconceptionPatternId:
          directState.lastEvidenceClaim?.misconceptionPatternId ?? null,
        recommendedAction: {
          taskKind: "independent_integration",
          assistance: "independent",
          desiredEvidence: ["independence"],
        },
      });
    } else if (
      directState.evidenceSufficiency >= 0.5 &&
      directState.estimate < 0.65
    ) {
      proposals.push({
        primaryEntityId: construct.id,
        cognitiveRelationId: criticalRelation?.id ?? null,
        gapType: "combination",
        confidence: directState.evidenceSufficiency,
        severity: 1 - directState.estimate,
        rationale: "组件均已就绪，但高层直接任务表现持续偏低。",
        supportingEntityIds: componentIds,
        evidenceClaimIds: [
          ...evidenceClaimIds,
          ...(directState.lastEvidenceClaimId
            ? [directState.lastEvidenceClaimId]
            : []),
        ],
        misconceptionPatternId:
          directState.lastEvidenceClaim?.misconceptionPatternId ?? null,
        recommendedAction: {
          taskKind: "integration",
          desiredEvidence: ["application", "independence"],
        },
      });
      if (criticalRelation) {
        proposals.push({
          primaryEntityId: construct.id,
          cognitiveRelationId: criticalRelation.id,
          gapType: "relation",
          confidence: directState.evidenceSufficiency,
          severity: 1 - directState.estimate,
          rationale:
            "组件均已就绪，但直接任务失败；关键关系的选择或运行方式需要单独验证。",
          supportingEntityIds: [
            criticalRelation.sourceEntityId,
            criticalRelation.targetEntityId,
          ],
          evidenceClaimIds: directState.lastEvidenceClaimId
            ? [directState.lastEvidenceClaimId]
            : [],
          misconceptionPatternId:
            directState.lastEvidenceClaim?.misconceptionPatternId ?? null,
          recommendedAction: {
            taskKind: "relation_discrimination",
            cognitiveRelationId: criticalRelation.id,
            desiredEvidence: ["understanding", "application"],
          },
        });
      }
    }
  }

  const affectedEntityIds = [
    changedEntityId,
    ...unverifiedPrerequisites.map((relation) => relation.sourceEntityId),
    ...changedGraph.componentMemberships.map(
      (membership) => membership.construct.entityId,
    ),
    ...(changedGraph.construct ? [changedGraph.id] : []),
  ];
  const persist = async (client: Persistence.TransactionClient) => {
    const existing = await client.learnerGapHypothesis.findMany({
      where: {
        userId,
        primaryEntityId: { in: affectedEntityIds },
        status: { in: ["active", "testing"] },
      },
    });
    const proposalKeys = new Set(
      proposals.map(
        (proposal) => `${proposal.primaryEntityId}:${proposal.gapType}`,
      ),
    );
    for (const row of existing) {
      if (!row.primaryEntityId) continue;
      if (!proposalKeys.has(`${row.primaryEntityId}:${row.gapType}`)) {
        await client.learnerGapHypothesis.update({
          where: { id: row.id },
          data: { status: "resolved", resolvedAt: new Date() },
        });
      }
    }
    for (const proposal of proposals) {
      const current = existing.find(
        (row) =>
          row.primaryEntityId === proposal.primaryEntityId &&
          row.gapType === proposal.gapType,
      );
      const data = {
        goalId: changedGraph.goalId,
        status:
          proposal.status ??
          (proposal.gapType === "combination" && proposal.confidence < 0.5
            ? "testing"
            : "active"),
        confidence: proposal.confidence,
        severity: proposal.severity,
        rationale: proposal.rationale,
        cognitiveRelationId: proposal.cognitiveRelationId ?? null,
        misconceptionPatternId: proposal.misconceptionPatternId ?? null,
        supportingEntityIds: json(proposal.supportingEntityIds),
        evidenceClaimIds: json(proposal.evidenceClaimIds),
        recommendedAction: json(proposal.recommendedAction),
        resolvedAt: null,
      };
      if (current) {
        await client.learnerGapHypothesis.update({
          where: { id: current.id },
          data,
        });
      } else {
        await client.learnerGapHypothesis.create({
          data: {
            userId,
            primaryEntityId: proposal.primaryEntityId,
            gapType: proposal.gapType,
            ...data,
          },
        });
      }
    }
  };
  if (
    typeof (persistence as unknown as { $transaction?: unknown }).$transaction ===
    "function"
  ) {
    await persistence.$transaction((tx) => persist(tx));
  } else {
    await persist(persistence as unknown as Persistence.TransactionClient);
  }
}
