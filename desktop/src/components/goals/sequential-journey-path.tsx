import { Link } from "react-router-dom";
import {
  CheckCircle2,
  CircleGauge,
  Compass,
  Flag,
  LockKeyhole,
  LoaderCircle,
  Map,
  Play,
  RefreshCw,
  Shield,
  Target,
  Trophy,
} from "lucide-react";
import type { GoalModule, LastLearnedUnit } from "@/shared/api";
import { LastLearnedUnitCard } from "@/components/goals/last-learned-unit-card";
import type { JourneyOrientationLesson } from "@/components/goals/journey-orientation";
import type { MasterySummary } from "@/shared/domain/mastery";
import { Button, buttonVariants } from "@xue-learn/core/ui/button";
import { cn } from "@xue-learn/core/utils";
import {
  useT,
  type TranslationKey,
  type TranslationParams,
} from "@xue-learn/core/i18n";

type JourneyTranslator = (
  key: TranslationKey,
  params?: TranslationParams,
) => string;

export type JourneyModuleVisualState =
  "completed" | "locked" | "failed" | "generating" | "active";

export type JourneyModulePresentation = {
  visualState: JourneyModuleVisualState;
  canOpen: boolean;
  statusLabel: string;
  actionLabel: string | null;
  readyCount: number;
  totalLessons: number;
  completedLessons: number;
  lessonProgressPercent: number | null;
};

export type JourneyMilestone = {
  module: GoalModule;
  displayNumber: number;
  isFinal: boolean;
  side: "left" | "right";
  presentation: JourneyModulePresentation;
};

type SequentialJourneyPathProps = {
  goalId: string;
  title: string;
  modules: readonly GoalModule[];
  orientation?: JourneyOrientationLesson | null;
  mastery?: MasterySummary;
  lastLearnedUnit?: LastLearnedUnit | null;
  requiresCognitiveModel?: boolean;
};

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function deriveJourneyModulePresentation(
  module: GoalModule,
  translate?: JourneyTranslator,
): JourneyModulePresentation {
  const t =
    translate ??
    ((key: TranslationKey, params?: TranslationParams) => {
      const fallbacks: Partial<Record<TranslationKey, string>> = {
        "goalDetail.journey.completed": "已完成",
        "goalDetail.journey.unlockAfterPrevious": "完成上一模块后解锁",
        "goalDetail.journey.retryAvailable": "准备失败 · 可重新准备",
        "goalDetail.journey.preparing": "正在准备",
        "goalDetail.journey.partiallyReady": `可开始 ${params?.ready}/${params?.total} 课 · 其余准备中`,
        "goalDetail.journey.unitsReadyModelPreparing":
          "单元已就绪 · 模型准备中",
        "goalDetail.journey.currentModule": "当前模块",
        "goalDetail.journey.review": "回顾",
        "goalDetail.journey.retry": "重新准备",
        "goalDetail.journey.continue": "继续",
        "goalDetail.journey.view": "查看",
      };
      return fallbacks[key] ?? key;
    });
  const locked = module.status === "locked";
  const failed = module.status === "failed";
  const generating = module.status === "generating";
  const completed = module.status === "completed";
  const structureReady = (module.structureUnitCount ?? 0) > 0;
  const readyCount = module.readyUnitCount ?? 0;
  const totalLessons =
    module.requiredUnitCount || module.structureUnitCount || 0;
  const canOpen = !locked && (!generating || structureReady || failed);

  const statusLabel = completed
    ? t("goalDetail.journey.completed")
    : locked
      ? t("goalDetail.journey.unlockAfterPrevious")
      : failed
        ? t("goalDetail.journey.retryAvailable")
        : generating && !structureReady
          ? t("goalDetail.journey.preparing")
          : generating && readyCount > 0
            ? t("goalDetail.journey.partiallyReady", {
                ready: readyCount,
                total: totalLessons,
              })
            : generating
              ? t("goalDetail.journey.unitsReadyModelPreparing")
              : t("goalDetail.journey.currentModule");

  const actionLabel = !canOpen
    ? null
    : completed
      ? t("goalDetail.journey.review")
      : failed
        ? t("goalDetail.journey.retry")
        : readyCount > 0 || !generating
          ? t("goalDetail.journey.continue")
          : t("goalDetail.journey.view");

  const completedLessons = Math.min(
    module.completedRequiredUnits,
    module.requiredUnitCount,
  );
  const lessonProgressPercent =
    module.requiredUnitCount > 0
      ? clampPercent(
          (completedLessons / Math.max(module.requiredUnitCount, 1)) * 100,
        )
      : null;

  return {
    visualState: completed
      ? "completed"
      : locked
        ? "locked"
        : failed
          ? "failed"
          : generating
            ? "generating"
            : "active",
    canOpen,
    statusLabel,
    actionLabel,
    readyCount,
    totalLessons,
    completedLessons,
    lessonProgressPercent,
  };
}

export function buildJourneyMilestones(
  modules: readonly GoalModule[],
  translate?: JourneyTranslator,
): JourneyMilestone[] {
  const ordered = [...modules].sort(
    (left, right) => left.orderIndex - right.orderIndex,
  );

  return ordered.map((module, index) => ({
    module,
    displayNumber: index + 1,
    isFinal: index === ordered.length - 1,
    side: index % 2 === 0 ? "right" : "left",
    presentation: deriveJourneyModulePresentation(module, translate),
  }));
}

export function deriveJourneyUnitProgress(modules: readonly GoalModule[]) {
  const totals = modules.reduce(
    (result, module) => {
      const totalUnits =
        module.requiredUnitCount || module.structureUnitCount || 0;
      const completedUnits =
        module.status === "completed"
          ? totalUnits
          : Math.min(module.completedRequiredUnits, totalUnits);

      return {
        completedUnits: result.completedUnits + completedUnits,
        totalUnits: result.totalUnits + totalUnits,
      };
    },
    { completedUnits: 0, totalUnits: 0 },
  );

  return {
    ...totals,
    progressPercent:
      totals.totalUnits > 0
        ? clampPercent((totals.completedUnits / totals.totalUnits) * 100)
        : 0,
  };
}

function JourneyStatusIcon({
  state,
  className,
}: {
  state: JourneyModuleVisualState;
  className?: string;
}) {
  switch (state) {
    case "completed":
      return <CheckCircle2 className={className} aria-hidden />;
    case "locked":
      return <LockKeyhole className={className} aria-hidden />;
    case "failed":
      return <RefreshCw className={className} aria-hidden />;
    case "generating":
      return (
        <LoaderCircle className={cn(className, "animate-spin")} aria-hidden />
      );
    default:
      return <Play className={className} aria-hidden />;
  }
}

function JourneyHud({
  modules,
  mastery,
  requiresCognitiveModel = true,
}: {
  modules: readonly JourneyMilestone[];
  mastery?: MasterySummary;
  requiresCognitiveModel?: boolean;
}) {
  const t = useT();
  const { completedUnits, totalUnits, progressPercent } =
    deriveJourneyUnitProgress(modules.map((milestone) => milestone.module));
  const masteryLabel = !mastery
    ? t("goalDetail.journey.evidenceLoading")
    : mastery.evidenceCoveragePercent === 0
      ? t("goalDetail.journey.notVerified")
      : t("goalDetail.journey.verifiedMastery", {
          percent: mastery.verifiedMasteryPercent,
        });

  return (
    <section
      className={cn(
        "journey-hud",
        !requiresCognitiveModel && "journey-hud--progress-only",
      )}
      aria-label={t("goalDetail.journey.progressAriaLabel")}
    >
      <div className="journey-hud__progress">
        <div className="journey-hud__summary-line">
          <p className="journey-hud__label">
            <CircleGauge className="size-4" aria-hidden />
            {t("goalDetail.journey.progress")}
          </p>
          <strong className="journey-hud__value">{progressPercent}%</strong>
          <span className="journey-hud__meta">
            {t("goalDetail.journey.unitProgress", {
              completed: completedUnits,
              total: totalUnits,
            })}
          </span>
        </div>
        <div
          className="journey-hud__track"
          role="progressbar"
          aria-label={t("goalDetail.journey.unitProgressAriaLabel")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progressPercent}
        >
          <span style={{ width: `${progressPercent}%` }} />
        </div>
      </div>

      {requiresCognitiveModel ? (
        <div className="journey-hud__mastery" aria-live="polite">
          <div className="journey-hud__mastery-copy">
            <div className="journey-hud__summary-line">
              <p className="journey-hud__label">
                {t("goalDetail.journey.capabilityVerification")}
              </p>
              <strong className="journey-hud__mastery-value">
                {masteryLabel}
              </strong>
            </div>
          </div>
          {mastery ? (
            <p className="journey-hud__detail">
              {t("goalDetail.journey.targetVerification", {
                demonstrated: mastery.demonstratedTargetCount,
                required: mastery.requiredTargetCount,
              })}
              <span aria-hidden> · </span>
              {t("goalDetail.journey.evidenceCoverage", {
                percent: mastery.evidenceCoveragePercent,
              })}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function JourneyModuleCard({
  milestone,
  current,
  requiresCognitiveModel = true,
}: {
  milestone: JourneyMilestone;
  current: boolean;
  requiresCognitiveModel?: boolean;
}) {
  const t = useT();
  const { module, displayNumber, isFinal, presentation } = milestone;
  const showLessonProgress =
    current && presentation.lessonProgressPercent !== null;
  const showCurrentPanel = current && presentation.actionLabel;

  return (
    <article
      className={cn(
        "journey-module-card",
        current && "journey-module-card--current",
        presentation.visualState === "locked" && "journey-module-card--locked",
        presentation.visualState === "completed" &&
          "journey-module-card--completed",
        presentation.visualState === "failed" && "journey-module-card--failed",
      )}
    >
      <div className="journey-module-card__body">
        <div className="journey-module-card__header">
          <JourneyStatusIcon
            state={presentation.visualState}
            className="size-4 shrink-0"
          />
          <span className="text-[var(--text-500)]">
            {t("goalDetail.journey.moduleNumber", { number: displayNumber })}
          </span>
          <span aria-hidden className="text-[var(--text-300)]">
            ·
          </span>
          <span
            className={cn(
              current ? "text-[var(--brand-700)]" : "text-[var(--text-500)]",
              presentation.visualState === "failed" && "text-[var(--danger)]",
            )}
          >
            {presentation.statusLabel}
          </span>
          {isFinal ? (
            <span className="journey-module-card__destination">
              <Flag className="size-3.5" aria-hidden />
              {t("goalDetail.journey.finalModule")}
            </span>
          ) : null}
        </div>

        <h2 className="mt-2 text-lg font-bold leading-snug text-[var(--text-800)] md:text-xl">
          {module.title}
        </h2>
        <p className="journey-module-card__summary mt-2 text-sm leading-6 text-[var(--text-500)]">
          {module.summary}
        </p>

        {current ? (
          <div className="journey-module-card__objective">
            <Target className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              <span className="font-semibold">
                {requiresCognitiveModel
                  ? t("goalDetail.journey.capabilityMilestone")
                  : t("goalDetail.journey.moduleFocus")}
              </span>{" "}
              {module.objective}
            </p>
          </div>
        ) : null}
      </div>

      {showCurrentPanel ? (
        <aside className="journey-module-card__current-panel">
          {showLessonProgress ? (
            <div className="journey-module-card__lesson-progress">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-semibold text-[var(--text-700)]">
                  {t("goalDetail.journey.moduleProgress")}
                </span>
                <span className="text-[var(--text-500)]">
                  {t("goalDetail.journey.lessonProgress", {
                    completed: presentation.completedLessons,
                    total: module.requiredUnitCount,
                  })}
                </span>
              </div>
              <div
                className="journey-module-card__lesson-track"
                role="progressbar"
                aria-label={t("goalDetail.journey.moduleProgressAriaLabel", {
                  number: displayNumber,
                })}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={presentation.lessonProgressPercent ?? 0}
              >
                <span
                  style={{
                    width: `${presentation.lessonProgressPercent ?? 0}%`,
                  }}
                />
              </div>
            </div>
          ) : null}
          <span className="journey-module-card__action">
            {presentation.actionLabel}
          </span>
        </aside>
      ) : presentation.actionLabel ? (
        <div className="journey-module-card__aside">
          <span className="journey-module-card__action">
            {presentation.actionLabel}
          </span>
        </div>
      ) : (
        <div className="journey-module-card__aside" aria-hidden>
          {isFinal ? (
            <Flag className="journey-module-card__state-icon" />
          ) : (
            <LockKeyhole className="journey-module-card__state-icon" />
          )}
        </div>
      )}
    </article>
  );
}

function JourneyOrientationCard({
  goalId,
  orientation,
}: {
  goalId: string;
  orientation: JourneyOrientationLesson;
}) {
  const t = useT();
  const ready =
    orientation.status === "ready" || orientation.status === "completed";
  const failed = orientation.status === "failed";
  const href =
    ready && orientation.unitId
      ? `/goals/${goalId}/units/${orientation.unitId}`
      : `/goals/${goalId}/overview`;
  const statusLabel =
    orientation.status === "completed"
      ? t("goalDetail.journey.completed")
      : orientation.status === "ready"
        ? t("goalDetail.journey.orientationReady")
        : failed
          ? t("goalDetail.journey.orientationFailed")
          : t("goalDetail.journey.orientationPreparing");
  const actionLabel =
    orientation.status === "completed"
      ? t("goalDetail.journey.review")
      : failed
        ? t("goalDetail.journey.retryOrientation")
        : t("goalDetail.journey.startOrientation");
  const card = (
    <article
      className={cn(
        "journey-module-card",
        ready && "journey-module-card--current",
        failed && "journey-module-card--failed",
      )}
      aria-label={orientation.title}
    >
      <div className="journey-module-card__body">
        <div className="journey-module-card__header">
          <Compass className="size-4 shrink-0" aria-hidden />
          <span className="text-[var(--brand-700)]">
            {t("goalDetail.journey.orientationEyebrow")}
          </span>
          <span aria-hidden className="text-[var(--text-300)]">
            ·
          </span>
          <span
            className={cn(
              "text-[var(--text-500)]",
              failed && "text-[var(--danger)]",
            )}
          >
            {statusLabel}
          </span>
        </div>
        {orientation.summary ? (
          <p className="mt-1 text-sm text-[var(--text-500)]">
            {orientation.summary}
          </p>
        ) : null}
      </div>
      <div className="journey-module-card__aside">
        <span className="journey-module-card__action">{actionLabel}</span>
      </div>
    </article>
  );

  if (!href) return <div className="px-1">{card}</div>;
  return (
    <Link to={href} className="journey-module-link block px-1">
      {card}
    </Link>
  );
}

export function SequentialJourneyPath({
  goalId,
  title,
  modules,
  orientation = null,
  mastery,
  lastLearnedUnit = null,
  requiresCognitiveModel = true,
}: SequentialJourneyPathProps) {
  const t = useT();
  const milestones = buildJourneyMilestones(modules, t);
  const currentModuleId =
    milestones.find((milestone) =>
      ["active", "generating", "failed"].includes(milestone.module.status),
    )?.module.id ?? null;
  const currentMilestone =
    milestones.find((milestone) => milestone.module.id === currentModuleId) ??
    milestones.find((milestone) => milestone.presentation.canOpen) ??
    null;

  return (
    <div className="journey-page">
      <header className="journey-page__header">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--brand-600)]">
            {requiresCognitiveModel ? (
              <Trophy className="size-4" aria-hidden />
            ) : (
              <Map className="size-4" aria-hidden />
            )}
            {t("goalDetail.journey.title")}
          </p>
          <h1 className="mt-2 text-2xl font-bold leading-tight text-[var(--text-800)] md:text-3xl">
            {title}
          </h1>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Link
            to={`/goals/${goalId}/plan`}
            className={cn(
              buttonVariants({ variant: "outline", size: "lg" }),
              "min-h-11 flex-1 px-4 sm:flex-none",
            )}
          >
            <Map className="size-4" aria-hidden />
            {t("goalDetail.journey.coursePlan")}
          </Link>
          {currentMilestone ? (
            <Link
              to={`/goals/${goalId}/modules/${currentMilestone.module.id}`}
              className={cn(
                buttonVariants({ variant: "default", size: "lg" }),
                "min-h-11 flex-1 px-4 sm:flex-none",
              )}
            >
              <Play className="size-4" aria-hidden />
              {currentMilestone.presentation.completedLessons > 0
                ? t("goalDetail.journey.continueCurrentModule")
                : t("goalDetail.journey.startLearning")}
            </Link>
          ) : null}
        </div>
      </header>

      {lastLearnedUnit ? (
        <LastLearnedUnitCard goalId={goalId} unit={lastLearnedUnit} />
      ) : null}

      <JourneyHud
        modules={milestones}
        mastery={mastery}
        requiresCognitiveModel={requiresCognitiveModel}
      />

      {orientation ? (
        <JourneyOrientationCard goalId={goalId} orientation={orientation} />
      ) : null}

      <ol
        className="journey-trail"
        aria-label={t("goalDetail.journey.pathAriaLabel")}
      >
        {milestones.map((milestone) => {
          const { module, presentation } = milestone;
          const current = module.id === currentModuleId;
          const card = (
            <JourneyModuleCard
              milestone={milestone}
              current={current}
              requiresCognitiveModel={requiresCognitiveModel}
            />
          );

          return (
            <li
              key={module.id}
              className={cn(
                "journey-trail__stage",
                milestone.side === "left"
                  ? "journey-trail__stage--left"
                  : "journey-trail__stage--right",
              )}
              data-state={presentation.visualState}
            >
              <div className="journey-trail__node" aria-hidden>
                <Shield className="journey-trail__shield" />
                <span className="journey-trail__number">
                  {milestone.displayNumber}
                </span>
                <span className="journey-trail__node-status">
                  {milestone.isFinal ? (
                    <Flag className="size-3.5" />
                  ) : (
                    <JourneyStatusIcon
                      state={presentation.visualState}
                      className="size-3.5"
                    />
                  )}
                </span>
              </div>

              <div className="journey-trail__card-slot">
                {presentation.canOpen ? (
                  <Link
                    to={`/goals/${goalId}/modules/${module.id}`}
                    className="journey-module-link"
                    aria-current={current ? "step" : undefined}
                  >
                    {card}
                  </Link>
                ) : (
                  card
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
