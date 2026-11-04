"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, LoaderCircle } from "lucide-react";
import { useT, type TranslationKey } from "@xue-learn/core/i18n";
import { cn } from "@xue-learn/core/utils";
import {
  AGENTIC_GOAL_CREATION_PHASE_ORDER,
  GOAL_CREATION_PHASE_LABEL_KEYS,
  GOAL_CREATION_PHASE_ORDER,
  goalCreationNeedsRetry,
  goalCreationShortStatus,
  type GoalCreationSession,
} from "@/shared/agent/goal-creation-session";
import { goalCreationStepElapsedSeconds } from "@/shared/agent/goal-creation-elapsed";

export function CreationProgress({
  session,
  message,
  showActivity = true,
}: {
  session: GoalCreationSession;
  message?: string;
  showActivity?: boolean;
}) {
  const t = useT();
  const running = session.status === "running";
  const [now, setNow] = useState(() => Date.now());
  const stepKey = `${session.id}:${session.phase}:${session.status}`;
  const stepRef = useRef({
    key: stepKey,
    at: Date.now(),
    startedAt: session.updatedAt,
  });
  if (stepRef.current.key !== stepKey) {
    stepRef.current = {
      key: stepKey,
      at: Date.now(),
      startedAt: session.updatedAt,
    };
  }
  useEffect(() => {
    if (!running || !showActivity) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running, showActivity, stepKey]);
  const elapsedSeconds = goalCreationStepElapsedSeconds({
    startedAt: stepRef.current.startedAt,
    seenAtMs: stepRef.current.at,
    nowMs: now,
  });
  const elapsed =
    elapsedSeconds < 60
      ? t("goalCreation.seconds", { value: elapsedSeconds })
      : t("goalCreation.minutesSeconds", {
          minutes: Math.floor(elapsedSeconds / 60),
          seconds: elapsedSeconds % 60,
        });
  const phaseOrder =
    session.flowMode === "automatic"
      ? ([
          "goal_creation",
          "icon",
          "planning",
          "module_shell",
          "first_unit",
          "ready",
        ] satisfies GoalCreationSession["phase"][])
      : session.flowMode === "agentic"
        ? AGENTIC_GOAL_CREATION_PHASE_ORDER
        : GOAL_CREATION_PHASE_ORDER;
  const total = phaseOrder.length;
  const progressPhase =
    session.phase === "first_unit_kacom"
      ? "first_unit"
      : session.phase === "plan_review" && !phaseOrder.includes("plan_review")
        ? "planning"
        : session.phase;
  const current = phaseOrder.indexOf(progressPhase);
  const completed = session.status === "completed";
  const needsRetry = goalCreationNeedsRetry(session);
  const progressIndex = completed ? total - 1 : Math.max(current, 0);
  const progressPercent = Math.max(
    8,
    Math.min(100, ((progressIndex + 1) / total) * 100),
  );

  return (
    <div className="space-y-2 sm:space-y-2.5">
      <ol
        className="hidden w-full items-center sm:flex"
        aria-label={t("goalCreation.progress")}
      >
        {phaseOrder.map((phase, index) => {
          const done = completed || index < current;
          const active = !completed && index === current;
          const segmentFilled = completed || index < current;
          return (
            <li
              key={phase}
              className={cn(
                "flex items-center",
                index < total - 1 ? "min-w-0 flex-1" : "shrink-0",
              )}
            >
              <span
                className={cn(
                  "relative z-10 flex size-[22px] shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold transition-colors",
                  done && "border-primary bg-primary text-primary-foreground",
                  active &&
                    needsRetry &&
                    "border-destructive bg-destructive/10 text-destructive ring-2 ring-destructive/25",
                  active &&
                    !needsRetry &&
                    "border-primary bg-background text-primary ring-2 ring-primary/25",
                  !done &&
                    !active &&
                    "border-border bg-[var(--bg-100)] text-muted-foreground",
                )}
                title={t(
                  GOAL_CREATION_PHASE_LABEL_KEYS[phase] as TranslationKey,
                )}
                aria-current={active ? "step" : undefined}
                aria-label={`${index + 1}. ${t(GOAL_CREATION_PHASE_LABEL_KEYS[phase] as TranslationKey)}${
                  done
                    ? ` (${t("goalCreation.completed")})`
                    : active
                      ? ` (${t("goalCreation.inProgress")})`
                      : ""
                }`}
              >
                {done ? (
                  <Check className="size-3" strokeWidth={2.5} />
                ) : active && needsRetry ? (
                  <AlertTriangle className="size-3" />
                ) : active && session.status === "running" ? (
                  <LoaderCircle className="size-3 animate-spin" />
                ) : (
                  index + 1
                )}
              </span>
              {index < total - 1 ? (
                <span
                  className={cn(
                    "mx-1 h-0.5 min-w-2 flex-1 rounded-full transition-colors",
                    segmentFilled ? "bg-primary" : "bg-border/70",
                  )}
                  aria-hidden
                />
              ) : null}
            </li>
          );
        })}
      </ol>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <p className="min-w-0 text-sm leading-6 text-foreground sm:text-base">
          <span className="text-muted-foreground">
            {t("goalCreation.step", { current: progressIndex + 1, total })}
          </span>
          <span className="mx-1.5 text-border" aria-hidden>
            ·
          </span>
          <span className="font-semibold">
            {t(GOAL_CREATION_PHASE_LABEL_KEYS[session.phase] as TranslationKey)}
          </span>
        </p>
        {session.status === "running" ? (
          <LoaderCircle className="size-3.5 shrink-0 animate-spin text-primary" />
        ) : null}
      </div>
      <div
        className="h-1 overflow-hidden rounded-full bg-border/70 sm:hidden"
        role="progressbar"
        aria-label={t("goalCreation.progress")}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={progressIndex + 1}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
      {running && showActivity ? (
        <div className="rounded-lg border border-primary/15 bg-primary/[0.06] px-3 py-2">
          <p
            role="status"
            aria-live="polite"
            className="text-sm leading-6 text-foreground"
          >
            {message || goalCreationShortStatus(session, t)}
          </p>
          <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
            {t("goalCreation.stepElapsed", { elapsed })}
          </p>
          {elapsedSeconds >= 30 ? (
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t("goalCreation.autoContinues")}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
