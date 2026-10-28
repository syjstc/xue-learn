import { formatPriorTeaching } from "../../../goal-creation/prior-teaching.js";
import { getGenerationOptionsPromptBlock } from "../../../llm/generation-options.js";
import type { LearningSystemPersistenceClient } from "../../persistence-client.js";
import type {
  CognitiveModelPresentationReadRepository,
  LearnerStateMemoryReadRepository,
  LearnerStateProjectionReadRepository,
} from "../../../../../domain/src/index.js";
import { match, P } from "ts-pattern";
import { z } from "zod";

import { formatCognitiveStatePromptBlock } from "../../../cognition/context.js";
import {
  getGoalCognitiveModel,
  getUnitLearningTargetsV2,
} from "../../../cognitive-model/presentation.js";
import { formatGlobalLearnerStateMemoryPrompt } from "../../../learner-state-memory/index.js";
import {
  extractLearnerProfile,
  formatLearnerProfilePromptBlock,
} from "../../../persona/learner-profile.js";
import type {
  PersonaPromptLocale,
  TeachingPersonaPromptPart,
} from "../../../teaching-personas/index.js";
import {
  loadTeachingSkillPrompt,
  type TeachingSkillStage,
} from "../../../teaching-skills/index.js";
import { upsertUserSettingsForUser } from "../../../user-settings.js";
import type {
  BoundToolSubject,
  CapabilityQueryTool,
  CapabilitySettingsPort,
  ContextAuthority,
  ContextEnvelope,
  LearningSystemCapability,
  LearningSystemSubject,
} from "../../types.js";
import { GENERAL_MEMORY_VIEW_KEYS } from "../general-memory/keys.js";
import type {
  LearningSpaceGoalCreationApplication,
  LearningSpacePortfolioReader,
} from "../../../learning-spaces/orm-application-service.js";

export const VERSION = "1.0.0";
export const SCHEMA_VERSION = 1;

export const BUILTIN_READ_VIEW_KEYS = {
  goalIntent: "goal.intent.v1",
  curriculumStructure: "curriculum.structure.v1",
  curriculumModule: "curriculum.module.v1",
  curriculumUnit: "curriculum.unit.v1",
  sessionCurrent: "session.current.v1",
  contentMaterial: "content.material.v1",
  learnerRelevantMemory: GENERAL_MEMORY_VIEW_KEYS.learnerRelevantMemory,
  learnerProfile: "learner.profile.v1",
  learnerCognitiveState: "learner.cognitive_state.v1",
  learningObjectives: "learning.objectives.v1",
  learningAssessmentAuthority: "learning.assessment_authority.v1",
  teachingPersonaBase: "teaching.persona.base.v1",
  teachingPersonaFull: "teaching.persona.full.v1",
  teachingPersonaCourse: "teaching.persona.course.v1",
  teachingPersonaAssessment: "teaching.persona.assessment.v1",
  teachingPersonaFollowUp: "teaching.persona.follow_up.v1",
  teachingDomainGuidance: "teaching.domain_guidance.v1",
} as const;

export const BUILTIN_READ_QUERY_TOOL_KEYS = {
  findRelevantMemory: "find_relevant_memory",
  searchGoals: "search_goals",
  searchUnits: "search_units",
  getRecentActivity: "get_recent_activity",
  getActiveGoalCreation: "get_active_goal_creation",
  explainLearningApp: "explain_learning_app",
  getCurrentLearningState: "get_current_learning_state",
  getLearningObjectives: "get_current_learning_objectives",
  getLearningPreferences: "get_effective_learning_preferences",
} as const;

export type BuiltinReadCapabilityDependencies = {
  formatGlobalLearnerStateMemoryPrompt: (
    userId: string,
    client?: LearningSystemPersistenceClient,
    memoryRead?: LearnerStateMemoryReadRepository,
  ) => Promise<string>;
  formatCognitiveStatePromptBlock: (
    userId: string,
    goalId?: string,
    projectionRead?: LearnerStateProjectionReadRepository,
  ) => Promise<string>;
  formatTeachingPersonaPromptPartForUser: (
    userId: string,
    goalId: string | undefined,
    part: TeachingPersonaPromptPart,
    locale?: PersonaPromptLocale,
  ) => Promise<string>;
  formatTeachingPersonaPromptBlockForUser: (
    userId: string,
    goalId?: string,
    locale?: PersonaPromptLocale,
  ) => Promise<string>;
  getGoalCognitiveModel: (
    client: LearningSystemPersistenceClient,
    goalId: string,
    options?: any,
  ) => ReturnType<typeof getGoalCognitiveModel>;
  getUnitLearningTargetsV2: (
    client: LearningSystemPersistenceClient,
    unitId: string,
    options?: any,
  ) => ReturnType<typeof getUnitLearningTargetsV2>;
  upsertUserSettingsForUser: typeof upsertUserSettingsForUser;
  loadTeachingSkillPrompt: typeof loadTeachingSkillPrompt;
};

export type CreateBuiltinReadCapabilitiesOptions = {
  persistence?: LearningSystemPersistenceClient;
  /** Optional cache reader supplied by the active persistence composition. */
  learnerStateMemoryRead?: LearnerStateMemoryReadRepository;
  /** Optional projection reader supplied by the active persistence composition. */
  learnerStateProjectionRead?: LearnerStateProjectionReadRepository;
  cognitiveModelPresentationRead?: CognitiveModelPresentationReadRepository;
  /** Optional typed application supplied by the active persistence composition root. */
  learningSpaceApplication?: LearningSpaceGoalCreationApplication;
  /** Optional typed reader supplied by the active persistence composition root. */
  learningSpacePortfolio?: LearningSpacePortfolioReader;
  /**
   * Test seam for public read APIs whose current implementation uses the
   * process-local database client. Production callers should not override it.
   */
  dependencies?: Partial<BuiltinReadCapabilityDependencies>;
};

export const preferencesResultSchema = z.object({
  learningViewMode: z.enum(["chat", "reading"]),
  chatAudioEnabled: z.boolean(),
});

export const goalSearchResultSchema = z.object({
  goals: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      goalKind: z.string(),
      learningMode: z.string(),
      contentLanguage: z.string(),
      updatedAt: z.string(),
    }),
  ),
});

export const unitSearchResultSchema = z.object({
  units: z.array(
    z.object({
      id: z.string(),
      goalId: z.string(),
      goalTitle: z.string(),
      title: z.string(),
      status: z.string(),
      unitKind: z.string(),
      orderIndex: z.number(),
      currentStep: z.string().nullable(),
    }),
  ),
});

export const recentActivityResultSchema = z.object({
  goals: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      lastTouchedAt: z.string(),
    }),
  ),
  units: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      goalId: z.string(),
      goalTitle: z.string(),
      currentStep: z.string().nullable(),
      lastTouchedAt: z.string(),
    }),
  ),
});

export const activeGoalCreationResultSchema = z.object({
  session: z
    .object({
      id: z.string(),
      goalId: z.string().nullable(),
      title: z.string().nullable(),
      status: z.string(),
      phase: z.string(),
      updatedAt: z.string(),
    })
    .nullable(),
});

export const cognitiveStateResultSchema = z.object({
  globalStatePrompt: z.string(),
  goalStatePrompt: z.string(),
  objectives: z.array(z.unknown()),
});

export const objectivesResultSchema = z.object({
  goalId: z.string().nullable(),
  unitId: z.string().nullable(),
  status: z.string(),
  objectives: z.array(z.unknown()),
});

export function nowIso(): string {
  return new Date().toISOString();
}

export function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.trim()) return value;
  return nowIso();
}

export function abortIfNeeded(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("Capability query was aborted");
  error.name = "AbortError";
  throw error;
}

export function envelope<T>(params: {
  ownerCapabilityId: string;
  authority: ContextAuthority;
  scope: LearningSystemSubject;
  data: T;
  asOf?: string;
  stale?: boolean;
}): ContextEnvelope<T> {
  return {
    ownerCapabilityId: params.ownerCapabilityId,
    ownerCapabilityVersion: VERSION,
    schemaVersion: SCHEMA_VERSION,
    authority: params.authority,
    scope: { ...params.scope },
    freshness: {
      asOf: params.asOf ?? nowIso(),
      stale: params.stale ?? false,
    },
    data: params.data,
  };
}

export function parseJsonObject(
  raw: string | null | undefined,
): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function parseJsonArray(raw: string | null | undefined): unknown[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function compactText(
  value: string | null | undefined,
  maxLength: number,
): string {
  const text = value?.trim() ?? "";
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`;
}

export function compactTakeaways(raw: string | null | undefined): string[] {
  return parseJsonArray(raw)
    .map((value) =>
      typeof value === "string"
        ? value
        : value && typeof value === "object" && "text" in value
          ? String((value as { text?: unknown }).text ?? "")
          : "",
    )
    .map((value) => compactText(value, 300))
    .filter(Boolean)
    .slice(0, 12);
}

export function compactSections(raw: string | null | undefined) {
  return parseJsonArray(raw)
    .map((value, index) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
      }
      const section = value as Record<string, unknown>;
      const title = [section.title, section.heading, section.name].find(
        (candidate): candidate is string =>
          typeof candidate === "string" && candidate.trim().length > 0,
      );
      const body = [section.content, section.markdown, section.text].find(
        (candidate): candidate is string => typeof candidate === "string",
      );
      return {
        index,
        title: compactText(title ?? `Section ${index + 1}`, 160),
        preview: compactText(body ?? "", 500),
      };
    })
    .filter(
      (section): section is NonNullable<typeof section> => section != null,
    )
    .slice(0, 10);
}

export async function loadGoal(
  persistence: LearningSystemPersistenceClient,
  subject: LearningSystemSubject,
) {
  if (!subject.userId) return null;
  if (subject.goalId) {
    return persistence.learningGoal.findFirst({
      where: { id: subject.goalId, userId: subject.userId },
      select: {
        id: true,
        title: true,
        level: true,
        domainTag: true,
        topicCategory: true,
        contentLanguage: true,
        goalKind: true,
        learningMode: true,
        planningMode: true,
        curriculumVersion: true,
        status: true,
        topicOverview: true,
        generationOptions: true,
        cognitiveModelStatus: true,
        updatedAt: true,
      },
    });
  }
  if (subject.unitId) {
    const unit = await persistence.learningUnit.findFirst({
      where: { id: subject.unitId, goal: { userId: subject.userId } },
      select: {
        goal: {
          select: {
            id: true,
            title: true,
            level: true,
            domainTag: true,
            topicCategory: true,
            contentLanguage: true,
            goalKind: true,
            learningMode: true,
            planningMode: true,
            curriculumVersion: true,
            status: true,
            topicOverview: true,
            cognitiveModelStatus: true,
            updatedAt: true,
          },
        },
      },
    });
    return unit?.goal ?? null;
  }
  return persistence.learningGoal.findFirst({
    where: { userId: subject.userId, status: "active" },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      title: true,
      level: true,
      domainTag: true,
      topicCategory: true,
      contentLanguage: true,
      goalKind: true,
      learningMode: true,
      planningMode: true,
      curriculumVersion: true,
      status: true,
      topicOverview: true,
      cognitiveModelStatus: true,
      updatedAt: true,
    },
  });
}

export async function loadCurriculum(
  persistence: LearningSystemPersistenceClient,
  subject: LearningSystemSubject,
) {
  const goal = await loadGoal(persistence, subject);
  if (!goal) return null;
  const [modules, units] = await Promise.all([
    persistence.learningModule.findMany({
      where: { goalId: goal.id },
      orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
      take: 20,
      select: {
        id: true,
        planRef: true,
        orderIndex: true,
        title: true,
        summary: true,
        objective: true,
        unlockStatus: true,
        generationStatus: true,
      },
    }),
    persistence.learningUnit.findMany({
      where: { goalId: goal.id },
      orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
      take: 100,
      select: {
        id: true,
        moduleId: true,
        parentUnitId: true,
        unitKind: true,
        title: true,
        orderIndex: true,
        difficulty: true,
        contentSummary: true,
        status: true,
        cognitiveModelStatus: true,
      },
    }),
  ]);
  return {
    goal: {
      ...goal,
      updatedAt: iso(goal.updatedAt),
      topicOverview: compactText(goal.topicOverview, 2_000),
    },
    modules: modules.map((module) => ({
      ...module,
      summary: compactText(module.summary, 500),
      objective: compactText(module.objective, 500),
    })),
    units: units.map((unit) => ({
      ...unit,
      contentSummary: compactText(unit.contentSummary, 500),
    })),
  };
}

export function compactDurableGoal(
  goal: NonNullable<Awaited<ReturnType<typeof loadGoal>>>,
) {
  return {
    id: goal.id,
    title: goal.title,
    level: goal.level,
    domainTag: goal.domainTag,
    topicCategory: goal.topicCategory,
    contentLanguage: goal.contentLanguage,
    goalKind: goal.goalKind,
    learningMode: goal.learningMode,
    planningMode: goal.planningMode,
    curriculumVersion: goal.curriculumVersion,
    topicOverview: compactText(goal.topicOverview, 2_000),
    generationOptions: goal.generationOptions,
  };
}

export function compactDurableCurriculum(
  curriculum: NonNullable<Awaited<ReturnType<typeof loadCurriculum>>>,
) {
  return {
    goal: compactDurableGoal(curriculum.goal),
    modules: curriculum.modules.map((module) => ({
      id: module.id,
      planRef: module.planRef,
      orderIndex: module.orderIndex,
      title: module.title,
      summary: compactText(module.summary, 500),
      objective: compactText(module.objective, 500),
    })),
    units: curriculum.units.map((unit) => ({
      id: unit.id,
      moduleId: unit.moduleId,
      parentUnitId: unit.parentUnitId,
      unitKind: unit.unitKind,
      title: unit.title,
      orderIndex: unit.orderIndex,
      difficulty: unit.difficulty,
      contentSummary: compactText(unit.contentSummary, 500),
    })),
  };
}

function line(label: string, value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return `${label}: ${String(value)}`;
}

export function renderGoalIntentPrompt(
  goal: ReturnType<typeof compactDurableGoal>,
): string {
  return [
    "[Current learning goal]",
    line("Title", goal.title),
    line("Starting level (not destination)", goal.level),
    line("Domain", goal.domainTag),
    line("Topic category", goal.topicCategory),
    line("Content language", goal.contentLanguage),
    line("Goal kind", goal.goalKind),
    line("Learning mode", goal.learningMode),
    line("Planning mode", goal.planningMode),
    line("Goal overview", goal.topicOverview),
    getGenerationOptionsPromptBlock(goal.generationOptions),
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

export function renderCurriculumStructurePrompt(
  curriculum: ReturnType<typeof compactDurableCurriculum>,
): string {
  const modules = curriculum.modules.map(
    (module) =>
      `${module.orderIndex + 1}. ${module.title}\n   Summary: ${module.summary ?? ""}\n   Objective: ${module.objective ?? ""}`,
  );
  return [
    "[Complete curriculum structure — use only for cross-module work]",
    `Goal: ${curriculum.goal.title}`,
    ...modules,
  ].join("\n");
}

export function renderCurriculumModulePrompt(
  input: NonNullable<Awaited<ReturnType<typeof loadModule>>>,
  goalTitle?: string | null,
): string {
  const module = input.module;
  return [
    "[Current module]",
    ...(goalTitle ? [`Goal: ${goalTitle}`] : []),
    `Module: ${module.title}`,
    `Summary: ${module.summary ?? ""}`,
    `Objective: ${module.objective ?? ""}`,
    "Module sequence:",
    ...input.units.map(
      (unit) =>
        `${unit.orderIndex + 1}. ${unit.title} (${unit.difficulty ?? "unspecified"}) — ${unit.contentSummary ?? ""}`,
    ),
  ].join("\n");
}

export function renderCurriculumUnitPrompt(
  unit: NonNullable<Awaited<ReturnType<typeof loadDurableUnit>>>,
): string {
  return [
    "[Current unit]",
    `Title: ${unit.title}`,
    `Kind: ${unit.unitKind}`,
    `Position in module: ${unit.orderIndex + 1}`,
    `Content boundary: ${unit.contentSummary ?? ""}`,
    unit.priorTeachingContext,
  ].join("\n");
}

export async function loadModule(
  persistence: LearningSystemPersistenceClient,
  subject: LearningSystemSubject,
) {
  if (!subject.moduleId && !subject.unitId) return null;
  const curriculum = await loadCurriculum(persistence, subject);
  if (!curriculum) return null;
  const moduleId =
    subject.moduleId ??
    curriculum.units.find((unit) => unit.id === subject.unitId)?.moduleId;
  if (!moduleId) return null;
  const module = curriculum.modules.find((item) => item.id === moduleId);
  if (!module) return null;
  return {
    goalTitle: curriculum.goal.title,
    module: {
      id: module.id,
      planRef: module.planRef,
      orderIndex: module.orderIndex,
      title: module.title,
      summary: compactText(module.summary, 500),
      objective: compactText(module.objective, 500),
    },
    units: curriculum.units
      .filter((unit) => unit.moduleId === moduleId)
      .map((unit) => ({
        id: unit.id,
        parentUnitId: unit.parentUnitId,
        unitKind: unit.unitKind,
        title: unit.title,
        orderIndex: unit.orderIndex,
        difficulty: unit.difficulty,
        contentSummary: compactText(unit.contentSummary, 500),
      })),
  };
}

export async function loadDurableUnit(
  persistence: LearningSystemPersistenceClient,
  subject: LearningSystemSubject,
) {
  const unit = await loadCurrentUnit(persistence, subject);
  if (!unit) return null;
  const priorTeaching =
    subject.userId && persistence.priorTeaching
      ? await persistence.priorTeaching.findMany({
          userId: subject.userId,
          unitId: unit.id,
        })
      : [];
  return {
    priorTeachingContext: formatPriorTeaching(priorTeaching),
    id: unit.id,
    goalId: unit.goalId,
    moduleId: unit.moduleId,
    title: unit.title,
    unitKind: unit.unitKind,
    orderIndex: unit.orderIndex,
    contentSummary: compactText(unit.contentSummary, 800),
  };
}

export async function loadCurrentUnit(
  persistence: LearningSystemPersistenceClient,
  subject: LearningSystemSubject,
) {
  if (!subject.userId) return null;
  if (subject.unitId) {
    return persistence.learningUnit.findFirst({
      where: { id: subject.unitId, goal: { userId: subject.userId } },
      select: {
        id: true,
        goalId: true,
        moduleId: true,
        title: true,
        status: true,
        unitKind: true,
        orderIndex: true,
        contentSummary: true,
        goal: { select: { title: true, learningMode: true, goalKind: true } },
        sessionState: {
          select: {
            currentStep: true,
            structuredSubStep: true,
            cumulativeActiveSeconds: true,
            updatedAt: true,
          },
        },
        learningMaterial: {
          select: {
            introduction: true,
            sections: true,
            keyTakeaways: true,
            contextSources: true,
            updatedAt: true,
          },
        },
      },
    });
  }

  const session = await persistence.unitSessionState.findFirst({
    where: {
      unit: {
        goal: {
          userId: subject.userId,
          ...(subject.goalId ? { id: subject.goalId } : {}),
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    select: { unitId: true },
  });
  if (!session) return null;
  return loadCurrentUnit(persistence, { ...subject, unitId: session.unitId });
}

export function compactSession(
  unit: Awaited<ReturnType<typeof loadCurrentUnit>>,
) {
  if (!unit) return null;
  return {
    unit: {
      id: unit.id,
      goalId: unit.goalId,
      goalTitle: unit.goal.title,
      moduleId: unit.moduleId,
      title: unit.title,
      status: unit.status,
      unitKind: unit.unitKind,
      orderIndex: unit.orderIndex,
      contentSummary: compactText(unit.contentSummary, 800),
      learningMode: unit.goal.learningMode,
      goalKind: unit.goal.goalKind,
    },
    session: unit.sessionState
      ? {
          currentStep: unit.sessionState.currentStep,
          structuredSubStep: unit.sessionState.structuredSubStep,
          cumulativeActiveSeconds: unit.sessionState.cumulativeActiveSeconds,
          updatedAt: iso(unit.sessionState.updatedAt),
        }
      : null,
  };
}

export function compactMaterial(
  unit: Awaited<ReturnType<typeof loadCurrentUnit>>,
) {
  if (!unit) return null;
  const material = unit.learningMaterial;
  return {
    unitId: unit.id,
    goalId: unit.goalId,
    title: unit.title,
    contentSummary: compactText(unit.contentSummary, 800),
    material: material
      ? {
          introduction: compactText(material.introduction, 2_000),
          sections: compactSections(material.sections),
          keyTakeaways: compactTakeaways(material.keyTakeaways),
          contextSources: parseJsonArray(material.contextSources).slice(0, 20),
          updatedAt: iso(material.updatedAt),
        }
      : null,
  };
}

export function compactLearningTarget(target: unknown): unknown {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    return target;
  }
  const value = target as Record<string, unknown>;
  return {
    id: value.id,
    localRef: value.localRef,
    title: value.title,
    learningObjective: value.learningObjective,
    description: value.description,
    role: value.role,
    isEntry: value.isEntry,
    isExit: value.isExit,
    assessmentCriteria: value.assessmentCriteria,
    requirements: value.requirements,
    state: value.state,
  };
}

export async function authorizeCognitiveSubject(
  persistence: LearningSystemPersistenceClient,
  subject: LearningSystemSubject,
) {
  if (!subject.userId) return null;
  if (subject.unitId) {
    const unit = await persistence.learningUnit.findFirst({
      where: { id: subject.unitId, goal: { userId: subject.userId } },
      select: {
        id: true,
        goalId: true,
        cognitiveModelStatus: true,
        goal: {
          select: {
            goalKind: true,
            learningMode: true,
            cognitiveModelStatus: true,
          },
        },
      },
    });
    if (!unit) return null;
    if (subject.goalId && subject.goalId !== unit.goalId) return null;
    return {
      goalId: unit.goalId,
      unitId: unit.id,
      goalKind: unit.goal.goalKind,
      learningMode: unit.goal.learningMode,
      goalCognitiveModelStatus: unit.goal.cognitiveModelStatus,
      unitCognitiveModelStatus: unit.cognitiveModelStatus,
    };
  }
  if (subject.goalId) {
    const goal = await persistence.learningGoal.findFirst({
      where: { id: subject.goalId, userId: subject.userId },
      select: {
        id: true,
        goalKind: true,
        learningMode: true,
        cognitiveModelStatus: true,
      },
    });
    if (!goal) return null;
    return {
      goalId: goal.id,
      unitId: null,
      goalKind: goal.goalKind,
      learningMode: goal.learningMode,
      goalCognitiveModelStatus: goal.cognitiveModelStatus,
      unitCognitiveModelStatus: null,
    };
  }
  return {
    goalId: null,
    unitId: null,
    goalKind: null,
    learningMode: null,
    goalCognitiveModelStatus: null,
    unitCognitiveModelStatus: null,
  };
}

export async function loadObjectives(
  persistence: LearningSystemPersistenceClient,
  deps: BuiltinReadCapabilityDependencies,
  subject: LearningSystemSubject,
) {
  const authorized = await authorizeCognitiveSubject(persistence, subject);
  if (!authorized) return null;
  if (
    authorized.goalKind === "micro" ||
    authorized.learningMode === "exploration"
  ) {
    return {
      goalId: authorized.goalId,
      unitId: authorized.unitId,
      status: "not_applicable",
      objectives: [],
    };
  }
  if (authorized.unitId) {
    const result = await deps.getUnitLearningTargetsV2(
      persistence,
      authorized.unitId,
      { userId: subject.userId },
    );
    return {
      goalId: authorized.goalId,
      unitId: authorized.unitId,
      status: authorized.unitCognitiveModelStatus ?? "unknown",
      objectives: result.learningTargets.map(compactLearningTarget),
    };
  }
  if (authorized.goalId) {
    const result = await deps.getGoalCognitiveModel(
      persistence,
      authorized.goalId,
      {
        view: "full",
        userId: subject.userId,
      },
    );
    return {
      goalId: authorized.goalId,
      unitId: null,
      status: result.status,
      objectives: result.learningTargets
        .slice(0, 30)
        .map(compactLearningTarget),
    };
  }
  return {
    goalId: null,
    unitId: null,
    status: "scope_required",
    objectives: [],
  };
}

export async function loadCognitiveState(
  persistence: LearningSystemPersistenceClient,
  deps: BuiltinReadCapabilityDependencies,
  subject: LearningSystemSubject,
) {
  if (!subject.userId) return null;
  const authorized = await authorizeCognitiveSubject(persistence, subject);
  if (!authorized) return null;
  const [globalStatePrompt, goalStatePrompt, objectives] = await Promise.all([
    deps.formatGlobalLearnerStateMemoryPrompt(subject.userId, persistence),
    authorized.goalId
      ? deps.formatCognitiveStatePromptBlock(subject.userId, authorized.goalId)
      : Promise.resolve(""),
    loadObjectives(persistence, deps, subject),
  ]);
  return {
    globalStatePrompt,
    goalStatePrompt,
    objectives: objectives?.objectives ?? [],
  };
}
