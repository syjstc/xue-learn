import type { ReviewExperienceRepository } from "../../../../../domain/src/index.js";
import { z } from "zod";

import { invalidateAgendaForUser } from "../../../agenda/settings.js";
import { getAgendaForUser } from "../../../agenda/queries.js";
import { retrieveLearnedKnowledge } from "../../../rag/learned-knowledge.js";
import { retrieveContextForUnitWithSources } from "../../../rag/retrieve.js";
import { createRagCapability, RAG_QUERY_TOOL_KEY, RAG_VIEW_KEY } from "../rag.js";
import type {
  BoundToolSubject,
  CapabilityQueryTool,
  ContextAuthority,
  ContextEnvelope,
  DomainEvent,
  LearningSystemCapability,
  LearningSystemSubject,
} from "../../types.js";

export const VERSION = "1.0.0";
export const SCHEMA_VERSION = 1;

export const RUNTIME_CONTEXT_VIEW_KEYS = {
  ragSources: RAG_VIEW_KEY,
  agendaCurrent: "agenda.current.v1",
  reviewDue: "review.due.v1",
} as const;

export const RUNTIME_CONTEXT_QUERY_TOOL_KEYS = {
  searchKnowledge: "search_knowledge",
  searchIndexedSources: RAG_QUERY_TOOL_KEY,
  getStudyAgenda: "get_study_agenda",
  getDueReviews: "get_due_reviews",
} as const;

export const AGENDA_INVALIDATION_EVENTS = [
  "goal.approved",
  "goal.curriculum_changed",
  "unit.material_published",
  "unit.completed",
  "assessment.answer_verified",
  "review.graded",
] as const;

export const knowledgeResultSchema = z.object({
  query: z.string(),
  learnedContext: z.string(),
  learnedUnitIds: z.array(z.string()),
});

export const agendaItemSchema = z.object({
  type: z.enum(["new_learning", "review"]),
  goalTitle: z.string(),
  unitTitle: z.string(),
  minutes: z.number().int().nonnegative(),
  explanation: z.string(),
});

export const agendaResultSchema = z.object({
  planningDate: z.string().nullable(),
  timezone: z.string(),
  paused: z.boolean(),
  stale: z.boolean(),
  capacityMinutes: z.number().int().nonnegative(),
  todayTotalMinutes: z.number().int().nonnegative(),
  totalPlannedMinutes: z.number().int().nonnegative(),
  todayItems: z.array(agendaItemSchema),
  continueItem: agendaItemSchema.nullable(),
});

export const reviewCardSchema = z.object({
  id: z.string(),
  unitId: z.string(),
  goalId: z.string(),
  unitTitle: z.string(),
  goalTitle: z.string(),
  dueAt: z.string(),
  lastGrade: z.number().int().nullable(),
});

export const reviewResultSchema = z.object({
  dueCount: z.number().int().nonnegative(),
  cards: z.array(reviewCardSchema),
});

export type RuntimeContextDependencies = {
  retrieveLearnedKnowledge: typeof retrieveLearnedKnowledge;
  retrieveContextForUnitWithSources: typeof retrieveContextForUnitWithSources;
  invalidateAgendaForUser: typeof invalidateAgendaForUser;
  now: () => Date;
};

export type CreateRuntimeContextCapabilitiesOptions = {
  /** Retained temporarily for source compatibility; runtime reads use ports. */
  persistence?: unknown;
  dependencies?: Partial<RuntimeContextDependencies>;
};

let configuredReviews: ReviewExperienceRepository | undefined;

export function configureRuntimeReviewPersistence(
  reviews: ReviewExperienceRepository | undefined,
): void {
  configuredReviews = reviews;
}

export function reviewPersistence(): ReviewExperienceRepository {
  if (!configuredReviews) {
    throw new Error("Runtime review persistence is not configured");
  }
  return configuredReviews;
}

export function abortIfNeeded(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("Capability query was aborted");
  error.name = "AbortError";
  throw error;
}

export function compactText(value: string, maxLength: number): string {
  const normalized = value.trim();
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength)}…`;
}

export function nowIso(now: () => Date): string {
  return now().toISOString();
}

export function envelope<T>(params: {
  ownerCapabilityId: string;
  authority: ContextAuthority;
  scope: LearningSystemSubject;
  data: T;
  asOf: string;
  stale?: boolean;
}): ContextEnvelope<T> {
  return {
    ownerCapabilityId: params.ownerCapabilityId,
    ownerCapabilityVersion: VERSION,
    schemaVersion: SCHEMA_VERSION,
    authority: params.authority,
    scope: { ...params.scope },
    freshness: {
      asOf: params.asOf,
      stale: params.stale ?? false,
    },
    data: params.data,
  };
}

export async function readAgendaSnapshot(subject: BoundToolSubject) {
  const agenda = await getAgendaForUser(subject.userId, {
    ...(subject.goalId ? { goalId: subject.goalId } : {}),
  });
  const items = agenda.days
    .flatMap((day) => [...day.newLearning, ...day.reviews])
    .filter((item) => !subject.unitId || item.unitId === subject.unitId)
    .map((item) => ({
      type: item.itemType,
      goalTitle: item.goalTitle,
      unitTitle: item.unitTitle,
      minutes: Math.max(0, item.estimatedMinutes),
      explanation: compactText(item.explanation, 500),
      plannedDate: item.plannedDate,
      priority: item.priority,
      sortIndex: item.sortIndex,
    }));
  const planningDate = agenda.planningDate;
  const todayItems = items
    .filter((item) => item.plannedDate === planningDate)
    .sort((left, right) => left.sortIndex - right.sortIndex)
    .map(
      ({
        plannedDate: _date,
        priority: _priority,
        sortIndex: _sort,
        ...item
      }) => item,
    );
  const continueItem =
    [...items]
      .filter((item) => item.plannedDate === planningDate)
      .sort((left, right) => right.priority - left.priority)[0] ?? null;

  return {
    asOf: new Date().toISOString(),
    stale: agenda.stale,
    data: {
      planningDate,
      timezone: agenda.timezone,
      paused: agenda.paused,
      stale: agenda.stale,
      capacityMinutes: Math.max(0, agenda.capacityMinutes),
      todayTotalMinutes: todayItems.reduce(
        (total, item) => total + item.minutes,
        0,
      ),
      totalPlannedMinutes: items.reduce(
        (total, item) => total + item.minutes,
        0,
      ),
      todayItems,
      continueItem: continueItem
        ? {
            type: continueItem.type,
            goalTitle: continueItem.goalTitle,
            unitTitle: continueItem.unitTitle,
            minutes: continueItem.minutes,
            explanation: continueItem.explanation,
          }
        : null,
    },
  };
}

export async function readDueReviews(
  subject: BoundToolSubject,
  now: Date,
  limit: number,
) {
  const due = (await reviewPersistence().listDue(subject.userId, now)).filter(
    (card) =>
      (!subject.goalId || card.goalId === subject.goalId) &&
      (!subject.unitId || card.unitId === subject.unitId),
  );
  return {
    dueCount: due.length,
    cards: due.slice(0, limit).map((card) => ({
      id: card.id,
      unitId: card.unitId,
      goalId: card.goalId,
      unitTitle: card.unitTitle,
      goalTitle: card.goalTitle,
      dueAt: card.nextReviewAt.toISOString(),
      lastGrade: card.lastGrade,
    })),
  };
}
