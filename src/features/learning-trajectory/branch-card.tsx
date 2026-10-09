import { useMainline } from "@/features/learning-mainline/provider";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { LearningBranch, LearningVisit } from "@xue-learn/core/domain";
import { BookOpen, CornerUpLeft, LoaderCircle } from "lucide-react";
import { apiGet, apiPost } from "@/shared/api";
import { Button } from "@xue-learn/core/ui/button";
import { ApiErrorNotice } from "@/components/ui/api-error-notice";
import { useT } from "@xue-learn/core/i18n";
import { currentLearningPosition, learningSessionId } from "./navigation.ts";
import {
  useLearningBranch,
  useRefreshLearningTrajectory,
} from "./use-learning-trajectory.ts";

export function LearningBranchCard({
  branchId,
  compact = false,
}: {
  branchId: string;
  compact?: boolean;
}) {
  const t = useT(),
    navigate = useNavigate(),
    query = useLearningBranch(branchId),
    refresh = useRefreshLearningTrajectory();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const [spaces, setSpaces] = useState<Array<{
      id: string;
      name: string;
    }> | null>(null),
    [spaceId, setSpaceId] = useState("");
  const [newSpaceName, setNewSpaceName] = useState("");
  const mainline = useMainline();
  const branch = query.data?.branch;
  useEffect(() => {
    if (branch) void refresh();
  }, [branch?.id, branch?.status]);
  if (!branch)
    return query.isError ? (
      <ApiErrorNotice error={query.error} />
    ) : (
      <span className="text-sm text-muted-foreground">
        {t("trajectory.loading")}
      </span>
    );
  const action = async (
    kind: "cancel" | "dismiss" | "defer" | "resume" | "retry",
  ) => {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/learning-trajectory/branches/${branch.id}/actions`, {
        revision: branch.revision,
        action: kind,
      });
      await refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const enter = async () => {
    setBusy(true);
    setError(null);
    try {
      const position = currentLearningPosition(branch.origin)!;
      let visitId: string;
      if (mainline) {
        const saved = await mainline.command({
          action: "start",
          unitId: branch.unitId,
          goalId: branch.goalId,
          kind: "supplement",
          branchId: branch.id,
          position,
        });
        visitId = saved.activities.find(
          (a) => a.id === saved.focus.activityId,
        )!.visitId!;
      } else {
        const visit = await apiPost<LearningVisit>(
          `/api/learning-trajectory/branches/${branch.id}/enter`,
          {
            visitId: crypto.randomUUID(),
            sessionId: learningSessionId(),
            returnPosition: position,
          },
        );
        visitId = visit.id;
      }
      await refresh();
      navigate(
        `/goals/${branch.goalId}/units/${branch.unitId}/supplements/${branch.id}?learningVisit=${visitId}`,
      );
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const openGoalProposal = async () => {
    setBusy(true);
    setError(null);
    try {
      const portfolio = await apiGet<{
        spaces: Array<{ id: string; name: string }>;
      }>("/api/learning-spaces");
      setSpaces(portfolio.spaces);
      setSpaceId(portfolio.spaces[0]?.id ?? "");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const confirmGoal = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await apiPost<{ spaceId: string; plannedGoalId: string }>(
        `/api/learning-trajectory/branches/${branch.id}/confirm-goal`,
        { spaceId },
      );
      await refresh();
      navigate(
        `/spaces/${encodeURIComponent(result.spaceId)}?plannedGoal=${encodeURIComponent(result.plannedGoalId)}`,
      );
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const createSpace = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/learning-spaces", { name: newSpaceName.trim() });
      const portfolio = await apiGet<{
        spaces: Array<{ id: string; name: string }>;
      }>("/api/learning-spaces");
      setSpaces(portfolio.spaces);
      setSpaceId(
        portfolio.spaces.find((s) => s.name === newSpaceName.trim())?.id ??
          portfolio.spaces[0]?.id ??
          "",
      );
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  if (branch.status === "dismissed")
    return (
      <p className="text-xs text-muted-foreground">
        {t("trajectory.dismissed")}
      </p>
    );
  return (
    <section
      aria-label={branch.title}
      className={`rounded-xl border border-border bg-card ${compact ? "p-3" : "p-4"} space-y-3`}
    >
      <div className="flex items-start gap-2">
        <BookOpen className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            {t(`trajectory.purpose.${branch.purpose}`)}
          </p>
          <h3 className="text-sm font-semibold">{branch.title}</h3>
        </div>
      </div>
      <p className="text-sm leading-6 text-muted-foreground">{branch.reason}</p>
      {branch.kind === "section" && (
        <ol className="list-inside list-decimal text-sm text-muted-foreground">
          {branch.topics.map((topic, i) => (
            <li key={i}>{topic}</li>
          ))}
        </ol>
      )}
      {branch.status === "preparing" && (
        <p
          role="status"
          className="flex items-center gap-2 text-xs text-muted-foreground"
        >
          <LoaderCircle className="size-3 animate-spin" />
          {t("trajectory.preparing")}
        </p>
      )}
      {(branch.status === "failed" || branch.status === "cancelled") && (
        <p role="status" className="text-sm text-muted-foreground">
          {t(
            branch.status === "failed"
              ? "trajectory.generationFailed"
              : "trajectory.cancelled",
          )}
        </p>
      )}
      {branch.deferred && (
        <p className="text-xs text-muted-foreground">
          {t("trajectory.savedForLater")}
        </p>
      )}
      {error ? <ApiErrorNotice error={error} /> : null}
      <div className="flex flex-wrap gap-2">
        {branch.status === "ready" && (
          <Button size="sm" disabled={busy} onClick={() => void enter()}>
            {t("trajectory.start")}
          </Button>
        )}
        {branch.status === "proposed" && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void openGoalProposal()}
          >
            {t("trajectory.reviewGoal")}
          </Button>
        )}
        {(branch.status === "failed" || branch.status === "cancelled") && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void action("retry")}
          >
            {t("trajectory.retry")}
          </Button>
        )}
        {branch.status === "preparing" && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void action("cancel")}
          >
            {t("trajectory.cancel")}
          </Button>
        )}
        {!branch.deferred && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void action("defer")}
          >
            {t("trajectory.later")}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => void action("dismiss")}
        >
          {t("trajectory.dismiss")}
        </Button>
      </div>
      {spaces && (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-sm">{t("trajectory.goalProposalHint")}</p>
          <label className="block text-sm">
            {t("trajectory.destination")}
            <select
              className="mt-1 block w-full rounded-md border border-input bg-background p-2"
              value={spaceId}
              onChange={(e) => setSpaceId(e.target.value)}
            >
              {spaces.map((space) => (
                <option key={space.id} value={space.id}>
                  {space.name}
                </option>
              ))}
            </select>
          </label>
          {!spaces.length && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {t("trajectory.needSpace")}
              </p>
              <label className="block text-sm">
                {t("spaces.name")}
                <input
                  className="mt-1 block w-full rounded-md border border-input bg-background p-2"
                  value={newSpaceName}
                  maxLength={80}
                  onChange={(e) => setNewSpaceName(e.target.value)}
                />
              </label>
              <Button
                size="sm"
                disabled={busy || !newSpaceName.trim()}
                onClick={() => void createSpace()}
              >
                {t("spaces.createFirst")}
              </Button>
            </div>
          )}
          <Button
            size="sm"
            disabled={busy || !spaceId}
            onClick={() => void confirmGoal()}
          >
            {t("trajectory.confirmGoal")}
          </Button>
        </div>
      )}
    </section>
  );
}
export function LearningReturnSuggestion({
  unitId,
  reason,
}: {
  unitId: string;
  reason: string;
}) {
  const t = useT();
  return (
    <div className="rounded-xl border border-border p-3 text-sm">
      <p>{reason}</p>
      <p className="mt-2 flex items-center gap-2 text-muted-foreground">
        <CornerUpLeft className="size-4" />
        {t("trajectory.useReturnEntry")}
      </p>
    </div>
  );
}
