import {Component, useCallback, useEffect, useRef, useState, type ReactNode} from 'react';
import {MemoryRouter, Navigate, useLocation} from 'react-router-dom';
import {QueryClientProvider} from '@tanstack/react-query';
import {I18nProvider} from '@xue-learn/core/i18n';
import {DisplayWorkspaceProvider} from '@xue-learn/core/display/workspace';
import {DesktopDocumentPreviewProvider} from '@xue-learn/core/components/goals/desktop-document-preview';
import {AssistantProvider} from '../../../desktop/src/components/agent/assistant-provider';
import {AssistantFab} from '../../../desktop/src/components/layout/assistant-fab';
import {FloatingActionStack} from '../../../desktop/src/components/layout/floating-action-stack';
import {WorkspaceShell} from '../../../desktop/src/components/layout/workspace-shell';
import {GoalWorkspaceSubview} from '../../../desktop/src/components/layout/goal-workspace-subview';
import type {WorkspaceSidebarViewRegistration} from '../../../desktop/src/components/layout/workspace-sidebar-view-registry';
import {MainWrapper} from '../../../desktop/src/components/layout/main-wrapper';
import {ConfirmProvider} from '../../../desktop/src/components/ui/confirm-provider';
import {TooltipProvider} from '../../../desktop/src/components/ui/tooltip';
import {MainlineProvider} from '../../../desktop/src/features/learning-mainline/provider';
import {LearnerRoutes} from '../../../desktop/src/shared/routes/learner-routes';
import {TodayPage} from '../../../desktop/src/pages/today-page';
import {ReviewSessionPage} from '../../../desktop/src/pages/review-session-page';
import {queryClient, apiGet, apiPost} from './api';
import {hostRequest} from './api-client';
import {EmbeddedPortalContext} from './embedded-portal';
import {hydrateLocalClientPreferences} from './client-preferences';
import {ThemeProvider} from './theme-provider';
import {bindEmbeddedSurface, observeEmbeddedViewport} from './viewport';
import {positionPath, routePosition, type Position} from '../lib/navigation.mjs';

const workspaceApi = {get: apiGet, post: apiPost};
const capabilities = {authentication: false, billing: false, development: false,
  legal: false, productUpdates: false, publicCatalog: false, sharing: false};
const sidebarViews: readonly WorkspaceSidebarViewRegistration[] = [{
  id: 'dsh-goal-outline', resolve: ({goalSubviewId}) => goalSubviewId ? {
    id: `dsh-goal:${goalSubviewId}`, render: () => <GoalWorkspaceSubview goalId={goalSubviewId} />,
  } : null,
}];

/** DSH owns the outer frame and transport; Desktop owns the learning experience. */
export function Workbench() {
  const [surface, setSurface] = useState<HTMLDivElement | null>(null);
  const [initialPath, setInitialPath] = useState<string>();
  const [restoreError, setRestoreError] = useState('');
  const bindSurface = useCallback((element: HTMLDivElement | null) => {
    bindEmbeddedSurface(element); setSurface(element);
  }, []);
  useEffect(() => surface ? observeEmbeddedViewport(surface) : undefined, [surface]);
  useEffect(() => {
    let active = true;
    void Promise.allSettled([hostRequest<Position>('/position'), hydrateLocalClientPreferences()])
      .then(([position, preferences]) => {
        if (!active) return;
        setInitialPath(positionPath(position.status === 'fulfilled' ? position.value : {}));
        const failure = [position, preferences].find(result => result.status === 'rejected');
        if (failure?.status === 'rejected') setRestoreError(failure.reason.message);
      });
    return () => {active = false;};
  }, []);
  return <div ref={bindSurface} className="xuelearn-workbench" data-xuelearn-workbench>
    <WorkbenchErrorBoundary>
      <EmbeddedPortalContext.Provider value={surface}>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider><I18nProvider initialLocalePreference="zh-Hans">
            {initialPath ? <MemoryRouter initialEntries={[initialPath]}>
              <PositionPersistence />
              {restoreError && <p className="xl-restore-error" role="alert">{restoreError}</p>}
              <ConfirmProvider><TooltipProvider><DesktopDocumentPreviewProvider>
                <DisplayWorkspaceProvider client={workspaceApi}>
                  <AssistantProvider>
                    <MainlineProvider>
                      <WorkspaceShell sidebarViews={sidebarViews}><MainWrapper>
                        <LearnerRoutes capabilities={capabilities} protect={element => element}
                          elements={{root: <Navigate to="/spaces" replace />, today: <TodayPage />,
                            'review-session': <ReviewSessionPage />}} />
                      </MainWrapper></WorkspaceShell>
                    </MainlineProvider>
                    <FloatingActionStack><AssistantFab /></FloatingActionStack>
                  </AssistantProvider>
                </DisplayWorkspaceProvider>
              </DesktopDocumentPreviewProvider></TooltipProvider></ConfirmProvider>
            </MemoryRouter> : <p className="xl-starting" role="status">正在恢复学习空间…</p>}
          </I18nProvider></ThemeProvider>
        </QueryClientProvider>
      </EmbeddedPortalContext.Provider>
    </WorkbenchErrorBoundary>
  </div>;
}

function PositionPersistence() {
  const location = useLocation();
  const saves = useRef(Promise.resolve());
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const position = routePosition(`${location.pathname}${location.search}`);
    if (!position) return;
    saves.current = saves.current.catch(() => {}).then(async () => {
      await hostRequest('/position', position);
      if (active) setError('');
    }).catch(cause => {if (active) setError(cause.message);});
    return () => {active = false;};
  }, [location.pathname, location.search]);
  return error ? <p className="xl-restore-error" role="alert">学习位置保存失败：{error}</p> : null;
}

class WorkbenchErrorBoundary extends Component<{children: ReactNode}, {error: Error | null}> {
  state = {error: null as Error | null};
  static getDerivedStateFromError(error: Error) {return {error};}
  render() {
    return this.state.error ? <div className="xl-starting" role="alert">
      <p>学习空间暂时无法打开：{this.state.error.message}</p>
      <button type="button" onClick={() => this.setState({error: null})}>重新打开</button>
    </div> : this.props.children;
  }
}
