import { createHash, randomUUID } from "node:crypto";
import { projectPathModule } from "./path-module-projection.js";
import {
  mapPreparedMasteryPublication,
  type CognitiveModelInvalidationRepository,
  type DeepPlanningResearchRepository,
  type ExplorationModulePublicationRepository,
  type ModuleGenerationLeaseRepository,
  type ModuleObjectiveCapability,
  type ModuleStructureDraftRepository,
  type PreparedModulePublicationRepository,
} from "../../../domain/src/index.js";
import { gatherGoalPathContext } from "../goals/goal-path-context.js";
import { gatherDeepPlanningResearch } from "../goals/deep-planning-research.js";
import { withDeepPlanningResearchLease } from "../generation/deep-planning-research-concurrency.js";
import { resolveGoalContentLanguage } from "../llm/content-language.js";
import {
  moduleCapabilityProposalSchema,
  moduleStructureProposalSchema,
  prepareExplorationModuleStructureAuthoring,
  prepareModuleCapabilitiesAuthoring,
  prepareModuleStructureAuthoring,
} from "../llm/module-curriculum.js";
import { runGoalAuthoringRound } from "../goal-authoring/runner.js";
import { parseMapPlan, serializeMapPlan } from "../goals/map-plan.js";
import type { GoalMapPlan } from "../llm/schemas.js";
import { readModulePathContext, pathModuleBrief } from "./learning-path.js";
import {
  authorModulePathRepair,
  mergeModulePathRepairs,
  pathAuditFindings,
  readCandidatePathRepair,
} from "./path-module-repair.js";
import { getLlmRuntimeConfig } from "../llm/runtime-config.js";
import { withOperationReasoning } from "../providers/llm/index.js";
import {
  loadTeachingSkillPrompt,
  resolveTeachingSkillForGoal,
} from "../teaching-skills/index.js";
import { goalCreationWorkGate } from "../agents/goal-creation/work-gate.js";
import { parseJson } from "../utils.js";
import {
  AGENTIC_OUTBOX_HOLD_STATUSES,
  GOAL_CREATION_COORDINATE_EVENT,
  GOAL_MODULE_STRUCTURE_AUDIT_EVENT,
  GOAL_MODULE_STRUCTURE_DRAFT_PREPARE_EVENT,
  MAX_MODULE_AUDIT_REPAIR_ROUNDS,
  MODULE_STRUCTURE_DRAFT_LEASE_MS,
  serializeSqlitePublication,
} from "./agentic-concurrency.js";
import {
  moduleStructureDraftsNeedAttention,
  moduleStructureDraftsReadyForAudit,
  draftsNeedingPublication,
} from "./module-structure-draft-settlement.js";
import {
  loadCheckpoint,
  saveCheckpoint,
  type ThreadCheckpoint,
} from "../agents/core/checkpoint.js";
import {
  goalStateFromCheckpoint,
  mergeGoalState,
} from "../agents/goal-creation/state.js";

export {
  AGENTIC_OUTBOX_HOLD_STATUSES,
  GOAL_CREATION_COORDINATE_EVENT,
  GOAL_MODULE_STRUCTURE_AUDIT_EVENT,
  GOAL_MODULE_STRUCTURE_DRAFT_PREPARE_EVENT,
};
import {
  auditGoalModuleStructures,
  sanitizeAuditFindings,
} from "./module-structure-audit.js";
import { classifyAuthoringCacheClass } from "./cache-telemetry.js";
import { requireModuleStructureDraft } from "./module-structure-draft-persistence.js";
import { requireAgentConversationPersistence } from "../agents/core/checkpoint.js";
import { tBackend } from "../../../common/src/index.js";
import {
  emitGoalCreationProgress,
  withGoalCreationPlanningActivity,
} from "./session-progress.js";

type WorkerRepos = Readonly<{
  drafts?: ModuleStructureDraftRepository;
  moduleGenerationLease: ModuleGenerationLeaseRepository;
  deepPlanningResearch: DeepPlanningResearchRepository;
  preparedModulePublication: PreparedModulePublicationRepository;
  explorationModulePublication: ExplorationModulePublicationRepository;
  cognitiveModelInvalidation: CognitiveModelInvalidationRepository;
}>;

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function parsePayload(payloadJson: string): {
  goalId?: string;
  sessionId?: string;
  moduleId?: string;
  reason?: string;
} {
  return parseJson(payloadJson, {});
}

async function sessionStopped(goalId: string): Promise<boolean> {
  return (await goalCreationWorkGate(goalId)) === "stopped";
}

async function settleDraftBatch(params: {
  goalId: string;
  sessionId?: string;
  drafts: ModuleStructureDraftRepository;
}): Promise<void> {
  const rows = await params.drafts.listByGoal(params.goalId);
  const sessionId = params.sessionId ?? rows[0]?.sessionId;
  if (!sessionId) return;
  if (moduleStructureDraftsNeedAttention(rows)) {
    await params.drafts.enqueueCoordinateEvent({
      goalId: params.goalId,
      sessionId,
      reason: "drafts_failed",
    });
    return;
  }
  if (moduleStructureDraftsReadyForAudit(rows)) {
    await params.drafts.enqueueAuditEvent({
      goalId: params.goalId,
      sessionId,
    });
  }
}

function retryableError(message: string): Error {
  const error = new Error(message) as Error & { retryable: boolean };
  error.retryable = true;
  return error;
}

export async function recoverStuckAgenticGoalCreation(
  drafts: ModuleStructureDraftRepository,
): Promise<number> {
  const sessions = await drafts.listGoalSessionsWithStatuses([
    "ready_for_audit",
    "publishing",
  ]);
  let enqueued = 0;
  for (const session of sessions) {
    const rows = await drafts.listByGoal(session.goalId);
    if (moduleStructureDraftsReadyForAudit(rows)) {
      await drafts.enqueueAuditEvent(session);
      enqueued += 1;
    }
    if (
      draftsNeedingPublication(rows).some((row) => row.status === "publishing")
    ) {
      await drafts.enqueueCoordinateEvent({
        ...session,
        reason: "audit_passed",
        idempotencyKey: `goal-creation-coordinate:${session.goalId}:publish`,
      });
      enqueued += 1;
    }
  }
  return enqueued;
}

async function completeAgenticSession(goalId: string): Promise<void> {
  const session =
    await requireAgentConversationPersistence().findGoalCreationSessionByGoalId(
      goalId,
    );
  if (!session) return;
  const completed =
    await requireAgentConversationPersistence().completeGoalCreationSession(
      session.id,
      "",
      new Date(),
    );
  if (!completed) return;
  await requireAgentConversationPersistence().appendGoalCreationEvent(
    session.id,
    {
      type: "done",
      payload: {
        type: "done",
        goalId,
        navigateTo: `/goals/${goalId}`,
      },
    },
  );
}

function authoringMeta(input: {
  goalId: string;
  sessionId?: string;
  cacheClass: "cold_seed" | "warm_fanout";
  moduleTitle: string;
}) {
  return {
    goalId: input.goalId,
    scope: "goal",
    scopeId: input.goalId,
    sessionId: input.sessionId,
    cacheClass: input.cacheClass,
    moduleTitle: input.moduleTitle,
  };
}

export async function authorModuleStructureDraft(params: {
  goalId: string;
  moduleId: string;
  sessionId?: string;
  cacheClass: "cold_seed" | "warm_fanout";
  diagnostics?: string;
  candidateJson?: string;
  repos: WorkerRepos;
}): Promise<{ candidate: unknown; hash: string }> {
  const claimed = await params.repos.moduleGenerationLease.loadContext({
    goalId: params.goalId,
    moduleId: params.moduleId,
    priorEntityLimit: 64,
  });
  if (!claimed) throw new Error("Module context is unavailable");
  await emitGoalCreationProgress(params.sessionId, {
    type: "module_stage",
    stage: "researching",
    moduleId: params.moduleId,
    moduleTitle: claimed.title,
    message: tBackend("status.planning.moduleDraft.started", {
      title: claimed.title,
    }),
  });
  const planningMode = claimed.goal.planningMode ?? "fast";
  const contentLanguage = resolveGoalContentLanguage(
    claimed.goal.contentLanguage,
    claimed.goal.title,
  );
  const boundPath = readModulePathContext(claimed.unitPlanningBrief);
  const findings = pathAuditFindings(params.diagnostics, params.moduleId);
  if (boundPath && findings.length) {
    const repair = () => withGoalCreationPlanningActivity(params.sessionId, {
      id: `module_path_repair:${params.moduleId}`,
      category: "synthesis",
      startedMessage: tBackend("status.planning.moduleDraft.started", { title: claimed.title }),
      pulseMessages: [tBackend("status.planning.moduleAudit.repairing")],
      completedMessage: tBackend("status.planning.moduleDraft.completed", { title: claimed.title }),
      pulseIntervalMs: 8_000,
    }, () => authorModulePathRepair({
      userId: claimed.goal.userId!,
      goalId: params.goalId,
      moduleId: params.moduleId,
      moduleRef: boundPath.contract.moduleRef,
      moduleTitle: claimed.title,
      mapPlanJson: String(claimed.goal.mapPlanJson ?? ""),
      candidateJson: params.candidateJson ?? "{}",
      findings,
      contentLanguage,
      meta: authoringMeta({ ...params, moduleTitle: claimed.title }),
    }));
    const repaired = planningMode === "deep" ? await withOperationReasoning(true, repair) : await repair();
    const candidate = {
      kind: claimed.goal.learningMode === "exploration" ? "exploration" as const : "mastery" as const,
      ...(claimed.goal.learningMode === "exploration" ? {} : { capabilities: repaired.capabilities }),
      ...repaired.structure,
      pathRepair: repaired.pathRepair,
    };
    return { candidate, hash: hashJson(candidate) };
  }
  // Operational failures are retried by replaying the valid contract; only
  // actionable audit findings trigger a constrained path revision.
  const pendingRepair = boundPath && params.candidateJson ? readCandidatePathRepair(params.candidateJson) : undefined;
  if (pendingRepair) {
    const candidate = JSON.parse(params.candidateJson!);
    return { candidate, hash: hashJson(candidate) };
  }
  const planned = projectPathModule(claimed.unitPlanningBrief, contentLanguage);
  if (planned) {
    const candidate = claimed.goal.learningMode === "exploration"
      ? { kind: "exploration" as const, ...planned.structure }
      : { kind: "mastery" as const, capabilities: planned.capabilities, ...planned.structure };
    await emitGoalCreationProgress(params.sessionId, {
      type: "module_stage",
      stage: "validating",
      moduleId: params.moduleId,
      moduleTitle: claimed.title,
      message: tBackend("status.planning.path.materialized", { title: claimed.title }),
    });
    return { candidate, hash: hashJson(candidate) };
  }
  const pathContext = await gatherGoalPathContext({
    goalId: claimed.goalId,
    title: claimed.goal.title,
    allowWebSearch: false,
    uploadedDocumentsOnly: planningMode === "docs_first",
    searchPurpose: "map",
  });
  await resolveTeachingSkillForGoal({
    goalId: claimed.goalId,
    title: claimed.goal.title,
    level: claimed.goal.level,
    generationOptions: claimed.goal.generationOptions,
    sourceSummary: pathContext.context,
  });
  const teachingSkill = await loadTeachingSkillPrompt(
    claimed.goalId,
    "module_units",
    `${claimed.goal.title} ${claimed.title} ${claimed.objective}`,
  );
  const priorModuleSummary = claimed.priorModules
    .map(
      (
        module: { title: string; objective?: string; summary?: string },
        index: number,
      ) =>
        `${index + 1}. ${module.title}: ${module.objective || module.summary}`,
    )
    .join("\n");
  const priorCognitiveContext = claimed.priorEntities
    .map(
      (entity: {
        kind: string;
        stableKey: string;
        title: string;
        description: string;
      }) =>
        `${entity.kind} | ${entity.stableKey} | ${entity.title}: ${entity.description}`,
    )
    .join("\n");
  let moduleSourceContext = pathContext.context;
  if (planningMode === "deep" && claimed.goal.userId) {
    const research = await withDeepPlanningResearchLease(
      params.repos.deepPlanningResearch,
      {
        ownerKey: `module-draft:${claimed.id}`,
        goalId: claimed.goalId,
        moduleKey: claimed.curriculumKey,
      },
      () =>
        gatherDeepPlanningResearch({
          userId: claimed.goal.userId,
          goalId: claimed.goalId,
          title: claimed.goal.title,
          scope: "module",
          moduleTitle: claimed.title,
          moduleRef: claimed.curriculumKey,
        }),
    );
    moduleSourceContext = [moduleSourceContext, research.context]
      .filter(Boolean)
      .join("\n\n---\n\n");
  }
  const meta = authoringMeta({
    goalId: params.goalId,
    sessionId: params.sessionId,
    cacheClass: params.cacheClass,
    moduleTitle: claimed.title,
  });
  if (claimed.goal.learningMode === "exploration") {
    return withGoalCreationPlanningActivity(
      params.sessionId,
      {
        id: `module_draft:${params.moduleId}`,
        category: "synthesis",
        startedMessage: tBackend("status.planning.moduleDraft.started", {
          title: claimed.title,
        }),
        pulseMessages: [
          tBackend("status.planning.moduleDraft.pulse1", {
            title: claimed.title,
          }),
          tBackend("status.planning.moduleDraft.pulse2", {
            title: claimed.title,
          }),
          tBackend("status.planning.moduleDraft.pulse3", {
            title: claimed.title,
          }),
        ],
        completedMessage: tBackend("status.planning.moduleDraft.completed", {
          title: claimed.title,
        }),
        pulseIntervalMs: 8_000,
      },
      async () => {
        const prepared = prepareExplorationModuleStructureAuthoring({
          goalTitle: claimed.goal.title,
          goalLevel: claimed.goal.level,
          moduleTitle: claimed.title,
          moduleSummary: claimed.summary,
          moduleObjective: claimed.objective,
          priorModuleSummary,
          sourceContext: moduleSourceContext,
          validationFindings: params.diagnostics,
          generationOptions: claimed.goal.generationOptions,
          contentLanguage,
          teachingSkillBlock: teachingSkill?.promptBlock,
          authoringMeta: meta,
        });
        const generate = () =>
          runGoalAuthoringRound({
            userId: claimed.goal.userId!,
            goalId: claimed.goalId,
            branchId: `module:${claimed.id}`,
            expectedTool: "commit_exploration_module_structure",
            prompt: prepared.standalonePrompt,
            resultSchema: prepared.acceptSchema,
            operation: "goal.authoring_agent",
            meta,
          });
        const structure =
          planningMode === "deep"
            ? await withOperationReasoning(true, generate)
            : await generate();
        const candidate = {
          kind: "exploration" as const,
          units: structure.units,
          coverageRationale: structure.coverageRationale,
        };
        return { candidate, hash: hashJson(candidate) };
      },
    );
  }
  const capabilityPrepared = prepareModuleCapabilitiesAuthoring({
    goalTitle: claimed.goal.title,
    moduleTitle: claimed.title,
    moduleObjective: claimed.objective,
    moduleSummary: claimed.summary,
    priorModuleSummary,
    contentLanguage,
    teachingSkillBlock: teachingSkill?.promptBlock,
    authoringMeta: meta,
  });
  const capabilities = await withGoalCreationPlanningActivity(
    params.sessionId,
    {
      id: `module_capabilities:${params.moduleId}`,
      category: "synthesis",
      startedMessage: tBackend("status.planning.moduleCapabilities.started", {
        title: claimed.title,
      }),
      pulseMessages: [
        tBackend("status.planning.moduleCapabilities.pulse1", {
          title: claimed.title,
        }),
        tBackend("status.planning.moduleCapabilities.pulse2", {
          title: claimed.title,
        }),
      ],
      completedMessage: tBackend(
        "status.planning.moduleCapabilities.completed",
        { title: claimed.title },
      ),
      pulseIntervalMs: 8_000,
    },
    async () => {
      const generateCapabilities = () =>
        runGoalAuthoringRound({
          userId: claimed.goal.userId!,
          goalId: claimed.goalId,
          branchId: `module:${claimed.id}`,
          expectedTool: "commit_module_capabilities",
          prompt: capabilityPrepared.standalonePrompt,
          resultSchema: capabilityPrepared.acceptSchema,
          operation: "goal.authoring_agent",
          meta,
        });
      return planningMode === "deep"
        ? await withOperationReasoning(true, generateCapabilities)
        : await generateCapabilities();
    },
  );
  const structurePrepared = prepareModuleStructureAuthoring({
    goalTitle: claimed.goal.title,
    goalLevel: claimed.goal.level,
    moduleTitle: claimed.title,
    moduleSummary: claimed.summary,
    moduleObjective: claimed.objective,
    capabilities: capabilities.capabilities,
    priorModuleSummary,
    priorCognitiveContext,
    sourceContext: moduleSourceContext,
    validationFindings: params.diagnostics,
    generationOptions: claimed.goal.generationOptions,
    contentLanguage,
    teachingSkillBlock: teachingSkill?.promptBlock,
    authoringMeta: meta,
  });
  const structure = await withGoalCreationPlanningActivity(
    params.sessionId,
    {
      id: `module_structure:${params.moduleId}`,
      category: "synthesis",
      startedMessage: tBackend("status.planning.moduleStructure.started", {
        title: claimed.title,
      }),
      pulseMessages: [
        tBackend("status.planning.moduleStructure.pulse1", {
          title: claimed.title,
        }),
        tBackend("status.planning.moduleStructure.pulse2", {
          title: claimed.title,
        }),
        tBackend("status.planning.moduleStructure.pulse3", {
          title: claimed.title,
        }),
      ],
      completedMessage: tBackend("status.planning.moduleStructure.completed", {
        title: claimed.title,
      }),
      pulseIntervalMs: 8_000,
    },
    async () => {
      const generateStructure = () =>
        runGoalAuthoringRound({
          userId: claimed.goal.userId!,
          goalId: claimed.goalId,
          branchId: `module:${claimed.id}`,
          expectedTool: "commit_module_structure",
          prompt: structurePrepared.standalonePrompt,
          resultSchema: structurePrepared.acceptSchema,
          operation: "goal.authoring_agent",
          meta,
        });
      return planningMode === "deep"
        ? await withOperationReasoning(true, generateStructure)
        : await generateStructure();
    },
  );
  const candidate = {
    kind: "mastery" as const,
    capabilities: capabilities.capabilities,
    units: structure.units,
    coverageRationale: structure.coverageRationale,
  };
  return { candidate, hash: hashJson(candidate) };
}

export async function processModuleStructureDraftPrepareEvent(params: {
  payloadJson: string;
  repos: WorkerRepos;
}): Promise<{ goalId: string; moduleId: string; status: string }> {
  const payload = parsePayload(params.payloadJson);
  if (!payload.goalId || !payload.moduleId) {
    throw new Error("Draft prepare event is missing goalId/moduleId");
  }
  const drafts = params.repos.drafts ?? requireModuleStructureDraft();
  const token = randomUUID();
  const claimed = await drafts.claim({
    moduleId: payload.moduleId,
    token,
    now: new Date(),
    leaseMs: MODULE_STRUCTURE_DRAFT_LEASE_MS,
    stopRequested: await sessionStopped(payload.goalId),
  });
  if (!claimed) {
    return {
      goalId: payload.goalId,
      moduleId: payload.moduleId,
      status: "ignored",
    };
  }
  try {
    await drafts.patch({
      moduleId: payload.moduleId,
      expectedToken: token,
      status: "researching",
    });
    const authored = await authorModuleStructureDraft({
      goalId: payload.goalId,
      moduleId: payload.moduleId,
      sessionId: payload.sessionId,
      cacheClass: classifyAuthoringCacheClass(payload.reason),
      diagnostics: claimed.attemptCount > 0 ? claimed.issuesJson : undefined,
      candidateJson: claimed.candidateJson,
      repos: params.repos,
    });
    await drafts.patch({
      moduleId: payload.moduleId,
      expectedToken: token,
      status: "ready_for_audit",
      candidateJson: JSON.stringify(authored.candidate),
      candidateHash: authored.hash,
      attemptCount: claimed.attemptCount + 1,
      issuesJson: "[]",
      clearLease: true,
    });
    await settleDraftBatch({
      goalId: payload.goalId,
      sessionId: payload.sessionId ?? claimed.sessionId,
      drafts,
    });
    return {
      goalId: payload.goalId,
      moduleId: payload.moduleId,
      status: "ready_for_audit",
    };
  } catch (error) {
    await drafts.patch({
      moduleId: payload.moduleId,
      expectedToken: token,
      status: "failed",
      issuesJson: JSON.stringify([
        ...pathAuditFindings(claimed.issuesJson, payload.moduleId),
        error instanceof Error ? error.message : String(error),
      ]),
      attemptCount: claimed.attemptCount + 1,
      clearLease: true,
    });
    await settleDraftBatch({
      goalId: payload.goalId,
      sessionId: payload.sessionId ?? claimed.sessionId,
      drafts,
    });
    return {
      goalId: payload.goalId,
      moduleId: payload.moduleId,
      status: "failed",
    };
  }
}

export async function processModuleStructureAuditEvent(params: {
  payloadJson: string;
  repos: WorkerRepos;
}): Promise<{ goalId: string; status: string }> {
  const payload = parsePayload(params.payloadJson);
  if (!payload.goalId) throw new Error("Audit event is missing goalId");
  const goalId = payload.goalId;
  if (await sessionStopped(goalId)) {
    return { goalId, status: "ignored" };
  }
  const drafts = params.repos.drafts ?? requireModuleStructureDraft();
  const rows = await drafts.listByGoal(goalId);
  if (rows.some((row) => row.status === "failed")) {
    await settleDraftBatch({
      goalId,
      sessionId: payload.sessionId ?? rows[0]?.sessionId,
      drafts,
    });
    return { goalId, status: "blocked" };
  }
  if (!rows.every((row) => ["ready_for_audit", "ready"].includes(row.status))) {
    return { goalId, status: "deferred" };
  }
  const sessionId = payload.sessionId ?? rows[0]!.sessionId;
  const auditScope = await params.repos.moduleGenerationLease.loadContext({
    goalId,
    moduleId: rows[0]!.moduleId,
    priorEntityLimit: 1,
  });
  await emitGoalCreationProgress(sessionId, {
    type: "module_stage",
    stage: "audit",
    message: tBackend("status.planning.moduleAudit.started"),
  });
  const audited = sanitizeAuditFindings(
    await withGoalCreationPlanningActivity(
      sessionId,
      {
        id: `module_audit:${goalId}`,
        category: "validation",
        startedMessage: tBackend("status.planning.moduleAudit.started"),
        pulseMessages: [
          tBackend("status.planning.moduleAudit.pulse1"),
          tBackend("status.planning.moduleAudit.pulse2"),
        ],
        completedMessage: tBackend("status.planning.moduleAudit.completed"),
        pulseIntervalMs: 8_000,
      },
      async () =>
        auditGoalModuleStructures({
          goalId,
          userId: auditScope?.goal.userId,
          learningMode: auditScope?.goal.learningMode,
          planningMode: auditScope?.goal.planningMode,
          drafts: await Promise.all(
            rows.map(async (row) => {
              const context =
                await params.repos.moduleGenerationLease.loadContext({
                  goalId,
                  moduleId: row.moduleId,
                  priorEntityLimit: 1,
                });
              return {
                moduleId: row.moduleId,
                title: String(context?.title ?? row.moduleId),
                candidateJson: row.candidateJson,
              };
            }),
          ),
        }),
    ),
    new Set(rows.map((row) => row.moduleId)),
  );
  const flagged = new Set(audited.findings.map((finding) => finding.moduleId));
  if (audited.passed) {
    const repairs = rows.flatMap((row) => {
      const repair = readCandidatePathRepair(row.candidateJson);
      return repair ? [{ row, repair }] : [];
    });
    let repairedPlan: GoalMapPlan | undefined;
    if (repairs.length) {
      if (!drafts.commitPathRepairs) throw new Error("The host cannot persist audited capability-path repairs.");
      const current = await params.repos.moduleGenerationLease.loadContext({ goalId, moduleId: rows[0]!.moduleId, priorEntityLimit: 1 });
      const expectedMapPlanJson = String(current?.goal.mapPlanJson ?? "");
      const plan = parseMapPlan(expectedMapPlanJson);
      if (!plan?.learningPath) throw new Error("The audited repair has no valid owning goal path.");
      const learningPath = mergeModulePathRepairs(plan.learningPath, repairs.map(({ repair }) => repair));
      const flaggedRefs = new Set(repairs.map(({ repair }) => repair.module.moduleRef));
      repairedPlan = {
        ...plan, learningPath,
        modules: plan.modules?.map((module, index) => flaggedRefs.has(learningPath.modules[index]!.moduleRef)
          ? { ...module, ...pathModuleBrief(learningPath, learningPath.modules[index]!) } : module),
        mapStructure: { ...plan.mapStructure, estimatedLeafUnits: learningPath.modules.reduce((count, module) => count + module.units.length, 0) },
      };
      const committed = await drafts.commitPathRepairs({
        goalId, sessionId, expectedMapPlanJson,
        mapPlanJson: serializeMapPlan(repairedPlan),
        modules: repairs.map(({ row, repair }) => {
          const contract = learningPath.modules.find((module) => module.moduleRef === repair.module.moduleRef)!;
          const brief = pathModuleBrief(learningPath, contract);
          return {
            moduleId: row.moduleId, expectedCandidateHash: row.candidateHash,
            plannedOutcomesJson: JSON.stringify(brief.plannedOutcomes),
            exitCapabilityBriefsJson: JSON.stringify(brief.exitCapabilityBriefs),
            estimatedUnitCount: brief.estimatedUnitCount,
            unitPlanningBriefJson: JSON.stringify(brief.unitPlanningBrief),
          };
        }),
      });
      if (!committed) throw retryableError("The capability path or draft changed during audit; re-audit the current revision.");
    }
    const session =
      await requireAgentConversationPersistence().findGoalCreationSessionByGoalId(
        payload.goalId,
      );
    if (session) {
      const checkpoint = await loadCheckpoint(session.threadId);
      await saveCheckpoint(
        session.threadId,
        mergeGoalState(checkpoint, {
          auditStatus: "passed",
          ...(repairedPlan ? { mapPlan: repairedPlan } : {}),
        }) as ThreadCheckpoint,
      );
    }
    await emitGoalCreationProgress(sessionId, {
      type: "status",
      message: tBackend("status.planning.moduleAudit.passed"),
    });
    await drafts.enqueueCoordinateEvent({
      goalId: payload.goalId,
      sessionId: payload.sessionId ?? rows[0]!.sessionId,
      reason: "audit_passed",
      idempotencyKey: `goal-creation-coordinate:${payload.goalId}:publish`,
    });
    return { goalId: payload.goalId, status: "passed" };
  }
  const session =
    await requireAgentConversationPersistence().findGoalCreationSessionByGoalId(
      payload.goalId,
    );
  const checkpoint = session
    ? await loadCheckpoint(session.threadId)
    : undefined;
  const repairRound = checkpoint
    ? goalStateFromCheckpoint(checkpoint).moduleAuditRepairRound
    : 0;
  if (repairRound >= MAX_MODULE_AUDIT_REPAIR_ROUNDS) {
    for (const row of rows) {
      if (!flagged.has(row.moduleId)) continue;
      await drafts.patch({
        moduleId: row.moduleId,
        status: "failed",
        issuesJson: JSON.stringify(
          audited.findings
            .filter((finding) => finding.moduleId === row.moduleId)
            .map((finding) => `${finding.issueCode}: ${finding.reason}`),
        ),
      });
    }
    await settleDraftBatch({
      goalId: payload.goalId,
      sessionId: payload.sessionId ?? rows[0]!.sessionId,
      drafts,
    });
    return { goalId: payload.goalId, status: "exhausted" };
  }
  if (session && checkpoint) {
    await saveCheckpoint(
      session.threadId,
      mergeGoalState(checkpoint, {
        moduleAuditRepairRound: repairRound + 1,
        auditStatus: "repairing",
      }) as ThreadCheckpoint,
    );
  }
  const unchanged = rows.filter((row) => !flagged.has(row.moduleId));
  for (const row of unchanged) {
    const before = row.candidateHash;
    await drafts.patch({
      moduleId: row.moduleId,
      candidateHash: before,
      status: "ready_for_audit",
    });
  }
  for (const row of rows) {
    if (!flagged.has(row.moduleId)) continue;
    await drafts.patch({
      moduleId: row.moduleId,
      status: "repairing",
      issuesJson: JSON.stringify(
        audited.findings.filter((finding) => finding.moduleId === row.moduleId),
      ),
    });
  }
  await drafts.enqueuePrepareEvents({
    goalId: payload.goalId,
    sessionId: payload.sessionId ?? rows[0]!.sessionId,
    moduleIds: [...flagged],
    reason: "audit_repair",
  });
  await emitGoalCreationProgress(payload.sessionId ?? rows[0]!.sessionId, {
    type: "status",
    message: tBackend("status.planning.moduleAudit.repairing"),
  });
  return { goalId: payload.goalId, status: "repairing" };
}

async function publishDraft(params: {
  row: Awaited<
    ReturnType<ModuleStructureDraftRepository["listByGoal"]>
  >[number];
  repos: WorkerRepos;
}) {
  const claimed = await params.repos.moduleGenerationLease.loadContext({
    goalId: params.row.goalId,
    moduleId: params.row.moduleId,
    priorEntityLimit: 64,
  });
  if (!claimed?.goal.userId) throw new Error("Module context is unavailable");
  await emitGoalCreationProgress(params.row.sessionId, {
    type: "module_stage",
    stage: "publishing",
    moduleId: params.row.moduleId,
    moduleTitle: claimed.title,
    message: tBackend("status.planning.modulePublish.started", {
      title: claimed.title,
    }),
  });
  const token = randomUUID();
  let claimedLease = false;
  try {
    const lease = await params.repos.moduleGenerationLease.claim({
      goalId: params.row.goalId,
      moduleId: params.row.moduleId,
      token,
      startedAt: new Date(),
      allowLockedBeforeNavigation: true,
    });
    if (!lease.claimed) {
      if (claimed.existingUnitCount > 0) {
        await params.repos.drafts!.patch({
          moduleId: params.row.moduleId,
          status: "ready",
          publishedAt: new Date(),
          clearLease: true,
        });
        await emitGoalCreationProgress(params.row.sessionId, {
          type: "module_stage",
          stage: "ready",
          moduleId: params.row.moduleId,
          moduleTitle: claimed.title,
          message: tBackend("status.planning.modulePublish.completed", {
            title: claimed.title,
          }),
        });
        return;
      }
      throw retryableError(
        "Module generation lease is busy; publication will retry",
      );
    }
    claimedLease = true;
    const candidate = parseJson<{
      kind?: string;
      units?: unknown[];
      capabilities?: unknown[];
      coverageRationale?: string;
    }>(params.row.candidateJson, {});
    const contentLanguage = resolveGoalContentLanguage(
      claimed.goal.contentLanguage,
      claimed.goal.title,
    );
    const publish = async () => {
      if (candidate.kind === "exploration") {
        await params.repos.explorationModulePublication.publish({
          userId: claimed.goal.userId,
          goalId: params.row.goalId,
          moduleId: params.row.moduleId,
          generationBuildToken: token,
          orderIndex: claimed.orderIndex,
          units: (candidate.units ?? []) as never,
          publishedAt: new Date(),
        });
        return;
      }
      const capabilities = moduleCapabilityProposalSchema.parse({
        capabilities: candidate.capabilities ?? [],
      }).capabilities as ModuleObjectiveCapability[];
      const structure = moduleStructureProposalSchema.parse({
        units: candidate.units ?? [],
        coverageRationale:
          typeof candidate.coverageRationale === "string"
            ? candidate.coverageRationale
            : "",
      });
      const published = mapPreparedMasteryPublication({
        moduleCurriculumKey: claimed.curriculumKey,
        entryFoundationBriefs: claimed.entryFoundationBriefs ?? [],
        capabilities,
        units: structure.units,
        coverageRationale: structure.coverageRationale,
      });
      await params.repos.preparedModulePublication.publishMastery({
        userId: claimed.goal.userId,
        goalId: params.row.goalId,
        moduleId: params.row.moduleId,
        generationBuildToken: token,
        orderIndex: claimed.orderIndex,
        curriculumKey: claimed.curriculumKey,
        contentLanguage,
        mapOutcomeCount:
          parseMapPlan(String(claimed.goal.mapPlanJson ?? ""))?.whatYouWillLearn
            .length ?? 1,
        preparedExisting: false,
        publishedAt: new Date(),
        units: published.units,
        foundations: published.foundations,
        capabilities: published.capabilities,
      });
    };
    if (process.env.XUELEARN_DESKTOP_LOCAL === "1") {
      await serializeSqlitePublication(publish);
    } else {
      await publish();
    }
    await params.repos.drafts!.patch({
      moduleId: params.row.moduleId,
      status: "ready",
      publishedAt: new Date(),
      clearLease: true,
    });
    // Structure publication is not KACOM authorization. Drop the module
    // generation lease so opening the journey can claim `goal_page_open`.
    await params.repos.moduleGenerationLease.release({
      goalId: params.row.goalId,
      moduleId: params.row.moduleId,
      token,
    });
    await emitGoalCreationProgress(params.row.sessionId, {
      type: "module_stage",
      stage: "ready",
      moduleId: params.row.moduleId,
      moduleTitle: claimed.title,
      message: tBackend("status.planning.modulePublish.completed", {
        title: claimed.title,
      }),
    });
  } catch (error) {
    if (claimedLease) {
      await params.repos.moduleGenerationLease
        .fail({
          goalId: params.row.goalId,
          moduleId: params.row.moduleId,
          token,
          message: error instanceof Error ? error.message : String(error),
        })
        .catch(() => undefined);
    }
    throw error;
  }
}

export async function processGoalCreationCoordinateEvent(params: {
  payloadJson: string;
  repos: WorkerRepos;
}): Promise<{ goalId: string; status: string }> {
  const payload = parsePayload(params.payloadJson);
  if (!payload.goalId) throw new Error("Coordinate event is missing goalId");
  if (await sessionStopped(payload.goalId)) {
    return { goalId: payload.goalId, status: "ignored" };
  }
  const drafts = params.repos.drafts ?? requireModuleStructureDraft();
  const rows = await drafts.listByGoal(payload.goalId);
  if (moduleStructureDraftsNeedAttention(rows)) {
    const session =
      await requireAgentConversationPersistence().findGoalCreationSessionByGoalId(
        payload.goalId,
      );
    if (session) {
      await requireAgentConversationPersistence().markGoalCreationSessionError(
        session.id,
        "One or more module structure drafts failed",
      );
    }
    return { goalId: payload.goalId, status: "needs_attention" };
  }
  if (rows.some((row) => row.status === "failed")) {
    return { goalId: payload.goalId, status: "waiting_for_remaining" };
  }
  if (rows.every((row) => row.status === "ready") && rows.length > 0) {
    await completeAgenticSession(payload.goalId);
    return { goalId: payload.goalId, status: "completed" };
  }
  if (
    moduleStructureDraftsReadyForAudit(rows) &&
    payload.reason !== "audit_passed"
  ) {
    await drafts.enqueueAuditEvent({
      goalId: payload.goalId,
      sessionId: payload.sessionId ?? rows[0]!.sessionId,
    });
    return { goalId: payload.goalId, status: "audit_enqueued" };
  }
  const pendingPublication = draftsNeedingPublication(rows);
  if (
    pendingPublication.length > 0 &&
    (payload.reason === "audit_passed" ||
      pendingPublication.some((row) => row.status === "publishing"))
  ) {
    for (const row of pendingPublication) {
      if (row.status !== "publishing") {
        await drafts.patch({ moduleId: row.moduleId, status: "publishing" });
      }
      await publishDraft({
        row: { ...row, status: "publishing" },
        repos: { ...params.repos, drafts },
      });
    }
    const after = await drafts.listByGoal(payload.goalId);
    if (after.every((row) => row.status === "ready")) {
      await completeAgenticSession(payload.goalId);
      return { goalId: payload.goalId, status: "completed" };
    }
    return { goalId: payload.goalId, status: "publishing" };
  }
  if (rows.some((row) => row.status === "queued")) {
    const queued = rows.filter((row) => row.status === "queued");
    const [seed, ...rest] = queued;
    if (seed) {
      await drafts.enqueuePrepareEvents({
        goalId: payload.goalId,
        sessionId: payload.sessionId ?? seed.sessionId,
        moduleIds: [seed.moduleId],
        reason: "cache_seed",
      });
      if (rest.length > 0) {
        await drafts.enqueuePrepareEvents({
          goalId: payload.goalId,
          sessionId: payload.sessionId ?? seed.sessionId,
          moduleIds: rest.map((row) => row.moduleId),
          reason: "fan_out",
        });
      }
    }
    return { goalId: payload.goalId, status: "seeded" };
  }
  return { goalId: payload.goalId, status: "noop" };
}

export const AGENTIC_GOAL_CREATION_EVENT_TYPES = [
  GOAL_MODULE_STRUCTURE_DRAFT_PREPARE_EVENT,
  GOAL_MODULE_STRUCTURE_AUDIT_EVENT,
  GOAL_CREATION_COORDINATE_EVENT,
] as const;
