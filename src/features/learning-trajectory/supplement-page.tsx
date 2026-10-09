import { useMainline } from "@/features/learning-mainline/provider";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Link,
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { CornerUpLeft, Pause, MessageCircle } from "lucide-react";
import type { LearningPosition, LearningVisit } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { AnchoredLearningMaterial } from "@/components/wizard/anchored-learning-material";
import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import { ApiErrorNotice } from "@/components/ui/api-error-notice";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import { isDesktopLocalRuntime } from "@xue-learn/core/source/src/shared/runtime/client-runtime.ts";
import { apiPost } from "@/shared/api";
import { useAssistant } from "@/components/agent/assistant-provider";
import {
  useLearningBranch,
  useLearningTrajectory,
  useRefreshLearningTrajectory,
} from "./use-learning-trajectory.ts";
import {
  captureReadingPosition,
  learningReturnPath,
  learningSessionId,
  queueLearningReturn,
  rememberLearningPosition,
  restoreReadingPosition,
} from "./navigation.ts";
import { LearningBranchCard } from "./branch-card.tsx";

export function LearningSupplementPage() {
  const { goalId = "", unitId = "", branchId = "" } = useParams();
  const mainline = useMainline();
  const [params, setParams] = useSearchParams(),
    navigate = useNavigate(),
    t = useT(),
    assistant = useAssistant();
  const detail = useLearningBranch(branchId),
    trajectory = useLearningTrajectory(unitId),
    refresh = useRefreshLearningTrajectory();
  const [visit, setVisit] = useState<LearningVisit | null>(null),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false),
    [advice, setAdvice] = useState("");
  const visitRef = useRef(visit);
  visitRef.current = visit;
  const root = useRef<HTMLDivElement>(null),
    restored = useRef<string | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    pendingPosition = useRef<LearningPosition | null>(null),
    saving = useRef(false);
  const viewport = useRef<HTMLDivElement>(null);
  const [viewportHeight, setViewportHeight] = useState<number>();
  const branch = detail.data?.branch,
    material = detail.data?.material;
  useLayoutEffect(() => {
    const measure = () => {
      if (!viewport.current) return;
      const height = Math.max(
        240,
        window.innerHeight - viewport.current.getBoundingClientRect().top - 16,
      );
      setViewportHeight((current) => (current === height ? current : height));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [branch?.id]);
  const guidance = trajectory.data?.events.find(
    (e) => e.kind === "suggestion" && e.visitId === visit?.id && e.text,
  );
  useEffect(() => {
    if (guidance?.text) setAdvice(guidance.text);
  }, [guidance?.id]);
  useEffect(() => {
    const found = trajectory.data?.visits.find(
      (v) => v.id === params.get("learningVisit") && v.branchId === branchId,
    );
    if (found)
      setVisit((current) =>
        !current || found.revision > current.revision ? found : current,
      );
  }, [trajectory.data?.visits, params, branchId]);
  useEffect(() => {
    if (!visit || !material || !root.current || restored.current === visit.id)
      return;
    restored.current = visit.id;
    if (visit.position)
      restoreReadingPosition(root.current, material, visit.position);
  }, [visit, material]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  if (!isDesktopLocalRuntime())
    return <Navigate to={`/goals/${goalId}/units/${unitId}`} replace />;
  const updatePosition = async () => {
    const current = visitRef.current,
      position = pendingPosition.current;
    if (!current || !position || saving.current || current.state === "returned")
      return;
    saving.current = true;
    pendingPosition.current = null;
    try {
      const updated = await apiPost<LearningVisit>(
        `/api/learning-trajectory/visits/${current.id}/actions`,
        { revision: current.revision, action: "position", position },
      );
      visitRef.current = updated;
      setVisit(updated);
    } catch {
      /* Keep reading usable; the last durable bookmark remains authoritative. */ pendingPosition.current =
        position;
    } finally {
      saving.current = false;
    }
  };
  const onScroll = () => {
    if (!material || !branch?.sectionId || !root.current) return;
    const top = root.current.getBoundingClientRect().top;
    const blocks = [
      ...root.current.querySelectorAll<HTMLElement>("[data-block-index]"),
    ];
    const visible = blocks.find(
      (el) => el.getBoundingClientRect().bottom > Math.max(100, top),
    );
    const index = Number(visible?.dataset.blockIndex ?? 0);
    const position = captureReadingPosition(
      unitId,
      branch.sectionId,
      material,
      { scope: "block", blockIndex: index },
    );
    rememberLearningPosition(position);
    pendingPosition.current = position;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void updatePosition(), 700);
  };
  const enter = async () => {
    if (!branch) return;
    setBusy(true);
    try {
      if (mainline) {
        const saved = await mainline.command({
          action: "start",
          unitId,
          goalId,
          kind: "supplement",
          branchId,
        });
        const activity = saved.activities.find(
          (a) => a.id === saved.focus.activityId,
        )!;
        setParams({ learningVisit: activity.visitId! }, { replace: true });
        await refresh();
        return;
      }
      const created = await apiPost<LearningVisit>(
        `/api/learning-trajectory/branches/${branch.id}/enter`,
        {
          visitId: crypto.randomUUID(),
          sessionId: learningSessionId(),
          returnPosition: visit?.returnPosition ?? branch.origin,
        },
      );
      setVisit(created);
      visitRef.current = created;
      setParams({ learningVisit: created.id }, { replace: true });
      await refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const leave = async (action: "pause" | "return") => {
    if (!branch) return;
    if (
      mainline?.current?.kind === "supplement" &&
      mainline.current.branchId === branchId &&
      mainline.current.returnActivityId
    ) {
      setBusy(true);
      try {
        await mainline.returnToSource();
        await refresh();
      } catch (e) {
        setError(e);
      } finally {
        setBusy(false);
      }
      return;
    }
    const position = visit?.returnPosition ?? branch.origin;
    queueLearningReturn(position);
    sessionStorage.setItem(
      `xuelearn.learning-bridge:${unitId}`,
      JSON.stringify({ title: branch.title, returnGoal: branch.returnGoal }),
    );
    // Restore navigation immediately; persistence and any AI advice never trap the learner.
    const current = visitRef.current;
    if (current) {
      const payload = {
        revision: current.revision,
        action,
        ...(pendingPosition.current
          ? { position: pendingPosition.current }
          : {}),
      };
      sessionStorage.setItem(
        `xuelearn.learning-return-pending:${current.id}`,
        JSON.stringify(payload),
      );
      void apiPost(
        `/api/learning-trajectory/visits/${current.id}/actions`,
        payload,
      )
        .then(() => {
          sessionStorage.removeItem(
            `xuelearn.learning-return-pending:${current.id}`,
          );
          return refresh();
        })
        .catch(() => undefined);
    }
    navigate(
      learningReturnPath(goalId, position) +
        (current ? `&finishVisit=${current.id}&visitAction=${action}` : ""),
    );
  };
  const feedback = async (kind: "understood" | "content_finished") => {
    if (!visit) return;
    setAdvice(t("trajectory.canReturn"));
    try {
      const result = await apiPost<{ message: string }>(
        `/api/learning-trajectory/visits/${visit.id}/feedback`,
        { kind, eventId: crypto.randomUUID() },
      );
      if (result.message) setAdvice(result.message);
      await refresh();
    } catch {
      /* Returning always remains available without an AI reply. */
    }
  };
  if (detail.isError)
    return (
      <div className="p-4">
        <ApiErrorNotice error={detail.error} />
        <Link to={`/goals/${goalId}/units/${unitId}`}>
          {t("trajectory.return")}
        </Link>
      </div>
    );
  if (!branch)
    return (
      <p role="status" className="p-4">
        {t("trajectory.loading")}
      </p>
    );
  return (
    <div
      ref={viewport}
      style={{ height: viewportHeight }}
      className="flex min-h-0 shrink-0 flex-col overflow-hidden"
      onScrollCapture={onScroll}
    >
      <header className="sticky top-0 z-20 shrink-0 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">
              {t("trajectory.studying")}
            </p>
            <h1 className="text-lg font-semibold">{branch.title}</h1>
            <p className="line-clamp-2 text-sm text-muted-foreground">
              {branch.returnGoal}
            </p>
          </div>
          <Button onClick={() => void leave("return")}>
            <CornerUpLeft className="size-4" />
            {t("trajectory.return")}
          </Button>
        </div>
      </header>
      <main ref={root} className="min-h-0 flex-1 overflow-auto px-4 py-6">
        <div className="mx-auto max-w-5xl space-y-5">
          {error ? <ApiErrorNotice error={error} /> : null}
          {!visit || visit.state !== "active" ? (
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="mb-3 text-sm">{t("trajectory.resumeHint")}</p>
              <div className="flex gap-2">
                <Button
                  disabled={busy || !material}
                  onClick={() => void enter()}
                >
                  {t("trajectory.continueSupplement")}
                </Button>
                <Button variant="ghost" onClick={() => void leave("return")}>
                  {t("trajectory.return")}
                </Button>
              </div>
            </div>
          ) : null}
          {branch.status !== "ready" ? (
            <LearningBranchCard branchId={branch.id} />
          ) : material && branch.sectionId ? (
            <AnchoredLearningMaterial
              unitId={unitId}
              goalId={goalId}
              sectionId={branch.sectionId}
              material={material}
              continuous
            />
          ) : (
            <p>{t("trajectory.contentUnavailable")}</p>
          )}
          {material && (
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-sm text-muted-foreground">
                {t("trajectory.enoughHint")}
              </p>
              {advice && (
                <p role="status" className="mt-3 text-sm leading-6">
                  {advice}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="ghost"
                  onClick={() => void feedback("content_finished")}
                >
                  {t("trajectory.event.content_finished")}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void feedback("understood")}
                >
                  {t("trajectory.understood")}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    assistant.openUnitFollowUp(
                      unitId,
                      `supplement:${branch.id}`,
                      {
                        goalId,
                        anchor: {
                          scope: "introduction",
                          sectionId: branch.sectionId!,
                        },
                        learningPosition: {
                          version: 1,
                          unitId,
                          sectionId: branch.sectionId!,
                          mode: "reading",
                          anchorText: branch.title,
                        },
                        activeVisitId: visit?.id,
                        initialMessage: t("trajectory.needAnotherExplanation"),
                      },
                    );
                  }}
                >
                  <MessageCircle className="size-4" />
                  {t("trajectory.ask")}
                </Button>
                <Button variant="ghost" onClick={() => void leave("pause")}>
                  <Pause className="size-4" />
                  {t("trajectory.pause")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
