import { MainlinePlanPage } from "@/features/learning-mainline/plan-page";
import { mainlineEnabled } from "@/features/learning-mainline/enabled";
import { useSearchParams } from "react-router-dom";
import { Link, Navigate, useParams } from "react-router-dom";
import { BookOpen, Play } from "lucide-react";
import { isNotFound } from "@/shared/api";
import { useGoal, useGoalMastery } from "@/hooks/api";
import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import { ApiErrorNotice } from "@/components/ui/api-error-notice";
import { Card, CardTitle } from "@/components/ui/card";
import { deriveUnitContentGenStatus } from "@/shared/domain/unit-content-status";
import { buildUnitTree } from "@/shared/domain/unit-tree-build";
import { ExportTextbookButton } from "@/components/goals/export-textbook-button";
import { GoalDocumentsPanel } from "@/components/goals/goal-documents-panel";
import { LearningPathTree } from "@/components/goals/learning-path-tree";
import { LastLearnedUnitCard } from "@/components/goals/last-learned-unit-card";
import { resolveGoalLastLearnedUnit } from "@/shared/domain/last-learned-unit";
import { isMicroGoal, resolveMicroLessonUnit } from "@/shared/domain/goal-kind";
import { FEATURE_OVERVIEW_COURSE } from "@xue-learn/core/source/src/shared/features.ts";
import { CoursePatternPanel } from "@/components/goals/course-pattern-panel";
import { SequentialJourneyPath } from "@/components/goals/sequential-journey-path";
import { resolveJourneyOrientationLesson } from "@/components/goals/journey-orientation";
import { formatMasteryDimensions } from "@/shared/domain/mastery";
import { GoalCreationStatusCard } from "@/components/agent/goal-creation-status-card";
import { useGoalCreationSessionByGoal } from "@/hooks/use-goal-creation-session";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import { supportsGoalWebResources } from "@xue-learn/core/source/src/shared/runtime/client-runtime.ts";

function overviewCourseStatusLabel(status?: string) {
  switch (status) {
    case "pending":
      return "生成中";
    case "failed":
      return "准备失败";
    case "ready":
      return "已就绪";
    default:
      return "未开始";
  }
}

export function GoalDashboardPage() {
  const [params] = useSearchParams();
  return mainlineEnabled() && params.get("view") !== "catalog" ? <MainlinePlanPage /> : <LegacyGoalDashboardPage />;
}

function LegacyGoalDashboardPage() {
  const t = useT();
  const { goalId = "" } = useParams();
  const { data: goal, error, refetch } = useGoal(goalId);
  const mastery = useGoalMastery(goalId, {
    enabled: Boolean(goal && goal.learningMode !== "exploration"),
  });
  const creationSession = useGoalCreationSessionByGoal(goalId);

  if (isNotFound(error)) return <Navigate to="/404" replace />;
  if (!goal) {
    return error ? (
      <ApiErrorNotice
        error={error}
        fallback="暂时无法加载目标，请稍后再试。"
        onRetry={() => {
          void refetch();
        }}
      />
    ) : (
      <p className="text-[var(--text-400)]">加载目标…</p>
    );
  }

  if (isMicroGoal(goal)) {
    const unit = resolveMicroLessonUnit(goal);
    if (!unit) {
      return <Navigate to={`/goals/${goalId}/plan`} replace />;
    }
    return <Navigate to={`/goals/${goalId}/units/${unit.id}`} replace />;
  }

  // Stopped creation sessions are handled by GoalLayout (shared query).
  const activeCreationSession = creationSession.data?.session;
  const showCreationStatus =
    activeCreationSession != null &&
    activeCreationSession.status !== "completed" &&
    activeCreationSession.status !== "stopped";

  if (goal.curriculumVersion === 2 && goal.modules?.length) {
    const lastLearnedUnit = resolveGoalLastLearnedUnit(goal);
    return (
      <div className="space-y-5">
        {showCreationStatus && activeCreationSession ? (
          <GoalCreationStatusCard session={activeCreationSession} />
        ) : null}
        <SequentialJourneyPath
          goalId={goalId}
          title={goal.title}
          modules={goal.modules}
          orientation={
            FEATURE_OVERVIEW_COURSE &&
            !showCreationStatus &&
            goal.overviewCourseStatus !== "skipped"
              ? resolveJourneyOrientationLesson(
                  goal,
                  t("goalDetail.journey.orientationEyebrow"),
                )
              : null
          }
          mastery={mastery.data}
          lastLearnedUnit={lastLearnedUnit}
          requiresCognitiveModel={goal.learningMode !== "exploration"}
        />
      </div>
    );
  }

  const leafUnits = goal.units.filter((u) => u.unitKind === "lesson");
  const pathRoots = buildUnitTree(
    goal.units.map((u) => ({
      id: u.id,
      title: u.title,
      status: u.status,
      unitKind: u.unitKind,
      parentUnitId: u.parentUnitId,
      orderIndex: u.orderIndex,
      contentGen: deriveUnitContentGenStatus(u) ?? undefined,
      completionMethod: u.completionMethod,
    })),
  );
  const lastLearnedUnit = resolveGoalLastLearnedUnit(goal);
  const resumeUnit =
    lastLearnedUnit ??
    leafUnits.find((u) => u.status === "in_progress") ??
    leafUnits.find((u) => u.status === "available") ??
    leafUnits[0];
  const resumeGoalUnit = resumeUnit
    ? (goal.units.find((unit) => unit.id === resumeUnit.id) ?? null)
    : null;

  const pathBadge =
    goal.pathSource === "rag"
      ? "基于你的资料"
      : goal.pathSource === "search"
        ? "基于网络权威路径"
        : "通用学习路径";

  const hasOverview =
    goal.overviewCourseStatus === "ready" || Boolean(goal.overviewCourse);

  return (
    <div className="space-y-6">
      {/* Header with actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            className="text-2xl font-bold text-[var(--text-800)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {goal.title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[var(--text-400)]">
            <span>{pathBadge}</span>
            {FEATURE_OVERVIEW_COURSE && goal.overviewCourseStatus && (
              <>
                <span className="text-[var(--border-400)]">·</span>
                <span>
                  总览：{overviewCourseStatusLabel(goal.overviewCourseStatus)}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportTextbookButton goalId={goalId} goalTitle={goal.title} />
          {FEATURE_OVERVIEW_COURSE && (
            <Link to={`/goals/${goalId}/overview`}>
              <Button variant="outline" size="sm" className="rounded-lg">
                <BookOpen className="mr-1.5 size-3.5" />
                {hasOverview ? "查看总览" : "开始总览"}
              </Button>
            </Link>
          )}
          {resumeUnit && (
            <Link to={`/goals/${goalId}/units/${resumeUnit.id}`}>
              <Button size="sm" className="rounded-lg">
                <Play className="mr-1.5 size-3.5" />
                {lastLearnedUnit ? "继续学习" : "开始学习"}
              </Button>
            </Link>
          )}
          {resumeGoalUnit &&
            resumeGoalUnit.unitKind === "lesson" &&
            resumeGoalUnit.status !== "completed" &&
            resumeGoalUnit.status !== "completed_needs_reinforcement" && (
              <Link
                to={`/goals/${goalId}/units/${resumeGoalUnit.id}/diagnostic`}
              >
                <Button variant="outline" size="sm" className="rounded-lg">
                  {resumeGoalUnit.status === "in_progress"
                    ? "验证学习目标"
                    : "测试跳过"}
                </Button>
              </Link>
            )}
        </div>
      </div>

      {mastery.data ? (
        <Card className="border-[var(--brand-200)] bg-[var(--course-content-surface-accent)] p-5">
          <p className="text-xs font-semibold text-[var(--brand-700)]">
            {t("goalDetail.dashboard.mastery.title")}
          </p>
          <p className="mt-1 text-xl font-bold text-[var(--text-800)]">
            {mastery.data.evidenceCoveragePercent === 0
              ? t("goalDetail.mastery.unverified")
              : t("goalDetail.dashboard.mastery.summary", {
                  mastery: mastery.data.verifiedMasteryPercent,
                  coverage: mastery.data.evidenceCoveragePercent,
                })}
          </p>
          <p className="mt-1 text-sm text-[var(--text-500)]">
            {t("goalDetail.dashboard.mastery.targets", {
              demonstrated: mastery.data.demonstratedTargetCount,
              required: mastery.data.requiredTargetCount,
            })}
          </p>
          {mastery.data.weakDimensions.length ? (
            <p className="mt-1 text-xs text-[var(--danger)]">
              {t("goalDetail.mastery.weakDimensions")}
              {formatMasteryDimensions(mastery.data.weakDimensions)}
            </p>
          ) : null}
          {mastery.data.unverifiedDimensions.length ? (
            <p className="mt-1 text-xs text-[var(--text-500)]">
              {t("goalDetail.mastery.missingEvidence")}
              {formatMasteryDimensions(mastery.data.unverifiedDimensions)}
            </p>
          ) : null}
        </Card>
      ) : null}

      {lastLearnedUnit ? (
        <LastLearnedUnitCard goalId={goalId} unit={lastLearnedUnit} />
      ) : null}

      <CoursePatternPanel goalId={goalId} />

      <GoalDocumentsPanel
        goalId={goalId}
        documents={goal.uploadedDocuments ?? []}
        webResourcesEnabled={supportsGoalWebResources()}
      />

      {/* Learning path */}
      <Card className="border-[var(--border-200)] bg-[var(--bg-50)]">
        <div className="p-5 pb-0">
          <CardTitle
            className="text-base"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            学习路径
          </CardTitle>
          <p
            className="mt-1 text-sm text-[var(--text-400)]"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            默认展示前两层；需要时再逐层展开，避免深层路径一次铺满页面。
          </p>
        </div>
        <div className="p-5 pt-3">
          <LearningPathTree key={goalId} roots={pathRoots} goalId={goalId} />
        </div>
      </Card>
    </div>
  );
}
