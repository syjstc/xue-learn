import { AlertTriangle, ChevronRight, CircleStop, LoaderCircle } from "lucide-react";
import { useAssistant } from "@/components/agent/assistant-provider";
import { GoalCreationRetryButton } from "@/components/agent/goal-creation-retry-button";
import {
  goalCreationNeedsRetry,
  goalCreationShortStatus,
  type GoalCreationSession,
} from "@/shared/agent/goal-creation-session";
import { cn } from "@xue-learn/core/source/src/shared/utils.ts";
import { useI18n } from "@xue-learn/core/source/src/shared/i18n/index.tsx";

export function GoalCreationStatusCard({
  session,
  className,
}: {
  session: GoalCreationSession;
  className?: string;
}) {
  const { openGoalCreationModal } = useAssistant();
  const { t } = useI18n();
  const stopped = session.status === "stopped";
  const needsRetry = goalCreationNeedsRetry(session);

  return (
    <div className={cn("space-y-3", className)}>
      <div
        className={cn(
          "flex w-full items-center gap-3 rounded-2xl border px-4 py-3",
          stopped || needsRetry
            ? "border-destructive/20 bg-destructive/5"
            : "border-primary/20 bg-primary/[0.06]",
        )}
      >
        <button
          type="button"
          onClick={openGoalCreationModal}
          className="flex min-w-0 flex-1 items-center gap-3 text-left transition-colors"
        >
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-xl",
              stopped || needsRetry
                ? "bg-destructive/10 text-destructive"
                : "bg-primary/10 text-primary",
            )}
          >
            {stopped ? (
              <CircleStop className="size-4" />
            ) : needsRetry ? (
              <AlertTriangle className="size-4" />
            ) : (
              <LoaderCircle className="size-4 animate-spin" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-foreground">
              {stopped
                ? t("assistant.creationStatus.stoppedTitle")
                : needsRetry
                  ? t("assistant.creationStatus.needsAttentionTitle")
                  : t("assistant.creationStatus.runningTitle")}
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {stopped
                ? t("assistant.creationStatus.deleteDraft")
                : goalCreationShortStatus(session, t)}
            </span>
          </span>
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-0.5 text-sm font-medium",
              needsRetry ? "text-destructive" : "text-primary",
            )}
          >
            {t("assistant.creationStatus.view")}
            <ChevronRight className="size-4" />
          </span>
        </button>
        {needsRetry ? <GoalCreationRetryButton sessionId={session.id} /> : null}
      </div>
      {needsRetry ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-destructive/20 bg-destructive/5 px-6 py-8">
          <p className="max-w-sm text-center text-sm leading-6 text-foreground">
            {t("goalCreation.needsAttentionGuidance")}
          </p>
          <GoalCreationRetryButton sessionId={session.id} prominent />
        </div>
      ) : null}
    </div>
  );
}
