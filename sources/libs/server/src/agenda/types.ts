import { createHash } from "node:crypto";

export const AGENDA_WINDOW_DAYS = 8; // today + next 7
export const DEFAULT_TIMEZONE = "Asia/Shanghai";
export const DEFAULT_REMINDER_HOUR = 19;
export const DEFAULT_REMINDER_MINUTE = 0;
export const DEFAULT_UNIT_MINUTES = 20;
export const MIN_DAILY_CAPACITY = 15;
export const MAX_DAILY_CAPACITY = 180;
/** Max relative swing vs previous capacity (or stated target). */
export const CAPACITY_CLAMP_RATIO = 0.35;

export type AgendaItemType = "new_learning" | "review";
export type AgendaGenerationSource = "deterministic" | "llm_refined";
export type AgendaRevisionStatus = "draft" | "active" | "superseded";
export type AgendaRefreshReason =
  | "daily"
  | "manual"
  | "settings"
  | "unit_completed"
  | "review_completed"
  | "goal_changed"
  | "event";

export type ExplanationCode =
  | "overdue_review"
  | "due_review"
  | "knowledge_gap"
  | "composition_gap"
  | "transfer_gap"
  | "stability_gap"
  | "continue_in_progress"
  | "next_after_prereqs"
  | "goal_priority"
  | "capacity_rebalance"
  | "moved_from_missed"
  | "balanced_across_goals";

export type PlannedAgendaItem = {
  goalId: string;
  unitId: string;
  unitTitle: string;
  sectionId?: string | null;
  sectionTitle?: string | null;
  goalTitle: string;
  itemType: AgendaItemType;
  plannedDate: string;
  estimatedMinutes: number;
  priority: number;
  explanation: string;
  explanationCode: ExplanationCode;
  reviewDueAt?: string | null;
  reviewCardId?: string | null;
  cognitiveEntityIds?: string[];
  targetState?: Record<string, unknown>;
  expectedEvidence?: Record<string, unknown>;
  sortIndex: number;
};

export type CapacityBreakdown = {
  statedTargetMinutes: number;
  overrideMinutes: number | null;
  observedAvgSessionMinutes: number | null;
  observedDailyActiveMinutes: number | null;
  adjustedMinutes: number;
  clampedFrom: number | null;
};

export type DeterministicAgenda = {
  planningDate: string;
  timezone: string;
  capacityMinutes: number;
  capacityByDate: Record<string, number>;
  capacity: CapacityBreakdown;
  items: PlannedAgendaItem[];
  contentHash: string;
};

export function hashAgendaContent(input: {
  planningDate: string;
  capacityMinutes: number;
  capacityByDate?: Record<string, number>;
  items: Array<{
    goalId: string;
    unitId: string;
    sectionId?: string | null;
    itemType: string;
    plannedDate: string;
    estimatedMinutes: number;
    priority: number;
  }>;
}): string {
  const normalized = {
    planningDate: input.planningDate,
    capacityMinutes: input.capacityMinutes,
    capacityByDate: input.capacityByDate ?? {},
    items: [...input.items]
      .map((item) => ({
        goalId: item.goalId,
        unitId: item.unitId,
        sectionId: item.sectionId ?? null,
        itemType: item.itemType,
        plannedDate: item.plannedDate,
        estimatedMinutes: item.estimatedMinutes,
        priority: item.priority,
      }))
      .sort((a, b) =>
        `${a.plannedDate}:${a.itemType}:${a.unitId}`.localeCompare(
          `${b.plannedDate}:${b.itemType}:${b.unitId}`,
        ),
      ),
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}
