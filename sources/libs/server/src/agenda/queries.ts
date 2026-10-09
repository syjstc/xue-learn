import type {
  AgendaProgressRepository,
  AgendaProjectionReadRepository,
  AgendaRevisionProjection,
} from "../../../domain/src/index.js";
import { AGENDA_WINDOW_DAYS } from "./types.js";
import { addDaysToDateKey, localDateKey } from "./timezone.js";
import { getOrCreatePlanningSettings } from "./settings.js";
import { refreshAgendaForUser } from "./refresh.js";
import { isUnitJourneyResolved } from "../../../domain/src/index.js";
import { shouldRestoreCompletedStatus } from "../domain/restore-unit-completion.js";
import { resolveLearnerContentLanguage } from "../persona/learner-language.js";
import { explanationForCode } from "./explanations.js";
import type { ExplanationCode } from "./types.js";

let configuredAgendaProgress: AgendaProgressRepository | undefined;
let configuredAgendaProjectionRead: AgendaProjectionReadRepository | undefined;

function projectionPersistence(): AgendaProjectionReadRepository {
  if (!configuredAgendaProjectionRead)
    throw new Error("Agenda projection persistence is not configured");
  return configuredAgendaProjectionRead;
}

function progressPersistence(): AgendaProgressRepository {
  if (!configuredAgendaProgress)
    throw new Error("Agenda progress persistence is not configured");
  return configuredAgendaProgress;
}

export function configureAgendaProgressPersistence(
  repository: AgendaProgressRepository | undefined,
): void {
  configuredAgendaProgress = repository;
}

export function configureAgendaProjectionReadPersistence(
  repository: AgendaProjectionReadRepository | undefined,
): void {
  configuredAgendaProjectionRead = repository;
}

export type AgendaItemDto = {
  id: string;
  goalId: string;
  unitId: string;
  sectionId: string | null;
  sectionTitle: string | null;
  navigationTarget: string;
  goalTitle: string;
  unitTitle: string;
  itemType: "new_learning" | "review";
  plannedDate: string;
  estimatedMinutes: number;
  priority: number;
  explanation: string;
  explanationCode: string;
  completedAt: string | null;
  reviewDueAt: string | null;
  reviewCardId: string | null;
  cognitiveEntityIds: string[];
  targetState: Record<string, unknown>;
  expectedEvidence: Record<string, unknown>;
  sortIndex: number;
};

export type AgendaDayDto = {
  date: string;
  isToday: boolean;
  totalMinutes: number;
  capacityMinutes: number;
  newLearning: AgendaItemDto[];
  reviews: AgendaItemDto[];
};

export type AgendaResponse = {
  enabled: boolean;
  paused: boolean;
  locale: string;
  planningDate: string;
  timezone: string;
  capacityMinutes: number;
  capacity: Record<string, unknown>;
  revisionId: string | null;
  generationSource: string | null;
  reason: string | null;
  stale: boolean;
  refreshing: boolean;
  todayActiveMinutes: number;
  totalPlannedMinutes: number;
  continueItem: AgendaItemDto | null;
  days: AgendaDayDto[];
};

function mapItem(
  item: {
    id: string;
    goalId: string;
    unitId: string;
    sectionId: string | null;
    itemType: string;
    plannedDate: string;
    estimatedMinutes: number;
    priority: number;
    explanation: string;
    explanationCode: string;
    completedAt: Date | null;
    reviewDueAt: Date | null;
    reviewCardId: string | null;
    cognitiveEntityIds: string;
    targetState: unknown;
    expectedEvidence: unknown;
    sortIndex: number;
    goal?: { title: string } | null;
    section?: { title: string } | null;
    goalTitle?: string;
    sectionTitle?: string | null;
  },
  unitTitle: string,
  locale: string,
): AgendaItemDto {
  const explanation =
    locale.startsWith("en") || locale.startsWith("zh")
      ? explanationForCode(item.explanationCode as ExplanationCode, locale)
      : item.explanation;
  return {
    id: item.id,
    goalId: item.goalId,
    unitId: item.unitId,
    sectionId: item.sectionId,
    sectionTitle: item.sectionTitle ?? item.section?.title ?? null,
    navigationTarget: item.sectionId
      ? `/goals/${item.goalId}/units/${item.unitId}?section=${encodeURIComponent(item.sectionId)}`
      : `/goals/${item.goalId}/units/${item.unitId}`,
    goalTitle: item.goalTitle ?? item.goal?.title ?? "",
    unitTitle,
    itemType: item.itemType as "new_learning" | "review",
    plannedDate: item.plannedDate,
    estimatedMinutes: item.estimatedMinutes,
    priority: item.priority,
    explanation,
    explanationCode: item.explanationCode,
    completedAt: item.completedAt?.toISOString() ?? null,
    reviewDueAt: item.reviewDueAt?.toISOString() ?? null,
    reviewCardId: item.reviewCardId,
    cognitiveEntityIds: JSON.parse(item.cognitiveEntityIds) as string[],
    targetState:
      item.targetState && typeof item.targetState === "object"
        ? (item.targetState as Record<string, unknown>)
        : {},
    expectedEvidence:
      item.expectedEvidence && typeof item.expectedEvidence === "object"
        ? (item.expectedEvidence as Record<string, unknown>)
        : {},
    sortIndex: item.sortIndex,
  };
}

export async function getAgendaForUser(
  userId: string,
  options: {
    goalId?: string;
    goalIds?: string[];
    ensureFresh?: boolean;
    client?: unknown;
  } = {},
): Promise<AgendaResponse> {
  const settings = await getOrCreatePlanningSettings(userId);
  const planningDate = localDateKey(new Date(), settings.timezone);
  const locale = await resolveLearnerContentLanguage(userId);
  const repository = projectionPersistence();
  const todayActiveSeconds = await repository.findDailyActiveSeconds(
    userId,
    planningDate,
  );

  if (options.ensureFresh && settings.enabled && settings.agendaInvalidatedAt) {
    await refreshAgendaForUser(userId, {
      reason: "event",
      locale,
    });
  }

  let revision = await repository.findActiveProjection(userId, planningDate);

  // Fallback to latest active if timezone rolled but refresh pending
  if (!revision) {
    revision = await repository.findActiveProjection(userId);
  }

  if (!revision && settings.enabled) {
    await refreshAgendaForUser(userId, { reason: "daily", locale });
    revision = await repository.findActiveProjection(userId, planningDate);
  }

  const units = (revision as AgendaRevisionProjection | null)?.units ?? [];
  const unitTitles = new Map(units.map((u) => [u.id, u.title]));
  const resolvedUnitIds = new Set(
    units
      .filter(
        (unit) =>
          isUnitJourneyResolved(unit.status) ||
          shouldRestoreCompletedStatus(unit),
      )
      .map((unit) => unit.id),
  );

  let items = (revision?.items ?? [])
    .map((item) => mapItem(item, unitTitles.get(item.unitId) ?? "", locale))
    .filter(
      (item) =>
        !item.completedAt &&
        (item.itemType === "review" || !resolvedUnitIds.has(item.unitId)),
    );
  if (options.goalId) {
    items = items.filter((i) => i.goalId === options.goalId);
  } else if (options.goalIds) {
    const allowedGoalIds = new Set(options.goalIds);
    items = items.filter((i) => allowedGoalIds.has(i.goalId));
  }

  let capacity: Record<string, unknown> = {};
  try {
    capacity = JSON.parse(revision?.capacityJson ?? "{}") as Record<
      string,
      unknown
    >;
  } catch {
    capacity = {};
  }

  const dayKeys = Array.from({ length: AGENDA_WINDOW_DAYS }, (_, i) =>
    addDaysToDateKey(planningDate, i),
  );
  const days: AgendaDayDto[] = dayKeys.map((date) => {
    const dayItems = items.filter((i) => i.plannedDate === date);
    const newLearning = dayItems.filter((i) => i.itemType === "new_learning");
    const reviews = dayItems.filter((i) => i.itemType === "review");
    return {
      date,
      isToday: date === planningDate,
      totalMinutes: dayItems.reduce((s, i) => s + i.estimatedMinutes, 0),
      capacityMinutes:
        typeof (
          capacity.capacityByDate as Record<string, unknown> | undefined
        )?.[date] === "number"
          ? ((capacity.capacityByDate as Record<string, number>)[date] ??
            revision?.capacityMinutes ??
            0)
          : (revision?.capacityMinutes ?? 0),
      newLearning,
      reviews,
    };
  });

  const incompleteToday = items
    .filter((i) => i.plannedDate === planningDate && !i.completedAt)
    .sort((a, b) => b.priority - a.priority);

  return {
    enabled: settings.enabled,
    paused: !settings.enabled,
    locale,
    planningDate,
    timezone: settings.timezone,
    capacityMinutes: revision?.capacityMinutes ?? 0,
    capacity,
    revisionId: revision?.id ?? null,
    generationSource: revision?.generationSource ?? null,
    reason: revision?.reason ?? null,
    stale: Boolean(settings.agendaInvalidatedAt),
    refreshing: false,
    todayActiveMinutes: Math.floor(todayActiveSeconds / 60),
    totalPlannedMinutes: items
      .filter((i) => !i.completedAt)
      .reduce((s, i) => s + i.estimatedMinutes, 0),
    continueItem: incompleteToday[0] ?? null,
    days,
  };
}

export async function getAgendaItemExplanation(
  userId: string,
  itemId: string,
  _compatibilityClient?: unknown,
): Promise<{
  id: string;
  explanation: string;
  explanationCode: string;
  itemType: string;
  plannedDate: string;
  priority: number;
} | null> {
  const item = await projectionPersistence().findActiveItemExplanation(
    userId,
    itemId,
  );
  if (!item) return null;
  const locale = await resolveLearnerContentLanguage(userId);
  return {
    ...item,
    explanation:
      locale.startsWith("en") || locale.startsWith("zh")
        ? explanationForCode(item.explanationCode as ExplanationCode, locale)
        : item.explanation,
  };
}

export async function markAgendaItemCompletedForUnit(
  userId: string,
  unitId: string,
  itemType?: "new_learning" | "review",
  _compatibilityClient?: unknown,
): Promise<void> {
  const settings = await getOrCreatePlanningSettings(userId);
  const planningDate = localDateKey(new Date(), settings.timezone);
  await progressPersistence().completeUnitItems({
    userId,
    planningDate,
    unitId,
    itemType,
    completedAt: new Date(),
  });
}
