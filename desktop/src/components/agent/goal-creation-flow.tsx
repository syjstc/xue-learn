"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  CircleStop,
  LoaderCircle,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { AgentChatWorkspace } from "@/components/agent/agent-chat-workspace";
import type { GoalCreationLiveProgress } from "@/components/agent/agent-chat";
import type { PendingGoalStart } from "@/components/agent/assistant-provider";
import { GoalCreationRetryButton } from "@/components/agent/goal-creation-retry-button";
import { CreationProgress } from "@/components/agent/goal-creation-progress";
import { GoalPlanStreamCard } from "@/components/agent/goal-plan-stream-card";
import { goalPlanPreviewFromEvents } from "@/shared/agent/goal-plan-stream-preview";
import { Button } from "@xue-learn/core/ui/button";
import { useConfirm } from "@/hooks/use-confirm";
import {
  useActiveGoalCreationSession,
  useGoalCreationSessionActions,
  useGoalCreationSessionByGoal,
  useGoalCreationSessionEvents,
} from "@/hooks/use-goal-creation-session";
import {
  GOAL_CREATION_PHASE_LABEL_KEYS,
  goalCreationAutoOpenPath,
  goalCreationNeedsRetry,
  goalCreationShortStatus,
  goalCreationShowsLiveFeed,
  goalCreationPendingToolUi,
  type GoalCreationSessionEvent,
  type GoalCreationSession,
} from "@/shared/agent/goal-creation-session";
import {
  goalCreationStepElapsedSeconds,
  goalCreationStepKey,
} from "@/shared/agent/goal-creation-elapsed";
import {
  goalCreationEventText,
  isMeaningfulGoalCreationEvent,
  latestLiveGoalCreationMessage,
} from "@/shared/agent/goal-creation-event-text";
import type { AgentPageContext } from "@/shared/agent/types";
import { agentDoneDestination } from "@/shared/agent/done-event";
import { useT, type TranslationKey } from "@xue-learn/core/i18n";
import { cn } from "@xue-learn/core/utils";

type Translate = (
  key: TranslationKey,
  params?: Record<string, string | number>,
) => string;

function statusCopy(session: GoalCreationSession, t: Translate) {
  if (session.status === "stopped")
    return t("goalCreation.stoppedCannotContinue");
  if (session.status === "needs_attention")
    return t("goalCreation.needsAttention");
  if (session.status === "completed" || session.phase === "ready") {
    return session.flowMode === "agentic"
      ? t("goalCreation.allModulesReady")
      : t("goalCreation.firstLessonReady");
  }
  if (session.status === "waiting_user") {
    return goalCreationShortStatus(session, t);
  }
  if (session.status === "running" || session.status === "stop_requested") {
    return goalCreationShortStatus(session, t);
  }
  if (session.phase === "first_unit" || session.phase === "first_unit_kacom")
    return t("goalCreation.preparingFirstLesson");
  return t("goalCreation.processingBackground");
}

function eventText(
  type: string,
  payload: Record<string, unknown>,
  t: Translate,
) {
  return goalCreationEventText(type, payload, t);
}

const DRAFT_STATUS_KEYS: Record<string, TranslationKey> = {
  queued: "goalCreation.draftStatus.queued",
  researching: "goalCreation.draftStatus.researching",
  authoring: "goalCreation.draftStatus.authoring",
  validating: "goalCreation.draftStatus.validating",
  ready_for_audit: "goalCreation.draftStatus.ready_for_audit",
  repairing: "goalCreation.draftStatus.repairing",
  publishing: "goalCreation.draftStatus.publishing",
  ready: "goalCreation.draftStatus.ready",
  failed: "goalCreation.draftStatus.failed",
};

function AutomaticCreationFeed({
  events,
  planningEvents,
  session,
  actionBusy = false,
}: {
  events: Array<GoalCreationSessionEvent & { text: string }>;
  planningEvents: readonly GoalCreationSessionEvent[];
  session: GoalCreationSession;
  actionBusy?: boolean;
}) {
  const t = useT();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const running = session.status === "running";
  const needsRetry = goalCreationNeedsRetry(session);
  const planProgress = useMemo(
    () => goalPlanPreviewFromEvents(planningEvents),
    [planningEvents],
  );
  const latestEvent = events.at(-1);
  const stepKey = goalCreationStepKey({
    sequence: latestEvent?.sequence,
    type: latestEvent?.type,
    payload: latestEvent?.payload,
    phase: session.phase,
  });
  const stepSeenAtRef = useRef<{ key: string; at: number }>({
    key: stepKey,
    at: Date.now(),
  });
  if (stepSeenAtRef.current.key !== stepKey) {
    stepSeenAtRef.current = { key: stepKey, at: Date.now() };
  }

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const elapsedSeconds = goalCreationStepElapsedSeconds({
    startedAt: latestEvent?.createdAt ?? session.updatedAt,
    nowMs: now,
    seenAtMs: stepSeenAtRef.current.at,
  });
  const elapsedText =
    elapsedSeconds < 60
      ? t("goalCreation.seconds", { value: elapsedSeconds })
      : t("goalCreation.minutesSeconds", {
          minutes: Math.floor(elapsedSeconds / 60),
          seconds: elapsedSeconds % 60,
        });
  const progress = session.progress;
  const fallbackMessages: Partial<
    Record<GoalCreationSession["phase"], string[]>
  > = {
    goal_creation: [
      t("goalCreation.savingFoundation"),
      t("goalCreation.confirmingGoal"),
    ],
    icon: [t("goalCreation.creatingIcon")],
    planning: [
      t("goalCreation.analyzingFoundation"),
      t("goalCreation.researchingPlan"),
      t("goalCreation.generatingPlan"),
    ],
    module_shell: [
      t("goalCreation.splittingModules"),
      t("goalCreation.creatingStructure"),
    ],
    first_unit_kacom: [
      t("goalCreation.buildingFirstLessonModel"),
      t("goalCreation.checkingFirstLesson"),
      t("goalCreation.preparingFirstLessonContent"),
    ],
    first_unit: [
      t("goalCreation.generatingFirstModule"),
      t("goalCreation.organizingFirstUnits"),
      t("goalCreation.firstLessonWillStart"),
    ],
  };
  const phaseMessages = fallbackMessages[session.phase] ?? [
    goalCreationShortStatus(session, t),
  ];
  const liveMessage =
    latestLiveGoalCreationMessage(events) ??
    phaseMessages[Math.floor(elapsedSeconds / 10) % phaseMessages.length];
  const progressMessage =
    progress && progress.moduleCount > 0
      ? session.flowMode === "agentic"
        ? t("goalCreation.agenticModuleProgress", {
            prepared: progress.preparedModuleCount ?? 0,
            published: progress.publishedModuleCount ?? 0,
            failed: progress.failedModuleCount ?? 0,
            modules: progress.moduleCount,
            audit: progress.auditStatus ?? "idle",
          })
        : t("goalCreation.readyProgress", {
            readyModules: progress.readyModuleCount,
            modules: progress.moduleCount,
            readyUnits: progress.readyUnitCount,
            units: progress.unitCount,
          })
      : null;

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto px-4 py-5 sm:px-6"
      aria-live="polite"
      aria-label={t("goalCreation.liveProgress")}
    >
      <div
        className={cn(
          "rounded-xl border px-4 py-3.5",
          needsRetry
            ? "border-destructive/25 bg-destructive/5"
            : "border-primary/15 bg-primary/[0.06]",
        )}
      >
        <div className="flex items-start gap-3">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-start gap-3 text-left"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((value) => !value)}
          >
            <div
              className={cn(
                "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
                needsRetry
                  ? "bg-destructive/10 text-destructive"
                  : "bg-primary/10 text-primary",
              )}
            >
              {running ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : needsRetry ? (
                <AlertTriangle className="size-4" />
              ) : (
                <Check className="size-4" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">
                {needsRetry
                  ? t("assistant.creationStatus.needsAttentionTitle")
                  : t("goalCreation.nowWorking")}
              </p>
              <p className="mt-1 text-sm leading-6 text-foreground">
                {needsRetry
                  ? t("assistant.creationStatus.retryableError")
                  : liveMessage}
                {running ? (
                  <span className="inline-flex w-5 justify-start" aria-hidden>
                    {".".repeat((elapsedSeconds % 3) + 1)}
                  </span>
                ) : null}
              </p>
              {needsRetry && liveMessage ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {liveMessage}
                </p>
              ) : null}
              {progressMessage ? (
                <p
                  className={cn(
                    "mt-1 text-xs",
                    (progress?.failedModuleCount ?? 0) > 0
                      ? "font-medium text-destructive"
                      : "text-muted-foreground",
                  )}
                >
                  {progressMessage}
                </p>
              ) : null}
              <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                {t("goalCreation.stepElapsed", { elapsed: elapsedText })}
              </p>
            </div>
            <ChevronDown
              className={cn(
                "mt-1 size-4 shrink-0 text-muted-foreground transition-transform",
                detailsOpen && "rotate-180",
              )}
              aria-hidden
            />
          </button>
          {needsRetry ? (
            <GoalCreationRetryButton
              sessionId={session.id}
              disabled={actionBusy}
              className="mt-0.5"
            />
          ) : null}
        </div>
        {detailsOpen && progress?.modules?.length ? (
          <ul
            className="mt-3 space-y-1.5 pl-11"
            aria-label={t("goalCreation.moduleList")}
          >
            {progress.modules.map((module) => (
              <li
                key={module.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-background/70 px-2.5 py-1.5 text-xs"
              >
                <span className="min-w-0 truncate font-medium text-foreground">
                  {module.title}
                </span>
                <span
                  className={cn(
                    "shrink-0",
                    module.status === "failed"
                      ? "font-medium text-destructive"
                      : "text-muted-foreground",
                  )}
                >
                  {t(
                    (DRAFT_STATUS_KEYS[
                      module.status === "queued" ? "researching" : module.status
                    ] ??
                      "goalCreation.draftStatus.researching") as TranslationKey,
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {session.phase === "planning" && planProgress && !needsRetry ? (
        <div className="shrink-0">
          <GoalPlanStreamCard preview={planProgress.preview} />
        </div>
      ) : null}
      {needsRetry ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-destructive/20 bg-destructive/5 px-6 py-10">
          <p className="max-w-sm text-center text-sm leading-6 text-foreground">
            {t("goalCreation.needsAttentionGuidance")}
          </p>
          <GoalCreationRetryButton
            sessionId={session.id}
            prominent
            disabled={actionBusy}
          />
        </div>
      ) : (
        <p className="mt-auto pt-6 text-center text-xs text-muted-foreground">
          {session.status === "stopped"
            ? t("goalCreation.stopped")
            : t("goalCreation.autoContinues")}
        </p>
      )}
    </div>
  );
}

export function GoalCreationFlow({
  variant,
  goalId,
  pageContext,
  pendingGoalStart = null,
  onPendingGoalStartConsumed,
  surfaceActions,
  onHeaderPointerDown,
  onResponseReady,
  onClose,
  className,
}: {
  variant: "assistant" | "page" | "goal";
  goalId?: string;
  pageContext?: AgentPageContext;
  pendingGoalStart?: PendingGoalStart | null;
  onPendingGoalStartConsumed?: () => void;
  surfaceActions?: ReactNode;
  onHeaderPointerDown?: ComponentProps<
    typeof AgentChatWorkspace
  >["onHeaderPointerDown"];
  onResponseReady?: () => void;
  onClose?: () => void;
  className?: string;
}) {
  const t = useT();
  const navigate = useNavigate();
  const { confirm, alert } = useConfirm();
  const activeQuery = useActiveGoalCreationSession(!goalId);
  const goalQuery = useGoalCreationSessionByGoal(goalId ?? "");
  const actions = useGoalCreationSessionActions();
  const creationAttemptRef = useRef<PendingGoalStart | null>(null);
  const [expanded, setExpanded] = useState(variant !== "goal");
  const response = goalId ? goalQuery.data : activeQuery.data;
  const liveSession = response?.session ?? null;
  const lastSessionRef = useRef<GoalCreationSession | null>(null);
  const seenInProgressRef = useRef(false);
  const awaitingFirstLessonRef = useRef(false);
  if (liveSession?.status === "running" && !liveSession.firstUnitId) awaitingFirstLessonRef.current = true;
  const confirmedSessionIdRef = useRef<string | null>(null);
  const goalCreationConfirmedRef = useRef(false);
  if (liveSession) lastSessionRef.current = liveSession;
  if (liveSession && !["completed", "stopped"].includes(liveSession.status)) {
    seenInProgressRef.current = true;
  }
  const displaySession = liveSession ?? lastSessionRef.current;
  if (displaySession?.id !== confirmedSessionIdRef.current) {
    confirmedSessionIdRef.current = displaySession?.id ?? null;
    goalCreationConfirmedRef.current = false;
  }
  if (
    displaySession?.phase === "intake" ||
    displaySession?.phase === "goal_scope"
  ) {
    goalCreationConfirmedRef.current = false;
  } else if (displaySession && displaySession.phase !== "confirmation") {
    goalCreationConfirmedRef.current = true;
  }
  const loading = goalId ? goalQuery.isPending : activeQuery.isPending;
  const eventsQuery = useGoalCreationSessionEvents(
    displaySession?.id ?? "",
    Boolean(displaySession),
    Boolean(
      liveSession && !["completed", "stopped"].includes(liveSession.status),
    ),
  );

  useEffect(() => {
    if (!pendingGoalStart) {
      creationAttemptRef.current = null;
      return;
    }
    if (
      goalId ||
      !activeQuery.isSuccess ||
      liveSession ||
      actions.create.isPending ||
      creationAttemptRef.current === pendingGoalStart
    ) {
      return;
    }
    creationAttemptRef.current = pendingGoalStart;
    actions.create.mutate();
  }, [
    actions.create.isPending,
    actions.create.mutate,
    activeQuery.isSuccess,
    goalId,
    pendingGoalStart,
    liveSession,
  ]);

  useEffect(() => {
    if (!liveSession || variant !== "goal") return;
    if (liveSession.status !== "completed") setExpanded(true);
  }, [liveSession, variant]);

  useEffect(() => {
    if (!seenInProgressRef.current) return;
    const known = liveSession ?? lastSessionRef.current;
    if (variant !== "goal" && awaitingFirstLessonRef.current && known?.status === "running" && known.firstUnitId && known.goalId) {
      awaitingFirstLessonRef.current = false;
      onClose?.();
      navigate(`/goals/${known.goalId}/units/${known.firstUnitId}`);
      return;
    }
    const events = eventsQuery.data?.events ?? [];
    const doneEvent = events
      .slice()
      .reverse()
      .find((event) => event.type === "done");
    const finishedEvent = events
      .slice()
      .reverse()
      .find(
        (event) =>
          event.type === "completed" || event.type === "session_completed",
      );
    const eventNavigateTo =
      typeof doneEvent?.payload.navigateTo === "string"
        ? doneEvent.payload.navigateTo
        : typeof finishedEvent?.payload.navigateTo === "string"
          ? finishedEvent.payload.navigateTo
          : undefined;
    const destination =
      eventNavigateTo ??
      goalCreationAutoOpenPath(known, {
        finished:
          (!liveSession && Boolean(known?.goalId)) || Boolean(finishedEvent),
      });
    if (!destination) return;
    onClose?.();
    navigate(destination, { replace: true });
  }, [eventsQuery.data?.events, liveSession, navigate, onClose, variant]);

  const isBusy =
    actions.retry.isPending ||
    actions.stop.isPending ||
    actions.remove.isPending;
  const journeyText = useMemo(() => {
    if (!displaySession?.progress?.moduleCount) return null;
    if (displaySession.flowMode === "agentic") {
      return t("goalCreation.agenticModuleProgress", {
        prepared: displaySession.progress.preparedModuleCount ?? 0,
        published: displaySession.progress.publishedModuleCount ?? 0,
        failed: displaySession.progress.failedModuleCount ?? 0,
        modules: displaySession.progress.moduleCount,
        audit: displaySession.progress.auditStatus ?? "idle",
      });
    }
    return t("goalCreation.readyProgress", {
      readyModules: displaySession.progress.readyModuleCount,
      modules: displaySession.progress.moduleCount,
      readyUnits: displaySession.progress.readyUnitCount,
      units: displaySession.progress.unitCount,
    });
  }, [displaySession?.flowMode, displaySession?.progress, t]);
  const visibleEvents = useMemo(
    () =>
      (eventsQuery.data?.events ?? [])
        .filter((event) =>
          isMeaningfulGoalCreationEvent(event.type, event.payload),
        )
        .map((event) => ({
          ...event,
          text: eventText(event.type, event.payload, t),
        }))
        .filter(
          (
            event,
          ): event is GoalCreationSessionEvent & {
            text: string;
          } => Boolean(event.text),
        )
        .slice(-40),
    [eventsQuery.data?.events, t],
  );
  const goalCreationProgress = useMemo<
    GoalCreationLiveProgress | undefined
  >(() => {
    if (
      !displaySession ||
      !["running", "stop_requested"].includes(displaySession.status)
    ) {
      return undefined;
    }
    return {
      active: true,
      phaseLabel: t(
        GOAL_CREATION_PHASE_LABEL_KEYS[displaySession.phase] as TranslationKey,
      ),
      status: goalCreationShortStatus(displaySession, t),
      latestEvent: latestLiveGoalCreationMessage(visibleEvents),
    };
  }, [displaySession, t, visibleEvents]);

  const sessionQuery = goalId ? goalQuery : activeQuery;
  const bootstrapError = sessionQuery.error ?? actions.create.error;

  if (!liveSession && bootstrapError) {
    const retryBootstrap = () => {
      if (sessionQuery.isError) {
        void sessionQuery.refetch();
        return;
      }
      if (!pendingGoalStart) return;
      actions.create.reset();
      creationAttemptRef.current = pendingGoalStart;
      actions.create.mutate();
    };
    return (
      <div
        role="alert"
        className={cn(
          "flex min-h-48 items-center justify-center px-5",
          className,
        )}
      >
        <div className="max-w-md space-y-3 text-center">
          <p className="text-sm text-destructive">
            {bootstrapError instanceof Error
              ? bootstrapError.message
              : t("goalCreation.tryAgainLater")}
          </p>
          <div className="flex justify-center gap-2">
            <Button type="button" variant="outline" onClick={retryBootstrap}>
              <RotateCcw className="size-3.5" />
              {t("goalCreation.retry")}
            </Button>
            {onClose ? (
              <Button type="button" variant="ghost" onClick={onClose}>
                {t("common.close")}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  if ((loading || pendingGoalStart) && !liveSession && !displaySession) {
    return (
      <div
        className={cn("flex min-h-48 items-center justify-center", className)}
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          {t("goalCreation.preparingWorkspace")}
        </div>
      </div>
    );
  }

  if (!displaySession) return null;
  const session = displaySession;
  const sessionId = session.id;
  const showLiveFeed = goalCreationShowsLiveFeed(session, {
    goalCreationConfirmed: goalCreationConfirmedRef.current,
  });

  async function stopSession() {
    const ok = await confirm({
      title: t("goalCreation.stopTitle"),
      description: t("goalCreation.stopDescription"),
      variant: "destructive",
      confirmLabel: t("goalCreation.stopAction"),
    });
    if (ok) actions.stop.mutate(sessionId);
  }

  async function deleteSession(createNext: boolean) {
    const ok = await confirm({
      title: createNext
        ? t("goalCreation.deleteAndCreateTitle")
        : t("goalCreation.deleteTitle"),
      description: t("goalCreation.deleteDescription"),
      variant: "destructive",
      confirmLabel: createNext
        ? t("goalCreation.deleteAndCreate")
        : t("common.delete"),
    });
    if (!ok) return;
    actions.remove.mutate(sessionId, {
      onSuccess: () => {
        if (createNext) {
          actions.create.mutate();
        } else {
          onClose?.();
          navigate("/goals");
        }
      },
      onError: (error) =>
        void alert({
          title: t("goalCreation.deleteFailed"),
          description:
            error instanceof Error
              ? error.message
              : t("goalCreation.tryAgainLater"),
        }),
    });
  }

  const readOnly = ["stopped", "completed"].includes(session.status);
  const showChat = variant !== "goal" || expanded;
  const compactHeader = variant === "assistant";

  const sessionActions = (
    <>
      {session.actions.canRetry ? (
        <GoalCreationRetryButton sessionId={session.id} disabled={isBusy} />
      ) : null}
      {session.actions.canStop ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isBusy}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => void stopSession()}
        >
          <CircleStop className="size-3.5" />
          {t("goalCreation.stop")}
        </Button>
      ) : null}
      {variant === "goal" ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => setExpanded((value) => !value)}
          aria-label={
            expanded
              ? t("goalCreation.collapseDetails")
              : t("goalCreation.expandDetails")
          }
        >
          {expanded ? (
            <ChevronUp className="size-4" />
          ) : (
            <ChevronDown className="size-4" />
          )}
        </Button>
      ) : null}
    </>
  );

  return (
    <section
      className={cn(
        "flex min-h-0 flex-col overflow-hidden border border-[var(--border-200)] bg-[var(--bg-50)]",
        variant === "assistant" ? "h-full border-0" : "rounded-2xl shadow-card",
        className,
      )}
    >
      <div className="shrink-0 border-b border-[var(--border-200)] bg-[var(--bg-100)] px-3 py-2 sm:px-5 sm:py-3.5">
        {compactHeader ? (
          <>
            <div className="flex min-w-0 items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="shrink-0 text-sm font-semibold tracking-tight text-foreground">
                  {t("goalCreation.title")}
                </h2>
                <span className="truncate rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                  {t(
                    GOAL_CREATION_PHASE_LABEL_KEYS[
                      session.phase
                    ] as TranslationKey,
                  )}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-0.5 [&>button]:size-8">
                {surfaceActions}
              </div>
            </div>
            <div className="mt-1.5 flex min-w-0 items-start justify-between gap-2">
              <p className="min-w-0 text-sm leading-6 text-foreground">
                {statusCopy(session, t)}
                {journeyText ? (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {journeyText}
                  </span>
                ) : null}
              </p>
              <div className="flex shrink-0 items-center gap-1">
                {sessionActions}
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold tracking-tight text-foreground sm:text-base">
                {t("goalCreation.title")}
              </h2>
              <p className="mt-1 text-sm leading-6 text-foreground sm:text-[15px]">
                {statusCopy(session, t)}
                {journeyText ? (
                  <span className="mt-0.5 block text-xs text-muted-foreground sm:text-sm">
                    {journeyText}
                  </span>
                ) : null}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {sessionActions}
              {surfaceActions ? (
                <>
                  <span
                    className="mx-0.5 hidden h-4 w-px bg-border sm:block"
                    aria-hidden
                  />
                  {surfaceActions}
                </>
              ) : null}
            </div>
          </div>
        )}
        <div className="mt-2 sm:mt-3.5">
          <CreationProgress
            session={session}
            message={
              goalCreationProgress?.latestEvent || goalCreationProgress?.status
            }
            showActivity={!showLiveFeed}
          />
        </div>
        {session.status === "stopped" ? (
          <div className="mt-3 flex flex-wrap gap-2 rounded-xl border border-destructive/20 bg-destructive/5 p-3">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={isBusy}
              onClick={() => void deleteSession(true)}
            >
              <Trash2 className="size-4" />
              {t("goalCreation.deleteAndCreateGoal")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isBusy}
              onClick={() => void deleteSession(false)}
            >
              {t("goalCreation.deleteDraft")}
            </Button>
          </div>
        ) : null}
        {session.goalId &&
        session.firstUnitId ? (
          <div className="mt-3">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                onClose?.();
                navigate(
                  `/goals/${session.goalId}/units/${session.firstUnitId}`,
                );
              }}
            >
              {t("goalCreation.startFirstLesson")}
            </Button>
          </div>
        ) : null}
      </div>

      {showChat ? (
        <div
          className={cn(
            "min-h-0 flex-1",
            variant === "goal" && "h-[min(62vh,620px)] flex-none",
          )}
        >
          {showLiveFeed ? (
            <AutomaticCreationFeed
              events={visibleEvents}
              planningEvents={eventsQuery.data?.events ?? []}
              session={session}
              actionBusy={isBusy}
            />
          ) : (
            <AgentChatWorkspace
              key={session.threadId}
              variant="panel"
              initialScope="goal_creation"
              initialThreadId={session.threadId}
              goalCreationSessionId={session.id}
              pageContext={pageContext}
              goalCreationProgress={goalCreationProgress}
              contextLabel={t("goalCreation.title")}
              pendingGoalStart={
                session.status === "stopped" ? null : pendingGoalStart
              }
              pendingToolUiFallback={goalCreationPendingToolUi(session)}
              onPendingGoalStartConsumed={onPendingGoalStartConsumed}
              onComplete={(result) => {
                const destination = agentDoneDestination(result);
                if (!destination) return;
                onClose?.();
                navigate(destination);
              }}
              onClose={onClose}
              onHeaderPointerDown={onHeaderPointerDown}
              onResponseReady={onResponseReady}
              readOnly={readOnly}
              className="h-full"
            />
          )}
        </div>
      ) : null}
    </section>
  );
}
