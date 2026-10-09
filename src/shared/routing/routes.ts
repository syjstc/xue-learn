import type { AgentPageContext, AgentPageKind } from "@/shared/agent/types";
import type { TranslationKey } from "@xue-learn/core/source/src/shared/i18n/index.tsx";

export function isPublicCoursePath(pathname: string): boolean {
  return pathname === "/explore" || /^\/courses\/[^/]+/.test(pathname);
}

export function isGoalContext(pathname: string): boolean {
  return /^\/goals\/(?!new(?:\/|$))[^/]+/.test(pathname);
}

export function isCourseRelatedPath(pathname: string): boolean {
  if (pathname === "/") return false;
  if (pathname === "/settings") return false;
  if (pathname.startsWith("/dev/")) return false;
  return pathname.startsWith("/goals") || pathname.startsWith("/reviews");
}

export function getGoalIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/goals\/([^/]+)/);
  return match?.[1] ?? null;
}

export function getUnitIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/goals\/[^/]+\/units\/([^/]+)$/);
  return match?.[1] ?? null;
}

function getPageKind(pathname: string): AgentPageKind {
  if (pathname === "/") return "home";
  if (pathname === "/goals/new") return "onboarding";
  if (pathname === "/goals") return "goals";
  if (pathname === "/spaces") return "spaces";
  if (pathname.startsWith("/spaces/")) return "space_dashboard";
  if (pathname === "/today") return "today";
  if (pathname === "/reviews") return "reviews";
  if (pathname === "/profile") return "settings";
  if (pathname === "/settings") return "settings";
  if (pathname.startsWith("/dev/")) return "dev";
  if (
    /^\/goals\/[^/]+\/units\/[^/]+(?:\/(?:lesson-performance|supplements\/[^/]+))?\/?$/.test(
      pathname,
    )
  )
    return "unit";
  // Legacy map deep links are redirected by the shared route tree; classify
  // them as the current goal dashboard during the transition.
  if (/^\/goals\/[^/]+\/map(?:\/|$)/.test(pathname)) {
    return "goal_dashboard";
  }
  if (/^\/goals\/[^/]+\/plan$/.test(pathname)) return "goal_plan";
  if (/^\/goals\/[^/]+$/.test(pathname)) return "goal_dashboard";
  return "unknown";
}

function getPageContextLabel(kind: AgentPageKind): string {
  const labels: Record<AgentPageKind, string> = {
    home: "学习首页",
    onboarding: "目标创建",
    goals: "我的学习目标",
    spaces: "学习空间",
    space_dashboard: "学习空间概览",
    today: "今日计划",
    goal_dashboard: "目标概览",
    goal_plan: "学习计划",
    unit: "当前学习单元",
    reviews: "复习安排",
    profile: "个人资料",
    settings: "设置",
    dev: "开发页面",
    unknown: "当前页面",
  };
  return labels[kind];
}

const PAGE_CONTEXT_LABEL_KEYS: Record<AgentPageKind, TranslationKey> = {
  home: "assistant.context.home",
  onboarding: "assistant.context.onboarding",
  goals: "assistant.context.goals",
  spaces: "assistant.context.goals",
  space_dashboard: "assistant.context.goals",
  today: "assistant.context.today",
  goal_dashboard: "assistant.context.goalDashboard",
  goal_plan: "assistant.context.goalPlan",
  unit: "assistant.context.unit",
  reviews: "assistant.context.reviews",
  profile: "assistant.context.profile",
  settings: "assistant.context.settings",
  dev: "assistant.context.dev",
  unknown: "assistant.context.unknown",
};

export function getPageContextLabelKey(kind: AgentPageKind): TranslationKey {
  return PAGE_CONTEXT_LABEL_KEYS[kind];
}

export function getAgentPageContext(
  pathname: string,
  search = "",
): AgentPageContext {
  const goalId = getGoalIdFromPath(pathname) ?? undefined;
  const rawSpaceId = pathname.match(/^\/spaces\/([^/]+)/)?.[1];
  const spaceId =
    rawSpaceId && rawSpaceId !== "unorganized" ? rawSpaceId : undefined;
  const unitMatch = pathname.match(
    /^\/goals\/[^/]+\/units\/([^/]+)(?:\/(?:lesson-performance|supplements\/[^/]+))?\/?$/,
  );
  const params = new URLSearchParams(search);
  const focusUnitId = params.get("focus") ?? undefined;

  const pageKind = getPageKind(pathname);
  return {
    pathname,
    search: search || undefined,
    pageKind,
    contextLabel: getPageContextLabel(pageKind),
    goalId,
    spaceId,
    unitId: unitMatch?.[1],
    focusUnitId,
  };
}
