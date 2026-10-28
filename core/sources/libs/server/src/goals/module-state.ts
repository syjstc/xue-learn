// @ts-nocheck -- unbound compatibility implementation; hosted callers use repositories.
import type { Persistence, PersistenceClient } from "../persistence/persistence-compat.js";
import { parseJson } from "../utils.js";
import { COURSE_MODULE_GENERATE_EVENT } from "./sequential-modules.js";
import {
  auditModuleKacom,
  evaluateModuleKacomStructuralReadiness,
} from "../llm/module-curriculum.js";
import { areRequiredModuleUnitsComplete } from "./module-gates.js";
import type { GoalModuleReadRepository } from "../../../domain/src/index.js";

const MODULE_READY_AUTO_RETRY_LIMIT = 3;
const MODULE_READY_RETRY_PREFIX = "[AUTO_RETRY=";

function unitLearningTargetCount(unit: {
  learningTargets?: unknown[];
  targetCount?: number | string | null;
}): number {
  if (Array.isArray(unit.learningTargets)) return unit.learningTargets.length;
  const count = Number(unit.targetCount ?? 0);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function parseModuleReadyRetryCount(
  message: string | null | undefined,
): number {
  const match = (message ?? "").match(/^\[AUTO_RETRY=(\d+)\]\s*(.*)?$/s);
  if (!match) return 0;
  return Number.parseInt(match[1], 10);
}

function buildRetryFailureMessage(message: string, retryCount: number): string {
  return `${MODULE_READY_RETRY_PREFIX}${retryCount}] ${message}`;
}

function parseRetryReason(message: string): string {
  return message.replace(/^\[AUTO_RETRY=\d+\]\s*/, "");
}

async function maybeAutoRetryModuleReady(
  persistence: PersistenceClient,
  module: {
    id: string;
    goalId: string;
    generationError: string | null;
  },
  failureMessage: string,
) {
  const retryCount = parseModuleReadyRetryCount(module.generationError);
  if (retryCount >= MODULE_READY_AUTO_RETRY_LIMIT) return null;
  const nextRetry = retryCount + 1;
  await persistence.learningModule.update({
    where: { id: module.id },
    data: {
      generationStatus: "building",
      generationBuildStartedAt: null,
      generationBuildToken: null,
      generationError: buildRetryFailureMessage(
        parseRetryReason(failureMessage),
        nextRetry,
      ),
    },
  });
  const queued = await persistence.eventOutbox.findFirst({
    where: {
      type: COURSE_MODULE_GENERATE_EVENT,
      payload: { contains: `"moduleId":"${module.id}"` },
      publishedAt: null,
      deadLetteredAt: null,
    },
    select: { id: true },
  });
  if (!queued) {
    await persistence.eventOutbox.create({
      data: {
        type: COURSE_MODULE_GENERATE_EVENT,
        payload: JSON.stringify({
          goalId: module.goalId,
          moduleId: module.id,
          reason: "reconcile_auto_retry",
        }),
      },
      select: { id: true },
    });
  }
  return nextRetry;
}

async function unlockNextModule(
  tx: Persistence.TransactionClient,
  current: { id: string; goalId: string; orderIndex: number },
) {
  const next = await tx.learningModule.findFirst({
    where: {
      goalId: current.goalId,
      orderIndex: { gt: current.orderIndex },
    },
    orderBy: { orderIndex: "asc" },
  });
  if (!next || next.unlockStatus !== "locked") return next;
  const now = new Date();
  const unlocked = await tx.learningModule.update({
    where: { id: next.id },
    data: {
      unlockStatus: "unlocked",
      generationStatus: "pending",
      unlockedAt: now,
      generationError: "",
    },
  });
  await tx.eventOutbox.create({
    data: {
      type: COURSE_MODULE_GENERATE_EVENT,
      payload: JSON.stringify({
        goalId: current.goalId,
        moduleId: next.id,
        reason: "previous_module_completed",
      }),
    },
  });
  return unlocked;
}

export async function reconcileReadySequentialModules(
  repository: PersistenceClient | GoalModuleReadRepository,
  goalId: string,
) {
  const portable =
    "listReadinessCandidates" in repository ? repository : null;
  const persistence = portable ? null : (repository as PersistenceClient);
  const modules:any[] = portable?await portable.listReadinessCandidates(goalId):await persistence!.learningModule.findMany({
    where: {
      goalId,
      unlockStatus: "unlocked",
      generationStatus: "building",
    },
    include: {
      units: {
        where: { unitKind: "lesson" },
        include: { learningTargets: true },
      },
      learningTargets: {
        orderBy: { orderIndex: "asc" },
        select: {
          localRef: true,
          role: true,
          learningTargetId: true,
          learningTarget: { select: { title: true, learningObjective: true } },
        },
      },
      goal: {
        select: { title: true, contentLanguage: true },
      },
    },
  });
  const readyIds: string[] = [];
  for (const module of modules) {
    if (
      module.units.length === 0 ||
      module.units.some(
        (unit: any) =>
          unit.cognitiveModelStatus !== "expanded" ||
          unitLearningTargetCount(unit) === 0,
      )
    ) {
      continue;
    }
    const exitTargets = module.learningTargets.filter(
      (mapping: any) => mapping.role !== "entry",
    );
    const expectedCapabilityRefs = new Set<string>(
      exitTargets.map((mapping: any, index: number) =>
        /^lt_\d+$/.test(mapping.localRef)
          ? mapping.localRef.replace(/^lt_/, "mc_")
          : /^mc_\d+$/.test(mapping.localRef)
            ? mapping.localRef
            : `mc_${index + 1}`,
      ),
    );
    const unitTargetIds = module.units.flatMap((unit: any) =>
      (unit.learningTargets ?? []).map(
        (mapping: any) => mapping.learningTargetId,
      ),
    );
    const targetIds = [
      ...new Set([
        ...module.learningTargets.map((mapping: any) => mapping.learningTargetId),
        ...unitTargetIds,
      ]),
    ];
    const entityRequirements = portable?Array.from({length:module.workingSetEntityCount},()=>({cognitiveEntityId:""})):await persistence!.learningTargetRequirement.findMany({
      where: { learningTargetId: { in: targetIds } },
      distinct: ["cognitiveEntityId"],
      select: { cognitiveEntityId: true },
    });
    const entities = portable?module.entities:await persistence!.cognitiveEntity.findMany({
      where: {
        goalId,
        learningTargetRequirements: {
          some: { learningTargetId: { in: targetIds } },
        },
      },
      select: {
        id: true,
        stableKey: true,
        title: true,
        kind: true,
        provenance: true,
      },
      orderBy: { stableKey: "asc" },
    });
    const unitCurriculumKeys = new Set([
      module.curriculumKey,
      ...module.units.map((unit: any) => unit.curriculumKey),
    ]);
    const authoredEntities = portable?module.authoredEntities:await persistence!.cognitiveEntity.findMany({
      where: { goalId, status: "active" },
      select: { provenance: true },
    });
    const newlyAuthoredCount = authoredEntities.filter((entity: any) => {
      const provenance =
        entity.provenance &&
        typeof entity.provenance === "object" &&
        !Array.isArray(entity.provenance)
          ? (entity.provenance as Record<string, unknown>)
          : {};
      return unitCurriculumKeys.has(
        String(provenance.ownerCurriculumKey ?? ""),
      );
    }).length;
    const structural = evaluateModuleKacomStructuralReadiness({
      units: module.units.map((unit: any) => ({
        modelStatus: unit.cognitiveModelStatus,
        targetCount: unitLearningTargetCount(unit),
        capabilityRefs: parseJson<string[]>(
          JSON.stringify(unit.moduleCapabilityRefs ?? []),
          [],
        ),
      })),
      expectedCapabilityRefs: [...expectedCapabilityRefs],
      workingSetEntityCount: entityRequirements.length,
      newlyAuthoredEntityCount: newlyAuthoredCount,
    });
    if (structural.status !== "audit_ready") {
      const failureReason = structural.reason;
      if(portable){await portable.settleReadinessFailure({moduleId:module.id,goalId:module.goalId,currentError:module.generationError,failureReason,eventType:COURSE_MODULE_GENERATE_EVENT,retryLimit:MODULE_READY_AUTO_RETRY_LIMIT});}
      else {const retryAttempted = await maybeAutoRetryModuleReady(
        persistence!, module, failureReason,
      );
      if (retryAttempted === null) {
        await persistence!.learningModule.update({
          where: { id: module.id },
          data: {
            generationStatus: "failed",
            generationBuildStartedAt: null,
            generationBuildToken: null,
            generationError: failureReason,
          },
        });
      }}
      continue;
    }
    const entityIds = entities.map((entity: any) => entity.id);
    const relations = portable?module.relations.map((relation:any)=>({...relation,source:{stableKey:relation.sourceStableKey},target:{stableKey:relation.targetStableKey}})):await persistence!.cognitiveRelation.findMany({
      where: {
        sourceEntityId: { in: entityIds },
        targetEntityId: { in: entityIds },
        status: "active",
      },
      include: {
        source: { select: { stableKey: true } },
        target: { select: { stableKey: true } },
      },
      take: 160,
    });
    let audit;
    try {
      audit = await auditModuleKacom({
        goalTitle: module.goal.title,
        moduleTitle: module.title,
        moduleObjective: module.objective,
        contentLanguage: module.goal.contentLanguage as
          | "zh-Hans"
          | "zh-Hant"
          | "en"
          | "ja"
          | "ko"
          | "fr"
          | "de"
          | "es"
          | "other",
        capabilitySummary: exitTargets
          .map((mapping: any, index: number) => {
            const ref = /^lt_\d+$/.test(mapping.localRef)
              ? mapping.localRef.replace(/^lt_/, "mc_")
              : /^mc_\d+$/.test(mapping.localRef)
                ? mapping.localRef
                : `mc_${index + 1}`;
            return `${ref}: ${mapping.learningTarget.title} — ${mapping.learningTarget.learningObjective}`;
          })
          .join("\n"),
        unitSummary: module.units
          .map(
            (unit: any) =>
              `${unit.title}: ${parseJson<string[]>(
                JSON.stringify(unit.moduleCapabilityRefs ?? []),
                [],
              ).join(", ")}; targets=${unitLearningTargetCount(unit)}`,
          )
          .join("\n"),
        entitySummary: entities
          .map(
            (entity: any) => `${entity.stableKey} [${entity.kind}]: ${entity.title}`,
          )
          .join("\n"),
        relationSummary: relations
          .map(
            (relation: any) =>
              `${relation.source.stableKey} -${relation.relationType}-> ${relation.target.stableKey}`,
          )
          .join("\n"),
      });
    } catch (error) {
      const failureReason =
        error instanceof Error
          ? `Module KACOM audit failed: ${error.message}`
          : "Module KACOM audit failed";
      if(portable){await portable.settleReadinessFailure({moduleId:module.id,goalId:module.goalId,currentError:module.generationError,failureReason,eventType:COURSE_MODULE_GENERATE_EVENT,retryLimit:MODULE_READY_AUTO_RETRY_LIMIT});}
      else {const retryAttempted = await maybeAutoRetryModuleReady(
        persistence!, module, failureReason,
      );
      if (retryAttempted === null) {
        await persistence!.learningModule.update({
          where: { id: module.id },
          data: {
            generationStatus: "failed",
            generationError: failureReason,
          },
        });
      }}
      continue;
    }
    if (audit.verdict === "repair_required") {
      const failureReason = `Module KACOM audit requires repair: ${audit.rationale}`;
      if(portable){await portable.settleReadinessFailure({moduleId:module.id,goalId:module.goalId,currentError:module.generationError,failureReason,eventType:COURSE_MODULE_GENERATE_EVENT,retryLimit:MODULE_READY_AUTO_RETRY_LIMIT});}
      else {const retryAttempted = await maybeAutoRetryModuleReady(
        persistence!, module, failureReason,
      );
      if (retryAttempted === null) {
        await persistence!.learningModule.update({
          where: { id: module.id },
          data: {
            generationStatus: "failed",
            generationError: failureReason,
          },
        });
      }}
      continue;
    }
    if(portable) await portable.markReadinessReady(module.id);
    else await persistence!.learningModule.update({
      where: { id: module.id },
      data: {
        generationStatus: "ready",
        generationBuildStartedAt: null,
        generationBuildToken: null,
        generationError: "",
        generatedAt: new Date(),
      },
    });
    readyIds.push(module.id);
  }
  return readyIds;
}

export async function completeSequentialModuleForUnit(
  persistence: PersistenceClient,
  unitId: string,
) {
  const unit = await persistence.learningUnit.findUnique({
    where: { id: unitId },
    select: { moduleId: true },
  });
  if (!unit?.moduleId) return null;
  return persistence.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "LearningModule" WHERE "id" = ${unit.moduleId} FOR UPDATE
    `;
    const module = await tx.learningModule.findUnique({
      where: { id: unit.moduleId! },
    });
    if (
      !module ||
      module.unlockStatus === "completed" ||
      module.generationStatus !== "ready"
    ) {
      return null;
    }
    const requiredUnits = await tx.learningUnit.findMany({
      where: {
        moduleId: module.id,
        unitKind: "lesson",
        requiredForModuleCompletion: true,
      },
      select: { status: true },
    });
    if (!areRequiredModuleUnitsComplete(requiredUnits)) {
      return null;
    }
    const completedAt = new Date();
    await tx.learningModule.update({
      where: { id: module.id },
      data: {
        unlockStatus: "completed",
        completionMethod: "units",
        completedAt,
      },
    });
    const next = await unlockNextModule(tx, module);
    return {
      moduleId: module.id,
      completionMethod: "units",
      nextModuleId: next?.id ?? null,
    };
  });
}

export async function completeSequentialModuleByTestOut(
  persistence: PersistenceClient,
  params: {
    goalId: string;
    moduleId: string;
    attemptId: string;
    completedAt?: Date;
  },
) {
  return persistence.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "LearningModule" WHERE "id" = ${params.moduleId} FOR UPDATE
    `;
    const module = await tx.learningModule.findFirst({
      where: { id: params.moduleId, goalId: params.goalId },
    });
    if (!module) throw new Error("Module not found");
    if (module.unlockStatus === "completed") {
      const next = await tx.learningModule.findFirst({
        where: {
          goalId: module.goalId,
          orderIndex: { gt: module.orderIndex },
        },
        orderBy: { orderIndex: "asc" },
      });
      return {
        moduleId: module.id,
        completionMethod: module.completionMethod,
        nextModuleId: next?.id ?? null,
      };
    }
    if (
      module.unlockStatus !== "unlocked" ||
      module.generationStatus !== "ready"
    ) {
      throw new Error(
        module.unlockStatus === "locked"
          ? "MODULE_LOCKED"
          : "MODULE_GENERATING",
      );
    }
    const completedAt = params.completedAt ?? new Date();
    await tx.learningUnit.updateMany({
      where: {
        moduleId: module.id,
        status: { in: ["available", "in_progress"] },
      },
      data: {
        status: "skipped",
        skippedAt: completedAt,
        completionMethod: "module_test_out",
        completionAttemptId: params.attemptId,
      },
    });
    await tx.learningModule.update({
      where: { id: module.id },
      data: {
        unlockStatus: "completed",
        completionMethod: "test_out",
        completionAttemptId: params.attemptId,
        completedAt,
      },
    });
    const next = await unlockNextModule(tx, module);
    return {
      moduleId: module.id,
      completionMethod: "test_out",
      nextModuleId: next?.id ?? null,
    };
  });
}
