import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import { Card, CardTitle } from "@/components/ui/card";
import { GoalCourseSettingsOverview } from "@/components/goals/goal-course-settings-overview";
import { GoalMapPlanReview } from "@/components/goals/goal-map-plan-review";
import { GoalDocumentsPanel } from "@/components/goals/goal-documents-panel";
import {
  LlmMarkdown,
  LlmMarkdownInline,
} from "@/components/markdown/llm-markdown";
import { AiGenStopButton } from "@/components/ai/ai-gen-stop-button";
import { LlmLoadingStatus } from "@/components/ai/llm-loading-status";
import type { SseEvent } from "@/shared/llm/sse";
import { useAiGeneration } from "@/hooks/use-ai-generation";
import { useGoal, useGoalPlan, useInvalidateGoal } from "@/hooks/api";
import { selectActiveMapPreviewUnits } from "@/shared/llm/map-partial-preview";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import { KnowledgeActivityCard } from "@/components/agent/knowledge-activity-card";
import type { KnowledgeActivity } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { DeepPlanningProgress } from "@/components/agent/deep-planning-progress";
import {
  reducePlanningProgressEvent,
  type PlanningProgress,
} from "@/hooks/use-agent-thread";
import { GoalCreationStatusCard } from "@/components/agent/goal-creation-status-card";
import { useGoalCreationSessionByGoal } from "@/hooks/use-goal-creation-session";
import { AiGeneratedNotice } from "@/components/ui/ai-generated-notice";
import {
  supportsGoalPlanLegacyGeneration,
  supportsGoalWebResources,
} from "@xue-learn/core/source/src/shared/runtime/client-runtime.ts";
import { goalPlanApprovalAction } from "@/shared/domain/goal-plan-approval";

export function GoalPlanPage() {
  const t = useT();
  const { goalId = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const shouldGenerateMap = searchParams.get("generateMap") === "1";
  const creationSession = useGoalCreationSessionByGoal(goalId);

  const [phase, setPhase] = useState<"plan" | "map" | "micro">("plan");
  const [refinedTitle, setRefinedTitle] = useState<string | null>(null);
  const [mapStatus, setMapStatus] = useState("");
  const [planStatus, setPlanStatus] = useState("");
  const [planningProgress, setPlanningProgress] = useState<PlanningProgress>({
    active: false,
    updates: [],
    activities: [],
    warnings: [],
  });
  const [mapPreview, setMapPreview] = useState<{
    domainTag?: string;
    units?: {
      title?: string;
      contentSummary?: string;
      parentTitle?: string | null;
    }[];
    placeholderUnitCount?: number;
  } | null>(null);
  const [microPreview, setMicroPreview] = useState<{
    title?: string;
    topicOverview?: string;
    contentSummary?: string;
    pendingFields?: string[];
  } | null>(null);
  const [error, setError] = useState("");
  const [knowledgeActivity, setKnowledgeActivity] =
    useState<KnowledgeActivity | null>(null);
  const [settingsTab, setSettingsTab] = useState<"overview" | "resources">(
    "overview",
  );
  const legacyGenerationEnabled = supportsGoalPlanLegacyGeneration();
  const webResourcesEnabled = supportsGoalWebResources();
  const [mapReconnectChecked, setMapReconnectChecked] = useState(false);
  const autoPlanStartedRef = useRef<string | null>(null);
  const autoMapCompletionStartedRef = useRef<string | null>(null);
  const autoMapGenerationStartedRef = useRef<string | null>(null);
  const autoMicroGenerationStartedRef = useRef<string | null>(null);
  const invalidateGoal = useInvalidateGoal();
  const aiGen = useAiGeneration({
    scope: "goal",
    scopeId: goalId,
    onRestore: (run) => {
      if (run.operation === "goal.map") {
        setPhase("map");
        if (run.statusMessage) setMapStatus(run.statusMessage);
      }
      if (run.operation === "goal.micro_unit") {
        setPhase("micro");
        if (run.statusMessage) setMapStatus(run.statusMessage);
      }
      if (run.operation === "goal.plan.detail" && run.statusMessage) {
        setPlanStatus(run.statusMessage);
      }
    },
  });

  const planQuery = useGoalPlan(goalId);
  const { data: goalDetail } = useGoal(goalId);
  const documentCount = planQuery.data?.documentCount ?? 0;
  const metaLoading = planQuery.isPending;
  const isMicroGoal = !metaLoading && planQuery.data?.goalKind === "micro";
  const goalMeta = planQuery.data
    ? {
        title: refinedTitle ?? planQuery.data.title,
        level: planQuery.data.level,
        hasMap: Boolean(planQuery.data.hasMap),
        incompleteMapModuleCount: planQuery.data.incompleteMapModuleCount ?? 0,
        generationOptions: planQuery.data.generationOptions?.trim() ?? "",
        parentGoalId: planQuery.data.parentGoalId ?? null,
        topicOverview:
          planQuery.data.topicOverview ??
          planQuery.data.plan?.topicOverview ??
          "",
        detailedPlanStatus: planQuery.data.detailedPlanStatus ?? "pending",
        plan: planQuery.data.plan ?? null,
      }
    : null;
  const loadError = planQuery.error?.message ?? "";
  const isSequentialPlan =
    goalMeta?.plan?.schemaVersion === 2 &&
    Boolean(goalMeta.plan.modules?.length);
  const isPlanGenerating = aiGen.isLoading("goal.plan.detail");
  const needsMapCompletion =
    Boolean(goalMeta?.hasMap) && (goalMeta?.incompleteMapModuleCount ?? 0) > 0;
  const needsDetailedPlan =
    Boolean(goalMeta?.hasMap) &&
    !needsMapCompletion &&
    goalMeta?.detailedPlanStatus !== "pending" &&
    !isPlanGenerating &&
    (!goalMeta?.plan ||
      goalMeta.detailedPlanStatus === "stale" ||
      goalMeta.detailedPlanStatus === "failed");
  const previewBox = useMemo(() => {
    if (phase === "map" && mapPreview) {
      const units = mapPreview.units ?? [];
      const placeholderUnitCount = mapPreview.placeholderUnitCount ?? 0;
      const visibleUnits = selectActiveMapPreviewUnits(units, 8);
      const activeParentTitle = visibleUnits.find(
        (unit) => unit.parentTitle,
      )?.parentTitle;
      const remainingSlots = Math.max(0, 8 - visibleUnits.length);
      const visiblePlaceholders = Math.min(
        placeholderUnitCount,
        remainingSlots,
      );
      if (visibleUnits.length === 0 && visiblePlaceholders === 0) {
        return (
          <div className="mt-4 rounded-lg border border-[var(--border-200)] bg-[var(--bg-50)] p-3 text-sm">
            <p className="text-xs font-medium text-[var(--text-400)]">
              {t("goalDetail.plan.generatingBranch")}
              {mapPreview.domainTag ? `（${mapPreview.domainTag}）` : "…"}
            </p>
          </div>
        );
      }
      return (
        <div className="mt-4 space-y-2 rounded-lg border border-[var(--border-200)] bg-[var(--bg-50)] p-3">
          <p className="text-xs font-medium text-[var(--text-400)]">
            {activeParentTitle
              ? t("goalDetail.plan.generatingSubmap", {
                  title: activeParentTitle,
                })
              : ""}
            {t("generation.map.progress", { count: units.length })}
            {placeholderUnitCount > 0
              ? `，${t("generation.map.refining", {
                  count: placeholderUnitCount,
                })}`
              : ""}
          </p>
          <ul className="space-y-2">
            {visibleUnits.map((unit, index) => (
              <li
                key={`${unit.title ?? "unit"}-${index}`}
                className={
                  unit.parentTitle
                    ? "ml-4 border-l border-[var(--border-200)] pl-3 text-sm"
                    : "text-sm"
                }
              >
                <span className="font-medium text-[var(--text-800)]">
                  {unit.parentTitle ? "↳ " : ""}
                  <LlmMarkdownInline
                    content={unit.title ?? t("goalDetail.plan.untitledUnit")}
                  />
                </span>
                {unit.contentSummary && (
                  <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--text-400)]">
                    <LlmMarkdownInline content={unit.contentSummary} />
                  </span>
                )}
              </li>
            ))}
            {Array.from({ length: visiblePlaceholders }).map((_, index) => (
              <li
                key={`placeholder-${visibleUnits.length + index}`}
                className="text-sm"
                aria-label={t("generation.map.unitRefiningAria")}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium text-[var(--text-800)]">
                    {visibleUnits.length + index + 1}.
                  </span>
                  <div className="h-3 w-2/3 animate-pulse rounded bg-[var(--bg-300)]" />
                </div>
                <div className="mt-1 h-3 w-4/5 animate-pulse rounded bg-[var(--bg-300)]" />
              </li>
            ))}
          </ul>
        </div>
      );
    }
    if (phase === "micro" && microPreview) {
      const pendingFields = microPreview.pendingFields ?? [];
      return (
        <div className="mt-4 rounded-lg border border-[var(--border-200)] bg-[var(--bg-50)] p-3 text-sm">
          <p className="font-medium text-[var(--text-800)]">
            {typeof microPreview.title === "string" ? (
              <LlmMarkdownInline content={microPreview.title} />
            ) : (
              t("goalDetail.plan.generatingCourseTitle")
            )}
          </p>
          {typeof microPreview.topicOverview === "string" && (
            <div className="mt-2 text-[var(--text-400)]">
              <LlmMarkdown
                content={microPreview.topicOverview}
                variant="muted"
              />
            </div>
          )}
          {typeof microPreview.contentSummary === "string" && (
            <div className="mt-2 text-xs text-[var(--text-400)]">
              <LlmMarkdown
                content={microPreview.contentSummary}
                variant="muted"
              />
            </div>
          )}
          {pendingFields.length > 0 && (
            <div className="mt-3 flex items-center gap-2 rounded-md bg-[var(--brand-50)] px-2 py-1.5 text-xs text-[var(--brand-700)]">
              <span
                className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--brand-500)]"
                aria-hidden
              />
              <span>{t("generation.micro.refining")}</span>
            </div>
          )}
        </div>
      );
    }
    return null;
  }, [mapPreview, microPreview, phase, t]);

  const handleMapEvent = useCallback(
    (event: SseEvent) => {
      if (event.type === "status") setMapStatus(event.message);
      if (event.type === "knowledge_activity") {
        setKnowledgeActivity(event.activity);
      }
      if (event.type === "map_partial") {
        const baseMap = (event.map ?? {}) as {
          domainTag?: string;
          units?: {
            title?: string;
            contentSummary?: string;
            parentTitle?: string | null;
          }[];
        };
        setMapPreview({
          ...baseMap,
          placeholderUnitCount: event.placeholderUnitCount ?? 0,
        });
        setMapStatus(
          event.unitCount > 0
            ? t("goalDetail.plan.continueMapUnitsReady", {
                count: event.unitCount,
              })
            : t("goalDetail.plan.continueBranch"),
        );
      }
      if (event.type === "micro_unit_partial") {
        const microUnit = (event.microUnit ?? {}) as {
          title?: string;
          topicOverview?: string;
          contentSummary?: string;
        };
        setMicroPreview({
          ...microUnit,
          pendingFields: event.pendingFields ?? [],
        });
        setMapStatus(t("goalDetail.plan.continueMicro"));
      }
      if (event.type === "progress" && event.message) {
        setMapStatus(
          t("goalDetail.plan.savingUnit", {
            current: event.current,
            total: event.total,
            message: event.message,
          }),
        );
      }
    },
    [t],
  );

  const startMapGeneration = useCallback(async () => {
    if (!goalMeta) return;
    setPhase("map");
    setError("");
    setMapPreview(null);
    setMicroPreview(null);
    setKnowledgeActivity(null);
    setMapStatus(
      isSequentialPlan
        ? t("goalDetail.plan.creatingJourney")
        : t("goalDetail.plan.generatingMap"),
    );

    try {
      const done = await aiGen.startPost(
        `/api/goals/${goalId}/map/stream`,
        {
          title: goalMeta.title,
          level: goalMeta.level,
        },
        handleMapEvent,
        "goal.map",
      );
      const resultGoalId =
        done?.type === "done" && typeof done.goalId === "string"
          ? done.goalId
          : goalId;
      // All goal versions continue through the shared journey at the goal root;
      // the former learner-facing map page is no longer mounted.
      await invalidateGoal(resultGoalId);
      navigate(`/goals/${resultGoalId}`);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : t("goalDetail.plan.generationError"),
      );
      setPhase("plan");
    }
  }, [
    goalId,
    goalMeta,
    isSequentialPlan,
    navigate,
    handleMapEvent,
    aiGen,
    invalidateGoal,
    t,
  ]);

  const startMicroCourseGeneration = useCallback(async () => {
    if (!goalMeta) return;
    setPhase("micro");
    setError("");
    setMapPreview(null);
    setMicroPreview(null);
    setMapStatus(t("goalDetail.plan.generatingMicro"));

    try {
      const done = await aiGen.startPost(
        `/api/goals/${goalId}/micro-unit/stream`,
        {},
        handleMapEvent,
        "goal.micro_unit",
      );
      const resultGoalId =
        done?.type === "done" && typeof done.goalId === "string"
          ? done.goalId
          : goalId;
      const unitId =
        done?.type === "done" && typeof done.unitId === "string"
          ? done.unitId
          : null;
      await invalidateGoal(resultGoalId);
      navigate(
        unitId
          ? `/goals/${resultGoalId}/units/${unitId}`
          : `/goals/${resultGoalId}`,
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("goalDetail.plan.microGenerationError"),
      );
      setPhase("plan");
    }
  }, [goalId, goalMeta, navigate, handleMapEvent, aiGen, invalidateGoal, t]);

  const handlePlanEvent = useCallback(
    (event: SseEvent) => {
      if (event.type === "status") setPlanStatus(event.message);
      if (event.type === "knowledge_activity") {
        setKnowledgeActivity(event.activity);
        setPlanningProgress((current) =>
          reducePlanningProgressEvent(current, event),
        );
      }
      if (event.type === "planning_activity") {
        setPlanningProgress((current) =>
          reducePlanningProgressEvent(current, event),
        );
      }
      if (event.type === "reasoning_status") {
        setPlanningProgress((current) =>
          reducePlanningProgressEvent(current, event),
        );
      }
      if (event.type === "planning_stage") {
        setPlanningProgress((current) =>
          reducePlanningProgressEvent(current, event),
        );
      }
      if (event.type === "planning_outline") {
        setPlanningProgress((current) =>
          reducePlanningProgressEvent(current, event),
        );
      }
      if (event.type === "research_query") {
        setPlanningProgress((current) =>
          reducePlanningProgressEvent(current, event),
        );
      }
      if (event.type === "module_research_progress") {
        setPlanningProgress((current) =>
          reducePlanningProgressEvent(current, event),
        );
      }
      if (event.type === "planning_warning") {
        setPlanningProgress((current) =>
          reducePlanningProgressEvent(current, event),
        );
      }
      if (event.type === "done") {
        void invalidateGoal(goalId);
      }
    },
    [goalId, invalidateGoal],
  );

  const startPlanGeneration = useCallback(
    async (regenerate = false) => {
      if (!goalId || aiGen.isLoading("goal.plan.detail")) return;
      setError("");
      setPlanningProgress({
        active: true,
        updates: [],
        activities: [],
        warnings: [],
      });
      setPlanStatus(t("goalDetail.plan.generatingDetailedPlan"));
      try {
        const done = await aiGen.startPost(
          `/api/goals/${goalId}/plan/stream`,
          { regenerate },
          handlePlanEvent,
          "goal.plan.detail",
        );
        if (done?.type === "done") {
          await invalidateGoal(goalId);
        }
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : t("goalDetail.plan.detailedPlanError"),
        );
      }
    },
    [goalId, aiGen, handlePlanEvent, invalidateGoal, t],
  );

  useEffect(() => {
    if (!legacyGenerationEnabled) {
      setMapReconnectChecked(true);
      return;
    }
    setMapReconnectChecked(false);
    void aiGen
      .reconnectActive(
        handleMapEvent,
        (op) => op === "goal.map" || op === "goal.micro_unit",
      )
      .then(async (results) => {
        const done = results.find((event) => event?.type === "done");
        if (done?.type === "done" && typeof done.goalId === "string") {
          await invalidateGoal(done.goalId);
          const unitId =
            typeof done.unitId === "string" ? done.unitId : undefined;
          navigate(
            unitId
              ? `/goals/${done.goalId}/units/${unitId}`
              : `/goals/${done.goalId}`,
          );
        }
        setMapReconnectChecked(true);
      })
      .catch((e) => {
        setError(
          e instanceof Error ? e.message : t("goalDetail.plan.reconnectError"),
        );
        setMapReconnectChecked(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resume in-progress map generation after refresh
  }, [goalId, legacyGenerationEnabled]);

  useEffect(() => {
    if (!legacyGenerationEnabled) return;
    void aiGen
      .reconnectActive(handlePlanEvent, (op) => op === "goal.plan.detail")
      .then(async (results) => {
        if (results.some((event) => event?.type === "done")) {
          await invalidateGoal(goalId);
        }
      })
      .catch((e) => {
        setError(
          e instanceof Error ? e.message : t("goalDetail.plan.reconnectError"),
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resume in-progress plan generation after refresh
  }, [goalId, legacyGenerationEnabled]);

  useEffect(() => {
    if (
      !goalId ||
      metaLoading ||
      !mapReconnectChecked ||
      !legacyGenerationEnabled ||
      !isMicroGoal ||
      goalMeta?.hasMap
    ) {
      return;
    }
    if (aiGen.isLoading("goal.micro_unit")) return;
    const autoKey = `${goalId}:micro:auto`;
    if (autoMicroGenerationStartedRef.current === autoKey) return;
    autoMicroGenerationStartedRef.current = autoKey;
    void startMicroCourseGeneration();
  }, [
    goalId,
    goalMeta?.hasMap,
    isMicroGoal,
    legacyGenerationEnabled,
    mapReconnectChecked,
    metaLoading,
    aiGen,
    startMicroCourseGeneration,
  ]);

  useEffect(() => {
    if (
      !goalId ||
      metaLoading ||
      !mapReconnectChecked ||
      !legacyGenerationEnabled ||
      !shouldGenerateMap ||
      goalMeta?.hasMap
    ) {
      return;
    }
    if (aiGen.isLoading("goal.map") || aiGen.isLoading("goal.micro_unit")) {
      return;
    }
    const autoKey = `${goalId}:generateMap`;
    if (autoMapGenerationStartedRef.current === autoKey) return;
    autoMapGenerationStartedRef.current = autoKey;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("generateMap");
        return next;
      },
      { replace: true },
    );
    void (isMicroGoal ? startMicroCourseGeneration() : startMapGeneration());
  }, [
    goalId,
    goalMeta?.hasMap,
    isMicroGoal,
    legacyGenerationEnabled,
    mapReconnectChecked,
    metaLoading,
    shouldGenerateMap,
    aiGen,
    startMapGeneration,
    startMicroCourseGeneration,
    setSearchParams,
  ]);

  useEffect(() => {
    if (
      !goalId ||
      metaLoading ||
      !mapReconnectChecked ||
      !legacyGenerationEnabled ||
      !needsMapCompletion
    ) {
      return;
    }
    if (aiGen.isLoading("goal.map")) return;
    const autoKey = `${goalId}:${goalMeta?.incompleteMapModuleCount ?? 0}`;
    if (autoMapCompletionStartedRef.current === autoKey) return;
    autoMapCompletionStartedRef.current = autoKey;
    void startMapGeneration();
  }, [
    goalId,
    goalMeta?.incompleteMapModuleCount,
    metaLoading,
    mapReconnectChecked,
    legacyGenerationEnabled,
    needsMapCompletion,
    aiGen,
    startMapGeneration,
  ]);

  useEffect(() => {
    if (
      !goalId ||
      metaLoading ||
      !legacyGenerationEnabled ||
      !needsDetailedPlan
    )
      return;
    if (aiGen.isLoading("goal.plan.detail")) return;
    const autoKey = `${goalId}:${goalMeta?.detailedPlanStatus ?? "missing"}:${goalMeta?.plan ? "has-plan" : "no-plan"}`;
    if (autoPlanStartedRef.current === autoKey) return;
    autoPlanStartedRef.current = autoKey;
    void startPlanGeneration(false);
  }, [
    goalId,
    goalMeta?.detailedPlanStatus,
    goalMeta?.plan,
    metaLoading,
    legacyGenerationEnabled,
    needsDetailedPlan,
    aiGen,
    startPlanGeneration,
  ]);

  if (
    creationSession.data?.session &&
    creationSession.data.session.status !== "completed"
  ) {
    return (
      <div className="mx-auto max-w-4xl">
        <GoalCreationStatusCard session={creationSession.data.session} />
      </div>
    );
  }

  if (phase === "map" || phase === "micro") {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <Card>
          <CardTitle>
            {phase === "micro"
              ? t("goalDetail.plan.generateMicro")
              : isSequentialPlan
                ? t("goalDetail.plan.createJourney")
                : t("goalDetail.plan.generateMap")}
          </CardTitle>
          <p className="mt-2 text-sm text-[var(--text-400)]">
            {phase === "micro"
              ? t("goalDetail.plan.generatingMicroAndPreview")
              : isSequentialPlan
                ? t("goalDetail.plan.creatingSequentialModules")
                : t("goalDetail.plan.generatingConfirmedMap")}
            {documentCount > 0
              ? t("goalDetail.plan.documentsDetected", { count: documentCount })
              : null}
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            {mapStatus && (
              <LlmLoadingStatus className="text-sm font-medium text-[var(--brand-600)]">
                {mapStatus}
              </LlmLoadingStatus>
            )}
            {aiGen.canStop() && (
              <AiGenStopButton onStop={() => void aiGen.stop()} />
            )}
          </div>
          {previewBox}
          {error && (
            <p className="mt-4 rounded-lg bg-[var(--error-50)] p-2 text-sm text-[var(--error-500)]">
              {error}
            </p>
          )}
        </Card>
        {goalDetail ? (
          <GoalDocumentsPanel
            goalId={goalId}
            documents={goalDetail.uploadedDocuments ?? []}
            webResourcesEnabled={webResourcesEnabled}
          />
        ) : null}
      </div>
    );
  }

  const estimatedLessonCount =
    goalDetail?.units.filter((unit) => unit.unitKind === "lesson").length ?? 0;
  const moduleCount =
    goalMeta?.plan?.schemaVersion === 2
      ? (goalMeta.plan.modules?.length ?? 0)
      : (goalDetail?.units.filter((unit) => unit.unitKind === "module")
          .length ?? 0);
  const showSettingsWorkspace = Boolean(
    goalMeta?.hasMap && goalMeta.plan && !needsDetailedPlan,
  );

  return (
    <div
      className={`mx-auto w-full space-y-6 ${
        showSettingsWorkspace ? "max-w-6xl" : "max-w-4xl"
      }`}
    >
      <AiGeneratedNotice kind="partial" />
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1
            className="text-2xl font-bold text-[var(--text-800)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {showSettingsWorkspace
              ? t("goalDetail.plan.courseSettings")
              : t("goalDetail.plan.learningPlan")}
          </h1>
          <p
            className="mt-1 text-sm text-[var(--text-400)]"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            {showSettingsWorkspace
              ? t("goalDetail.plan.settingsDescription")
              : isMicroGoal
                ? t("goalDetail.plan.microDescription")
                : goalMeta?.hasMap
                  ? isSequentialPlan
                    ? t("goalDetail.plan.sequentialDescription")
                    : t("goalDetail.plan.detailedDescription")
                  : isSequentialPlan
                    ? t("goalDetail.plan.confirmJourneyDescription")
                    : t("goalDetail.plan.confirmMapDescription")}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {!showSettingsWorkspace ? (
            <Link to="/goals">
              <Button variant="outline" size="sm">
                {t("goalDetail.plan.back")}
              </Button>
            </Link>
          ) : null}
        </div>
      </div>

      {goalDetail && !showSettingsWorkspace ? (
        <GoalDocumentsPanel
          goalId={goalId}
          documents={goalDetail.uploadedDocuments ?? []}
          webResourcesEnabled={webResourcesEnabled}
        />
      ) : null}

      {showSettingsWorkspace && goalMeta?.plan ? (
        <>
          <div className="flex flex-col gap-4 rounded-xl border border-[var(--border-200)] bg-[var(--bg-50)] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-[var(--text-800)] sm:text-lg">
                {goalMeta.title}
              </p>
              <p className="mt-1 text-sm text-[var(--text-400)]">
                {moduleCount > 0
                  ? t("goalDetail.plan.moduleCount", { count: moduleCount })
                  : t("goalDetail.plan.personalizedCourse")}
                {estimatedLessonCount > 0
                  ? t("goalDetail.plan.estimatedLessons", {
                      count: estimatedLessonCount,
                    })
                  : ""}
              </p>
            </div>
            <Link className="w-full sm:w-auto" to={`/goals/${goalId}`}>
              <Button className="min-h-11 w-full px-6 sm:w-auto">
                {t("goalDetail.plan.continueLearning")}
              </Button>
            </Link>
          </div>

          <div className="border-b border-[var(--border-200)]">
            <div
              className="flex min-w-0 gap-6 overflow-x-auto"
              role="tablist"
              aria-label={t("goalDetail.plan.courseSettings")}
            >
              <button
                type="button"
                role="tab"
                aria-selected={settingsTab === "overview"}
                onClick={() => setSettingsTab("overview")}
                className={`min-h-11 shrink-0 border-b-2 px-1 text-sm font-semibold ${
                  settingsTab === "overview"
                    ? "border-[var(--brand-500)] text-[var(--brand-600)]"
                    : "border-transparent text-[var(--text-400)]"
                }`}
              >
                {t("goalDetail.plan.courseOverview")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={settingsTab === "resources"}
                onClick={() => setSettingsTab("resources")}
                className={`min-h-11 shrink-0 border-b-2 px-1 text-sm font-semibold ${
                  settingsTab === "resources"
                    ? "border-[var(--brand-500)] text-[var(--brand-600)]"
                    : "border-transparent text-[var(--text-400)]"
                }`}
              >
                {t("goalDetail.plan.learningResources", {
                  count: documentCount,
                })}
              </button>
            </div>
          </div>
        </>
      ) : null}
      {knowledgeActivity ? (
        <KnowledgeActivityCard activity={knowledgeActivity} />
      ) : null}

      {metaLoading ? (
        <Card>
          <p className="text-sm text-[var(--text-400)]">
            {t("goalDetail.plan.loadingGoal")}
          </p>
        </Card>
      ) : goalMeta?.hasMap ? (
        goalMeta.plan && !needsDetailedPlan ? (
          <>
            {isPlanGenerating && (
              <Card>
                <DeepPlanningProgress progress={planningProgress} />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <LlmLoadingStatus className="text-sm font-medium text-[var(--brand-600)]">
                    {planStatus || t("goalDetail.plan.generatingDetailedPlan")}
                  </LlmLoadingStatus>
                  {aiGen.canStop("goal.plan.detail") && (
                    <AiGenStopButton
                      onStop={() => void aiGen.stop("goal.plan.detail")}
                    />
                  )}
                </div>
                {previewBox}
              </Card>
            )}
            {settingsTab === "overview" ? (
              <GoalCourseSettingsOverview
                goalId={goalId}
                contentLanguage={planQuery.data?.contentLanguage}
                topicOverview={goalMeta.topicOverview}
                plan={goalMeta.plan}
                allowFoundationGoal={!goalMeta.parentGoalId}
              />
            ) : goalDetail ? (
              <GoalDocumentsPanel
                goalId={goalId}
                documents={goalDetail.uploadedDocuments ?? []}
                webResourcesEnabled={webResourcesEnabled}
              />
            ) : (
              <Card>
                <p className="text-sm text-[var(--text-400)]">
                  {t("goalDetail.plan.loadingResources")}
                </p>
              </Card>
            )}
          </>
        ) : (
          <Card>
            {isPlanGenerating ? (
              <DeepPlanningProgress progress={planningProgress} />
            ) : null}
            <p className="text-sm text-[var(--text-400)]">
              {goalMeta.plan
                ? t("goalDetail.plan.mapUpdatedRefreshing")
                : t("goalDetail.plan.mapGeneratedPlanning")}
            </p>
            {planStatus && (
              <LlmLoadingStatus className="mt-3 text-sm font-medium text-[var(--brand-600)]">
                {planStatus}
              </LlmLoadingStatus>
            )}
            {previewBox}
            {error && (
              <p className="mt-4 rounded-lg bg-[var(--error-50)] p-2 text-sm text-[var(--error-500)]">
                {error}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {legacyGenerationEnabled ? (
                <Button
                  size="sm"
                  disabled={isPlanGenerating}
                  onClick={() => void startPlanGeneration(true)}
                >
                  {goalMeta.detailedPlanStatus === "failed"
                    ? t("goalDetail.plan.retryPlan")
                    : t("goalDetail.plan.generatePlan")}
                </Button>
              ) : null}
              {aiGen.canStop("goal.plan.detail") && (
                <AiGenStopButton
                  onStop={() => void aiGen.stop("goal.plan.detail")}
                />
              )}
              <Link to={`/goals/${goalId}`}>
                <Button variant="outline" size="sm">
                  {t("uiChrome.goalLayout.journey")}
                </Button>
              </Link>
            </div>
          </Card>
        )
      ) : goalMeta ? (
        isMicroGoal ? (
          <Card>
            <p className="text-sm text-[var(--text-400)]">
              {t("goalDetail.plan.preparingMicro")}
            </p>
            {mapStatus && (
              <LlmLoadingStatus className="mt-3 text-sm font-medium text-[var(--brand-600)]">
                {mapStatus}
              </LlmLoadingStatus>
            )}
            {error && (
              <p className="mt-4 rounded-lg bg-[var(--error-50)] p-2 text-sm text-[var(--error-500)]">
                {error}
              </p>
            )}
          </Card>
        ) : (
          <>
            {goalMeta.generationOptions ? (
              <Card className="border-[var(--brand-200)] bg-[var(--brand-50)]">
                <p className="text-xs font-bold uppercase tracking-wide text-[var(--text-400)]">
                  {t("goalDetail.plan.customizationNotes")}
                </p>
                <LlmMarkdown content={goalMeta.generationOptions} />
              </Card>
            ) : null}
            <GoalMapPlanReview
              goalId={goalId}
              goalTitle={goalMeta.title}
              isMicroCourse={false}
              generationEnabled={legacyGenerationEnabled}
              onTitleRefined={setRefinedTitle}
              onApproved={() => {
                if (
                  goalPlanApprovalAction({
                    isSequentialPlan,
                    legacyGenerationEnabled,
                  }) === "navigate"
                ) {
                  void invalidateGoal(goalId).then(() =>
                    navigate(`/goals/${goalId}`),
                  );
                  return;
                }
                void startMapGeneration();
              }}
            />
          </>
        )
      ) : (
        <Card>
          <p className="text-sm text-[var(--error-500)]">
            {error || loadError || t("goalDetail.plan.unableToLoadGoal")}
          </p>
        </Card>
      )}
    </div>
  );
}
