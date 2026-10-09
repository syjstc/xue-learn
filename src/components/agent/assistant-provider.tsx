"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { AssistantCompanionShell } from "@/components/agent/assistant-companion-shell";
import { GoalCreationFlow } from "@/components/agent/goal-creation-flow";
import { useDesktopDocumentPreview } from "@xue-learn/core/source/src/components/goals/desktop-document-preview.tsx";
import {
  PYTHON_EDITOR_FOLLOW_UP_OWNER,
  parsePythonAskAiMessage,
} from "@/components/desktop-python-editor/ask-ai";
import { useDesktopPythonEditor } from "@xue-learn/core/source/src/components/desktop-python-editor/python-editor-provider.tsx";
import {
  GoalTopicPromptDialog,
  type GoalTopicPromptSubmit,
} from "@/components/agent/goal-topic-prompt-dialog";
import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@xue-learn/core/source/src/components/ui/dialog.tsx";
import { useInstantMicroCreation } from "@/hooks/use-instant-micro-creation";
import { getAgentPageContext } from "@/shared/routing/routes";
import type { AgentPageContext } from "@/shared/agent/types";
import {
  ASSISTANT_SURFACE_STORAGE_KEY,
  COMPANION_COLLAPSED_RAIL_WIDTH,
  DEFAULT_ASSISTANT_SURFACE_PREFERENCE,
  clampDockWidth,
  readAssistantSurfacePreference,
  type AssistantCompanionMode,
} from "@/shared/agent/assistant-companion-state";
import {
  closeOwnedAssistantFollowUp,
  type ActiveAssistantFollowUp,
} from "@/shared/domain/assistant-follow-up-owner";
import type { MaterialAnchor } from "@xue-learn/core/source/src/shared/domain/material-anchor.ts";
import { useI18n } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import {
  supportsGlobalAssistant,
  supportsGoalInstantMicroGeneration,
  supportsMaterialFollowUps,
  canUseBrowserPersistentStorage,
} from "@xue-learn/core/source/src/shared/runtime/client-runtime.ts";
import {
  readLocalClientPreference,
  writeLocalClientPreference,
} from "@/shared/runtime/local-client-preferences";

export type PendingGoalStart = {
  topic?: string;
  files: File[];
  urls: string[];
  isSmallCourse?: boolean;
  goalDraft?: {
    topic?: string;
    level?: "zero" | "basic" | "advanced";
    targetSpaceId?: string;
    targetSpaceItemId?: string;
  };
};

export type PendingMicroExpand = {
  goalId: string;
  goalTitle: string;
  unitTitle: string;
};

export type GoalCreationPromptOptions = {
  isSmallCourse?: boolean;
  targetSpaceId?: string;
};

export type GoalCreationAdapter = {
  create: (input: GoalTopicPromptSubmit) => Promise<{ goalId: string }>;
};

export type PendingMaterialFollowUp = {
  learningPosition?: import("@xue-learn/core/source/libs/domain/src/index.ts").LearningPosition;
  activeVisitId?: string;
  goalId: string;
  unitId: string;
  anchor: MaterialAnchor;
  threadId?: string;
  initialMessage?: string;
  requestId: number;
};

type AssistantContextValue = {
  open: boolean;
  companionOpen: boolean;
  companionExpanded: boolean;
  companionReserveWidth: number;
  mode: AssistantCompanionMode;
  responseReady: boolean;
  openAssistant: (initialMessage?: string) => void;
  openGoalCreationPrompt: (
    seedTopic?: string,
    options?: GoalCreationPromptOptions,
  ) => void;
  openGoalCreation: (input: PendingGoalStart) => void;
  openGoalCreationModal: () => void;
  openMicroExpandAssistant: (params: PendingMicroExpand) => void;
  closeAssistant: () => void;
  collapseCompanion: () => void;
  expandCompanion: () => void;
  activeFollowUpUnitId: string | null;
  activeFollowUpOwnerId: string | null;
  openUnitFollowUp: (
    unitId: string,
    ownerId: string,
    followUp?: Omit<PendingMaterialFollowUp, "unitId" | "requestId">,
  ) => void;
  closeUnitFollowUp: (ownerId?: string) => void;
  immersiveLearningActive: boolean;
  immersiveFollowUpWidth: number;
  setImmersiveLearningActive: (active: boolean) => void;
  setImmersiveFollowUpWidth: (width: number) => void;
  registerPageContext: (
    context: AssistantPageContextRegistration | null,
  ) => void;
};

function initialAssistantSurfacePreference() {
  if (typeof window === "undefined") {
    return DEFAULT_ASSISTANT_SURFACE_PREFERENCE;
  }
  if (canUseBrowserPersistentStorage()) {
    return readAssistantSurfacePreference(
      window.localStorage.getItem(ASSISTANT_SURFACE_STORAGE_KEY),
    );
  }

  const stored = readLocalClientPreference<unknown>(
    ASSISTANT_SURFACE_STORAGE_KEY,
    null,
  );
  return readAssistantSurfacePreference(
    stored == null ? null : JSON.stringify(stored),
  );
}

export type AssistantPageContextRegistration = {
  contextLabel?: string;
  currentStep?: string;
};

const AssistantContext = createContext<AssistantContextValue | null>(null);

export function AssistantProvider({
  children,
  goalCreationAdapter,
}: {
  children: ReactNode;
  goalCreationAdapter?: GoalCreationAdapter;
}) {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const documentPreview = useDesktopDocumentPreview();
  const pythonEditor = useDesktopPythonEditor();
  const initialPreferenceRef = useRef(initialAssistantSurfacePreference());
  const [mode, setMode] = useState<AssistantCompanionMode>("collapsed");
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const open = mode !== "collapsed";
  const companionOpen =
    open ||
    Boolean(documentPreview?.document) ||
    Boolean(pythonEditor?.session);
  const companionExpanded = companionOpen && !panelCollapsed;
  const companionMode: AssistantCompanionMode = companionOpen
    ? mode === "collapsed"
      ? "docked"
      : mode
    : "collapsed";
  const [assistantMounted, setAssistantMounted] = useState(false);
  const [responseReady, setResponseReady] = useState(false);
  const [activeFollowUp, setActiveFollowUp] =
    useState<ActiveAssistantFollowUp | null>(null);
  const [pendingMaterialFollowUp, setPendingMaterialFollowUp] =
    useState<PendingMaterialFollowUp | null>(null);
  const [pendingContextQuestion, setPendingContextQuestion] = useState<{
    id: number;
    message: string;
    pageContext: AgentPageContext;
  } | null>(null);
  const activeFollowUpRef = useRef<ActiveAssistantFollowUp | null>(null);
  activeFollowUpRef.current = activeFollowUp;
  const activeFollowUpUnitId = activeFollowUp?.unitId ?? null;
  const activeFollowUpOwnerId = activeFollowUp?.ownerId ?? null;
  const [dockWidth, setDockWidth] = useState(
    initialPreferenceRef.current.dockWidth,
  );
  const [immersiveFollowUpWidth, setImmersiveFollowUpWidthState] = useState(
    Number.isFinite(initialPreferenceRef.current.immersiveFollowUpWidth)
      ? initialPreferenceRef.current.immersiveFollowUpWidth
      : DEFAULT_ASSISTANT_SURFACE_PREFERENCE.immersiveFollowUpWidth,
  );
  const [immersiveLearningActive, setImmersiveLearningActive] = useState(false);
  const [pageRegistration, setPageRegistration] =
    useState<AssistantPageContextRegistration | null>(null);
  const [topicPromptOpen, setTopicPromptOpen] = useState(false);
  const [topicPromptSeed, setTopicPromptSeed] = useState<string | undefined>();
  const [topicPromptIsMicro, setTopicPromptIsMicro] = useState(false);
  const [topicPromptTargetSpaceId, setTopicPromptTargetSpaceId] = useState<
    string | undefined
  >();
  const [pendingGoalStart, setPendingGoalStart] =
    useState<PendingGoalStart | null>(null);
  const [goalCreationModalOpen, setGoalCreationModalOpen] = useState(false);
  const [adaptedGoalPending, setAdaptedGoalPending] = useState(false);
  const [adaptedGoalError, setAdaptedGoalError] = useState("");
  const goalCreationModalPathRef = useRef<string | null>(null);
  const [pendingMicroExpand, setPendingMicroExpand] =
    useState<PendingMicroExpand | null>(null);
  const instantMicro = useInstantMicroCreation();

  const pageContext = useMemo<AgentPageContext>(() => {
    const base = getAgentPageContext(location.pathname, location.search);
    return {
      ...base,
      contextLabel: pageRegistration?.contextLabel ?? base.contextLabel,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      frontendState: {
        currentStep: pageRegistration?.currentStep,
      },
    };
  }, [
    location.pathname,
    location.search,
    pageRegistration?.contextLabel,
    pageRegistration?.currentStep,
  ]);

  const closeGoalCreationModal = useCallback(() => {
    setGoalCreationModalOpen(false);
  }, []);

  useEffect(() => {
    if (!goalCreationModalOpen) {
      goalCreationModalPathRef.current = null;
      return;
    }
    if (goalCreationModalPathRef.current === null) {
      goalCreationModalPathRef.current = location.pathname;
      return;
    }
    if (goalCreationModalPathRef.current !== location.pathname) {
      setGoalCreationModalOpen(false);
      goalCreationModalPathRef.current = null;
    }
  }, [goalCreationModalOpen, location.pathname]);

  useEffect(() => {
    if (mode !== "collapsed") setResponseReady(false);
  }, [mode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!companionOpen) return;
    const next = { dockWidth, immersiveFollowUpWidth };
    if (canUseBrowserPersistentStorage()) {
      window.localStorage.setItem(
        ASSISTANT_SURFACE_STORAGE_KEY,
        JSON.stringify(next),
      );
    } else {
      writeLocalClientPreference(ASSISTANT_SURFACE_STORAGE_KEY, next);
    }
  }, [companionOpen, dockWidth, immersiveFollowUpWidth]);

  const setImmersiveFollowUpWidth = useCallback((width: number) => {
    setImmersiveFollowUpWidthState(clampDockWidth(width, window.innerWidth));
  }, []);

  const collapseCompanion = useCallback(() => {
    setPanelCollapsed(true);
  }, []);

  const expandCompanion = useCallback(() => {
    setPanelCollapsed(false);
  }, []);

  useEffect(() => {
    if (!companionOpen && panelCollapsed) setPanelCollapsed(false);
  }, [companionOpen, panelCollapsed]);

  useEffect(() => {
    if (pythonEditor?.session) setPanelCollapsed(false);
  }, [pythonEditor?.session]);

  useEffect(() => {
    if (documentPreview?.document) setPanelCollapsed(false);
  }, [documentPreview?.document]);

  const openAssistant = useCallback(
    (initialMessage?: string) => {
      // Keep the companion surface closed when the runtime has not opted into
      // the shared global-thread contract.  Desktop-local currently exposes
      // goal creation and learning sessions through SQLite, but does not yet
      // provide the hosted global assistant's durable tools/resume semantics.
      if (!supportsGlobalAssistant()) return;
      setPanelCollapsed(false);
      documentPreview?.showAssistant();
      setAssistantMounted(true);
      setResponseReady(false);
      if (initialMessage?.trim()) {
        setPendingContextQuestion({
          id: Date.now(),
          message: initialMessage.trim(),
          pageContext,
        });
      }
      setMode("docked");
    },
    [documentPreview, pageContext],
  );

  const openGoalCreationPrompt = useCallback(
    (seedTopic?: string, options?: GoalCreationPromptOptions) => {
      setAdaptedGoalError("");
      setTopicPromptSeed(seedTopic?.trim() || undefined);
      setTopicPromptIsMicro(options?.isSmallCourse === true);
      setTopicPromptTargetSpaceId(options?.targetSpaceId);
      setTopicPromptOpen(true);
    },
    [],
  );

  const openMicroExpandAssistant = useCallback(
    (params: PendingMicroExpand) => {
      if (!supportsGlobalAssistant()) return;
      setPanelCollapsed(false);
      documentPreview?.showAssistant();
      setAssistantMounted(true);
      setPendingMicroExpand(params);
      setMode("focus");
    },
    [documentPreview],
  );

  const closeAssistant = useCallback(() => {
    setMode("collapsed");
    if (pythonEditor?.session) documentPreview?.showEditor();
    else documentPreview?.showDocument();
  }, [documentPreview, pythonEditor?.session]);

  const openUnitFollowUp = useCallback(
    (
      unitId: string,
      ownerId: string,
      followUp?: Omit<PendingMaterialFollowUp, "unitId" | "requestId">,
    ) => {
      if (!supportsMaterialFollowUps()) return;
      setPanelCollapsed(false);
      documentPreview?.showAssistant();
      const next = { unitId, ownerId };
      setAssistantMounted(true);
      setResponseReady(false);
      activeFollowUpRef.current = next;
      setActiveFollowUp(next);
      if (followUp) {
        setPendingMaterialFollowUp({
          ...followUp,
          unitId,
          requestId: Date.now(),
        });
      }
      setMode((current) => {
        return current === "focus" ? current : "docked";
      });
    },
    [documentPreview],
  );

  const handlePythonAskAi = useCallback(
    (message: string) => {
      const playground = parsePythonAskAiMessage(message);
      const selectedText = playground
        ? playground.code.split("\n")[0]?.slice(0, 80)
        : message.slice(0, 500);
      if (pageContext.unitId && pageContext.goalId) {
        openUnitFollowUp(pageContext.unitId, PYTHON_EDITOR_FOLLOW_UP_OWNER, {
          goalId: pageContext.goalId,
          anchor: {
            scope: "block",
            selectedText,
            subPath: "text.selection",
          },
          initialMessage: message,
        });
        return;
      }
      openAssistant(message);
    },
    [
      openAssistant,
      openUnitFollowUp,
      pageContext.goalId,
      pageContext.unitId,
    ],
  );

  const closeUnitFollowUp = useCallback(
    (ownerId?: string) => {
      const current = activeFollowUpRef.current;
      const next = closeOwnedAssistantFollowUp(current, ownerId);
      if (next === current) return;
      activeFollowUpRef.current = next;
      setActiveFollowUp(next);
      if (immersiveLearningActive) setMode("collapsed");
    },
    [immersiveLearningActive],
  );

  const closeTopicPrompt = useCallback(() => {
    if (instantMicro.loading || adaptedGoalPending) return;
    setTopicPromptOpen(false);
    setTopicPromptSeed(undefined);
    setTopicPromptIsMicro(false);
    setTopicPromptTargetSpaceId(undefined);
    setAdaptedGoalError("");
  }, [adaptedGoalPending, instantMicro.loading]);

  const submitGoalStart = useCallback((input: PendingGoalStart) => {
    setTopicPromptOpen(false);
    setTopicPromptSeed(undefined);
    setTopicPromptIsMicro(false);
    setTopicPromptTargetSpaceId(undefined);
    setPendingGoalStart({
      topic: input.topic?.trim() || undefined,
      files: input.files,
      urls: input.urls,
      isSmallCourse: input.isSmallCourse,
      goalDraft: input.goalDraft,
    });
    setGoalCreationModalOpen(true);
  }, []);

  const startGoalCreationFromAssistant = useCallback(
    (seedTopic?: string) => {
      if (goalCreationAdapter) {
        setAdaptedGoalError("");
        setTopicPromptSeed(seedTopic?.trim() || undefined);
        setTopicPromptOpen(true);
        return;
      }
      const topic = seedTopic?.trim();
      if (topic) {
        submitGoalStart({ topic, files: [], urls: [] });
        return;
      }
      setGoalCreationModalOpen(true);
    },
    [goalCreationAdapter, submitGoalStart],
  );

  const openGoalCreationModal = useCallback(() => {
    if (goalCreationAdapter) {
      setAdaptedGoalError("");
      setTopicPromptOpen(true);
      return;
    }
    setGoalCreationModalOpen(true);
  }, [goalCreationAdapter]);

  const handleGoalPromptSubmit = useCallback(
    (input: GoalTopicPromptSubmit) => {
      if (goalCreationAdapter) {
        setAdaptedGoalPending(true);
        setAdaptedGoalError("");
        void goalCreationAdapter
          .create(input)
          .then(({ goalId }) => {
            setTopicPromptOpen(false);
            setTopicPromptSeed(undefined);
            setTopicPromptIsMicro(false);
            navigate(`/goals/${goalId}`);
          })
          .catch((error) => {
            setAdaptedGoalError(
              error instanceof Error
                ? error.message
                : t("onboarding.profile.saveFailed"),
            );
          })
          .finally(() => setAdaptedGoalPending(false));
        return;
      }
      if (
        supportsGoalInstantMicroGeneration() &&
        input.isSmallCourse &&
        input.microMode === "instant"
      ) {
        void instantMicro
          .start({
            topic: input.topic?.trim() || undefined,
            files: input.files,
          })
          .then(() => {
            setTopicPromptOpen(false);
            setTopicPromptSeed(undefined);
            setTopicPromptIsMicro(false);
          })
          .catch(() => {
            // error surfaced via instantMicro.error
          });
        return;
      }
      submitGoalStart({
        ...input,
        goalDraft: topicPromptTargetSpaceId
          ? { targetSpaceId: topicPromptTargetSpaceId }
          : undefined,
      });
    },
    [
      goalCreationAdapter,
      instantMicro,
      navigate,
      submitGoalStart,
      t,
      topicPromptTargetSpaceId,
    ],
  );

  const consumePendingGoalStart = useCallback(() => {
    setPendingGoalStart(null);
  }, []);

  const openGoalCreation = useCallback(
    (input: PendingGoalStart) => {
      if (!goalCreationAdapter) {
        submitGoalStart(input);
        return;
      }
      handleGoalPromptSubmit({
        topic: input.topic ?? "",
        files: input.files,
        urls: input.urls,
        isSmallCourse: input.isSmallCourse,
        microMode: input.isSmallCourse ? "guided" : undefined,
      });
    },
    [goalCreationAdapter, handleGoalPromptSubmit, submitGoalStart],
  );

  const consumePendingMicroExpand = useCallback(() => {
    setPendingMicroExpand(null);
  }, []);

  const handleResponseReady = useCallback(() => {
    if (mode === "collapsed") setResponseReady(true);
  }, [mode]);

  const reservedDockWidth = !companionOpen
    ? 0
    : panelCollapsed
      ? COMPANION_COLLAPSED_RAIL_WIDTH
      : immersiveLearningActive
        ? immersiveFollowUpWidth
        : companionMode === "focus"
          ? clampDockWidth(Math.max(480, dockWidth), 1440)
          : dockWidth;

  const value = useMemo(
    () => ({
      open,
      companionOpen,
      companionExpanded,
      companionReserveWidth: reservedDockWidth,
      mode,
      responseReady,
      activeFollowUpUnitId,
      activeFollowUpOwnerId,
      openAssistant,
      openGoalCreationPrompt,
      openGoalCreation,
      openGoalCreationModal,
      openMicroExpandAssistant,
      closeAssistant,
      collapseCompanion,
      expandCompanion,
      openUnitFollowUp,
      closeUnitFollowUp,
      immersiveLearningActive,
      immersiveFollowUpWidth,
      setImmersiveLearningActive,
      setImmersiveFollowUpWidth,
      registerPageContext: setPageRegistration,
    }),
    [
      open,
      companionOpen,
      companionExpanded,
      reservedDockWidth,
      mode,
      responseReady,
      activeFollowUpUnitId,
      activeFollowUpOwnerId,
      openAssistant,
      openGoalCreationPrompt,
      openGoalCreation,
      openGoalCreationModal,
      openMicroExpandAssistant,
      closeAssistant,
      collapseCompanion,
      expandCompanion,
      openUnitFollowUp,
      closeUnitFollowUp,
      immersiveLearningActive,
      immersiveFollowUpWidth,
      setImmersiveFollowUpWidth,
    ],
  );

  return (
    <AssistantContext.Provider value={value}>
      <div
        data-assistant-layout-root
        className={
          companionOpen &&
          reservedDockWidth > 0 &&
          (companionMode === "docked" || companionMode === "focus")
            ? "min-w-0 transition-[padding] duration-280 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none md:pr-[var(--assistant-dock-width)]"
            : "min-w-0 transition-[padding] duration-280 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
        }
        style={
          {
            "--assistant-dock-width": `${reservedDockWidth}px`,
          } as CSSProperties
        }
      >
        {children}
      </div>
      <GoalTopicPromptDialog
        open={topicPromptOpen}
        initialTopic={topicPromptSeed}
        initialIsSmallCourse={topicPromptIsMicro}
        onClose={closeTopicPrompt}
        onSubmit={handleGoalPromptSubmit}
        loading={instantMicro.loading || adaptedGoalPending}
        loadingStatus={
          adaptedGoalPending
            ? t("goalCreation.preparingWorkspace")
            : adaptedGoalError || instantMicro.error || instantMicro.status
        }
      />
      {!goalCreationAdapter ? (
        <Dialog
          open={goalCreationModalOpen}
          onOpenChange={setGoalCreationModalOpen}
        >
          <DialogContent
            showCloseButton={false}
            className="h-dvh w-screen max-w-none gap-0 overflow-hidden rounded-none p-0 shadow-lg ring-1 ring-foreground/8 sm:h-[min(92dvh,820px)] sm:w-[min(960px,calc(100vw-1rem))] sm:rounded-2xl sm:max-w-none"
          >
            <DialogTitle className="sr-only">
              {t("assistant.goalModal.title")}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t("assistant.goalModal.description")}
            </DialogDescription>
            <GoalCreationFlow
              variant="page"
              pageContext={pageContext}
              pendingGoalStart={pendingGoalStart}
              onPendingGoalStartConsumed={consumePendingGoalStart}
              onResponseReady={handleResponseReady}
              onClose={closeGoalCreationModal}
              surfaceActions={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={closeGoalCreationModal}
                  aria-label={t("assistant.goalModal.close")}
                  title={t("assistant.goalModal.close")}
                >
                  <X className="size-4" />
                </Button>
              }
              className="h-full min-h-0 w-full rounded-none border-0 shadow-none"
            />
          </DialogContent>
        </Dialog>
      ) : null}
      {assistantMounted ||
      documentPreview?.document ||
      pythonEditor?.session ? (
        <AssistantCompanionShell
          mode={companionMode}
          assistantOpen={open}
          dockWidth={dockWidth}
          panelCollapsed={panelCollapsed}
          pageContext={pageContext}
          onDockWidthChange={setDockWidth}
          immersiveFollowUpWidth={immersiveFollowUpWidth}
          onImmersiveFollowUpWidthChange={setImmersiveFollowUpWidth}
          onClose={closeAssistant}
          onCollapsePanel={collapseCompanion}
          onExpandPanel={expandCompanion}
          onResponseReady={handleResponseReady}
          onOpenGoalCreation={startGoalCreationFromAssistant}
          pendingMicroExpand={pendingMicroExpand}
          onPendingMicroExpandConsumed={consumePendingMicroExpand}
          pendingMaterialFollowUp={pendingMaterialFollowUp}
          onPendingMaterialFollowUpConsumed={() =>
            setPendingMaterialFollowUp(null)
          }
          pendingContextQuestion={pendingContextQuestion}
          onPendingContextQuestionConsumed={() =>
            setPendingContextQuestion(null)
          }
          immersiveLearningActive={immersiveLearningActive}
          onPythonAskAi={handlePythonAskAi}
        />
      ) : null}
    </AssistantContext.Provider>
  );
}

export function useAssistant() {
  const ctx = useContext(AssistantContext);
  if (!ctx) {
    throw new Error("useAssistant must be used within AssistantProvider");
  }
  return ctx;
}

export function useAssistantPageContext(
  registration: AssistantPageContextRegistration,
) {
  const { registerPageContext } = useAssistant();
  const contextLabel = registration.contextLabel;
  const currentStep = registration.currentStep;
  useEffect(() => {
    registerPageContext({ contextLabel, currentStep });
    return () => registerPageContext(null);
  }, [contextLabel, currentStep, registerPageContext]);
}
