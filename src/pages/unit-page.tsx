import { MainlineSuggestions } from "@/features/learning-mainline/suggestions";
import { mainlineEnabled } from "@/features/learning-mainline/enabled";
import { LearningTrajectoryPanel } from "@/features/learning-trajectory/trajectory-panel";
import {
  Link,
  Navigate,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useEffect, useState } from "react";
import { apiGet, isNotFound } from "@/shared/api";
import { useGoal, useUnitLearningTargets, useUnitPage } from "@/hooks/api";
import { UnitWizard } from "@/components/wizard/unit-wizard";
import { Button, buttonVariants } from "@xue-learn/core/source/src/components/ui/button.tsx";
import { ApiErrorNotice } from "@/components/ui/api-error-notice";
import { ForceSubdividePanel } from "@/components/map/force-subdivide-panel";
import { GoalDocumentsPanel } from "@/components/goals/goal-documents-panel";
import { LlmMarkdownInline } from "@/components/markdown/llm-markdown";
import { isUnitLearningDone } from "@/shared/domain/unit-status";
import {
  BookOpenText,
  MessagesSquare,
  MoreHorizontal,
  Route,
} from "lucide-react";
import type { LearningAccess } from "@/shared/domain/learning-access";
import { useAssistantPageContext } from "@/components/agent/assistant-provider";
import { ALL_STEPS } from "@/components/wizard/unit-wizard/constants";
import {
  useLearningViewSettings,
  useSaveLearningViewSettings,
} from "@/hooks/api/use-settings";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import { cn } from "@xue-learn/core/source/src/shared/utils.ts";
import { isMicroGoal } from "@/shared/domain/goal-kind";
import {
  FEATURE_MICRO_EXPAND,
  FEATURE_SUBDIVIDE_UNIT,
} from "@xue-learn/core/source/src/shared/features.ts";
import { AiGeneratedNotice } from "@/components/ui/ai-generated-notice";
import { supportsGoalWebResources } from "@xue-learn/core/source/src/shared/runtime/client-runtime.ts";

function assistantStepLabel(step: string | undefined, fallback: string) {
  return ALL_STEPS.find((item) => item.id === step)?.label ?? fallback;
}

export function UnitPage() {
  const t = useT();
  const { goalId = "", unitId = "" } = useParams();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const targetGapFocus = searchParams.get("focus") === "target-gaps";
  const [weakPoints, setWeakPoints] = useState<
    Array<{ title: string; score: number }>
  >([]);
  const [learningAccess, setLearningAccess] = useState<LearningAccess | null>(
    null,
  );
  const [assistantCurrentStep, setAssistantCurrentStep] = useState<string>();
  const locationState = location.state as {
    startNewQuiz?: boolean;
    instantMicro?: boolean;
    runId?: string;
  } | null;
  const startNewQuiz = Boolean(locationState?.startNewQuiz);
  const instantMicro = Boolean(locationState?.instantMicro);
  const instantRunId =
    typeof locationState?.runId === "string" ? locationState.runId : undefined;
  const { data, error, refetch } = useUnitPage(unitId, goalId);
  const learningTargetsQuery = useUnitLearningTargets(unitId, {
    enabled: Boolean(
      data &&
      !data.isModule &&
      data.goal.goalKind !== "micro" &&
      data.goal.learningMode !== "exploration",
    ),
  });
  const { data: goalDetail } = useGoal(goalId);
  const learningView = useLearningViewSettings();
  const saveLearningView = useSaveLearningViewSettings();
  const presentationMode = learningView.data?.mode ?? "chat";

  useAssistantPageContext({
    contextLabel: data?.unit
      ? `${
          data.unit.unitKind === "overview"
            ? t("goalDetail.journey.orientationEyebrow")
            : data.unit.title
        } · ${assistantStepLabel(assistantCurrentStep, t("course.learningContent"))}`
      : t("course.currentUnit"),
    currentStep: assistantCurrentStep,
  });

  useEffect(() => {
    if (
      !targetGapFocus ||
      data?.goal.goalKind === "micro" ||
      data?.goal.learningMode === "exploration"
    )
      return;
    void apiGet<{
      latestAttempt?: {
        perLearningTargetResults?: Array<{
          title: string;
          score: number;
          passed: boolean;
        }>;
      } | null;
    }>(`/api/units/${unitId}/diagnostic`).then((diagnostic) => {
      setWeakPoints(
        (diagnostic.latestAttempt?.perLearningTargetResults ?? [])
          .filter((point) => !point.passed)
          .map(({ title, score }) => ({ title, score })),
      );
    });
  }, [data?.goal.goalKind, unitId, targetGapFocus]);

  if (isNotFound(error)) return <Navigate to="/404" replace />;
  if (!data) {
    return error ? (
      <ApiErrorNotice
        error={error}
        fallback={t("course.loadError")}
        onRetry={() => {
          void refetch();
        }}
      />
    ) : (
      <p className="text-[var(--text-400)]">{t("course.loading")}</p>
    );
  }

  const { unit, goal, isModule, canForceSubdivide } = data;
  const isMicro = isMicroGoal(goal);
  const isOverview = unit.unitKind === "overview";
  const isKacomFree = isMicro || isOverview || goal.learningMode === "exploration";

  if (isModule) {
    return <Navigate to={`/goals/${goalId}`} replace />;
  }

  const showDiagnostic = !isKacomFree && !isUnitLearningDone(unit.status);
  const diagnosticLocked = learningAccess?.assessmentMode === "locked";
  const displayTitle = isOverview
    ? t("goalDetail.journey.orientationEyebrow")
    : unit.title;

  return (
    <div className="min-w-0 w-full space-y-3 sm:space-y-4">
      <AiGeneratedNotice />
      <div className="scroll-mt-16 min-w-0 space-y-2">
        <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            {isMicro ? (
              <p className="text-xs font-medium text-[var(--brand-600)]">
                {t("course.microCourse")}
              </p>
            ) : null}
            <h1
              className="text-lg font-bold leading-snug text-[var(--text-800)] sm:text-xl sm:leading-tight"
              style={{ fontFamily: "var(--font-display)" }}
            >
              <LlmMarkdownInline content={displayTitle} />
            </h1>
            {unit.contentSummary && !isOverview && (
              <div
                className={`mt-1 text-sm leading-6 text-[var(--text-500)] ${
                  presentationMode === "chat"
                    ? "hidden sm:line-clamp-1 sm:block"
                    : "line-clamp-2"
                }`}
                style={{ fontFamily: "var(--font-serif)" }}
              >
                <LlmMarkdownInline content={unit.contentSummary} />
              </div>
            )}
            {!isKacomFree &&
            learningTargetsQuery.data?.learningTargets.length ? (
              <p
                className={`text-xs text-[var(--text-500)] ${
                  presentationMode === "chat" ? "hidden sm:block" : ""
                }`}
              >
                {t("course.learningTargetCount", {
                  count: learningTargetsQuery.data.learningTargets.length,
                })}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-start gap-1.5 sm:gap-2">
            {showDiagnostic ? (
              diagnosticLocked ? (
                <span
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "hidden sm:inline-flex",
                  )}
                  aria-disabled="true"
                  title={t("course.diagnosticLockedTitle")}
                >
                  {t("course.diagnosticPreparing")}
                </span>
              ) : (
                <Link
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "hidden sm:inline-flex",
                  )}
                  to={`/goals/${goalId}/units/${unitId}/diagnostic`}
                  title={t("diagnostic.validateTargetsTitle")}
                >
                  <Route aria-hidden />
                  {t("diagnostic.validateTargets")}
                </Link>
              )
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    aria-label={t("settings.learningView.title")}
                    title={t("settings.learningView.title")}
                  />
                }
              >
                <MoreHorizontal aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-52">
                <DropdownMenuRadioGroup
                  value={presentationMode}
                  onValueChange={(value) => {
                    if (value === "chat" || value === "reading") {
                      saveLearningView.mutate(value);
                    }
                  }}
                >
                  <DropdownMenuLabel>
                    {t("settings.learningView.title")}
                  </DropdownMenuLabel>
                  <DropdownMenuRadioItem value="chat">
                    <MessagesSquare aria-hidden />
                    {t("settings.learningView.chat")}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="reading">
                    <BookOpenText aria-hidden />
                    {t("settings.learningView.reading")}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {showDiagnostic && !diagnosticLocked ? (
          <Link
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "inline-flex w-fit sm:hidden",
            )}
            to={`/goals/${goalId}/units/${unitId}/diagnostic`}
            title={t("diagnostic.validateTargetsTitle")}
          >
            <Route aria-hidden />
            {t("diagnostic.validateTargets")}
          </Link>
        ) : null}
        <div className="min-w-0 space-y-1">
          {((FEATURE_MICRO_EXPAND && isMicro) ||
            (FEATURE_SUBDIVIDE_UNIT && canForceSubdivide)) && (
            <ForceSubdividePanel
              goalId={goalId}
              goalTitle={isMicro ? goal.title : undefined}
              unitId={unitId}
              unitTitle={displayTitle}
              variant="card"
              mode={isMicro ? "convert" : "subdivide"}
            />
          )}
        </div>
      </div>

      {!isKacomFree && targetGapFocus && weakPoints.length > 0 ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-semibold">{t("course.targetGapTitle")}</p>
          <p className="mt-1 text-amber-800">{t("course.targetGapBody")}</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {weakPoints.map((point) => (
              <li key={point.title} className="rounded-full bg-white px-3 py-1">
                {point.title} · {Math.round(point.score * 100)}%
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <LearningTrajectoryPanel unitId={unitId} goalId={goalId} />
      <UnitWizard
        key={unitId}
        unitId={unitId}
        goalId={goalId}
        unitTitle={displayTitle}
        unitKind={unit.unitKind}
        domainTag={goal.domainTag}
        initialStep={unit.sessionState?.currentStep ?? "structured_input"}
        startNewQuiz={startNewQuiz}
        instantMicro={instantMicro}
        instantRunId={instantRunId}
        onLearningAccessChange={setLearningAccess}
        onCurrentStepChange={setAssistantCurrentStep}
        sections={unit.sections}
        initialSectionId={searchParams.get("section")}
        initialSectionAnchor={searchParams.get("anchor")}
        presentationMode={presentationMode}
      />

      {mainlineEnabled("recommendations") ? <MainlineSuggestions unitId={unitId} boundaryKey={`${unitId}:${isUnitLearningDone(unit.status) ? "end" : "start"}`} /> : null}

      {isMicro && goalDetail ? (
        <GoalDocumentsPanel
          goalId={goalId}
          documents={goalDetail.uploadedDocuments ?? []}
          webResourcesEnabled={supportsGoalWebResources()}
        />
      ) : null}
    </div>
  );
}
