"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, PanelRightClose, PanelRightOpen, Settings } from "lucide-react";
import { AgentChatWorkspace } from "@/components/agent/agent-chat-workspace";
import { GoalCreationRetryButton } from "@/components/agent/goal-creation-retry-button";
import {
  DesktopDocumentPreviewView,
  useDesktopDocumentPreview,
} from "@xue-learn/core/source/src/components/goals/desktop-document-preview.tsx";
import { QuickSettingsPanel } from "@/components/settings/quick-settings-panel";
import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import { ResizablePanelHandle } from "@/components/ui/resizable-panel-handle";
import type {
  PendingMaterialFollowUp,
  PendingMicroExpand,
} from "@/components/agent/assistant-provider";
import { useActiveGoalCreationSession } from "@/hooks/use-goal-creation-session";
import {
  goalCreationNeedsRetry,
  goalCreationShortStatus,
} from "@/shared/agent/goal-creation-session";
import type { AgentPageContext } from "@/shared/agent/types";
import { getPageContextLabelKey } from "@/shared/routing/routes";
import {
  ASSISTANT_COMPACT_BREAKPOINT,
  ASSISTANT_DOCK_DEFAULT_WIDTH,
  ASSISTANT_DOCK_MAX_WIDTH,
  ASSISTANT_DOCK_MIN_WIDTH,
  COMPANION_COLLAPSED_RAIL_WIDTH,
  IMMERSIVE_FOLLOW_UP_DEFAULT_WIDTH,
  IMMERSIVE_ASSISTANT_DOCK_BREAKPOINT,
  clampDockWidth,
  type AssistantCompanionMode,
} from "@/shared/agent/assistant-companion-state";
import { resolveCompanionPresentation } from "@/shared/agent/companion-presentation";
import { DesktopPythonEditorView } from "@/components/desktop-python-editor/editor-pane";
import { useDesktopPythonEditor } from "@xue-learn/core/source/src/components/desktop-python-editor/python-editor-provider.tsx";
import { supportsScopedAssistantTextThreads } from "@xue-learn/core/source/src/shared/runtime/client-runtime.ts";
import { resolveAssistantThreadBinding } from "@/shared/agent/assistant-scope";
import { agentDoneDestination } from "@/shared/agent/done-event";
import { cn } from "@xue-learn/core/source/src/shared/utils.ts";
import { useI18n } from "@xue-learn/core/source/src/shared/i18n/index.tsx";

type AssistantCompanionShellProps = {
  mode: AssistantCompanionMode;
  assistantOpen: boolean;
  dockWidth: number;
  panelCollapsed: boolean;
  pageContext: AgentPageContext;
  onOpenGoalCreation: (seedTopic?: string) => void;
  pendingMicroExpand: PendingMicroExpand | null;
  onPendingMicroExpandConsumed: () => void;
  pendingMaterialFollowUp: PendingMaterialFollowUp | null;
  onPendingMaterialFollowUpConsumed: () => void;
  pendingContextQuestion: {
    id: number;
    message: string;
    pageContext: AgentPageContext;
  } | null;
  onPendingContextQuestionConsumed: () => void;
  onDockWidthChange: (width: number) => void;
  immersiveFollowUpWidth: number;
  onImmersiveFollowUpWidthChange: (width: number) => void;
  onClose: () => void;
  onCollapsePanel: () => void;
  onExpandPanel: () => void;
  onResponseReady: () => void;
  immersiveLearningActive: boolean;
  onPythonAskAi: (message: string) => void;
};

function launcherElement() {
  return document.getElementById("assistant-companion-launcher");
}

export function AssistantCompanionShell({
  mode,
  assistantOpen,
  dockWidth,
  panelCollapsed,
  pageContext,
  onOpenGoalCreation,
  pendingMicroExpand,
  onPendingMicroExpandConsumed,
  pendingMaterialFollowUp,
  onPendingMaterialFollowUpConsumed,
  pendingContextQuestion,
  onPendingContextQuestionConsumed,
  onDockWidthChange,
  immersiveFollowUpWidth,
  onImmersiveFollowUpWidthChange,
  onClose,
  onCollapsePanel,
  onExpandPanel,
  onResponseReady,
  immersiveLearningActive,
  onPythonAskAi,
}: AssistantCompanionShellProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const documentPreview = useDesktopDocumentPreview();
  const pythonEditor = useDesktopPythonEditor();
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === "undefined" ? 1440 : window.innerWidth,
    height: typeof window === "undefined" ? 900 : window.innerHeight,
  }));
  const [workspaceMounted, setWorkspaceMounted] = useState(false);
  const [quickSettingsOpen, setQuickSettingsOpen] = useState(false);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const activeGoalCreation = useActiveGoalCreationSession(mode !== "collapsed");
  const initialAssistantBinding = resolveAssistantThreadBinding(
    pageContext,
    supportsScopedAssistantTextThreads(),
  );
  const compact = viewport.width < ASSISTANT_COMPACT_BREAKPOINT;
  // Immersive: wide = side dock (content shrinks); narrow = full-screen cover (no split).
  const immersiveSidebar = immersiveLearningActive && mode !== "collapsed";
  const immersiveDock =
    immersiveSidebar && viewport.width >= IMMERSIVE_ASSISTANT_DOCK_BREAKPOINT;
  const immersiveCover = immersiveSidebar && !immersiveDock;
  const presentation = resolveCompanionPresentation({
    documentOpen: Boolean(documentPreview?.document),
    editorOpen: Boolean(pythonEditor?.session),
    assistantOpen,
    activeView: documentPreview?.activeView ?? "assistant",
  });
  const showDocument = presentation.visibleDocument;
  const showTabs = presentation.showTabs;
  const railCollapsed = panelCollapsed && mode !== "collapsed";

  useEffect(() => {
    const handleResize = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(
    () => () => {
      resizeCleanupRef.current?.();
    },
    [],
  );

  useEffect(() => {
    if (mode === "docked" || mode === "focus") {
      setWorkspaceMounted(true);
    }
  }, [mode]);

  useEffect(() => {
    // Immersive Escape is owned by the learning workspace (close sidebar / exit focus).
    if (mode === "collapsed" || immersiveSidebar) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (railCollapsed) return;
      if (showTabs) {
        event.preventDefault();
        onCollapsePanel();
        return;
      }
      if (showDocument) return;
      if (pythonEditor?.session && !assistantOpen) return;
      event.preventDefault();
      onClose();
      window.requestAnimationFrame(() => launcherElement()?.focus());
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    assistantOpen,
    immersiveSidebar,
    mode,
    onClose,
    onCollapsePanel,
    pythonEditor?.session,
    railCollapsed,
    showDocument,
    showTabs,
  ]);

  const beginResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || compact || immersiveCover || railCollapsed) return;
      event.preventDefault();
      event.stopPropagation();
      resizeCleanupRef.current?.();
      document.body.dataset.assistantResizing = "true";
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      const move = (moveEvent: PointerEvent) => {
        const nextWidth = viewport.width - moveEvent.clientX;
        const clampedWidth = clampDockWidth(nextWidth, viewport.width);
        if (immersiveDock) {
          onImmersiveFollowUpWidthChange(clampedWidth);
        } else {
          onDockWidthChange(clampedWidth);
        }
      };
      const cleanup = () => {
        delete document.body.dataset.assistantResizing;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", cleanup);
        window.removeEventListener("pointercancel", cleanup);
        window.removeEventListener("blur", cleanup);
        resizeCleanupRef.current = null;
      };
      resizeCleanupRef.current = cleanup;
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", cleanup, { once: true });
      window.addEventListener("pointercancel", cleanup, { once: true });
      window.addEventListener("blur", cleanup, { once: true });
    },
    [
      compact,
      immersiveCover,
      immersiveDock,
      onDockWidthChange,
      onImmersiveFollowUpWidthChange,
      railCollapsed,
      viewport.width,
    ],
  );

  const effectiveMode = compact ? "focus" : mode;
  const docked =
    immersiveDock || effectiveMode === "docked" || effectiveMode === "focus";
  const expandedDockWidth = clampDockWidth(
    !immersiveSidebar && mode === "focus"
      ? Math.max(480, dockWidth)
      : immersiveDock
        ? immersiveFollowUpWidth
        : dockWidth,
    viewport.width,
  );
  const panelWidth = railCollapsed
    ? COMPANION_COLLAPSED_RAIL_WIDTH
    : expandedDockWidth;
  const resizeMin = ASSISTANT_DOCK_MIN_WIDTH;
  const resizeMax = Math.min(
    ASSISTANT_DOCK_MAX_WIDTH,
    viewport.width - 2 * 16,
  );
  const creationSession = activeGoalCreation.data?.session ?? null;
  const hasGoalCreation = Boolean(creationSession);
  // Quick settings (persona / LLM / theme / agenda) are global assistant controls —
  // keep the gear visible on every page, including Learning Spaces.
  const surfaceActions = (
    <button
      type="button"
      className="flex size-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-[var(--bg-300)] hover:text-foreground"
      onClick={() => setQuickSettingsOpen(true)}
      aria-label={t("assistant.companion.openQuickSettings")}
      title={t("assistant.companion.quickSettings")}
    >
      <Settings className="size-[17px]" />
    </button>
  );

  const resizeHandle =
    docked && !compact && !immersiveCover && !railCollapsed ? (
      <ResizablePanelHandle
        panelSide="right"
        label={t("assistant.companion.resize")}
        min={resizeMin}
        max={resizeMax}
        value={expandedDockWidth}
        assistantHandle
        className={cn(
          "fixed inset-y-0",
          immersiveDock
            ? "z-[calc(var(--z-fullscreen)+4)]"
            : "z-[calc(var(--z-modal)+1)]",
        )}
        style={{ right: expandedDockWidth - 6 }}
        onPointerDown={beginResize}
        onReset={() => {
          const resetWidth = immersiveDock
            ? IMMERSIVE_FOLLOW_UP_DEFAULT_WIDTH
            : ASSISTANT_DOCK_DEFAULT_WIDTH;
          if (immersiveDock) {
            onImmersiveFollowUpWidthChange(resetWidth);
          } else {
            onDockWidthChange(resetWidth);
          }
        }}
        onResizeBy={(delta) => {
          const nextWidth = clampDockWidth(
            expandedDockWidth + delta,
            viewport.width,
          );
          if (immersiveDock) {
            onImmersiveFollowUpWidthChange(nextWidth);
          } else {
            onDockWidthChange(nextWidth);
          }
        }}
      />
    ) : null;

  const companionSurface = (
    <aside
      id="assistant-companion-surface"
      data-assistant-companion
      data-companion-rail={railCollapsed ? "true" : undefined}
      data-immersive-sidebar={immersiveDock && !railCollapsed ? "true" : undefined}
      data-immersive-cover={immersiveCover && !railCollapsed ? "true" : undefined}
      aria-label={
        railCollapsed
          ? t("assistant.companion.expandPanel")
          : showDocument
            ? t("goalDocuments.previewDescription")
            : presentation.visibleEditor
              ? t("pythonEditor.tab")
              : t("assistant.companion.label")
      }
      className={cn(
        "fixed z-modal flex transform-gpu overflow-hidden border border-[var(--border-200)] bg-[var(--bg-50)] shadow-2xl transition-[transform,opacity,visibility,width] duration-280 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
        mode === "collapsed"
          ? "pointer-events-none invisible translate-x-full opacity-0 delay-[0ms,0ms,280ms]"
          : "visible translate-x-0 opacity-100 delay-0",
        immersiveCover && !railCollapsed
          ? "inset-0 rounded-none border-0"
          : compact && !railCollapsed
            ? "inset-0 rounded-none border-0"
            : "top-0 right-0 bottom-0 rounded-none border-y-0 border-r-0",
      )}
      style={
        (immersiveCover || compact) && !railCollapsed
          ? undefined
          : { width: panelWidth }
      }
    >
      {workspaceMounted ||
      documentPreview?.document ||
      pythonEditor?.session ? (
        <div
          className="flex h-full min-h-0 flex-col"
          style={{
            width:
              (immersiveCover || compact) && !railCollapsed
                ? "100%"
                : expandedDockWidth,
          }}
        >
          {railCollapsed ? (
            <div className="absolute inset-0 z-10 flex flex-col items-center bg-[var(--bg-50)] pt-3">
              <Button
                type="button"
                variant="outline"
                size="icon-lg"
                onClick={onExpandPanel}
                aria-label={t("assistant.companion.expandPanel")}
                title={t("assistant.companion.expandPanel")}
              >
                <PanelRightOpen aria-hidden />
              </Button>
            </div>
          ) : null}
          {showTabs ? (
            <div
              role="tablist"
              data-desktop-companion-tablist
              aria-label={t("goalDocuments.previewCompanionTabs")}
              className="flex h-9 shrink-0 items-end border-b border-[var(--border-200)] px-2"
            >
              {documentPreview?.document ? (
                <button
                  type="button"
                  role="tab"
                  aria-selected={showDocument}
                  aria-controls="desktop-document-preview-surface"
                  className={cn(
                    "h-8 border-b-2 px-3 text-xs font-medium",
                    showDocument
                      ? "border-primary text-[var(--text-800)]"
                      : "border-transparent text-[var(--text-400)] hover:text-[var(--text-700)]",
                  )}
                  onClick={documentPreview.showDocument}
                >
                  {t("goalDocuments.previewTab")}
                </button>
              ) : null}
              {pythonEditor?.session ? (
                <button
                  type="button"
                  role="tab"
                  aria-selected={presentation.visibleEditor}
                  aria-controls="desktop-python-editor-surface"
                  className={cn(
                    "h-8 border-b-2 px-3 text-xs font-medium",
                    presentation.visibleEditor
                      ? "border-primary text-[var(--text-800)]"
                      : "border-transparent text-[var(--text-400)] hover:text-[var(--text-700)]",
                  )}
                  onClick={documentPreview?.showEditor}
                >
                  {t("pythonEditor.tab")}
                </button>
              ) : null}
              {assistantOpen ? (
                <button
                  type="button"
                  role="tab"
                  aria-selected={presentation.visibleAssistant}
                  aria-controls="assistant-companion-view"
                  className={cn(
                    "h-8 border-b-2 px-3 text-xs font-medium",
                    presentation.visibleAssistant
                      ? "border-primary text-[var(--text-800)]"
                      : "border-transparent text-[var(--text-400)] hover:text-[var(--text-700)]",
                  )}
                  onClick={documentPreview?.showAssistant}
                >
                  {t("assistant.companion.label")}
                </button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="ml-auto mb-0.5 shrink-0"
                onClick={onCollapsePanel}
                aria-label={t("assistant.companion.collapsePanel")}
                title={t("assistant.companion.collapsePanel")}
              >
                <PanelRightClose aria-hidden />
              </Button>
            </div>
          ) : null}
          <div className="flex min-h-0 flex-1 flex-col">
            {documentPreview?.document ? (
              <div
                className={cn(
                  "min-h-0 flex-1",
                  showDocument ? "flex" : "hidden",
                )}
              >
                <DesktopDocumentPreviewView
                  document={documentPreview.document}
                  active={showDocument}
                  onClose={documentPreview.closeDocument}
                />
              </div>
            ) : null}
            {pythonEditor?.session ? (
              <div
                id="desktop-python-editor-surface"
                className={cn(
                  "min-h-0 min-w-0 flex-1 flex-col",
                  presentation.visibleEditor ? "flex" : "hidden",
                )}
              >
                <DesktopPythonEditorView onAskAi={onPythonAskAi} />
              </div>
            ) : null}
            <div
              id="assistant-companion-view"
              className={cn(
                "min-h-0 min-w-0 flex-1 flex-col",
                presentation.visibleAssistant ? "flex" : "hidden",
              )}
            >
              {workspaceMounted ? (
                <>
                  {hasGoalCreation && creationSession ? (
                    <div
                      className={cn(
                        "flex shrink-0 items-start gap-2 border-b px-3 py-2.5",
                        goalCreationNeedsRetry(creationSession)
                          ? "border-destructive/20 bg-destructive/5"
                          : "border-primary/15 bg-primary/[0.06]",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => onOpenGoalCreation()}
                        className="flex min-w-0 flex-1 items-start gap-2 text-left transition-colors"
                      >
                        <span
                          className={cn(
                            "mt-1.5 size-2 shrink-0 rounded-full",
                            goalCreationNeedsRetry(creationSession)
                              ? "bg-destructive"
                              : "bg-primary",
                            creationSession.status === "running" &&
                              "animate-pulse",
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-foreground">
                            {goalCreationNeedsRetry(creationSession)
                              ? t("assistant.creationStatus.needsAttentionTitle")
                              : t("assistant.companion.goalCreation")}
                          </span>
                          <span className="mt-0.5 block text-sm leading-5 text-muted-foreground">
                            {goalCreationShortStatus(creationSession, t)}
                          </span>
                        </span>
                        <span
                          className={cn(
                            "inline-flex shrink-0 items-center gap-0.5 pt-0.5 text-xs font-medium",
                            goalCreationNeedsRetry(creationSession)
                              ? "text-destructive"
                              : "text-primary",
                          )}
                        >
                          {t("assistant.companion.view")}
                          <ChevronRight className="size-3.5" />
                        </span>
                      </button>
                      {goalCreationNeedsRetry(creationSession) ? (
                        <GoalCreationRetryButton
                          sessionId={creationSession.id}
                          className="mt-0.5"
                        />
                      ) : null}
                    </div>
                  ) : null}
                  <AgentChatWorkspace
                    key={`${initialAssistantBinding.scope}:${initialAssistantBinding.scopeId ?? ""}`}
                    variant="panel"
                    initialScope={initialAssistantBinding.scope}
                    initialScopeId={initialAssistantBinding.scopeId}
                    pageContext={pageContext}
                    contextLabel={
                      pageContext.pageKind === "unit"
                        ? pageContext.contextLabel
                        : t(getPageContextLabelKey(pageContext.pageKind))
                    }
                    pendingMicroExpand={pendingMicroExpand}
                    onPendingMicroExpandConsumed={onPendingMicroExpandConsumed}
                    pendingMaterialFollowUp={pendingMaterialFollowUp}
                    onPendingMaterialFollowUpConsumed={
                      onPendingMaterialFollowUpConsumed
                    }
                    pendingContextQuestion={pendingContextQuestion}
                    onPendingContextQuestionConsumed={
                      onPendingContextQuestionConsumed
                    }
                    headerActions={surfaceActions}
                    onOpenGoalCreation={onOpenGoalCreation}
                    onComplete={(result) => {
                      const destination = agentDoneDestination(result);
                      if (destination) navigate(destination);
                    }}
                    onResponseReady={onResponseReady}
                    onClose={onClose}
                    className="min-h-0 flex-1"
                  />
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      <QuickSettingsPanel
        open={quickSettingsOpen}
        onClose={() => setQuickSettingsOpen(false)}
        unitId={pageContext.unitId}
      />
    </aside>
  );

  return (
    <>
      {resizeHandle}
      {companionSurface}
    </>
  );
}
