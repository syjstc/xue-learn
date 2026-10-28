import { isUnitJourneyResolved, parsePrereqs } from "../../../domain/src/index.js";
import { shouldRestoreCompletedStatus } from "../domain/restore-unit-completion.js";
import type { ExplanationCode } from "./types.js";

export type UnitCandidateRow = {
  id: string;
  goalId: string;
  title: string;
  status: string;
  unitKind: string;
  parentUnitId: string | null;
  orderIndex: number;
  prerequisites: string;
  completedAt?: Date | string | null;
  completionMethod?: string | null;
  module?: {
    unlockStatus: string;
  } | null;
  remediationSourceUnitId?: string | null;
  supportKind?: string | null;
  sections?: Array<{
    id: string;
    title: string;
    orderIndex: number;
    baseEstimatedMinutes: number;
    progress: Array<{
      status: string;
      activeSeconds: number;
      completedAt: Date | null;
    }>;
  }>;
};

export type ReviewCandidateRow = {
  reviewCardId: string | null;
  cognitiveEntityIds: string[];
  unitId: string;
  goalId: string;
  unitTitle: string;
  goalTitle: string;
  durationMin: number;
  nextReviewAt: Date;
  status: string;
  prerequisitePriority?: number;
  explanationCode?: ExplanationCode;
  targetState?: Record<string, unknown>;
  expectedEvidence?: Record<string, unknown>;
};

export type NewLearningCandidate = {
  unitId: string;
  sectionId: string | null;
  sectionTitle: string | null;
  goalId: string;
  unitTitle: string;
  goalTitle: string;
  estimatedMinutes: number;
  status: string;
  inProgress: boolean;
  mapOrder: number;
  goalPriority: number;
  recentEngagementScore: number;
  remediation: boolean;
  targetState?: Record<string, unknown>;
  expectedEvidence?: Record<string, unknown>;
};

export type ReviewCandidate = {
  reviewCardId: string | null;
  cognitiveEntityIds: string[];
  unitId: string;
  goalId: string;
  unitTitle: string;
  goalTitle: string;
  estimatedMinutes: number;
  nextReviewAt: Date;
  overdueMs: number;
  goalPriority: number;
  prerequisitePriority: number;
  explanationCode?: ExplanationCode;
  targetState?: Record<string, unknown>;
  expectedEvidence?: Record<string, unknown>;
};

function orderedLessons(units: UnitCandidateRow[]): UnitCandidateRow[] {
  const children = new Map<string | null, UnitCandidateRow[]>();
  for (const unit of units) {
    const siblings = children.get(unit.parentUnitId) ?? [];
    siblings.push(unit);
    children.set(unit.parentUnitId, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((a, b) => a.orderIndex - b.orderIndex);
  }
  const lessons: UnitCandidateRow[] = [];
  const walk = (parentId: string | null) => {
    for (const unit of children.get(parentId) ?? []) {
      if (unit.unitKind === "lesson") lessons.push(unit);
      walk(unit.id);
    }
  };
  walk(null);
  return lessons;
}

function hasDurableCompletion(unit: UnitCandidateRow): boolean {
  return shouldRestoreCompletedStatus({
    status: unit.status,
    completedAt: unit.completedAt,
    completionMethod: unit.completionMethod,
  });
}

function isNewLearningEligible(unit: UnitCandidateRow): boolean {
  if (isUnitJourneyResolved(unit.status)) return false;
  if (hasDurableCompletion(unit)) return false;
  if (unit.module?.unlockStatus === "locked") return false;
  return unit.status === "available" || unit.status === "in_progress";
}

export function collectNewLearningCandidates(params: {
  unitsByGoal: Map<string, UnitCandidateRow[]>;
  goalTitles: Map<string, string>;
  goalPriorities: Map<string, number>;
  engagementByGoal: Map<string, number>;
  now?: Date;
}): NewLearningCandidate[] {
  const out: NewLearningCandidate[] = [];
  const sampleCutoff = new Date(
    (params.now ?? new Date()).getTime() - 14 * 24 * 60 * 60_000,
  );
  const ratios = [...params.unitsByGoal.values()]
    .flatMap((units) => units)
    .flatMap((unit) => unit.sections ?? [])
    .flatMap((section) =>
      section.progress
        .filter(
          (progress) =>
            progress.status === "completed" &&
            progress.completedAt != null &&
            progress.completedAt >= sampleCutoff &&
            progress.activeSeconds > 0,
        )
        .map((progress) =>
          Math.max(
            0.75,
            Math.min(
              1.5,
              progress.activeSeconds / 60 / section.baseEstimatedMinutes,
            ),
          ),
        ),
    )
    .sort((a, b) => a - b);
  const effortRatio =
    ratios.length < 3
      ? 1
      : ratios.length % 2 === 1
        ? ratios[Math.floor(ratios.length / 2)]!
        : (ratios[ratios.length / 2 - 1]! + ratios[ratios.length / 2]!) / 2;
  for (const [goalId, units] of params.unitsByGoal) {
    const lessons = orderedLessons(units);
    const byId = new Map(units.map((u) => [u.id, u]));
    const done = new Set(
      lessons
        .filter(
          (unit) =>
            isUnitJourneyResolved(unit.status) || hasDurableCompletion(unit),
        )
        .map((u) => u.id),
    );

    lessons.forEach((lesson, mapOrder) => {
      if (!isNewLearningEligible(lesson)) return;
      const prereqs = parsePrereqs(lesson.prerequisites).filter((id) =>
        byId.has(id),
      );
      if (!prereqs.every((id) => done.has(id))) return;

      const unfinishedSections = (lesson.sections ?? [])
        .filter((section) => {
          const status = section.progress[0]?.status;
          return status !== "completed" && status !== "skipped";
        })
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .slice(0, 1);
      const slices =
        unfinishedSections.length > 0 ? unfinishedSections : [null];
      slices.forEach((section, sectionIndex) =>
        out.push({
          unitId: lesson.id,
          sectionId: section?.id ?? null,
          sectionTitle: section?.title ?? null,
          goalId,
          unitTitle: lesson.title,
          goalTitle: params.goalTitles.get(goalId) ?? "",
          estimatedMinutes: section
            ? Math.max(
                5,
                Math.min(
                  10,
                  Math.round(section.baseEstimatedMinutes * effortRatio),
                ),
              )
            : 10,
          status: lesson.status,
          inProgress:
            lesson.status === "in_progress" ||
            section?.progress[0]?.status === "in_progress",
          mapOrder: mapOrder * 10 + sectionIndex,
          goalPriority: params.goalPriorities.get(goalId) ?? 0,
          recentEngagementScore: params.engagementByGoal.get(goalId) ?? 0,
          remediation:
            Boolean(lesson.remediationSourceUnitId) ||
            lesson.supportKind === "prerequisite_bridge",
          targetState: {
            source: section ? "section_progress" : "curriculum_progress",
            unitStatus: lesson.status,
            ...(section ? { sectionId: section.id } : {}),
            ...(ratios.length >= 3
              ? { effortCalibrationRatio: Number(effortRatio.toFixed(2)) }
              : {}),
          },
          expectedEvidence: {
            taskKind: "declared_unit_tasks",
            dimensions: ["memory", "understanding", "application"],
            note: "reading_and_section_completion_are_exposure_only",
          },
        }),
      );
    });
  }

  out.sort((a, b) => {
    if (a.remediation !== b.remediation) return a.remediation ? -1 : 1;
    if (a.inProgress !== b.inProgress) return a.inProgress ? -1 : 1;
    if (b.goalPriority !== a.goalPriority)
      return b.goalPriority - a.goalPriority;
    if (b.recentEngagementScore !== a.recentEngagementScore) {
      return b.recentEngagementScore - a.recentEngagementScore;
    }
    if (a.goalId !== b.goalId) return a.goalId.localeCompare(b.goalId);
    return a.mapOrder - b.mapOrder;
  });
  const queues = new Map<string, NewLearningCandidate[]>();
  for (const candidate of out) {
    const queue = queues.get(candidate.goalId) ?? [];
    queue.push(candidate);
    queues.set(candidate.goalId, queue);
  }
  const goalOrder = [...queues.keys()].sort((left, right) => {
    const a = queues.get(left)![0]!;
    const b = queues.get(right)![0]!;
    if (a.remediation !== b.remediation) return a.remediation ? -1 : 1;
    if (b.goalPriority !== a.goalPriority)
      return b.goalPriority - a.goalPriority;
    if (b.recentEngagementScore !== a.recentEngagementScore) {
      return b.recentEngagementScore - a.recentEngagementScore;
    }
    return left.localeCompare(right);
  });
  const balanced: NewLearningCandidate[] = [];
  while (goalOrder.some((goalId) => (queues.get(goalId)?.length ?? 0) > 0)) {
    for (const goalId of goalOrder) {
      const next = queues.get(goalId)?.shift();
      if (next) balanced.push(next);
    }
  }
  return balanced;
}

export function collectReviewCandidates(params: {
  reviews: ReviewCandidateRow[];
  goalPriorities: Map<string, number>;
  now: Date;
  windowEnd: Date;
}): ReviewCandidate[] {
  // A review session is unit-scoped, while durable cognitive state is
  // entity-and-dimension-scoped. Several due learning targets can therefore map to
  // the same review route. Coalesce them here so the planner never presents the
  // learner with multiple copies of the same unit review.
  const byUnit = new Map<string, ReviewCandidate>();
  for (const review of params.reviews) {
    if (review.nextReviewAt > params.windowEnd) continue;
    const candidate: ReviewCandidate = {
      reviewCardId: review.reviewCardId,
      cognitiveEntityIds: review.cognitiveEntityIds,
      unitId: review.unitId,
      goalId: review.goalId,
      unitTitle: review.unitTitle,
      goalTitle: review.goalTitle,
      estimatedMinutes: Math.min(
        20,
        Math.max(10, Math.round(review.durationMin * 0.5) || 15),
      ),
      nextReviewAt: review.nextReviewAt,
      overdueMs: Math.max(
        0,
        params.now.getTime() - review.nextReviewAt.getTime(),
      ),
      goalPriority: params.goalPriorities.get(review.goalId) ?? 0,
      prerequisitePriority: review.prerequisitePriority ?? 0,
      explanationCode: review.explanationCode,
      targetState: review.targetState ?? {},
      expectedEvidence: review.expectedEvidence ?? {},
    };
    const existing = byUnit.get(review.unitId);
    if (!existing) {
      byUnit.set(review.unitId, candidate);
      continue;
    }

    const candidateIsEarlier =
      candidate.nextReviewAt.getTime() < existing.nextReviewAt.getTime();
    byUnit.set(review.unitId, {
      ...existing,
      ...(candidateIsEarlier
        ? {
            reviewCardId: candidate.reviewCardId,
            nextReviewAt: candidate.nextReviewAt,
          }
        : {}),
      cognitiveEntityIds: [
        ...new Set([
          ...existing.cognitiveEntityIds,
          ...candidate.cognitiveEntityIds,
        ]),
      ],
      estimatedMinutes: Math.max(
        existing.estimatedMinutes,
        candidate.estimatedMinutes,
      ),
      overdueMs: Math.max(existing.overdueMs, candidate.overdueMs),
      goalPriority: Math.max(existing.goalPriority, candidate.goalPriority),
      prerequisitePriority: Math.max(
        existing.prerequisitePriority,
        candidate.prerequisitePriority,
      ),
      explanationCode: existing.explanationCode ?? candidate.explanationCode,
      targetState:
        candidate.prerequisitePriority > existing.prerequisitePriority
          ? (candidate.targetState ?? {})
          : (existing.targetState ?? {}),
      expectedEvidence:
        candidate.prerequisitePriority > existing.prerequisitePriority
          ? (candidate.expectedEvidence ?? {})
          : (existing.expectedEvidence ?? {}),
    });
  }
  const out = [...byUnit.values()];
  out.sort((a, b) => {
    if (b.prerequisitePriority !== a.prerequisitePriority) {
      return b.prerequisitePriority - a.prerequisitePriority;
    }
    if (b.overdueMs !== a.overdueMs) return b.overdueMs - a.overdueMs;
    if (a.nextReviewAt.getTime() !== b.nextReviewAt.getTime()) {
      return a.nextReviewAt.getTime() - b.nextReviewAt.getTime();
    }
    return b.goalPriority - a.goalPriority;
  });
  return out;
}
