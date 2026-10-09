import { LearningSupplementPage } from "@/features/learning-trajectory/supplement-page";
import { type ReactElement, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { GoalLayout } from "@/components/layout/goal-layout";
import { GoalCreationAssistantOpener } from "@/pages/goal-creation-assistant-opener";
import { GoalCreationPage } from "@/pages/goal-creation-page";
import { GoalDashboardPage } from "@/pages/goal-dashboard-page";
import { GoalFoundationsPage } from "@/pages/goal-foundations-page";
import { GoalModulePage } from "@/pages/goal-module-page";
import { GoalOverviewPage } from "@/pages/goal-overview-page";
import { GoalPlanPage } from "@/pages/goal-plan-page";
import { GoalProjectsPage } from "@/pages/goal-projects-page";
import { ProjectDetailPage } from "@/pages/project-detail-page";
import { LearningSpacePage } from "@/pages/learning-space-page";
import { LearningSpacesPage } from "@/pages/learning-spaces-page";
import { NotFoundPage } from "@/pages/not-found-page";
import { OnboardingPage } from "@/pages/onboarding-page";
import { ReviewsPage } from "@/pages/reviews-page";
import { SettingsPage } from "@/pages/settings-page";
import { UnitPage } from "@/pages/unit-page";
import { UnitDiagnosticPage } from "@/pages/unit-diagnostic-page";
import { AdaptiveAssessmentPage } from "@/pages/adaptive-assessment-page";
import {
  isLearnerRouteEnabled,
  learnerRouteDescriptors,
  type LearnerRouteCapabilities,
  type LearnerRouteDescriptor,
  type LearnerRouteId,
} from "./learner-route-descriptors.ts";

type LearnerRoutesProps = {
  capabilities: LearnerRouteCapabilities;
  protect(element: ReactElement): ReactElement;
  elements?: Partial<Record<LearnerRouteId, ReactElement>>;
  additionalRoutes?: ReactNode;
};

export const sharedLearnerRouteElements: Partial<
  Record<LearnerRouteId, ReactElement>
> = {
  register: <Navigate to="/login" replace />,
  onboarding: <OnboardingPage />,
  "goal-new": <GoalCreationAssistantOpener />,
  "goal-creating": <GoalCreationPage />,
  "goals-alias": <Navigate to="/spaces" replace />,
  spaces: <LearningSpacesPage />,
  "space-unorganized": <LearningSpacePage unorganized />,
  space: <LearningSpacePage />,
  goal: <GoalLayout />,
  "goal-dashboard": <GoalDashboardPage />,
  "goal-overview": <GoalOverviewPage />,
  "goal-plan": <GoalPlanPage />,
  "goal-foundations": <GoalFoundationsPage />,
  // Keep the old URL as a safe deep-link alias, but do not mount the retired
  // Learning Map page in either hosted web or desktop-local.
  "goal-map": <Navigate to=".." relative="path" replace />,
  "goal-projects": <GoalProjectsPage />,
  project: <ProjectDetailPage />,
  unit: <UnitPage />,
  "unit-supplement": <LearningSupplementPage />,
  "unit-diagnostic": <UnitDiagnosticPage />,
  "module-diagnostic": <UnitDiagnosticPage />,
  "unit-assessment": <AdaptiveAssessmentPage />,
  "module-assessment": <AdaptiveAssessmentPage />,
  module: <GoalModulePage />,
  // Hosted keeps /today as a deep-link alias while the page stays retired.
  // Desktop-local mounts TodayPage via defineDesktopRouteOverrides.
  today: <Navigate to="/spaces" replace />,
  "flashcards-alias": <Navigate to="/reviews?tab=flashcards" replace />,
  reviews: <ReviewsPage />,
  "profile-alias": <Navigate to="/settings?tab=profile" replace />,
  settings: <SettingsPage />,
  "not-found": <NotFoundPage />,
  wildcard: <Navigate to="/404" replace />,
};

export function LearnerRoutes({
  capabilities,
  protect,
  elements = {},
  additionalRoutes,
}: LearnerRoutesProps) {
  function renderRoute(route: LearnerRouteDescriptor): ReactNode {
    if (!isLearnerRouteEnabled(route, capabilities)) return null;
    let element = elements[route.id] ?? sharedLearnerRouteElements[route.id];
    if (!element) {
      throw new Error(`No element was supplied for learner route: ${route.id}`);
    }
    if (route.protected) element = protect(element);
    if (route.index) {
      return <Route key={route.id} index element={element} />;
    }
    return (
      <Route key={route.id} path={route.path} element={element}>
        {route.children?.map(renderRoute)}
      </Route>
    );
  }

  return (
    <Routes>
      {learnerRouteDescriptors.map(renderRoute)}
      {additionalRoutes}
    </Routes>
  );
}
