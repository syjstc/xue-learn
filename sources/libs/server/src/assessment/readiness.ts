// @ts-nocheck -- unbound compatibility implementation; hosted callers use repositories.
import { randomUUID } from "node:crypto";
import type { Persistence, PersistenceClient } from "../persistence/persistence-compat.js";
import type {
  CognitiveModelInvalidationRepository,
  ModuleEntryFoundationQueueRepository,
  ModuleEntryReadinessReadRepository,
} from "../../../domain/src/index.js";
import {
  acquireCognitiveModelWriteLock,
  COGNITIVE_MODEL_TRANSACTION_OPTIONS,
  invalidateCognitiveModelForGoal,
  publishMappingOnlyRevision,
} from "../cognitive-model/index.js";
import { adaptiveAssessmentEvidenceWritesEnabled } from "./adaptive-runtime.js";

export const MODULE_ENTRY_FOUNDATION_GENERATE_EVENT =
  "course.module.entry_foundations.generate";
const ENTRY_FOUNDATION_LEASE_MS = 15 * 60 * 1000;
let configuredModuleEntryReadinessRead:
  | ModuleEntryReadinessReadRepository
  | undefined;

export function configureModuleEntryReadinessRead(
  repository: ModuleEntryReadinessReadRepository | undefined,
): void {
  configuredModuleEntryReadinessRead = repository;
}

export type EntryReadinessReason =
  "unverified" | "insufficient_evidence" | "below_threshold" | "revalidate";

export type ModuleEntryReadiness = {
  status:
    | "not_applicable"
    | "check_recommended"
    | "ready"
    | "bridge_needed"
    | "revalidate";
  checkAvailable: boolean;
  bridgeUnitId: string | null;
  foundations: Array<{
    learningTargetId: string;
    title: string;
    critical: boolean;
    estimate: number | null;
    evidenceSufficiency: number;
    reason: EntryReadinessReason | null;
    ready: boolean;
  }>;
};

function json(value: unknown): Persistence.InputJsonValue {
  return value as Persistence.InputJsonValue;
}

type FoundationBrief = {
  ref: string;
  title: string;
  rationale: string;
  criticality: "critical" | "recommended";
  verificationDimensions: Array<"memory" | "understanding" | "application">;
};

function parseBriefs(value: unknown): FoundationBrief[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    const title = typeof row.title === "string" ? row.title.trim() : "";
    if (!title) return [];
    const rationale =
      typeof row.rationale === "string" && row.rationale.trim()
        ? row.rationale.trim()
        : `进入本模块前预计需要理解：${title}`;
    const dimensions = Array.isArray(row.verificationDimensions)
      ? row.verificationDimensions.filter(
          (
            dimension,
          ): dimension is "memory" | "understanding" | "application" =>
            dimension === "memory" ||
            dimension === "understanding" ||
            dimension === "application",
        )
      : [];
    return [
      {
        ref:
          typeof row.ref === "string" && row.ref.trim()
            ? row.ref.trim()
            : `ef_${index + 1}`,
        title,
        rationale,
        criticality:
          row.criticality === "recommended" ? "recommended" : "critical",
        verificationDimensions:
          dimensions.length > 0 ? [...new Set(dimensions)] : ["understanding"],
      },
    ];
  });
}

function legacyBriefs(mapPlanJson: string, moduleIndex: number) {
  try {
    const plan = JSON.parse(mapPlanJson) as {
      modules?: Array<{ prerequisitesAssumed?: unknown }>;
      prerequisitesAssumed?: unknown;
    };
    const raw =
      plan.modules?.[moduleIndex]?.prerequisitesAssumed ??
      plan.prerequisitesAssumed;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((item, index): FoundationBrief[] => {
      if (typeof item !== "string" || !item.trim()) return [];
      const title = item.trim();
      return [
        {
          ref: `ef_${index + 1}`,
          title,
          rationale: `进入本模块前预计需要理解：${title}`,
          criticality: "critical",
          verificationDimensions: ["understanding"],
        },
      ];
    });
  } catch {
    return [];
  }
}

/**
 * Existing curriculum-v2 modules may predate entry targets. The first module
 * readiness read leases and queues one deterministic contract materialization.
 */
export async function ensureModuleEntryFoundationsQueued(
  params: { userId: string; goalId: string; moduleId: string },
  repository: ModuleEntryFoundationQueueRepository,
) {
  const module = await repository.findOwnedContext(params);
  if (!module || module.hasEntryTargets) return false;
  if (
    module.entryFoundationStatus === "ready" ||
    module.entryFoundationStatus === "not_applicable"
  ) {
    return false;
  }
  const briefs =
    parseBriefs(module.entryFoundationBriefs).length > 0
      ? parseBriefs(module.entryFoundationBriefs)
      : legacyBriefs(module.mapPlanJson, module.orderIndex);
  if (briefs.length === 0) {
    return repository.markNotApplicable(module.moduleId);
  }

  const now = new Date();
  const token = randomUUID();
  return repository.claim({
    ...params,
    briefs,
    token,
    now,
    leaseMs: ENTRY_FOUNDATION_LEASE_MS,
    eventType: MODULE_ENTRY_FOUNDATION_GENERATE_EVENT,
  });
}

export async function processModuleEntryFoundationEvent(params: {
  payloadJson: string;
  repository: ModuleEntryFoundationQueueRepository;
  cognitiveModelInvalidation: CognitiveModelInvalidationRepository;
}) {
  const payload = JSON.parse(params.payloadJson) as {
    goalId?: string;
    moduleId?: string;
    token?: string;
  };
  if (!payload.goalId || !payload.moduleId || !payload.token) {
    throw new Error("Invalid entry foundation event payload");
  }
  const result = await params.repository.publish({
    goalId: payload.goalId,
    moduleId: payload.moduleId,
    token: payload.token,
  });
  if (result.status === "ready") await params.cognitiveModelInvalidation.invalidate({ goalId: result.goalId, reason: "module_entry_foundations_prepared" });
  return { status: result.status };
}

export async function getModuleEntryReadiness(
  params: { userId: string; goalId: string; moduleId: string },
  readinessRead: ModuleEntryReadinessReadRepository =
    configuredModuleEntryReadinessRead!,
): Promise<ModuleEntryReadiness> {
  type ReadinessRequirement = {
    dimension: string;
    threshold: number;
    required: boolean;
    gate: boolean;
    estimate: number | null;
    evidenceSufficiency: number;
    status: string | null;
  };
  type ReadinessTarget = {
    learningTargetId: string;
    title: string;
    required: boolean;
    requirements: readonly ReadinessRequirement[];
  };

  let mappings: readonly ReadinessTarget[];
  let bridgeUnitId: string | null;
  if (!readinessRead)
    throw new Error("Module entry readiness persistence is not configured");
  const read = await readinessRead.findForModule(params);
  mappings = read?.targets ?? [];
  bridgeUnitId = read?.bridgeUnitId ?? null;
  if (mappings.length === 0) {
    return {
      status: "not_applicable",
      checkAvailable: false,
      bridgeUnitId,
      foundations: [],
    };
  }

  const foundations = mappings.map((mapping) => {
    const required = mapping.requirements.filter(
      (requirement) => requirement.required || requirement.gate,
    );
    const requirements = required.length > 0 ? required : mapping.requirements;
    const rows = requirements.map((requirement) => {
      let reason: EntryReadinessReason | null = null;
      if (requirement.status === "revalidate") reason = "revalidate";
      else if (requirement.estimate == null) reason = "unverified";
      else if (requirement.evidenceSufficiency < 0.5) {
        reason = "insufficient_evidence";
      } else if (requirement.estimate < requirement.threshold) {
        reason = "below_threshold";
      }
      return {
        estimate: requirement.estimate,
        evidenceSufficiency: requirement.evidenceSufficiency,
        reason,
      };
    });
    const failing = rows.find((row) => row.reason != null) ?? null;
    return {
      learningTargetId: mapping.learningTargetId,
      title: mapping.title,
      critical: mapping.required,
      estimate:
        rows.length > 0 && rows.every((row) => row.estimate != null)
          ? Math.min(...rows.map((row) => row.estimate ?? 0))
          : null,
      evidenceSufficiency:
        rows.length > 0
          ? Math.min(...rows.map((row) => row.evidenceSufficiency))
          : 0,
      reason: failing?.reason ?? null,
      ready: failing == null,
    };
  });
  const critical = foundations.filter((foundation) => foundation.critical);
  const decisionRows = critical.length > 0 ? critical : foundations;
  const status = decisionRows.some(
    (foundation) => foundation.reason === "below_threshold",
  )
    ? "bridge_needed"
    : decisionRows.some((foundation) => foundation.reason === "revalidate")
      ? "revalidate"
      : decisionRows.some(
            (foundation) =>
              foundation.reason === "unverified" ||
              foundation.reason === "insufficient_evidence",
          )
        ? "check_recommended"
        : "ready";
  return {
    status,
    checkAvailable: adaptiveAssessmentEvidenceWritesEnabled(),
    bridgeUnitId,
    foundations,
  };
}

function bridgeCopy(moduleTitle: string, titles: string[]) {
  return {
    title: `准备学习 · ${moduleTitle}`,
    summary: `针对进入“${moduleTitle}”前已由直接证据确认需要加强的基础：${titles.join(
      "、",
    )}。完成针对性解释与应用练习后再回到主课程。`,
  };
}

/**
 * Synchronize one consolidated prerequisite bridge with current direct state.
 * Unknown/insufficient evidence never creates a bridge.
 */
export async function syncPrerequisiteBridgeForModule(
  persistence: PersistenceClient,
  params: {
    userId: string;
    goalId: string;
    moduleId: string;
    triggerAttemptId?: string;
  },
): Promise<string | null> {
  const readiness = await getModuleEntryReadiness(params);
  const existing = await persistence.learningUnit.findFirst({
    where: {
      moduleId: params.moduleId,
      supportKind: "prerequisite_bridge",
    },
    include: {
      learningTargets: {
        select: { learningTargetId: true },
        orderBy: { orderIndex: "asc" },
      },
    },
  });
  if (readiness.status !== "bridge_needed") {
    if (
      readiness.status === "ready" &&
      existing &&
      existing.status !== "completed"
    ) {
      await persistence.learningUnit.update({
        where: { id: existing.id },
        data: {
          status: "completed",
          completionMethod: "test_out",
          completedAt: new Date(),
          skippedAt: new Date(),
        },
      });
    }
    return existing?.id ?? null;
  }
  if (!adaptiveAssessmentEvidenceWritesEnabled()) {
    return existing?.id ?? null;
  }

  const weakTargetIds = readiness.foundations
    .filter(
      (foundation) =>
        foundation.reason === "below_threshold" && foundation.critical,
    )
    .map((foundation) => foundation.learningTargetId);
  if (weakTargetIds.length === 0) return existing?.id ?? null;
  const [module, source, mappings] = await Promise.all([
    persistence.learningModule.findFirst({
      where: {
        id: params.moduleId,
        goalId: params.goalId,
        goal: { userId: params.userId },
      },
    }),
    persistence.learningUnit.findFirst({
      where: {
        moduleId: params.moduleId,
        unitKind: "lesson",
        requiredForModuleCompletion: true,
        supportKind: null,
      },
      orderBy: { orderIndex: "asc" },
    }),
    persistence.moduleLearningTarget.findMany({
      where: {
        moduleId: params.moduleId,
        role: "entry",
        learningTargetId: { in: weakTargetIds },
      },
      orderBy: { orderIndex: "asc" },
      include: { learningTarget: true },
    }),
  ]);
  if (!module || !source || mappings.length === 0) return null;
  const copy = bridgeCopy(
    module.title,
    mappings.map((mapping) => mapping.learningTarget.title),
  );
  const triggerEvidenceClaimIds = params.triggerAttemptId
    ? (
        await persistence.evidenceClaim.findMany({
          where: {
            userId: params.userId,
            observation: { attemptId: params.triggerAttemptId },
          },
          select: { id: true },
        })
      ).map((claim) => claim.id)
    : [];
  const expectedTargetIds = mappings.map((mapping) => mapping.learningTargetId);
  const existingTargetIds =
    existing?.learningTargets.map((mapping) => mapping.learningTargetId) ?? [];
  if (
    existing &&
    existing.title === copy.title &&
    existing.contentSummary === copy.summary &&
    existing.status === "available" &&
    existing.supportForUnitId === source.id &&
    (!params.triggerAttemptId ||
      existing.supportTriggerAttemptId === params.triggerAttemptId) &&
    JSON.stringify(existingTargetIds) === JSON.stringify(expectedTargetIds)
  ) {
    return existing.id;
  }

  return persistence.$transaction(async (tx) => {
    await acquireCognitiveModelWriteLock(tx, params.goalId);
    let bridge = await tx.learningUnit.findFirst({
      where: {
        moduleId: params.moduleId,
        supportKind: "prerequisite_bridge",
      },
    });
    if (!bridge) {
      await tx.learningUnit.updateMany({
        where: {
          moduleId: params.moduleId,
          orderIndex: { gte: source.orderIndex },
        },
        data: { orderIndex: { increment: 1 } },
      });
      bridge = await tx.learningUnit.create({
        data: {
          goalId: params.goalId,
          moduleId: params.moduleId,
          parentUnitId: null,
          unitKind: "lesson",
          title: copy.title,
          orderIndex: source.orderIndex,
          difficulty: "medium",
          prerequisites: source.prerequisites,
          contentSummary: copy.summary,
          mapOrigin: "adaptive",
          status: "available",
          cognitiveModelStatus: "expanded",
          requiredForModuleCompletion: false,
          supportKind: "prerequisite_bridge",
          supportForUnitId: source.id,
          supportTriggerAttemptId: params.triggerAttemptId,
          supportTriggerEvidenceClaimIds: json(triggerEvidenceClaimIds),
        },
      });
    } else {
      bridge = await tx.learningUnit.update({
        where: { id: bridge.id },
        data: {
          title: copy.title,
          contentSummary: copy.summary,
          status: "available",
          completionMethod: null,
          completedAt: null,
          skippedAt: null,
          supportForUnitId: source.id,
          supportTriggerAttemptId: params.triggerAttemptId,
          supportTriggerEvidenceClaimIds: json(triggerEvidenceClaimIds),
          requiredForModuleCompletion: false,
          contentRevision: { increment: 1 },
        },
      });
    }
    await tx.unitLearningTarget.deleteMany({ where: { unitId: bridge.id } });
    await tx.unitLearningTarget.createMany({
      data: mappings.map((mapping, index) => ({
        unitId: bridge!.id,
        learningTargetId: mapping.learningTargetId,
        localRef: `lt_${index + 1}`,
        required: true,
        weight: mapping.weight,
        orderIndex: index,
        role: "review",
        isEntry: index === 0,
        isExit: index === mappings.length - 1,
        moduleRole: "support",
        moduleCapabilityRefs: json([]),
      })),
    });
    await publishMappingOnlyRevision(tx, {
      goalId: params.goalId,
      reason: "prerequisite_bridge_mapping_changed",
    });
    return bridge.id;
  }, COGNITIVE_MODEL_TRANSACTION_OPTIONS);
}

/** Re-evaluate affected support units after any direct prerequisite evidence. */
export async function syncPrerequisiteBridgesForEntity(
  persistence: PersistenceClient,
  params: { userId: string; cognitiveEntityId: string },
) {
  const mappings = await persistence.moduleLearningTarget.findMany({
    where: {
      role: "entry",
      learningTarget: {
        requirements: {
          some: { cognitiveEntityId: params.cognitiveEntityId },
        },
      },
      module: { goal: { userId: params.userId } },
    },
    select: {
      moduleId: true,
      module: { select: { goalId: true } },
    },
  });
  for (const mapping of mappings) {
    await syncPrerequisiteBridgeForModule(persistence, {
      userId: params.userId,
      goalId: mapping.module.goalId,
      moduleId: mapping.moduleId,
    });
  }
}
