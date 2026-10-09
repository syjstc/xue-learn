export type LearnerRouteCapability =
  | "authentication"
  | "billing"
  | "development"
  | "legal"
  | "productUpdates"
  | "publicCatalog"
  | "sharing";

export type LearnerRouteId =
  | "root"
  | "login"
  | "register"
  | "privacy"
  | "terms"
  | "dev-scenario-theater"
  | "onboarding"
  | "goal-new"
  | "goal-creating"
  | "goals-alias"
  | "spaces"
  | "space-unorganized"
  | "space"
  | "public-course"
  | "explore"
  | "shared-goal"
  | "goal"
  | "goal-dashboard"
  | "goal-overview"
  | "goal-map"
  | "goal-plan"
  | "goal-foundations"
  | "goal-projects"
  | "project"
  | "unit"
  | "unit-supplement"
  | "unit-diagnostic"
  | "module"
  | "module-diagnostic"
  | "module-assessment"
  | "unit-assessment"
  | "today"
  | "flashcards-alias"
  | "reviews"
  | "review-session"
  | "profile-alias"
  | "settings"
  | "credits"
  | "updates"
  | "not-found"
  | "wildcard";

export type LearnerRouteDescriptor = {
  id: LearnerRouteId;
  path?: string;
  index?: true;
  capability?: LearnerRouteCapability;
  redirectTo?: string;
  protected?: true;
  children?: readonly LearnerRouteDescriptor[];
};

export type LearnerRouteCapabilities = Readonly<
  Record<LearnerRouteCapability, boolean>
>;

const goalChildren = [
  { id: "goal-dashboard", index: true },
  { id: "goal-overview", path: "overview" },
  { id: "goal-map", path: "map" },
  { id: "goal-plan", path: "plan" },
  { id: "goal-foundations", path: "foundations" },
  { id: "goal-projects", path: "projects" },
  { id: "project", path: "projects/:projectId" },
  { id: "unit", path: "units/:unitId" },
  { id: "unit-supplement", path: "units/:unitId/supplements/:branchId" },
  { id: "unit-diagnostic", path: "units/:unitId/diagnostic" },
  { id: "module", path: "modules/:moduleId" },
  { id: "module-diagnostic", path: "modules/:moduleId/diagnostic" },
  { id: "module-assessment", path: "modules/:moduleId/assessment" },
  { id: "unit-assessment", path: "units/:unitId/assessment" },
] as const satisfies readonly LearnerRouteDescriptor[];

/** The canonical learner URL tree shared by hosted web and desktop-local. */
export const learnerRouteDescriptors = [
  { id: "root", path: "/" },
  { id: "login", path: "/login", capability: "authentication" },
  { id: "register", path: "/register", capability: "authentication" },
  { id: "privacy", path: "/privacy", capability: "legal" },
  { id: "terms", path: "/terms", capability: "legal" },
  {
    id: "dev-scenario-theater",
    path: "/dev/scenario-theater",
    capability: "development",
  },
  { id: "onboarding", path: "/onboarding", protected: true },
  { id: "goal-new", path: "/goals/new", protected: true },
  { id: "goal-creating", path: "/goals/creating", protected: true },
  {
    id: "goals-alias",
    path: "/goals",
    redirectTo: "/spaces",
    protected: true,
  },
  { id: "spaces", path: "/spaces", protected: true },
  {
    id: "space-unorganized",
    path: "/spaces/unorganized",
    protected: true,
  },
  { id: "space", path: "/spaces/:spaceId", protected: true },
  {
    id: "public-course",
    path: "/courses/:shareId",
    capability: "publicCatalog",
  },
  { id: "explore", path: "/explore", capability: "publicCatalog" },
  {
    id: "shared-goal",
    path: "/goals/shared/:shareId",
    capability: "sharing",
    protected: true,
  },
  {
    id: "goal",
    path: "/goals/:goalId",
    protected: true,
    children: goalChildren,
  },
  { id: "today", path: "/today", protected: true },
  {
    id: "flashcards-alias",
    path: "/flashcards",
    redirectTo: "/reviews?tab=flashcards",
    protected: true,
  },
  { id: "reviews", path: "/reviews", protected: true },
  {
    id: "review-session",
    path: "/reviews/:goalId/:unitId",
    protected: true,
  },
  {
    id: "profile-alias",
    path: "/profile",
    redirectTo: "/settings?tab=profile",
    protected: true,
  },
  { id: "settings", path: "/settings", protected: true },
  { id: "credits", path: "/credits", capability: "billing", protected: true },
  {
    id: "updates",
    path: "/updates",
    capability: "productUpdates",
    protected: true,
  },
  { id: "not-found", path: "/404" },
  { id: "wildcard", path: "*", redirectTo: "/404" },
] as const satisfies readonly LearnerRouteDescriptor[];

export function isLearnerRouteEnabled(
  route: LearnerRouteDescriptor,
  capabilities: LearnerRouteCapabilities,
) {
  return route.capability == null || capabilities[route.capability];
}

export function flattenLearnerRouteDescriptors(
  capabilities: LearnerRouteCapabilities,
): Array<{ id: LearnerRouteId; path: string; redirectTo?: string }> {
  const result: Array<{
    id: LearnerRouteId;
    path: string;
    redirectTo?: string;
  }> = [];
  function visit(routes: readonly LearnerRouteDescriptor[], parentPath = "") {
    for (const route of routes) {
      if (!isLearnerRouteEnabled(route, capabilities)) continue;
      const path = route.index
        ? parentPath
        : route.path?.startsWith("/") || route.path === "*"
          ? route.path
          : `${parentPath}/${route.path ?? ""}`.replace(/\/+/g, "/");
      if (path != null) {
        result.push({
          id: route.id,
          path,
          ...(route.redirectTo ? { redirectTo: route.redirectTo } : {}),
        });
      }
      if (route.children) visit(route.children, path ?? parentPath);
    }
  }
  visit(learnerRouteDescriptors);
  return result;
}
