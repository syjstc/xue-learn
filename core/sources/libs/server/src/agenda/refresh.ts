import {
  isUnitJourneyResolved,
  isUnitLearningDone,
  type AgendaRefreshReadRepository,
  type UnitCompletionRepository,
} from "../../../domain/src/index.js";
import type { ContentLanguageCode } from "../llm/content-language.js";
import { resolveGoalContentLanguage } from "../llm/content-language.js";
import { allocateAgenda, agendaWindowEndDateKey } from "./allocate.js";
import { calculateDailyCapacity } from "./capacity.js";
import {
  collectNewLearningCandidates,
  collectReviewCandidates,
  type UnitCandidateRow,
} from "./candidates.js";
import { publishAgendaRevision } from "./publish.js";
import { getOrCreatePlanningSettings } from "./settings.js";
import {
  addDaysToDateKey,
  localDateKey,
  localDateKeyToApproxUtc,
} from "./timezone.js";
import type { AgendaRefreshReason } from "./types.js";
import { shouldRestoreCompletedStatus } from "../domain/restore-unit-completion.js";

let configuredAgendaRefreshRead: AgendaRefreshReadRepository | undefined;
let configuredAgendaUnitCompletion: UnitCompletionRepository | undefined;

function refreshReadPersistence(): AgendaRefreshReadRepository {
  if (!configuredAgendaRefreshRead)
    throw new Error("Agenda refresh persistence is not configured");
  return configuredAgendaRefreshRead;
}

function unitCompletionPersistence(): UnitCompletionRepository {
  if (!configuredAgendaUnitCompletion)
    throw new Error("Agenda unit-completion persistence is not configured");
  return configuredAgendaUnitCompletion;
}

export function configureAgendaRefreshReadPersistence(
  repository: AgendaRefreshReadRepository | undefined,
  unitCompletion?: UnitCompletionRepository,
): void {
  configuredAgendaRefreshRead = repository;
  configuredAgendaUnitCompletion = unitCompletion;
}

const inFlight = new Map<string, Promise<RefreshAgendaResult>>();

export type RefreshAgendaResult = {
  skipped: boolean;
  reason: string;
  revisionId?: string;
  generationSource?: string;
  contentHash?: string;
  itemCount?: number;
};

export function evidencePlanForGap(gapType: string): {
  explanationCode:
    "knowledge_gap" | "composition_gap" | "transfer_gap" | "stability_gap";
  expectedEvidence: Record<string, unknown>;
} {
  if (gapType === "transfer") {
    return {
      explanationCode: "transfer_gap",
      expectedEvidence: {
        taskKind: "novel_application",
        dimensions: ["transfer", "independence"],
        contextDistance: "far",
      },
    };
  }
  if (gapType === "stability") {
    return {
      explanationCode: "stability_gap",
      expectedEvidence: {
        taskKind: "retention",
        dimensions: ["memory", "stability"],
        contextDistance: "same",
      },
    };
  }
  if (gapType === "combination" || gapType === "strategy") {
    return {
      explanationCode: "composition_gap",
      expectedEvidence: {
        taskKind: "integration",
        dimensions: ["application", "independence"],
        directHighLevelEvidence: true,
      },
    };
  }
  return {
    explanationCode: "knowledge_gap",
    expectedEvidence: {
      taskKind: "focused_learning_and_practice",
      dimensions: ["memory", "understanding", "application"],
    },
  };
}

async function buildDeterministicAgenda(params: {
  userId: string;
  reason: AgendaRefreshReason;
  locale?: ContentLanguageCode;
}) {
  const settings = await getOrCreatePlanningSettings(params.userId);
  const now = new Date();
  const planningDate = localDateKey(now, settings.timezone);
  const windowEndKey = agendaWindowEndDateKey(planningDate);
  const windowEnd = localDateKeyToApproxUtc(windowEndKey, settings.timezone);
  windowEnd.setUTCHours(23, 59, 59, 999);
  const activityStart = addDaysToDateKey(planningDate, -13);
  const repository = refreshReadPersistence();
  const planningInputs = await repository.readPlanningInputs({
    userId: params.userId,
    activityStart,
    planningDate,
    windowEnd,
  });

  const goals = planningInputs.goals.map((goal) => ({
    ...goal,
    units: goal.units.map((unit) => ({
      ...unit,
      sections: unit.sections.map(({ unitId: _unitId, ...section }) => ({
        ...section,
        progress: section.progress.map((progress) => ({ ...progress })),
      })),
    })),
  }));
  const locale =
    params.locale ??
    (goals[0]
      ? resolveGoalContentLanguage(goals[0].contentLanguage, goals[0].title)
      : "zh-Hans");

  const goalIds = goals.map((g) => g.id);
  const goalTitles = new Map(goals.map((g) => [g.id, g.title]));
  const goalPriorities = new Map(
    Object.entries(settings.goalPriorities).map(([k, v]) => [k, v]),
  );
  const unitsByGoal = new Map<string, UnitCandidateRow[]>();
  for (const goal of goals) {
    unitsByGoal.set(goal.id, goal.units);
  }

  const allUnits = goals.flatMap((goal) => goal.units);
  const healedIds = await unitCompletionPersistence().healOwnedDemoted(
    params.userId,
    allUnits.map((unit) => unit.id),
  );
  const healed = new Set(healedIds);
  for (const unit of allUnits) {
    if (healed.has(unit.id)) unit.status = "completed";
  }

  const learningSeconds = new Map(planningInputs.learningSecondsByGoal);
  const engagementByGoal = new Map<string, number>();
  for (const [goalId, seconds] of learningSeconds) {
    engagementByGoal.set(goalId, seconds);
  }

  const { ensureUnitSectionPlan } = await import("../sections/index.js");
  await Promise.all(
    goals.flatMap((goal) =>
      goal.units
        .filter(
          (unit) =>
            unit.unitKind === "lesson" &&
            !isUnitJourneyResolved(unit.status) &&
            !shouldRestoreCompletedStatus(unit) &&
            unit.module?.unlockStatus !== "locked" &&
            (unit.status === "available" || unit.status === "in_progress"),
        )
        .map((unit) => ensureUnitSectionPlan(unit.id)),
    ),
  );
  const refreshedSections = await repository.listOwnedUnitSections(
    params.userId,
    goals.flatMap((goal) => goal.units.map((unit) => unit.id)),
  );
  for (const goal of goals) {
    for (const unit of goal.units) {
      unit.sections = refreshedSections
        .filter((section) => section.unitId === unit.id)
        .map(({ unitId: _unitId, ...section }) => ({
          ...section,
          progress: [...section.progress],
        }));
    }
  }
  const statedTarget = settings.dailyCapacityTargetMin;

  // Observed section effort comes from persisted plans and learner activity.
  const sessionSamples: number[] = [];
  let completedCount = 0;
  for (const goal of goals) {
    for (const unit of goal.units) {
      if (unit.unitKind !== "lesson") continue;
      for (const section of unit.sections) {
        const progress = section.progress[0];
        if (progress?.activeSeconds) {
          sessionSamples.push(
            Math.max(1, Math.round(progress.activeSeconds / 60)),
          );
        } else if (progress?.status === "in_progress") {
          sessionSamples.push(section.baseEstimatedMinutes);
        }
      }
      if (isUnitLearningDone(unit.status)) {
        completedCount += 1;
      }
    }
  }
  const totalSeconds = [...learningSeconds.values()].reduce((a, b) => a + b, 0);
  const observedAvgSessionMinutes =
    sessionSamples.length > 0
      ? Math.round(
          sessionSamples.reduce((a, b) => a + b, 0) / sessionSamples.length,
        )
      : completedCount > 0 && totalSeconds > 0
        ? Math.round(totalSeconds / 60 / completedCount)
        : null;
  const recentDailyActivity = planningInputs.recentDailyActiveSeconds.map(
    (activeSeconds) => ({
      activeSeconds,
    }),
  );
  const observedDailyActiveMinutes = recentDailyActivity.length
    ? Math.round(
        recentDailyActivity.reduce((sum, row) => sum + row.activeSeconds, 0) /
          60 /
          14,
      )
    : null;

  const previous = planningInputs.previous;

  const capacity = calculateDailyCapacity({
    statedTargetMinutes: statedTarget,
    overrideMinutes: null,
    observedAvgSessionMinutes,
    observedDailyActiveMinutes,
    previousCapacityMinutes: previous?.capacityMinutes ?? null,
  });

  const reviewRows = planningInputs.reviews;
  const activeGaps = planningInputs.gaps;

  const gapPriorityByEntity = new Map<string, number>();
  for (const gap of activeGaps) {
    gapPriorityByEntity.set(
      gap.primaryEntityId,
      Math.max(
        gapPriorityByEntity.get(gap.primaryEntityId) ?? 0,
        gap.severity * gap.confidence,
      ),
    );
  }

  const spacedReviewRows = reviewRows.map((review) => {
    const cognitiveEntityIds = [...review.cognitiveEntityIds];
    const maxGapPriority = cognitiveEntityIds.reduce(
      (maximum, entityId) =>
        Math.max(maximum, gapPriorityByEntity.get(entityId) ?? 0),
      0,
    );
    return {
      reviewCardId: review.id,
      cognitiveEntityIds,
      unitId: review.unitId,
      goalId: review.goalId,
      unitTitle: review.unitTitle,
      goalTitle: review.goalTitle,
      durationMin: 10,
      nextReviewAt: review.nextReviewAt,
      status: review.unitStatus,
      prerequisitePriority:
        maxGapPriority >= 0.7 ? 3 : maxGapPriority > 0 ? 2 : 1,
      explanationCode: "stability_gap" as const,
      targetState: {
        gapType: "stability",
        reviewDueAt: review.nextReviewAt.toISOString(),
      },
      expectedEvidence: {
        taskKind: "retention",
        dimensions: ["memory", "stability"],
        contextDistance: "same",
        delayedUntil: review.nextReviewAt.toISOString(),
      },
    };
  });
  const gapReviewRows = activeGaps.flatMap((gap) => {
    const unit = gap.unit;
    if (!unit) return [];
    const supportingEntityIds = [...gap.supportingEntityIds];
    const recommendation = gap.recommendedAction;
    const readinessProbe =
      gap.status === "testing" &&
      recommendation.assessmentPurpose === "readiness";
    const plan = readinessProbe
      ? {
          explanationCode: "knowledge_gap" as const,
          expectedEvidence: {
            taskKind: "readiness_probe",
            assessmentPurpose: "readiness",
            dimensions: ["memory", "understanding"],
            prerequisiteEntityId: gap.primaryEntityId,
          },
        }
      : evidencePlanForGap(gap.gapType);
    return [
      {
        reviewCardId: null,
        cognitiveEntityIds: [gap.primaryEntityId, ...supportingEntityIds],
        unitId: unit.id,
        goalId: unit.goalId,
        unitTitle: unit.title,
        goalTitle: unit.goalTitle,
        durationMin: 10,
        nextReviewAt: now,
        status: unit.status,
        prerequisitePriority: Math.max(
          2,
          Math.round(gap.severity * gap.confidence * 4),
        ),
        explanationCode: plan.explanationCode,
        targetState: {
          hypothesisId: gap.id,
          gapType: gap.gapType,
          status: gap.status,
          confidence: gap.confidence,
          severity: gap.severity,
        },
        expectedEvidence: plan.expectedEvidence,
      },
    ];
  });

  const reviews = collectReviewCandidates({
    reviews: [...gapReviewRows, ...spacedReviewRows],
    goalPriorities,
    now,
    windowEnd,
  });

  const newLearning = collectNewLearningCandidates({
    unitsByGoal,
    goalTitles,
    goalPriorities,
    engagementByGoal,
    now,
  });

  const agenda = allocateAgenda({
    planningDate,
    timezone: settings.timezone,
    capacityMinutes: capacity.adjustedMinutes,
    capacityByDate: Object.fromEntries(
      Array.from({ length: 8 }, (_, index) => {
        const date = addDaysToDateKey(planningDate, index);
        const todayOverride =
          index === 0 && settings.todayCapacityOverrideDate === planningDate
            ? settings.todayCapacityOverrideMin
            : null;
        return [date, todayOverride ?? capacity.adjustedMinutes];
      }),
    ),
    capacity,
    reviews,
    newLearning,
    locale,
    now,
  });

  return {
    settings,
    agenda,
    locale,
    previousHash: previous?.contentHash ?? null,
  };
}

export async function refreshAgendaForUser(
  userId: string,
  options: {
    reason?: AgendaRefreshReason;
    forceLlm?: boolean;
    skipLlm?: boolean;
    locale?: ContentLanguageCode;
    client?: unknown;
  } = {},
): Promise<RefreshAgendaResult> {
  const existing = inFlight.get(userId);
  if (existing) return existing;

  const run = (async (): Promise<RefreshAgendaResult> => {
    const reason = options.reason ?? "event";
    const settings = await getOrCreatePlanningSettings(userId);

    if (!settings.enabled && reason !== "manual" && reason !== "settings") {
      return { skipped: true, reason: "paused" };
    }

    const { agenda, previousHash } = await buildDeterministicAgenda({
      userId,
      reason,
      locale: options.locale,
    });

    // Idempotent: not invalidated and same hash for today's plan.
    if (
      !settings.agendaInvalidatedAt &&
      previousHash &&
      previousHash === agenda.contentHash &&
      reason !== "manual"
    ) {
      const active = await refreshReadPersistence().findActiveRevision(
        userId,
        agenda.planningDate,
      );
      if (active) {
        return {
          skipped: true,
          reason: "unchanged",
          revisionId: active.id,
          generationSource: active.generationSource,
          contentHash: active.contentHash,
        };
      }
    }

    const published = await publishAgendaRevision({
      userId,
      agenda,
      // LLM agenda refinement is paused. Keep publishing the deterministic
      // allocation so agenda-backed Continue behavior remains available.
      generationSource: "deterministic",
      reason,
    });

    return {
      skipped: false,
      reason: "published",
      revisionId: published.revisionId,
      generationSource: published.generationSource,
      contentHash: published.contentHash,
      itemCount: published.itemCount,
    };
  })().finally(() => {
    inFlight.delete(userId);
  });

  inFlight.set(userId, run);
  return run;
}

export async function listUsersNeedingAgendaRefresh(
  limit: number,
  _compatibilityClient?: unknown,
): Promise<string[]> {
  const now = new Date();
  const repository = refreshReadPersistence();
  const invalidated = await repository.listInvalidatedUsers(limit);
  const ids = new Set(invalidated.map((row) => row.userId));
  if (ids.size >= limit) return [...ids].slice(0, limit);
  const recentGoalUsers = await repository.listRecentActiveGoalOwners(
    limit * 3,
  );
  for (const userId of recentGoalUsers) {
    if (ids.has(userId)) continue;
    const settings = await getOrCreatePlanningSettings(userId);
    if (!settings.enabled) continue;
    const today = localDateKey(now, settings.timezone);
    const active = await repository.findActiveRevision(userId, today);
    if (!active) ids.add(userId);
    if (ids.size >= limit) break;
  }

  return [...ids].slice(0, limit);
}
