import { withExplanation } from "./explanations.js";
import { addDaysToDateKey, dateKeysForWindow, localDateKey } from "./timezone.js";
import {
  AGENDA_WINDOW_DAYS,
  hashAgendaContent,
  type CapacityBreakdown,
  type DeterministicAgenda,
  type ExplanationCode,
  type PlannedAgendaItem,
} from "./types.js";
import type { NewLearningCandidate, ReviewCandidate } from "./candidates.js";

export type AllocateParams = {
  planningDate: string;
  timezone: string;
  capacityMinutes: number;
  capacityByDate?: Record<string, number>;
  capacity: CapacityBreakdown;
  reviews: ReviewCandidate[];
  newLearning: NewLearningCandidate[];
  locale?: string;
  now?: Date;
};

function reviewPlannedDate(
  review: ReviewCandidate,
  planningDate: string,
  timezone: string,
): string {
  const dueKey = localDateKey(review.nextReviewAt, timezone);
  if (dueKey < planningDate) return planningDate; // overdue → today
  return dueKey;
}

/**
 * Allocate one capacity budget per day across the rolling window.
 * Overdue/due reviews first; remaining capacity → new learning.
 * Missed work is rebuilt into current capacity (no unbounded backlog).
 */
export function allocateAgenda(params: AllocateParams): DeterministicAgenda {
  const locale = params.locale ?? "zh-Hans";
  const dayKeys = dateKeysForWindow(params.planningDate, AGENDA_WINDOW_DAYS);
  const capacityByDate = Object.fromEntries(
    dayKeys.map((date) => [
      date,
      params.capacityByDate?.[date] ?? params.capacityMinutes,
    ]),
  );
  const remaining = new Map(
    dayKeys.map((date) => [
      date,
      capacityByDate[date] ?? params.capacityMinutes,
    ]),
  );
  const items: PlannedAgendaItem[] = [];
  const scheduledLearningKeys = new Set<string>();

  let priority = 1000;
  let sortIndex = 0;

  const pushItem = (
    partial: Omit<
      PlannedAgendaItem,
      "priority" | "sortIndex" | "explanation" | "explanationCode"
    > & {
      explanationCode: ExplanationCode;
    },
  ) => {
    const learningKey = partial.sectionId ?? partial.unitId;
    if (
      scheduledLearningKeys.has(learningKey) &&
      partial.itemType === "new_learning"
    ) {
      return false;
    }
    const dayLeft = remaining.get(partial.plannedDate) ?? 0;
    if (dayLeft < partial.estimatedMinutes && dayLeft < 10) return false;
    // Allow last item to slightly exceed if day has some room and item is a review.
    if (
      dayLeft < partial.estimatedMinutes &&
      !(partial.itemType === "review" && dayLeft >= 8)
    ) {
      return false;
    }
    const minutes = Math.min(
      partial.estimatedMinutes,
      Math.max(dayLeft, partial.estimatedMinutes),
    );
    const used = Math.min(minutes, dayLeft || minutes);
    remaining.set(partial.plannedDate, Math.max(0, dayLeft - used));
    const expl = withExplanation(partial.explanationCode, locale);
    items.push({
      ...partial,
      estimatedMinutes: used || partial.estimatedMinutes,
      priority: priority--,
      sortIndex: sortIndex++,
      explanation: expl.explanation,
      explanationCode: expl.explanationCode,
    });
    if (partial.itemType === "new_learning") {
      scheduledLearningKeys.add(learningKey);
    }
    return true;
  };

  // 1) Reviews — prefer due day; overdue on today. Cap reviews by capacity (rebuild, not backlog).
  for (const review of params.reviews) {
    const plannedDate = reviewPlannedDate(
      review,
      params.planningDate,
      params.timezone,
    );
    if (!remaining.has(plannedDate)) continue;
    const code: ExplanationCode =
      review.explanationCode ??
      (review.overdueMs > 0 ? "overdue_review" : "stability_gap");
    // If due day is full, try next days within window (capacity rebalance).
    let placed = pushItem({
      goalId: review.goalId,
      unitId: review.unitId,
      unitTitle: review.unitTitle,
      goalTitle: review.goalTitle,
      itemType: "review",
      plannedDate,
      estimatedMinutes: review.estimatedMinutes,
      explanationCode: code,
      reviewDueAt: review.nextReviewAt.toISOString(),
      reviewCardId: review.reviewCardId,
      cognitiveEntityIds: review.cognitiveEntityIds,
      targetState: review.targetState ?? {},
      expectedEvidence: review.expectedEvidence ?? {},
    });
    if (!placed && plannedDate === params.planningDate) {
      for (const day of dayKeys.slice(1)) {
        placed = pushItem({
          goalId: review.goalId,
          unitId: review.unitId,
          unitTitle: review.unitTitle,
          goalTitle: review.goalTitle,
          itemType: "review",
          plannedDate: day,
          estimatedMinutes: review.estimatedMinutes,
          explanationCode: "capacity_rebalance",
          reviewDueAt: review.nextReviewAt.toISOString(),
          reviewCardId: review.reviewCardId,
          cognitiveEntityIds: review.cognitiveEntityIds,
          targetState: review.targetState ?? {},
          expectedEvidence: review.expectedEvidence ?? {},
        });
        if (placed) break;
      }
    }
  }

  // 2) New learning — fill remaining capacity day by day.
  const learningQueue = [...params.newLearning];
  for (const day of dayKeys) {
    while ((remaining.get(day) ?? 0) >= 5 && learningQueue.length > 0) {
      const next = learningQueue.shift()!;
      if (scheduledLearningKeys.has(next.sectionId ?? next.unitId)) continue;
      let code: ExplanationCode = "next_after_prereqs";
      if (next.inProgress) code = "continue_in_progress";
      else if (next.goalPriority > 0) code = "goal_priority";
      else if (day !== params.planningDate) code = "capacity_rebalance";

      const placed = pushItem({
        goalId: next.goalId,
        unitId: next.unitId,
        unitTitle: next.unitTitle,
        sectionId: next.sectionId,
        sectionTitle: next.sectionTitle,
        goalTitle: next.goalTitle,
        itemType: "new_learning",
        plannedDate: day,
        estimatedMinutes: next.estimatedMinutes,
        explanationCode: code,
        reviewDueAt: null,
        reviewCardId: null,
        targetState: next.targetState ?? {},
        expectedEvidence: next.expectedEvidence ?? {},
      });
      if (!placed) {
        // Try later days for this candidate once; else drop (capacity rebuild, not backlog).
        let later = false;
        for (const laterDay of dayKeys.slice(dayKeys.indexOf(day) + 1)) {
          later = pushItem({
            goalId: next.goalId,
            unitId: next.unitId,
            unitTitle: next.unitTitle,
            sectionId: next.sectionId,
            sectionTitle: next.sectionTitle,
            goalTitle: next.goalTitle,
            itemType: "new_learning",
            plannedDate: laterDay,
            estimatedMinutes: next.estimatedMinutes,
            explanationCode: next.inProgress
              ? "continue_in_progress"
              : "moved_from_missed",
            reviewDueAt: null,
            reviewCardId: null,
            targetState: next.targetState ?? {},
            expectedEvidence: next.expectedEvidence ?? {},
          });
          if (later) break;
        }
        if (!later) {
          // Drop — prevents unbounded backlog.
        }
      }
    }
  }

  // Light multi-goal balance hint on explanations when ≥2 goals appear today.
  const todayGoals = new Set(
    items
      .filter((i) => i.plannedDate === params.planningDate)
      .map((i) => i.goalId),
  );
  if (todayGoals.size >= 2) {
    for (const item of items) {
      if (
        item.plannedDate === params.planningDate &&
        item.itemType === "new_learning" &&
        item.explanationCode === "next_after_prereqs"
      ) {
        const expl = withExplanation("balanced_across_goals", locale);
        item.explanationCode = expl.explanationCode;
        item.explanation = expl.explanation;
      }
    }
  }

  const contentHash = hashAgendaContent({
    planningDate: params.planningDate,
    capacityMinutes: params.capacityMinutes,
    capacityByDate,
    items,
  });

  return {
    planningDate: params.planningDate,
    timezone: params.timezone,
    capacityMinutes: params.capacityMinutes,
    capacityByDate,
    capacity: params.capacity,
    items,
    contentHash,
  };
}

/** Exported for tests: ensure window length helpers stay aligned. */
export function agendaWindowEndDateKey(planningDate: string): string {
  return addDaysToDateKey(planningDate, AGENDA_WINDOW_DAYS - 1);
}
