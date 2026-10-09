import { MainlineProvider } from "@/features/learning-mainline/provider";
import { Navigate, Route, Routes } from "react-router-dom";
import { AssistantProvider } from "@/components/agent/assistant-provider";
import { AssistantFab } from "@/components/layout/assistant-fab";
import { FloatingActionStack } from "@/components/layout/floating-action-stack";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { MainWrapper } from "@/components/layout/main-wrapper";
import { ConfirmProvider } from "@/components/ui/confirm-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { OnboardingPage } from "@/pages/onboarding-page";
import { ReviewSessionPage } from "@/pages/review-session-page";
import { TodayPage } from "@/pages/today-page";
import { useLearnerProfile } from "@/hooks/api/use-learner-profile";
import { LearnerRoutes } from "@/shared/routes/learner-routes";
import { defineDesktopRouteOverrides } from "./desktop-route-overrides.ts";
import { LOCAL_CONTROL_SIDEBAR_VIEW } from "./local-control-workspace-subview.tsx";
import { LocalControlLayout } from "./local-control-layout.tsx";
import { LocalApiKeysPage } from "./local-api-keys-page.tsx";
import { LocalLlmLogsPage } from "./local-llm-logs-page.tsx";
import { LocalErrorLogsPage } from "./local-error-logs-page.tsx";
import { LocalTeachingSkillsPage } from "./local-teaching-skills-page.tsx";
import { LocalTokenUsagePage } from "./local-token-usage-page.tsx";
import { LocalMaintenancePage } from "./local-maintenance-page.tsx";
import { LocalResourceSettingsPage } from "./local-resource-settings-page.tsx";
import { isDev } from "@xue-learn/core/dev";
import { DesktopDocumentPreviewProvider } from "@xue-learn/core/components/goals/desktop-document-preview";
import { DesktopPythonEditorProvider } from "@xue-learn/core/components/desktop-python-editor/python-editor-provider";
import { LocalEmbeddingSetupGate } from "./local-embedding-setup-gate.tsx";
import { LocalDataLoadError } from "./local-data-load-error.tsx";
import { PersonalSyncPage } from "./personal-sync-page.tsx";

const LOCAL_SIDEBAR_VIEWS = [LOCAL_CONTROL_SIDEBAR_VIEW] as const;

function Shell() {
  const learnerProfile = useLearnerProfile();
  if (learnerProfile.isPending) {
    return (
      <main className="grid min-h-screen place-items-center text-muted-foreground">
        Opening your private learning space…
      </main>
    );
  }
  if (learnerProfile.isError) {
    return <LocalDataLoadError error={learnerProfile.error} />;
  }

  const onboarded = Boolean(learnerProfile.data?.profile.onboardingCompleted);
  const refreshProfile = async () => {
    await learnerProfile.refetch();
  };

  return (
    <MainlineProvider><WorkspaceShell sidebarViews={LOCAL_SIDEBAR_VIEWS}>
      <MainWrapper>
        <LearnerRoutes
          capabilities={{
            authentication: false,
            billing: false,
            development: false,
            legal: false,
            productUpdates: false,
            publicCatalog: false,
            sharing: false,
          }}
          protect={(element) => element}
          elements={defineDesktopRouteOverrides({
            root: (
              <Navigate to={onboarded ? "/spaces" : "/onboarding"} replace />
            ),
            onboarding: onboarded ? (
              <Navigate to="/spaces" replace />
            ) : (
              <OnboardingPage onProfileSaved={refreshProfile} />
            ),
            today: onboarded ? (
              <TodayPage />
            ) : (
              <Navigate to="/onboarding" replace />
            ),
            "review-session": <ReviewSessionPage />,
          })}
          additionalRoutes={
            <>
              <Route
                path="/local-settings"
                element={<Navigate to="/local/api-keys" replace />}
              />
              <Route path="/local" element={<LocalControlLayout />}>
                <Route index element={<Navigate to="resources" replace />} />
                <Route
                  path="resources"
                  element={<LocalResourceSettingsPage />}
                />
                <Route path="sync" element={<PersonalSyncPage />} />
                <Route
                  path="teaching-skills"
                  element={<LocalTeachingSkillsPage />}
                />
                <Route path="api-keys" element={<LocalApiKeysPage />} />
                <Route path="token-usage" element={<LocalTokenUsagePage />} />
                {isDev() ? (
                  <>
                    <Route path="logs/llm" element={<LocalLlmLogsPage />} />
                    <Route
                      path="maintenance"
                      element={<LocalMaintenancePage />}
                    />
                  </>
                ) : null}
                <Route path="logs/errors" element={<LocalErrorLogsPage />} />
              </Route>
            </>
          }
        />
      </MainWrapper>
    </WorkspaceShell></MainlineProvider>
  );
}

export function DesktopLocalApp() {
  return (
    <Routes>
      <Route
        path="*"
        element={
          <LocalEmbeddingSetupGate>
            <ConfirmProvider>
              <TooltipProvider>
                <DesktopDocumentPreviewProvider>
                  <DesktopPythonEditorProvider>
                    <AssistantProvider>
                      <div className="desktop-local-window min-h-screen min-w-0 bg-background antialiased">
                        <div className="desktop-local-content min-h-0 min-w-0">
                          <Shell />
                        </div>
                        <FloatingActionStack>
                          <AssistantFab />
                        </FloatingActionStack>
                      </div>
                    </AssistantProvider>
                  </DesktopPythonEditorProvider>
                </DesktopDocumentPreviewProvider>
              </TooltipProvider>
            </ConfirmProvider>
          </LocalEmbeddingSetupGate>
        }
      />
    </Routes>
  );
}
