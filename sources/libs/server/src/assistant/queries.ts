import type { AgentConversationRepository } from "../../../domain/src/index.js";

let configured: AgentConversationRepository | undefined;

export function configureAssistantQueryPersistence(
  repository: AgentConversationRepository | undefined,
): void {
  configured = repository;
}

function persistence(): AgentConversationRepository {
  if (!configured)
    throw new Error("Assistant-query persistence is not configured");
  return configured;
}

export type SearchGoalsInput = {
  since?: string;
  until?: string;
  dateField?: "updated" | "created";
  status?: "active" | "all";
  query?: string;
  limit?: number;
};

export type RecentActivityInput = {
  limit?: number;
};

export type SearchUnitsInput = {
  query?: string;
  goalId?: string;
  goalQuery?: string;
  status?:
    | "all"
    | "available"
    | "in_progress"
    | "completed"
    | "completed_needs_reinforcement";
  limit?: number;
};

function parseIsoDate(
  value: string | undefined,
  label: string,
): Date | undefined {
  if (!value?.trim()) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`无效的 ${label} 时间：${value}`);
  }
  return date;
}

function clampLimit(limit: number | undefined, fallback = 10, max = 50) {
  if (!limit || limit < 1) return fallback;
  return Math.min(limit, max);
}

export async function searchGoals(
  userId: string,
  input: SearchGoalsInput,
  _compatibilityClient?: unknown,
) {
  const since = parseIsoDate(input.since, "since");
  const until = parseIsoDate(input.until, "until");
  const dateField = input.dateField === "created" ? "createdAt" : "updatedAt";
  const limit = clampLimit(input.limit, 20);

  const goals = await persistence().searchOwnedGoals({
    userId,
    since: since ?? null,
    until: until ?? null,
    dateField,
    includeInactive: input.status === "all",
    query: input.query?.trim() || null,
    limit,
  });

  return {
    dateField,
    count: goals.length,
    goals: goals.map((g) => ({
      id: g.id,
      title: g.title,
      status: g.status,
      createdAt: g.createdAt.toISOString(),
      updatedAt: g.updatedAt.toISOString(),
      unitCount: g.unitCount,
      completedCount: g.completedCount,
    })),
  };
}

export async function getRecentActivity(
  userId: string,
  input: RecentActivityInput = {},
  _compatibilityClient?: unknown,
) {
  const limit = clampLimit(input.limit, 8);

  const activity = await persistence().listOwnedRecentActivity(userId, limit);

  return {
    goals: activity.goals.map((g) => ({
      id: g.id,
      title: g.title,
      status: g.status,
      lastTouchedAt: g.updatedAt.toISOString(),
      kind: "goal" as const,
    })),
    units: activity.units.map((unit) => ({
      id: unit.id,
      title: unit.title,
      status: unit.status,
      goalId: unit.goalId,
      goalTitle: unit.goalTitle,
      currentStep: unit.currentStep,
      structuredSubStep: unit.structuredSubStep,
      lastTouchedAt: unit.updatedAt.toISOString(),
      kind: "unit" as const,
    })),
  };
}

export async function searchUnits(
  userId: string,
  input: SearchUnitsInput,
  _compatibilityClient?: unknown,
) {
  const limit = clampLimit(input.limit, 10);
  const titleQuery = input.query?.trim();

  const units = await persistence().searchOwnedUnits({
    userId,
    query: titleQuery || null,
    goalId: input.goalId?.trim() || null,
    goalQuery: input.goalQuery?.trim() || null,
    status: input.status ?? null,
    limit,
  });

  return {
    count: units.length,
    units: units.map((u) => ({
      id: u.id,
      title: u.title,
      status: u.status,
      unitKind: u.unitKind,
      orderIndex: u.orderIndex,
      goalId: u.goalId,
      goalTitle: u.goalTitle,
      currentStep: u.currentStep,
      path: `/goals/${u.goalId}/units/${u.id}`,
    })),
  };
}
