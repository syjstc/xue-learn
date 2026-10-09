import type { LearningGoalRepository } from "../../../domain/src/index.js";

export type UnitLearningTimeState = {
  totalActiveSeconds: number;
  lastTickAt?: string;
  byTab?: Record<string, number>;
};

/** Max seconds accepted per client heartbeat (30s interval + network slack). */
export const MAX_LEARNING_TIME_DELTA_SECONDS = 90;

export function parseUnitLearningTime(graphState: {
  learningTime?: UnitLearningTimeState;
}): UnitLearningTimeState {
  const raw = graphState.learningTime;
  const byTab: Record<string, number> = {};
  if (raw?.byTab && typeof raw.byTab === "object") {
    for (const [key, value] of Object.entries(raw.byTab)) {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        byTab[key] = Math.floor(value);
      }
    }
  }
  return {
    totalActiveSeconds: Math.max(0, Math.floor(raw?.totalActiveSeconds ?? 0)),
    lastTickAt:
      typeof raw?.lastTickAt === "string" ? raw.lastTickAt : undefined,
    byTab,
  };
}

export function sumUnitLearningSeconds(
  units: Array<{
    sessionState?: {
      graphState?: string;
      cumulativeActiveSeconds?: number;
    } | null;
  }>,
  parseGraphState: (raw: string) => { learningTime?: UnitLearningTimeState },
): number {
  let total = 0;
  for (const unit of units) {
    if (
      typeof unit.sessionState?.cumulativeActiveSeconds === "number" &&
      Number.isFinite(unit.sessionState.cumulativeActiveSeconds)
    ) {
      total += Math.max(
        0,
        Math.floor(unit.sessionState.cumulativeActiveSeconds),
      );
      continue;
    }
    const raw = unit.sessionState?.graphState;
    if (!raw) continue;
    total += parseUnitLearningTime(parseGraphState(raw)).totalActiveSeconds;
  }
  return total;
}

/** Aggregate per-goal learning seconds without loading full graphState blobs. */
export async function getTotalLearningSecondsByGoalIds(
  goalIds: string[],
  repository: Pick<LearningGoalRepository, "sumLearningSecondsByGoalIds">,
): Promise<Map<string, number>> {
  return new Map(await repository.sumLearningSecondsByGoalIds(goalIds));
}

export function accumulateUnitLearningTime(
  current: UnitLearningTimeState,
  deltaSeconds: number,
  options: {
    tab?: string;
    now?: Date;
  } = {},
): {
  next: UnitLearningTimeState;
  acceptedSeconds: number;
} {
  const now = options.now ?? new Date();
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
    return {
      next: current,
      acceptedSeconds: 0,
    };
  }

  let accepted = Math.min(
    Math.floor(deltaSeconds),
    MAX_LEARNING_TIME_DELTA_SECONDS,
  );

  if (current.lastTickAt) {
    const wallSeconds = Math.floor(
      (now.getTime() - new Date(current.lastTickAt).getTime()) / 1000,
    );
    if (wallSeconds >= 0) {
      accepted = Math.min(accepted, wallSeconds + 5);
    }
  }

  if (accepted <= 0) {
    return {
      next: current,
      acceptedSeconds: 0,
    };
  }

  const prevTotal = current.totalActiveSeconds;
  const nextTotal = prevTotal + accepted;
  const byTab = { ...current.byTab };
  const tab = options.tab?.trim();
  if (tab) {
    byTab[tab] = (byTab[tab] ?? 0) + accepted;
  }

  return {
    next: {
      totalActiveSeconds: nextTotal,
      lastTickAt: now.toISOString(),
      byTab,
    },
    acceptedSeconds: accepted,
  };
}

export function formatLearningDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  if (total < 60) return `${total}秒`;
  const minutes = Math.floor(total / 60);
  const rem = total % 60;
  if (minutes < 60) {
    return rem > 0 ? `${minutes}分${rem}秒` : `${minutes}分钟`;
  }
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return remMin > 0 ? `${hours}小时${remMin}分钟` : `${hours}小时`;
}
