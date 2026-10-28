import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { Button, buttonVariants } from "@xue-learn/core/ui/button";
import { ApiErrorNotice } from "@/components/ui/api-error-notice";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InlineGenStream } from "@/components/ai/inline-gen-stream";
import { AnchoredLearningMaterial } from "@/components/wizard/anchored-learning-material";
import { LlmMarkdown } from "@/components/markdown/llm-markdown";
import { isNotFound } from "@/shared/api";
import {
  useFullGoal,
  useInvalidateGoal,
  useLearnerDisplayName,
  useUpdateGoalOverviewUnitProgress,
} from "@/hooks/api";
import { useAiGeneration } from "@/hooks/use-ai-generation";
import { useConfirm } from "@/hooks/use-confirm";
import { isMicroGoal } from "@/shared/domain/goal-kind";
import { personalizeLearnerText } from "@/shared/domain/learner-text";
import { ForceSubdividePanel } from "@/components/map/force-subdivide-panel";
import type { SseEvent } from "@/shared/llm/sse";
import type { LearningMaterialContent } from "@xue-learn/core/schemas";
import { GoalDocumentsPanel } from "@/components/goals/goal-documents-panel";
import {
  FEATURE_MICRO_EXPAND,
  FEATURE_OVERVIEW_COURSE,
} from "@xue-learn/core/features";
import { useT } from "@xue-learn/core/i18n";
import { cn } from "@xue-learn/core/utils";
import {
  supportsGoalOverviewGeneration,
  supportsGoalWebResources,
} from "@xue-learn/core/client-runtime";

const OVERVIEW_OPERATION = "goal.overview";

export function GoalOverviewPage() {
  const t = useT();
  const { goalId = "" } = useParams();
  const navigate = useNavigate();
  const { data: goal, error, refetch } = useFullGoal(goalId);
  const learnerName = useLearnerDisplayName();
  const updateProgress = useUpdateGoalOverviewUnitProgress();
  const invalidateGoal = useInvalidateGoal();
  const { confirm } = useConfirm();
  const [material, setMaterial] = useState<LearningMaterialContent | null>(
    null,
  );
  const [genStatus, setGenStatus] = useState("");
  const [genError, setGenError] = useState("");
  const [reconnectChecked, setReconnectChecked] = useState(false);
  const autoStartedGoalRef = useRef("");
  const overviewGenerationEnabled = supportsGoalOverviewGeneration();
  const webResourcesEnabled = supportsGoalWebResources();

  const course = goal?.overviewCourse;
  const isMicro = goal ? isMicroGoal(goal) : false;
  const activeUnit = useMemo(() => {
    if (!course?.units.length) return null;
    return course.units[0];
  }, [course?.units]);

  useEffect(() => {
    setMaterial(activeUnit?.material ?? null);
  }, [activeUnit?.id, activeUnit?.material]);

  const handleStreamEvent = useCallback((event: SseEvent) => {
    if (event.type === "status") setGenStatus(event.message);
    if (event.type === "error") {
      setGenError(event.message);
    }
  }, []);

  const aiGen = useAiGeneration({
    scope: "goal",
    scopeId: goalId,
    onRestore: (run) => {
      if (run.operation !== OVERVIEW_OPERATION) return;
      if (run.statusMessage) setGenStatus(run.statusMessage);
    },
  });

  const overviewLoading = aiGen.isLoading(OVERVIEW_OPERATION);
  const overviewFailed =
    Boolean(genError) || goal?.overviewCourseStatus === "failed";
  const awaitingOverviewStart =
    Boolean(goal) &&
    !isMicro &&
    !course &&
    overviewGenerationEnabled &&
    !overviewLoading &&
    !genError &&
    !reconnectChecked;
  const coursePreparing =
    overviewLoading ||
    awaitingOverviewStart ||
    (isMicro && goal?.overviewCourseStatus === "pending");

  useEffect(() => {
    if (!goalId || !overviewGenerationEnabled) return;
    let cancelled = false;
    setReconnectChecked(false);
    void aiGen
      .reconnectActive(
        handleStreamEvent,
        (operation) => operation === OVERVIEW_OPERATION,
      )
      .then(async (results) => {
        if (cancelled) return;
        if (results.length > 0) {
          autoStartedGoalRef.current = goalId;
        }
        const completed = results.find((result) => result?.type === "done");
        if (completed?.type === "done") {
          await invalidateGoal(goalId);
          if (
            typeof completed.navigateTo === "string" &&
            completed.navigateTo.includes("/units/")
          ) {
            navigate(completed.navigateTo, { replace: true });
          }
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setReconnectChecked(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resume in-progress overview generation after refresh
  }, [goalId, overviewGenerationEnabled]);

  async function runOverviewGeneration() {
    setGenError("");
    setMaterial(null);
    setGenStatus(
      isMicro
        ? t("goalDetail.overview.generatingMicro")
        : t("goalDetail.overview.generatingOverview"),
    );
    const result = await aiGen.startPost(
      `/api/goals/${goalId}/overview/stream`,
      {},
      handleStreamEvent,
      OVERVIEW_OPERATION,
    );
    if (result?.type === "done" || result?.type === "error") {
      await invalidateGoal(goalId);
    }
    if (
      result?.type === "done" &&
      typeof result.navigateTo === "string" &&
      result.navigateTo.includes("/units/")
    ) {
      navigate(result.navigateTo, { replace: true });
    }
    if (result?.type === "error") {
      setGenError(result.message);
    }
  }

  useEffect(() => {
    if (
      !goal ||
      isMicro ||
      course ||
      !overviewGenerationEnabled ||
      !reconnectChecked ||
      overviewLoading ||
      autoStartedGoalRef.current === goalId
    ) {
      return;
    }
    autoStartedGoalRef.current = goalId;
    void runOverviewGeneration();
    // One-shot per visit: opening starts (or retries) generation. An in-page
    // failure is retried with the visible button, not this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    course,
    goal,
    goalId,
    isMicro,
    overviewGenerationEnabled,
    overviewLoading,
    reconnectChecked,
  ]);

  async function handleRegenerate() {
    const ok = await confirm({
      title: isMicro
        ? t("goalDetail.overview.regenerateMicroTitle")
        : t("goalDetail.overview.regenerateTitle"),
      description: isMicro
        ? t("goalDetail.overview.regenerateMicroDescription")
        : t("goalDetail.overview.regenerateDescription"),
      variant: "destructive",
    });
    if (!ok) return;
    await runOverviewGeneration();
  }

  if (isNotFound(error)) return <Navigate to="/404" replace />;
  if (!goal) {
    return error ? (
      <ApiErrorNotice
        error={error}
        fallback={t("goalDetail.overview.loadError")}
        onRetry={() => {
          void refetch();
        }}
      />
    ) : (
      <p className="text-[var(--text-400)]">
        {t("goalDetail.overview.loading")}
      </p>
    );
  }

  if (!isMicro && activeUnit?.id) {
    return <Navigate to={`/goals/${goalId}/units/${activeUnit.id}`} replace />;
  }

  // Micro courses created by the legacy/compatible flow are stored as an
  // overview course. Keep that route available even while overview courses
  // are disabled for full goals.
  if (!FEATURE_OVERVIEW_COURSE && !isMicro) {
    return <Navigate to={`/goals/${goalId}`} replace />;
  }

  if (!course) {
    return (
      <div className="space-y-6">
        {!isMicro ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link to={`/goals/${goalId}`}>
              <Button
                variant="ghost"
                className="text-[var(--text-400)] hover:text-[var(--brand-600)]"
              >
                <ArrowLeft className="mr-1.5 size-4" />
                {t("uiChrome.goalLayout.backJourney")}
              </Button>
            </Link>
          </div>
        ) : null}
        <Card>
          <CardContent className="space-y-4 pt-4">
            <p className="text-[var(--text-400)]">
              {isMicro
                ? coursePreparing
                  ? t("goalDetail.overview.autoPreparingMicro")
                  : t("goalDetail.overview.microNotReady")
                : coursePreparing
                  ? t("goalDetail.overview.generatingOverview")
                  : t("goalDetail.overview.noOverview")}
            </p>
            {genError ? (
              <p className="text-sm text-[var(--error-500)]">{genError}</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {!coursePreparing && overviewGenerationEnabled ? (
                <Button onClick={() => void runOverviewGeneration()}>
                  {isMicro
                    ? t("goalDetail.overview.prepareMicroAgain")
                    : overviewFailed
                      ? t("goalDetail.overview.regenerate")
                      : t("goalDetail.overview.generateCourse")}
                </Button>
              ) : null}
              {!isMicro ? (
                <Link to={`/goals/${goalId}`}>
                  <Button variant="outline" className="rounded-lg">
                    {t("uiChrome.goalLayout.journey")}
                  </Button>
                </Link>
              ) : null}
            </div>
            <InlineGenStream
              status={genStatus}
              canStop={aiGen.canStop(OVERVIEW_OPERATION)}
              onStop={() => void aiGen.stop(OVERVIEW_OPERATION)}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  const completed = course.units.filter((unit) => unit.completedAt).length;
  const progress =
    course.units.length > 0
      ? Math.round((completed / course.units.length) * 100)
      : 0;

  async function completeUnit() {
    if (!activeUnit) return;
    await updateProgress.mutateAsync({
      goalId,
      unitId: activeUnit.id,
      completed: true,
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {!isMicro ? (
          <Link to={`/goals/${goalId}`}>
            <Button
              variant="ghost"
              className="text-[var(--text-400)] hover:text-[var(--brand-600)]"
            >
              <ArrowLeft className="mr-1.5 size-4" />
              {t("uiChrome.goalLayout.backJourney")}
            </Button>
          </Link>
        ) : null}
        {!isMicro ? (
          <Link to={`/goals/${goalId}`}>
            <Button className="rounded-lg">
              {t("uiChrome.goalLayout.journey")}
            </Button>
          </Link>
        ) : null}
      </div>

      {FEATURE_MICRO_EXPAND && isMicro && activeUnit ? (
        <ForceSubdividePanel
          goalId={goalId}
          goalTitle={goal.title}
          unitId={activeUnit.id}
          unitTitle={activeUnit.title}
          variant="card"
          mode="convert"
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle style={{ fontFamily: "var(--font-display)" }}>
            {course.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(course.summary || goal.topicOverview) && (
            <LlmMarkdown
              content={personalizeLearnerText(
                course.summary ?? goal.topicOverview ?? "",
                learnerName,
              )}
              variant="muted"
              className="text-sm leading-6"
            />
          )}
          <div>
            <div className="mb-1 flex justify-between text-xs font-medium text-[var(--text-400)]">
              <span>
                {isMicro
                  ? t("goalDetail.overview.learningProgress")
                  : t("goalDetail.overview.overviewProgress")}
              </span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-300)]">
              <div
                className="h-full rounded-full bg-[var(--brand-500)]"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {activeUnit ? (
        <Card>
          <CardHeader className="border-b border-[var(--border-200)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-xs font-medium text-[var(--text-400)]">
                  {isMicro
                    ? t("goalDetail.overview.microCourse")
                    : t("goalDetail.overview.overviewCourse")}
                </p>
                <CardTitle
                  className="text-lg"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {activeUnit.title}
                </CardTitle>
                <div
                  className="text-sm text-[var(--text-400)]"
                  style={{ fontFamily: "var(--font-serif)" }}
                >
                  <LlmMarkdown
                    content={personalizeLearnerText(
                      activeUnit.summary,
                      learnerName,
                    )}
                    variant="muted"
                  />
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button
                  variant={activeUnit.completedAt ? "outline" : "default"}
                  disabled={updateProgress.isPending}
                  onClick={() =>
                    updateProgress.mutate({
                      goalId,
                      unitId: activeUnit.id,
                      completed: !activeUnit.completedAt,
                    })
                  }
                >
                  {activeUnit.completedAt
                    ? t("goalDetail.overview.markIncomplete")
                    : t("goalDetail.overview.markComplete")}
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="min-w-0 space-y-5 pt-6">
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold text-[var(--text-800)]">
                    {t("goalDetail.overview.materialTitle")}
                  </h2>
                  {material ? (
                    <p className="text-xs text-[var(--text-400)]">
                      {t("goalDetail.overview.materialDescription")}
                    </p>
                  ) : null}
                </div>
                {material && overviewGenerationEnabled ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleRegenerate()}
                    disabled={overviewLoading}
                  >
                    {overviewLoading
                      ? t("goalDetail.overview.reorganizing")
                      : isMicro
                        ? t("goalDetail.overview.regenerateMaterial")
                        : t("goalDetail.overview.regenerate")}
                  </Button>
                ) : null}
              </div>

              {genError ? (
                <p className="text-sm text-[var(--error-500)]">{genError}</p>
              ) : null}

              {!material ? (
                <div className="space-y-3">
                  {!overviewLoading ? (
                    <>
                      <p className="text-sm text-[var(--text-400)]">
                        {isMicro
                          ? t("goalDetail.overview.microNotReady")
                          : t("goalDetail.overview.noMaterial")}
                      </p>
                      {overviewGenerationEnabled ? (
                        <Button
                          disabled={overviewLoading}
                          onClick={() => void runOverviewGeneration()}
                        >
                          {isMicro
                            ? t("goalDetail.overview.prepareMicroAgain")
                            : t("goalDetail.overview.generateMaterial")}
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : overviewLoading ? null : (
                <AnchoredLearningMaterial
                  unitId={activeUnit.id}
                  sectionId="legacy-material"
                  goalId={goalId}
                  material={material}
                  onMaterialChange={setMaterial}
                />
              )}

              <InlineGenStream
                status={genStatus}
                canStop={aiGen.canStop(OVERVIEW_OPERATION)}
                onStop={() => void aiGen.stop(OVERVIEW_OPERATION)}
              />
            </section>

            {!activeUnit.completedAt ? (
              <div className="rounded-xl border border-[var(--brand-200)] bg-[var(--brand-50)] p-4">
                <p className="text-sm font-semibold text-[var(--brand-600)]">
                  {isMicro
                    ? t("goalDetail.overview.completeMicroTitle")
                    : t("goalDetail.overview.completeOverviewTitle")}
                </p>
                <p className="mt-2 text-sm leading-7 text-[var(--text-400)]">
                  {isMicro
                    ? t("goalDetail.overview.completeMicroDescription")
                    : t("goalDetail.overview.completeOverviewDescription")}
                </p>
                <Button
                  className="mt-4"
                  disabled={updateProgress.isPending || !material}
                  onClick={() => void completeUnit()}
                >
                  <CheckCircle2 className="mr-1.5 size-4" />
                  {isMicro
                    ? t("goalDetail.overview.completeMicro")
                    : t("goalDetail.overview.completeOverview")}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {isMicro ? (
        <GoalDocumentsPanel
          goalId={goalId}
          documents={goal.uploadedDocuments ?? []}
          webResourcesEnabled={webResourcesEnabled}
        />
      ) : null}
    </div>
  );
}
