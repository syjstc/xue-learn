import type { LearningSystemPersistenceClient } from "../persistence-client.js";
import { match, P } from "ts-pattern";
import { z } from "zod";
import {
  extractLearnerProfile,
  formatLearnerProfilePromptBlock,
} from "../../persona/learner-profile.js";
import type { TeachingSkillStage } from "../../teaching-skills/index.js";
import type {
  CapabilityQueryTool,
  CapabilitySettingsPort,
  LearningSystemCapability,
} from "../types.js";
import * as shared from "./support/builtin.js";
import type { BuiltinReadCapabilityDependencies } from "./support/builtin.js";

const {
  VERSION,
  SCHEMA_VERSION,
  BUILTIN_READ_VIEW_KEYS,
  BUILTIN_READ_QUERY_TOOL_KEYS,
  preferencesResultSchema,
  goalSearchResultSchema,
  unitSearchResultSchema,
  recentActivityResultSchema,
  activeGoalCreationResultSchema,
  cognitiveStateResultSchema,
  objectivesResultSchema,
  iso,
  abortIfNeeded,
  envelope,
  parseJsonObject,
  loadGoal,
  loadCurriculum,
  loadCurrentUnit,
  compactSession,
  compactMaterial,
  compactDurableGoal,
  compactDurableCurriculum,
  renderGoalIntentPrompt,
  renderCurriculumStructurePrompt,
  renderCurriculumModulePrompt,
  renderCurriculumUnitPrompt,
  loadModule,
  loadDurableUnit,
  authorizeCognitiveSubject,
  loadObjectives,
  loadCognitiveState,
  nowIso,
} = shared;

export function createCurriculumSessionCapability(
  persistence: LearningSystemPersistenceClient,
): LearningSystemCapability {
  const capabilityId = "curriculum-session";

  const searchGoalsTool: CapabilityQueryTool<
    { query?: string; limit?: number },
    z.infer<typeof goalSearchResultSchema>
  > = {
    key: BUILTIN_READ_QUERY_TOOL_KEYS.searchGoals,
    ownerCapabilityId: capabilityId,
    schemaVersion: SCHEMA_VERSION,
    description: "Search the current learner's goals by title.",
    inputSchema: z
      .object({
        query: z.string().trim().max(200).optional(),
        limit: z.number().int().min(1).max(20).optional(),
      })
      .strict(),
    resultSchema: goalSearchResultSchema,
    requiredScopes: ["user"],
    authority: "objective_definition",
    maxResultTokens: 1_200,
    query: async (subject, input, signal) => {
      abortIfNeeded(signal);
      const goals = await persistence.learningGoal.findMany({
        where: {
          userId: subject.userId,
          ...(input.query
            ? {
                title: {
                  contains: input.query,
                  mode: "insensitive" as const,
                },
              }
            : {}),
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: input.limit ?? 10,
        select: {
          id: true,
          title: true,
          status: true,
          goalKind: true,
          learningMode: true,
          contentLanguage: true,
          updatedAt: true,
        },
      });
      return envelope({
        ownerCapabilityId: capabilityId,
        authority: "objective_definition",
        scope: { userId: subject.userId },
        asOf: goals[0] ? iso(goals[0].updatedAt) : nowIso(),
        data: {
          goals: goals.map((goal) => ({
            ...goal,
            updatedAt: iso(goal.updatedAt),
          })),
        },
      });
    },
  };

  const searchUnitsTool: CapabilityQueryTool<
    { query?: string; status?: string; limit?: number },
    z.infer<typeof unitSearchResultSchema>
  > = {
    key: BUILTIN_READ_QUERY_TOOL_KEYS.searchUnits,
    ownerCapabilityId: capabilityId,
    schemaVersion: SCHEMA_VERSION,
    description:
      "Search units owned by the current learner, optionally restricted to the server-bound goal.",
    inputSchema: z
      .object({
        query: z.string().trim().max(200).optional(),
        status: z
          .enum([
            "available",
            "in_progress",
            "completed",
            "completed_needs_reinforcement",
            "skipped",
          ])
          .optional(),
        limit: z.number().int().min(1).max(20).optional(),
      })
      .strict(),
    resultSchema: unitSearchResultSchema,
    requiredScopes: ["user"],
    authority: "objective_definition",
    maxResultTokens: 1_500,
    query: async (subject, input, signal) => {
      abortIfNeeded(signal);
      const units = await persistence.learningUnit.findMany({
        where: {
          goal: {
            userId: subject.userId,
            ...(subject.goalId ? { id: subject.goalId } : {}),
          },
          ...(input.query
            ? {
                title: {
                  contains: input.query,
                  mode: "insensitive" as const,
                },
              }
            : {}),
          ...(input.status ? { status: input.status } : {}),
        },
        orderBy: [
          { goal: { updatedAt: "desc" } },
          { orderIndex: "asc" },
          { id: "asc" },
        ],
        take: input.limit ?? 10,
        select: {
          id: true,
          goalId: true,
          title: true,
          status: true,
          unitKind: true,
          orderIndex: true,
          goal: { select: { title: true } },
          sessionState: { select: { currentStep: true } },
        },
      });
      return envelope({
        ownerCapabilityId: capabilityId,
        authority: "objective_definition",
        scope: {
          userId: subject.userId,
          ...(subject.goalId ? { goalId: subject.goalId } : {}),
        },
        data: {
          units: units.map((unit) => ({
            id: unit.id,
            goalId: unit.goalId,
            goalTitle: unit.goal.title,
            title: unit.title,
            status: unit.status,
            unitKind: unit.unitKind,
            orderIndex: unit.orderIndex,
            currentStep: unit.sessionState?.currentStep ?? null,
          })),
        },
      });
    },
  };

  const recentActivityTool: CapabilityQueryTool<
    { limit?: number },
    z.infer<typeof recentActivityResultSchema>
  > = {
    key: BUILTIN_READ_QUERY_TOOL_KEYS.getRecentActivity,
    ownerCapabilityId: capabilityId,
    schemaVersion: SCHEMA_VERSION,
    description:
      "Read the learner's recently touched goals and learning units.",
    inputSchema: z
      .object({ limit: z.number().int().min(1).max(20).optional() })
      .strict(),
    resultSchema: recentActivityResultSchema,
    requiredScopes: ["user"],
    authority: "verified_learner_state",
    maxResultTokens: 1_200,
    query: async (subject, input, signal) => {
      abortIfNeeded(signal);
      const limit = input.limit ?? 8;
      const [goals, sessions] = await Promise.all([
        persistence.learningGoal.findMany({
          where: { userId: subject.userId },
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          take: limit,
          select: { id: true, title: true, status: true, updatedAt: true },
        }),
        persistence.unitSessionState.findMany({
          where: { unit: { goal: { userId: subject.userId } } },
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          take: limit,
          select: {
            updatedAt: true,
            currentStep: true,
            unit: {
              select: {
                id: true,
                title: true,
                status: true,
                goalId: true,
                goal: { select: { title: true } },
              },
            },
          },
        }),
      ]);
      return envelope({
        ownerCapabilityId: capabilityId,
        authority: "verified_learner_state",
        scope: { userId: subject.userId },
        data: {
          goals: goals.map((goal) => ({
            id: goal.id,
            title: goal.title,
            status: goal.status,
            lastTouchedAt: iso(goal.updatedAt),
          })),
          units: sessions.map((session) => ({
            id: session.unit.id,
            title: session.unit.title,
            status: session.unit.status,
            goalId: session.unit.goalId,
            goalTitle: session.unit.goal.title,
            currentStep: session.currentStep,
            lastTouchedAt: iso(session.updatedAt),
          })),
        },
      });
    },
  };

  const activeGoalCreationTool: CapabilityQueryTool<
    Record<string, never>,
    z.infer<typeof activeGoalCreationResultSchema>
  > = {
    key: BUILTIN_READ_QUERY_TOOL_KEYS.getActiveGoalCreation,
    ownerCapabilityId: capabilityId,
    schemaVersion: SCHEMA_VERSION,
    description: "Read the learner's current unfinished goal-creation session.",
    inputSchema: z.object({}).strict(),
    resultSchema: activeGoalCreationResultSchema,
    requiredScopes: ["user"],
    authority: "verified_learner_state",
    maxResultTokens: 500,
    query: async (subject, _input, signal) => {
      abortIfNeeded(signal);
      const session = await persistence.goalCreationSession.findUnique({
        where: { activeSlot: subject.userId },
        include: { goal: { select: { title: true } } },
      });
      return envelope({
        ownerCapabilityId: capabilityId,
        authority: "verified_learner_state",
        scope: { userId: subject.userId },
        data: {
          session: session
            ? {
                id: session.id,
                goalId: session.goalId,
                title: session.goal?.title ?? null,
                status: session.status,
                phase: session.phase,
                updatedAt: iso(session.updatedAt),
              }
            : null,
        },
      });
    },
  };

  return {
    manifest: {
      id: capabilityId,
      version: VERSION,
      kind: "core_provider",
      providesViews: [
        BUILTIN_READ_VIEW_KEYS.goalIntent,
        BUILTIN_READ_VIEW_KEYS.curriculumStructure,
        BUILTIN_READ_VIEW_KEYS.curriculumModule,
        BUILTIN_READ_VIEW_KEYS.curriculumUnit,
        BUILTIN_READ_VIEW_KEYS.sessionCurrent,
        BUILTIN_READ_VIEW_KEYS.contentMaterial,
      ],
      providesQueryTools: [
        searchGoalsTool.key,
        searchUnitsTool.key,
        recentActivityTool.key,
        activeGoalCreationTool.key,
      ],
    },
    getView: async (request) => {
      if (!request.subject.userId) return null;
      if (request.key === BUILTIN_READ_VIEW_KEYS.goalIntent) {
        const goal = await loadGoal(persistence, request.subject);
        if (!goal) return null;
        return envelope({
          ownerCapabilityId: capabilityId,
          authority: "objective_definition",
          scope: { userId: request.subject.userId, goalId: goal.id },
          asOf: iso(goal.updatedAt),
          data: {
            promptBlock: renderGoalIntentPrompt(compactDurableGoal(goal)),
          },
        });
      }
      if (request.key === BUILTIN_READ_VIEW_KEYS.curriculumStructure) {
        const curriculum = await loadCurriculum(persistence, request.subject);
        if (!curriculum) return null;
        return envelope({
          ownerCapabilityId: capabilityId,
          authority: "objective_definition",
          scope: {
            userId: request.subject.userId,
            goalId: curriculum.goal.id,
          },
          asOf: curriculum.goal.updatedAt,
          data: {
            promptBlock: renderCurriculumStructurePrompt(
              compactDurableCurriculum(curriculum),
            ),
          },
        });
      }
      if (request.key === BUILTIN_READ_VIEW_KEYS.curriculumModule) {
        const module = await loadModule(persistence, request.subject);
        if (!module) return null;
        return envelope({
          ownerCapabilityId: capabilityId,
          authority: "objective_definition",
          scope: {
            userId: request.subject.userId,
            goalId: request.subject.goalId,
            moduleId: module.module.id,
          },
          asOf: new Date(0).toISOString(),
          data: {
            promptBlock: renderCurriculumModulePrompt(module, module.goalTitle),
          },
        });
      }
      if (request.key === BUILTIN_READ_VIEW_KEYS.curriculumUnit) {
        const unit = await loadDurableUnit(persistence, request.subject);
        if (!unit) return null;
        return envelope({
          ownerCapabilityId: capabilityId,
          authority: "objective_definition",
          scope: {
            userId: request.subject.userId,
            goalId: unit.goalId,
            moduleId: unit.moduleId ?? undefined,
            unitId: unit.id,
          },
          asOf: new Date(0).toISOString(),
          data: { promptBlock: renderCurriculumUnitPrompt(unit) },
        });
      }
      if (
        request.key === BUILTIN_READ_VIEW_KEYS.sessionCurrent ||
        request.key === BUILTIN_READ_VIEW_KEYS.contentMaterial
      ) {
        const unit = await loadCurrentUnit(persistence, request.subject);
        if (!unit) return null;
        return envelope({
          ownerCapabilityId: capabilityId,
          authority:
            request.key === BUILTIN_READ_VIEW_KEYS.contentMaterial
              ? "verified_source"
              : "conversation_context",
          scope: {
            userId: request.subject.userId,
            goalId: unit.goalId,
            unitId: unit.id,
          },
          asOf: iso(
            request.key === BUILTIN_READ_VIEW_KEYS.contentMaterial
              ? unit.learningMaterial?.updatedAt
              : unit.sessionState?.updatedAt,
          ),
          data:
            request.key === BUILTIN_READ_VIEW_KEYS.contentMaterial
              ? compactMaterial(unit)
              : compactSession(unit),
        });
      }
      return null;
    },
    getQueryTools: () =>
      [
        searchGoalsTool,
        searchUnitsTool,
        recentActivityTool,
        activeGoalCreationTool,
      ] as unknown as CapabilityQueryTool[],
  };
}
