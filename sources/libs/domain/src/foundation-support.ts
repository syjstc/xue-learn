export function normalizeFoundationItems(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

export function parseFoundationGoalItems(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return normalizeFoundationItems(
    (value as { prerequisiteItems?: unknown }).prerequisiteItems,
  );
}

export function buildFoundationGoalTitle(items: string[]): string {
  const normalized = normalizeFoundationItems(items);
  if (normalized.length === 0) return "基础补充";
  if (normalized.length === 1) return `基础补充：${normalized[0]}`;
  return `基础补充：${normalized.slice(0, 2).join("、")}${
    normalized.length > 2 ? `等 ${normalized.length} 项` : ""
  }`;
}

export function excludeFoundationScopeFromPlan<
  T extends {
    prerequisitesAssumed?: string[];
    modules?: Array<{ entryFoundationBriefs?: Array<{ title: string }> }>;
  },
>(plan: T, scopeItems: string[]): T {
  const scope = new Set(normalizeFoundationItems(scopeItems));
  if (scope.size === 0) return plan;
  return {
    ...plan,
    prerequisitesAssumed: (plan.prerequisitesAssumed ?? []).filter(
      (item) => !scope.has(item.trim()),
    ),
    ...(plan.modules
      ? {
          modules: plan.modules.map((module) => ({
            ...module,
            entryFoundationBriefs: (module.entryFoundationBriefs ?? []).filter(
              (brief) => !scope.has(brief.title.trim()),
            ),
          })),
        }
      : {}),
  };
}

export function summarizeFoundationProgress(params: {
  unitStatuses: string[];
  moduleUnlockStatuses: string[];
}) {
  const total =
    params.moduleUnlockStatuses.length || params.unitStatuses.length;
  const completed = params.moduleUnlockStatuses.length
    ? params.moduleUnlockStatuses.filter((status) => status === "completed")
        .length
    : params.unitStatuses.filter((status) => status === "completed").length;
  return {
    completedCount: completed,
    totalCount: total,
    progressPercent: total > 0 ? Math.round((completed / total) * 100) : 0,
  };
}
