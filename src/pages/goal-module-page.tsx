import { useEffect, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  LoaderCircle,
  Lock,
  RefreshCw,
  Puzzle,
  ShieldCheck,
  Target,
} from "lucide-react";
import {
  useGoalModule,
  useGoal,
  useModuleMastery,
  useModuleCognitiveModel,
  useRetryModuleGeneration,
} from "@/hooks/api";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@xue-learn/core/ui/button";
import { Card } from "@/components/ui/card";
import { LlmMarkdownInline } from "@/components/markdown/llm-markdown";
import { statusLabel } from "@/shared/domain/unit-status";
import type { UnitStatus } from "@/shared/domain/types";
import {
  COGNITIVE_LABELS,
  cognitivePercent,
  learnerConfidenceLabel,
} from "@/shared/domain/cognitive-model";
import { cn } from "@xue-learn/core/utils";
import {
  formatMasteryDimensions,
  type MasterySummary,
  type MasteryTargetSummary,
} from "@/shared/domain/mastery";
import type { GoalModuleDetail } from "@/shared/api/types";
import { getUserFacingApiErrorMessage } from "@/shared/api";
import { useT, type TranslationKey, type TranslationParams } from "@xue-learn/core/i18n";
import { resolveModuleProgressAction } from "@/shared/domain/module-progress-action";
import { LastLearnedUnitCard } from "@/components/goals/last-learned-unit-card";
import { resolveModuleLastLearnedUnit } from "@/shared/domain/last-learned-unit";

type GoalDetailTranslator = (key: TranslationKey, params?: TranslationParams) => string;

const COMPLETED_UNIT_STATUSES = new Set([
  "completed",
  "mastered",
  "completed_needs_reinforcement",
]);

type CapabilityRequirement = {
  dimension: string;
  estimate: number | null;
  evidenceSufficiency: number;
  passed: boolean;
  gate: boolean;
};

type Capability = {
  id: string;
  title: string;
  learningObjective: string;
  readiness: string;
  requirements: CapabilityRequirement[];
  missingRequirements: CapabilityRequirement[];
  practiceUnitId?: string | null;
  practiceUnitTitle?: string | null;
};

/** Selected-response / exit diagnostic can write these dimensions today. */
const QUIZ_FILLABLE_DIMENSIONS = new Set(["memory", "understanding"]);

function isCompleted(status: string) {
  return COMPLETED_UNIT_STATUSES.has(status);
}

function dimensionLabel(dimension: string) {
  return (
    COGNITIVE_LABELS.dimensions[
      dimension as keyof typeof COGNITIVE_LABELS.dimensions
    ] ?? dimension
  );
}

function readinessLabel(readiness: string, t: GoalDetailTranslator) {
  if (readiness === "demonstrated") return t("goalDetail.module.mastered");
  if (readiness === "needs_evidence") return t("goalDetail.module.learning");
  return t("goalDetail.module.notTested");
}

function readinessClass(readiness: string) {
  if (readiness === "demonstrated") {
    return "border-[color-mix(in_srgb,var(--success)_42%,var(--border))] bg-[var(--success-soft)] text-[var(--success)]";
  }
  if (readiness === "needs_evidence") {
    return "border-[color-mix(in_srgb,var(--warning)_42%,var(--border))] bg-[var(--warning-soft)] text-[var(--warning)]";
  }
  return "border-[var(--border-300)] bg-[var(--bg-200)] text-[var(--text-500)]";
}

function ModuleEntryReadinessCard({
  goalId,
  module,
  nextUnitId,
  retrying,
  onRetry,
}: {
  goalId: string;
  module: GoalModuleDetail;
  nextUnitId?: string | null;
  retrying: boolean;
  onRetry: () => void;
}) {
  const t = useT();
  const readiness = module.entryReadiness;
  if (
    readiness.status === "not_applicable" &&
    module.entryFoundationStatus === "not_applicable"
  ) {
    return null;
  }

  const needsBridge = readiness.status === "bridge_needed";
  const satisfied = readiness.status === "ready";
  const preparationFailed = module.entryFoundationStatus === "failed";
  const preparing =
    module.entryFoundationStatus === "pending" ||
    module.entryFoundationStatus === "building";
  const readinessFoundations = readiness.foundations ?? [];
  const visibleFoundations =
    readinessFoundations.length > 0
      ? readinessFoundations
      : (module.entryFoundationBriefs ?? []).map((brief) => ({
          learningTargetId: brief.ref,
          title: brief.title,
          critical: brief.criticality === "critical",
          estimate: null,
          evidenceSufficiency: 0,
          reason: "unverified" as const,
          ready: false,
        }));
  const outstandingCount = visibleFoundations.filter(
    (foundation) => !foundation.ready,
  ).length;

  return (
    <Card
      className={cn(
        "gap-0 overflow-hidden p-0",
        needsBridge || preparationFailed
          ? "border-[color-mix(in_srgb,var(--warning)_42%,var(--border))]"
          : satisfied
            ? "border-[color-mix(in_srgb,var(--success)_38%,var(--border))]"
            : "border-[var(--brand-200)]",
      )}
    >
      <details>
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-[var(--text-800)] marker:hidden md:px-5">
          <span className="flex min-w-0 items-center gap-2">
            <ShieldCheck className="size-4 shrink-0 text-[var(--brand-600)]" />
            <span>{t("goalDetail.module.foundationRequirements")}</span>
            <span className="truncate font-normal text-[var(--text-500)]">
              {t("goalDetail.module.unverifiedCount", { count: outstandingCount })}
            </span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-[var(--text-400)]" />
        </summary>
        <div className="flex min-w-0 flex-col items-stretch gap-4 border-t border-[var(--border-200)] p-4 sm:flex-row sm:items-start sm:justify-between md:p-5">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-start gap-2">
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-xl",
                  satisfied
                    ? "bg-[var(--success-soft)] text-[var(--success)]"
                    : "bg-[var(--brand-100)] text-[var(--brand-700)]",
                )}
              >
                {satisfied ? (
                  <CheckCircle2 aria-hidden className="size-4.5" />
                ) : (
                  <ShieldCheck aria-hidden className="size-4.5" />
                )}
              </span>
              <div className="min-w-0">
                <h2 className="font-bold wrap-break-word text-[var(--text-800)]">
                  {t("goalDetail.module.foundationDetails")}
                </h2>
                <p className="mt-0.5 text-xs wrap-break-word text-[var(--text-500)]">
                  {t("goalDetail.module.foundationDisclaimer")}
                </p>
              </div>
            </div>

            {visibleFoundations.length ? (
              <ul className="mt-3 flex min-w-0 flex-wrap gap-2">
                {visibleFoundations.map((foundation) => (
                  <li
                    key={foundation.learningTargetId}
                    className="min-w-0 max-w-full"
                  >
                    <Badge
                      className={cn(
                        "max-w-full whitespace-normal wrap-break-word text-left",
                        foundation.ready
                          ? "border-[color-mix(in_srgb,var(--success)_38%,var(--border))] bg-[var(--success-soft)] text-[var(--success)]"
                          : "border-[var(--border-200)] bg-[var(--bg-100)] text-[var(--text-600)]",
                      )}
                      variant="outline"
                    >
                      {foundation.title}
                      {foundation.critical ? t("goalDetail.module.criticalSuffix") : ""}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : null}

            <p className="mt-3 text-sm leading-6 text-[var(--text-600)]">
              {preparing
                ? t("goalDetail.module.preparingFoundationContract")
                : preparationFailed
                  ? module.entryFoundationError?.trim() ||
                    t("goalDetail.module.foundationContractFailed")
                  : needsBridge
                    ? t("goalDetail.module.foundationGapConfirmed")
                    : satisfied
                      ? t("goalDetail.module.foundationSatisfied")
                      : readiness.status === "revalidate"
                        ? t("goalDetail.module.foundationNeedsRevalidation")
                        : t("goalDetail.module.foundationUnknown")}
            </p>
          </div>

          <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[12rem]">
            {preparationFailed ? (
              <Button
                disabled={retrying}
                size="lg"
                variant="outline"
                onClick={onRetry}
              >
                <RefreshCw
                  aria-hidden
                  className={cn("size-4", retrying && "animate-spin")}
                />
                {retrying ? t("goalDetail.module.preparing") : t("goalDetail.module.retryFoundation")}
              </Button>
            ) : preparing ? (
              <Button disabled size="lg" variant="outline">
                <LoaderCircle aria-hidden className="size-4 animate-spin" />
                {t("goalDetail.module.preparingFoundationCheck")}
              </Button>
            ) : needsBridge && readiness.bridgeUnitId ? (
              <Link
                className={buttonVariants({ size: "lg" })}
                to={`/goals/${goalId}/units/${readiness.bridgeUnitId}`}
              >
                {t("goalDetail.module.studyPreparationUnit")}
                <ArrowRight aria-hidden className="size-4" />
              </Link>
            ) : readiness.checkAvailable && !satisfied ? (
              <Link
                className={buttonVariants({ size: "lg" })}
                to={`/goals/${goalId}/modules/${module.id}/assessment?purpose=readiness`}
              >
                {t("goalDetail.module.checkFoundation")}
                <ShieldCheck aria-hidden className="size-4" />
              </Link>
            ) : null}
            {!satisfied && nextUnitId ? (
              <Link
                className={buttonVariants({ variant: "ghost", size: "lg" })}
                to={`/goals/${goalId}/units/${nextUnitId}`}
              >
                {t("goalDetail.module.startAnyway")}
              </Link>
            ) : null}
          </div>
        </div>
      </details>
    </Card>
  );
}

function ModuleMasterySnapshot({
  capabilities,
  summary,
  loading,
  generating,
  onOpen,
}: {
  capabilities: Capability[];
  summary?: MasterySummary;
  loading: boolean;
  generating: boolean;
  onOpen: () => void;
}) {
  const t = useT();
  const mastered =
    summary?.demonstratedTargetCount ??
    capabilities.filter((capability) => capability.readiness === "demonstrated")
      .length;
  const inProgress =
    summary?.formingTargetCount ??
    capabilities.filter(
      (capability) => capability.readiness === "needs_evidence",
    ).length;
  const notStarted =
    summary?.unobservedTargetCount ??
    Math.max(0, capabilities.length - mastered - inProgress);
  const targetSummaryById = new Map(
    summary?.targets?.map((target) => [target.learningTargetId, target]) ?? [],
  );

  return (
    <Card
      className="min-w-0 gap-0 overflow-hidden border-[var(--brand-200)] bg-[color-mix(in_srgb,var(--brand-50)_72%,var(--bg-50))] p-0"
      elevated
    >
      <div className="border-b border-[var(--brand-100)] p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-[var(--brand-100)] text-[var(--brand-700)]">
            <BrainCircuit aria-hidden className="size-4.5" />
          </span>
          <Badge
            className="border-[var(--brand-200)] bg-[var(--bg-50)] text-[var(--brand-700)]"
            variant="outline"
          >
            {t("goalDetail.module.masteryStatus")}
          </Badge>
        </div>
        <h2 className="mt-3 font-bold text-[var(--text-800)]">{t("goalDetail.module.moduleMastery")}</h2>
        {summary ? (
          summary.evidenceCoveragePercent === 0 ? (
            <p className="mt-2 text-lg font-bold text-[var(--text-800)]">
              {t("goalDetail.module.notVerified")}
            </p>
          ) : (
            <p className="mt-2 text-base font-bold text-[var(--text-800)]">
              {t("goalDetail.module.verifiedMastery", { percent: summary.verifiedMasteryPercent })}{" "}
              <span className="font-medium text-[var(--text-500)]">
                {t("goalDetail.module.evidenceCoverageSuffix", { percent: summary.evidenceCoveragePercent })}
              </span>
            </p>
          )
        ) : null}
        <p className="mt-1 text-xs leading-5 text-[var(--text-500)]">
          {t("goalDetail.module.completionDisclaimer")}
        </p>
        {summary?.weakDimensions?.length ? (
          <p className="mt-1 text-xs text-[var(--danger)]">
            {t("goalDetail.module.weakDimensions")}
            {formatMasteryDimensions(summary.weakDimensions)}
          </p>
        ) : null}
        {summary?.unverifiedDimensions?.length ? (
          <p className="mt-1 text-xs text-[var(--text-500)]">
            {t("goalDetail.module.missingEvidence")}
            {formatMasteryDimensions(summary.unverifiedDimensions)}
          </p>
        ) : null}
      </div>

      {generating ? (
        <div className="p-4">
          <p className="flex items-start gap-2 text-sm leading-6 text-[var(--text-600)]">
            <LoaderCircle
              aria-hidden
              className="mt-1 size-4 shrink-0 animate-spin text-[var(--brand-600)]"
            />
            {t("goalDetail.module.masteryPreparingDescription")}
          </p>
        </div>
      ) : loading ? (
        <div className="flex items-center gap-2 p-4 text-sm text-[var(--text-500)]">
          <LoaderCircle aria-hidden className="size-4 animate-spin" />
          {t("goalDetail.module.loadingMastery")}
        </div>
      ) : capabilities.length === 0 ? (
        <p className="p-4 text-sm leading-6 text-[var(--text-500)]">
          {t("goalDetail.module.noCapabilities")}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 border-b border-[var(--brand-100)]">
            <div className="border-r border-[var(--brand-100)] p-3.5">
              <p className="text-lg font-bold text-[var(--text-800)]">
                {mastered}
              </p>
              <p className="text-[11px] text-[var(--text-500)]">{t("goalDetail.module.mastered")}</p>
            </div>
            <div className="border-r border-[var(--brand-100)] p-3.5">
              <p className="text-lg font-bold text-[var(--text-800)]">
                {inProgress}
              </p>
              <p className="text-[11px] text-[var(--text-500)]">{t("goalDetail.module.learning")}</p>
            </div>
            <div className="p-3.5">
              <p className="text-lg font-bold text-[var(--text-800)]">
                {notStarted}
              </p>
              <p className="text-[11px] text-[var(--text-500)]">{t("goalDetail.module.notTested")}</p>
            </div>
          </div>
          <div className="space-y-2 p-3">
            {capabilities.slice(0, 3).map((capability) => {
              const targetSummary = targetSummaryById.get(capability.id);
              return (
                <button
                  className="w-full rounded-xl border border-transparent bg-[var(--bg-50)] px-3 py-2.5 text-left transition hover:border-[var(--brand-200)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-500)]"
                  key={capability.id}
                  onClick={onOpen}
                  type="button"
                >
                  <span className="flex min-w-0 items-start justify-between gap-2">
                    <span className="min-w-0 flex-1 line-clamp-2 wrap-break-word text-xs font-semibold leading-5 text-[var(--text-700)]">
                      {capability.title}
                    </span>
                    <ChevronRight
                      aria-hidden
                      className="mt-0.5 size-3.5 shrink-0 text-[var(--text-400)]"
                    />
                  </span>
                  <span className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-[var(--text-500)]">
                    <span>{readinessLabel(capability.readiness, t)}</span>
                    <span>
                      {!targetSummary ||
                      targetSummary.evidenceCoveragePercent === 0
                        ? t("goalDetail.module.notVerified")
                        : t("goalDetail.module.verifiedPercent", { percent: targetSummary.verifiedMasteryPercent })}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <button
            className="flex w-full items-center justify-between border-t border-[var(--brand-100)] px-4 py-3 text-left text-xs font-semibold text-[var(--brand-700)] transition hover:bg-[var(--brand-50)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand-500)]"
            onClick={onOpen}
            type="button"
          >
            {t("goalDetail.module.viewAllCapabilities")}
            <ArrowRight aria-hidden className="size-3.5" />
          </button>
        </>
      )}
    </Card>
  );
}

function CapabilityCard({
  capability,
  goalId,
  moduleId,
  targetSummary,
}: {
  capability: Capability;
  goalId: string;
  moduleId: string;
  targetSummary?: MasteryTargetSummary;
}) {
  const t = useT();
  const progress =
    targetSummary && targetSummary.evidenceCoveragePercent > 0
      ? targetSummary.verifiedMasteryPercent
      : null;
  const missingRequirements = capability.missingRequirements ?? [];
  const missingCount = missingRequirements.length;
  const requirements = capability.requirements ?? [];
  const quizFillableMissing = missingRequirements.some((requirement) =>
    QUIZ_FILLABLE_DIMENSIONS.has(requirement.dimension),
  );
  const performanceMissing = missingRequirements.some(
    (requirement) => !QUIZ_FILLABLE_DIMENSIONS.has(requirement.dimension),
  );
  return (
    <Card className="min-w-0 gap-0 overflow-hidden p-0">
      <div className="border-b border-[var(--border-200)] p-5">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-50)] text-[var(--brand-700)]">
            <Target aria-hidden className="size-4.5" />
          </span>
          <Badge
            className={cn("shrink-0", readinessClass(capability.readiness))}
            variant="outline"
          >
            {readinessLabel(capability.readiness, t)}
          </Badge>
        </div>
        <h2 className="mt-3 text-base font-bold leading-6 wrap-break-word text-[var(--text-800)]">
          {capability.title}
        </h2>
        <p className="mt-1.5 text-sm leading-6 wrap-break-word text-[var(--text-500)]">
          {capability.learningObjective}
        </p>
        <div className="mt-3">
          <div className="flex justify-between gap-2 text-[10px] text-[var(--text-500)]">
            <span>{t("goalDetail.module.masteryProgress")}</span>
            <span>{progress == null ? t("goalDetail.module.notTested") : `${progress}%`}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--bg-300)]">
            {progress != null ? (
              <div
                className="h-full rounded-full bg-[var(--brand-500)]"
                style={{ width: `${progress}%` }}
              />
            ) : null}
          </div>
        </div>
      </div>

      <div className="space-y-3 p-4">
        {requirements.map((requirement) => {
          const estimate = cognitivePercent(requirement.estimate);
          return (
            <div
              className="rounded-xl border border-[var(--border-200)] bg-[var(--bg-100)] p-3"
              key={requirement.dimension}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-700)]">
                  {requirement.passed ? (
                    <CheckCircle2
                      aria-hidden
                      className="size-3.5 text-[var(--success)]"
                    />
                  ) : (
                    <CircleDashed
                      aria-hidden
                      className="size-3.5 text-[var(--text-400)]"
                    />
                  )}
                  {dimensionLabel(requirement.dimension)}
                </span>
                {requirement.gate ? (
                  <Badge className="h-5 text-[10px]" variant="outline">
                    {t("goalDetail.module.criticalThreshold")}
                  </Badge>
                ) : null}
              </div>
              <div className="mt-3">
                <div className="flex justify-between gap-2 text-[10px] text-[var(--text-500)]">
                  <span>{t("goalDetail.module.currentPerformance")}</span>
                  <span>{estimate == null ? t("goalDetail.module.notTested") : `${estimate}%`}</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--bg-300)]">
                  {estimate != null ? (
                    <div
                      className="h-full rounded-full bg-[var(--brand-500)]"
                      style={{ width: `${estimate}%` }}
                    />
                  ) : null}
                </div>
                <p className="mt-1.5 text-[10px] text-[var(--text-400)]">
                  {learnerConfidenceLabel(requirement.evidenceSufficiency)}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="space-y-3 border-t border-[var(--border-200)] px-4 py-3">
        <p
          className={cn(
            "flex items-center gap-2 text-xs",
            missingCount ? "text-[var(--warning)]" : "text-[var(--success)]",
          )}
        >
          {missingCount ? (
            <ShieldCheck aria-hidden className="size-3.5" />
          ) : (
            <Check aria-hidden className="size-3.5" />
          )}
          {missingCount
            ? t("goalDetail.module.missingCriticalRequirements", { count: missingCount })
            : t("goalDetail.module.criticalRequirementsMet")}
        </p>
        {missingCount ? (
          <div className="flex flex-col gap-2">
            <Link
              className={cn(
                buttonVariants({
                  variant: quizFillableMissing ? "default" : "outline",
                  size: "sm",
                }),
                "justify-between",
              )}
              to={`/goals/${goalId}/modules/${moduleId}/diagnostic`}
            >
              {t("goalDetail.module.takeExitDiagnostic")}
              <ArrowRight aria-hidden className="size-3.5" />
            </Link>
            {capability.practiceUnitId ? (
              <Link
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "justify-between",
                )}
                to={`/goals/${goalId}/units/${capability.practiceUnitId}`}
              >
                <span className="truncate">
                  {t("goalDetail.module.goToRelatedLesson")}
                  {capability.practiceUnitTitle
                    ? `：${capability.practiceUnitTitle}`
                    : t("goalDetail.module.practice")}
                </span>
                <ChevronRight aria-hidden className="size-3.5 shrink-0" />
              </Link>
            ) : null}
            {performanceMissing ? (
              <p className="text-[10px] leading-4 text-[var(--text-400)]">
                {t("goalDetail.module.advancedPracticeComing")}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export function GoalModulePage() {
  const t = useT();
  const { goalId = "", moduleId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const [retryQueued, setRetryQueued] = useState(false);
  const journey = useGoal(goalId);
  const detail = useGoalModule(goalId, moduleId);
  const retryGeneration = useRetryModuleGeneration(goalId, moduleId);
  const cognitive = useModuleCognitiveModel(goalId, moduleId, "capabilities", {
    enabled:
      detail.data?.requiresCognitiveModel === true &&
      detail.data.generationStatus === "ready",
  });
  const mastery = useModuleMastery(goalId, moduleId, {
    enabled:
      detail.data?.requiresCognitiveModel === true &&
      detail.data.generationStatus === "ready",
  });

  const module = detail.data;
  const moduleUnits = module?.units ?? [];
  const requiresCognitiveModel = module?.requiresCognitiveModel !== false;
  const failedUnitCount = requiresCognitiveModel
    ? moduleUnits.filter((unit) => unit.cognitiveModelStatus === "failed")
        .length
    : 0;
  const moduleFailed = module?.generationStatus === "failed";
  const needsRecovery = Boolean(
    module &&
    module.unlockStatus !== "locked" &&
    (moduleFailed || (requiresCognitiveModel && failedUnitCount > 0)),
  );
  const generating = Boolean(module && module.generationStatus !== "ready");
  const readyCount = module?.readyUnitCount ?? 0;
  const lessonUnits = moduleUnits.filter((unit) => unit.unitKind === "lesson");
  const unitKacomActive = Boolean(
    requiresCognitiveModel &&
      lessonUnits.some(
        (unit) =>
          unit.cognitiveModelStatus === "building" ||
          unit.cognitiveModelStatus === "pending" ||
          unit.cognitiveModelStatus === "queued",
      ),
    );
  const allLessonsExpanded = Boolean(
    requiresCognitiveModel &&
      lessonUnits.length > 0 &&
      lessonUnits.every((unit) => unit.cognitiveModelStatus === "expanded"),
  );
  const moduleFinalizing = Boolean(
    module &&
      module.generationStatus === "building" &&
      !unitKacomActive &&
      allLessonsExpanded,
  );
  const stalledPreparing = Boolean(
    module &&
    generating &&
    !moduleFailed &&
    failedUnitCount === 0 &&
    readyCount > 0 &&
    moduleUnits.length > readyCount &&
    !moduleUnits.some((unit) => unit.cognitiveModelStatus === "building"),
  );
  const awaitingUnitCount = module
    ? Math.max(0, moduleUnits.length - readyCount)
    : 0;
  useEffect(() => {
    if (!stalledPreparing && !needsRecovery) setRetryQueued(false);
  }, [needsRecovery, stalledPreparing]);
  useEffect(() => {
    if (!retryQueued) return;
    const timer = window.setTimeout(() => setRetryQueued(false), 12_000);
    return () => window.clearTimeout(timer);
  }, [retryQueued]);

  if (detail.error && (detail.error as { status?: number }).status === 404) {
    return <Navigate to="/404" replace />;
  }
  if (!module) {
    return (
      <p className="text-[var(--text-400)]">
        {detail.error?.message ?? t("goalDetail.module.loadingModule")}
      </p>
    );
  }
  if (module.unlockStatus === "locked") {
    return <Navigate to={`/goals/${goalId}`} replace />;
  }
  const view =
    requiresCognitiveModel && params.get("view") === "cognition" && !generating
      ? "cognition"
      : "map";
  const totalLessons =
    module.requiredUnitCount ||
    module.structureUnitCount ||
    moduleUnits.length;
  const completedLessons = module.completedRequiredUnits ?? 0;
  const progressPercent = totalLessons
    ? Math.min(100, Math.round((completedLessons / totalLessons) * 100))
    : 0;
  const supportUnits = moduleUnits.filter(
    (unit) => unit.supportKind === "prerequisite_bridge",
  );
  const curriculumUnits = moduleUnits.filter(
    (unit) => unit.supportKind !== "prerequisite_bridge",
  );
  const progressAction = resolveModuleProgressAction({
    currentModule: module,
    units: moduleUnits,
    journeyModules: journey.data?.modules,
  });
  const nextUnit =
    progressAction?.kind === "unit"
      ? (moduleUnits.find((unit) => unit.id === progressAction.unitId) ?? null)
      : null;
  const lastLearnedUnit = journey.data
    ? resolveModuleLastLearnedUnit(journey.data, moduleId)
    : null;
  const capabilities = (cognitive.data?.capabilities ?? []) as Capability[];
  const setView = (next: "map" | "cognition") => {
    setParams(next === "cognition" ? { view: "cognition" } : {}, {
      replace: true,
    });
  };
  const recoverBusy = retryGeneration.isPending || retryQueued;
  const requestRecovery = () => {
    retryGeneration.mutate(undefined, {
      onSuccess: () => setRetryQueued(true),
    });
  };
  return (
    <div className="min-w-0 space-y-5 overflow-x-clip">
      {needsRecovery || stalledPreparing ? (
        <div
          className={cn(
            "flex w-full flex-wrap items-center gap-3 rounded-2xl border px-4 py-3",
            needsRecovery
              ? "border-[color-mix(in_srgb,var(--warning)_42%,var(--border))] bg-[var(--warning-soft)]"
              : "border-[color-mix(in_srgb,var(--brand-500)_28%,var(--border))] bg-[var(--brand-50)]",
          )}
        >
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-xl",
              needsRecovery
                ? "bg-[color-mix(in_srgb,var(--warning)_16%,transparent)] text-[var(--warning)]"
                : "bg-[var(--brand-100)] text-[var(--brand-700)]",
            )}
          >
            {recoverBusy ? (
              <LoaderCircle aria-hidden className="size-4 animate-spin" />
            ) : needsRecovery ? (
              <AlertTriangle aria-hidden className="size-4" />
            ) : (
              <CircleDashed aria-hidden className="size-4" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold wrap-break-word text-[var(--text-800)]">
              {moduleFailed
                ? t("goalDetail.module.modulePreparationFailed")
                : failedUnitCount > 0
                  ? t("goalDetail.module.failedUnitCount", { count: failedUnitCount })
                  : t("goalDetail.module.unitsAwaitingPreparation", {
                      count: awaitingUnitCount,
                    })}
            </p>
            <p className="mt-0.5 text-xs wrap-break-word text-[var(--text-600)]">
              {needsRecovery
                ? t("goalDetail.module.retriesExhausted")
                : t("goalDetail.module.retryIfStalled")}
            </p>
            {retryGeneration.isError ? (
              <p className="mt-1 text-xs wrap-break-word text-[var(--warning)]">
                {getUserFacingApiErrorMessage(retryGeneration.error)}
              </p>
            ) : null}
          </div>
          <Button
            className="shrink-0"
            disabled={recoverBusy}
            size="sm"
            type="button"
            variant="default"
            onClick={requestRecovery}
          >
            <RefreshCw
              aria-hidden
              className={cn("size-3.5", recoverBusy && "animate-spin")}
            />
            {recoverBusy ? t("goalDetail.module.repreparing") : t("goalDetail.module.retry")}
          </Button>
        </div>
      ) : null}
      <section className="overflow-hidden rounded-3xl border border-[var(--border-200)] bg-[var(--bg-50)] shadow-sm">
        <div className="grid gap-6 p-5 md:p-7 lg:grid-cols-[minmax(0,1fr)_15rem] lg:items-end">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                className="border-[var(--brand-200)] bg-[var(--brand-50)] text-[var(--brand-700)]"
                variant="outline"
              >
                {t("goalDetail.module.moduleNumber", { number: module.orderIndex + 1 })}
              </Badge>
              <span className="flex items-center gap-1.5 text-xs text-[var(--text-500)]">
                <BookOpen aria-hidden className="size-3.5" />
                {t("goalDetail.module.learningUnitCount", { count: totalLessons })}
              </span>
            </div>
            <h1 className="mt-3 text-2xl font-bold leading-tight tracking-tight wrap-break-word text-[var(--text-900)] md:text-3xl">
              {module.title}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 wrap-break-word text-[var(--text-600)]">
              {module.objective}
            </p>
            {moduleFailed ? (
              <p className="mt-4 text-xs font-medium text-[var(--warning)]">
                {t("goalDetail.module.generationFailedDescription")}
              </p>
            ) : generating ? (
              <p className="mt-4 flex items-center gap-2 text-xs font-medium text-[var(--brand-700)]">
                <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
                {moduleUnits.length === 0
                  ? t("goalDetail.module.generatingUnits")
                  : moduleFinalizing
                    ? t("goalDetail.module.moduleFinalizing")
                    : readyCount > 0
                      ? t("goalDetail.module.lessonsPartiallyReady", {
                          ready: readyCount,
                          total: totalLessons,
                        })
                      : requiresCognitiveModel
                        ? t("goalDetail.module.unitsListedMasteryPreparing")
                        : t("goalDetail.module.unitsListedPreparing")}
              </p>
            ) : null}
          </div>

          <div className="rounded-2xl border border-[var(--border-200)] bg-[var(--bg-100)] p-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium text-[var(--text-500)]">
                  {t("goalDetail.module.moduleProgress")}
                </p>
                <p className="mt-1 text-xl font-bold text-[var(--text-800)]">
                  {completedLessons}
                  <span className="ml-1 text-sm font-medium text-[var(--text-400)]">
                    / {totalLessons}
                  </span>
                </p>
              </div>
              <span className="text-xs font-semibold text-[var(--brand-700)]">
                {progressPercent}%
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--bg-300)]">
              <div
                className="h-full rounded-full bg-[var(--brand-500)] transition-[width]"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            {progressAction ? (
              <Link
                className={cn(
                  buttonVariants({ variant: "default", size: "lg" }),
                  "mt-4 w-full justify-between",
                )}
                to={
                  progressAction.kind === "unit"
                    ? `/goals/${goalId}/units/${progressAction.unitId}`
                    : progressAction.kind === "module"
                      ? `/goals/${goalId}/modules/${progressAction.moduleId}`
                      : `/goals/${goalId}`
                }
              >
                {progressAction.kind === "unit"
                  ? progressAction.continuing
                    ? t("goalDetail.module.continueLearning")
                    : t("goalDetail.module.startNextUnit")
                  : progressAction.kind === "module"
                    ? t("goalDetail.module.continueNextModule")
                    : t("goalDetail.module.viewLearningPath")}
                <ArrowRight aria-hidden className="size-4" />
              </Link>
            ) : null}
          </div>
        </div>
        {lastLearnedUnit ? (
          <LastLearnedUnitCard
            className="rounded-none border-x-0 border-b-0"
            goalId={goalId}
            unit={lastLearnedUnit}
          />
        ) : null}
      </section>

      {requiresCognitiveModel ? (
        <ModuleEntryReadinessCard
          goalId={goalId}
          module={module}
          nextUnitId={nextUnit?.id}
          onRetry={requestRecovery}
          retrying={recoverBusy}
        />
      ) : null}

      {requiresCognitiveModel ? (
        <div className="flex min-w-0 flex-wrap items-center gap-3 border-b border-[var(--border-200)] pb-3">
          <nav
            aria-label={t("goalDetail.module.contentAriaLabel")}
            className="flex min-w-0 max-w-full flex-wrap rounded-xl bg-[var(--bg-200)] p-1"
          >
            <Button
              aria-pressed={view === "map"}
              className="rounded-lg"
              size="lg"
              variant={view === "map" ? "default" : "ghost"}
              onClick={() => setView("map")}
            >
              <BookOpen aria-hidden className="size-4 shrink-0" />
              {t("goalDetail.module.learningPath")}
            </Button>
            <Button
              aria-pressed={view === "cognition"}
              className="rounded-lg"
              disabled={generating}
              size="lg"
              variant={view === "cognition" ? "default" : "ghost"}
              onClick={() => setView("cognition")}
            >
              <BrainCircuit aria-hidden className="size-4 shrink-0" />
              {t("goalDetail.module.moduleMastery")}
            </Button>
          </nav>
        </div>
      ) : null}

      {view === "map" ? (
        moduleUnits.length === 0 ? (
          <Card className="flex items-center gap-3 p-5 text-sm text-[var(--text-500)]">
            <LoaderCircle className="size-4 animate-spin text-[var(--brand-600)]" />
            {t("goalDetail.module.generatingModuleUnits")}
          </Card>
        ) : (
          <div
            className={cn(
              "grid min-w-0 items-start gap-5",
              requiresCognitiveModel &&
                "lg:grid-cols-[minmax(0,1fr)_17rem]",
            )}
          >
            <section
              aria-labelledby="module-lessons-heading"
              className="min-w-0"
            >
              <div className="mb-3 flex min-w-0 items-end justify-between gap-3">
                <div className="min-w-0">
                  <h2
                    className="font-bold text-[var(--text-800)]"
                    id="module-lessons-heading"
                  >
                    {t("goalDetail.module.learningPath")}
                  </h2>
                  <p className="mt-1 text-xs wrap-break-word text-[var(--text-500)]">
                    {requiresCognitiveModel
                      ? t("goalDetail.module.masteryPathDescription")
                      : t("goalDetail.module.explorationPathDescription")}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-[var(--text-400)]">
                  {t("goalDetail.module.completedLessons", { completed: completedLessons, total: totalLessons })}
                </span>
              </div>
              {supportUnits.length ? (
                <div className="mb-4 rounded-2xl border border-[color-mix(in_srgb,var(--warning)_35%,var(--border))] bg-[var(--warning-soft)] p-4">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <ShieldCheck
                      aria-hidden
                      className="size-4 shrink-0 text-[var(--warning)]"
                    />
                    <h3 className="text-sm font-bold text-[var(--text-800)]">
                      {t("goalDetail.module.preparationLearning")}
                    </h3>
                    <Badge variant="outline">{t("goalDetail.module.notRequiredProgress")}</Badge>
                  </div>
                  <div className="mt-3 grid gap-2">
                    {supportUnits.map((unit) => (
                      <Link
                        className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-[var(--border-200)] bg-[var(--bg-50)] px-4 py-3 text-sm font-semibold text-[var(--text-800)] transition hover:border-[var(--brand-300)]"
                        key={unit.id}
                        to={`/goals/${goalId}/units/${unit.id}`}
                      >
                        <span className="min-w-0 flex-1 wrap-break-word">
                          <LlmMarkdownInline content={unit.title} />
                        </span>
                        <ChevronRight
                          aria-hidden
                          className="size-4 shrink-0 text-[var(--text-400)]"
                        />
                      </Link>
                    ))}
                  </div>
                </div>
              ) : null}
              <ol className="min-w-0 space-y-2">
                {curriculumUnits.map((unit, index) => {
                  const learnable =
                    unit.learnable ??
                    (!generating ||
                      unit.cognitiveModelStatus === "expanded" ||
                      unit.cognitiveModelStatus === "building");
                  const unitFailed =
                    requiresCognitiveModel &&
                    unit.cognitiveModelStatus === "failed";
                  const preparing = generating && !learnable && !unitFailed;
                  const completed = isCompleted(unit.status);
                  const active = unit.id === nextUnit?.id;
                  const expanded =
                    unit.id === (params.get("unit") ?? nextUnit?.id);
                  const content = (
                    <div
                      className={cn(
                        "group flex min-w-0 items-start gap-3 rounded-2xl border bg-[var(--bg-50)] p-4 transition",
                        active
                          ? "border-[var(--brand-300)] shadow-sm"
                          : unitFailed
                            ? "border-[color-mix(in_srgb,var(--warning)_40%,var(--border))]"
                            : "border-[var(--border-200)]",
                        learnable
                          ? "hover:-translate-y-0.5 hover:border-[var(--brand-300)] hover:shadow-sm"
                          : "opacity-65",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold",
                          completed
                            ? "border-[color-mix(in_srgb,var(--success)_42%,var(--border))] bg-[var(--success-soft)] text-[var(--success)]"
                            : active
                              ? "border-[var(--brand-300)] bg-[var(--brand-100)] text-[var(--brand-700)]"
                              : "border-[var(--border-200)] bg-[var(--bg-100)] text-[var(--text-500)]",
                        )}
                      >
                        {completed ? (
                          <Check aria-label={t("goalDetail.module.completed")} className="size-4" />
                        ) : (
                          index + 1
                        )}
                      </span>
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <div className="flex min-w-0 flex-col items-start gap-1.5">
                          <h3 className="min-w-0 max-w-full font-semibold leading-5 text-[var(--text-800)]">
                            <LlmMarkdownInline
                              className="block wrap-anywhere"
                              content={unit.title}
                            />
                          </h3>
                          {active ? (
                            <Badge
                              className="max-w-full shrink-0 border-[var(--brand-200)] bg-[var(--brand-50)] text-[var(--brand-700)]"
                              variant="outline"
                            >
                              {t("goalDetail.module.recommendedNext")}
                            </Badge>
                          ) : null}
                        </div>
                        {unit.contentSummary ? (
                          <div className="mt-1.5 min-w-0 text-xs leading-5 text-[var(--text-500)]">
                            <LlmMarkdownInline
                              className="block line-clamp-2 wrap-anywhere"
                              content={unit.contentSummary}
                            />
                          </div>
                        ) : null}
                        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-400)]">
                          <span className="flex items-center gap-1">
                            {unitFailed ? (
                              <>
                                <RefreshCw
                                  aria-hidden
                                  className="size-3 text-[var(--warning)]"
                                />
                                <span className="text-[var(--warning)]">
                                  {t("goalDetail.module.preparationFailed")}
                                </span>
                              </>
                            ) : preparing ? (
                              <>
                                <LoaderCircle
                                  aria-hidden
                                  className="size-3 animate-spin"
                                />
                                {t("goalDetail.module.preparing")}
                              </>
                            ) : requiresCognitiveModel &&
                              unit.cognitiveModelStatus === "building" ? (
                              <>
                                <LoaderCircle
                                  aria-hidden
                                  className="size-3 animate-spin"
                                />
                                {t("goalDetail.module.contentPreparingCanStart")}
                              </>
                            ) : (
                              statusLabel(unit.status as UnitStatus)
                            )}
                          </span>
                        </div>
                      </div>
                      {learnable ? (
                        <ChevronRight
                          aria-hidden
                          className="mt-1 size-4 shrink-0 text-[var(--text-400)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--brand-600)]"
                        />
                      ) : (
                        <Lock
                          aria-label={t("goalDetail.module.notOpen")}
                          className="mt-1 size-4 shrink-0 text-[var(--text-400)]"
                        />
                      )}
                    </div>
                  );
                  return (
                    <li
                      className={cn(
                        "min-w-0",
                        unit.parentUnitId &&
                          "ml-4 border-l border-[var(--border-200)] pl-3 sm:ml-6",
                      )}
                      key={unit.id}
                    >
                      {learnable ? (
                        <Link
                          className="block min-w-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-500)] focus-visible:ring-offset-2"
                          to={`/goals/${goalId}/units/${unit.id}`}
                        >
                          {content}
                        </Link>
                      ) : (
                        content
                      )}
                      {unit.sections?.length && !expanded ? (
                        <button
                          className="ml-11 mt-1 text-xs font-medium text-[var(--brand-700)] hover:underline sm:ml-12"
                          type="button"
                          onClick={() => {
                            const next = new URLSearchParams(params);
                            next.set("unit", unit.id);
                            setParams(next, { replace: true });
                          }}
                        >
                          {t("goalDetail.module.viewSectionCount", { count: unit.sections.length })}
                        </button>
                      ) : null}
                      {expanded && unit.sections?.length ? (
                        <div className="ml-3 mt-2 min-w-0 border-l border-[var(--brand-200)] pl-3 sm:ml-5 sm:pl-5">
                          {(() => {
                            const currentIndex = Math.max(
                              0,
                              unit.sections.findIndex(
                                (section) =>
                                  section.status !== "completed" &&
                                  section.status !== "skipped",
                              ),
                            );
                            const current = unit.sections[currentIndex];
                            const currentLearningSectionNumber = unit.sections
                              .slice(0, currentIndex + 1)
                              .filter(
                                (section) => section.sectionKind === "content",
                              ).length;
                            return current ? (
                              <Link
                                className={cn(
                                  buttonVariants({ size: "sm" }),
                                  "mb-2",
                                )}
                                to={`/goals/${goalId}/units/${unit.id}?section=${encodeURIComponent(current.id)}`}
                              >
                                {current.sectionKind === "mini_test"
                                  ? t("goalDetail.module.continueSectionQuiz", { number: currentLearningSectionNumber })
                                  : t("goalDetail.module.continueSection", { number: currentLearningSectionNumber })}
                                <ChevronRight className="size-3.5" />
                              </Link>
                            ) : null;
                          })()}
                          <ol className="space-y-1">
                            {unit.sections.flatMap((section, sectionIndex) => {
                              const learningSectionNumber = unit
                                .sections!.slice(0, sectionIndex + 1)
                                .filter(
                                  (item) => item.sectionKind === "content",
                                ).length;
                              const sectionLabel =
                                section.sectionKind === "mini_test"
                                  ? t("goalDetail.module.sectionQuiz", { number: learningSectionNumber })
                                  : t("goalDetail.module.sectionTitle", { number: learningSectionNumber, title: section.title });
                              const complete =
                                section.status === "completed" ||
                                section.status === "skipped";
                              const unlocked = unit
                                .sections!.slice(0, sectionIndex)
                                .every(
                                  (previous) =>
                                    previous.status === "completed" ||
                                    previous.status === "skipped",
                                );
                              const sectionRow = (
                                <li key={section.id} className="min-w-0">
                                  {unlocked ? (
                                    <Link
                                      className={cn(
                                        "flex min-w-0 items-start gap-3 overflow-hidden rounded-xl px-3 py-2.5 text-sm transition",
                                        complete
                                          ? "text-[var(--text-500)]"
                                          : "bg-[var(--brand-50)] font-semibold text-[var(--text-800)] hover:bg-[var(--brand-100)]",
                                      )}
                                      to={`/goals/${goalId}/units/${unit.id}?section=${encodeURIComponent(section.id)}`}
                                    >
                                      <span
                                        className={cn(
                                          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs",
                                          complete
                                            ? "bg-[var(--success-soft)] text-[var(--success)]"
                                            : "bg-[var(--brand-100)] text-[var(--brand-700)]",
                                        )}
                                      >
                                        {complete ? (
                                          <Check className="size-3.5" />
                                        ) : (
                                          sectionIndex + 1
                                        )}
                                      </span>
                                      <span className="min-w-0 flex-1 wrap-anywhere line-clamp-2">
                                        {sectionLabel}
                                      </span>
                                      {section.recommendSkip ? (
                                        <Badge
                                          className="shrink-0"
                                          variant="outline"
                                        >
                                          {t("goalDetail.module.suggestSkip")}
                                        </Badge>
                                      ) : section.generationStatus ===
                                        "failed" ? (
                                        <Badge
                                          className="shrink-0"
                                          variant="outline"
                                        >
                                          {t("goalDetail.module.preparationFailed")}
                                        </Badge>
                                      ) : section.generationStatus ===
                                        "building" ? (
                                        <LoaderCircle className="size-3.5 shrink-0 animate-spin" />
                                      ) : section.generationStatus ===
                                        "pending" ? (
                                        <Badge
                                          className="shrink-0"
                                          variant="outline"
                                        >
                                          {t("goalDetail.module.awaitingPreparation")}
                                        </Badge>
                                      ) : null}
                                    </Link>
                                  ) : (
                                    <div className="flex min-w-0 items-start gap-3 overflow-hidden rounded-xl px-3 py-2.5 text-sm text-[var(--text-400)] opacity-55">
                                      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--bg-200)] text-xs">
                                        {sectionIndex + 1}
                                      </span>
                                      <span className="min-w-0 flex-1 wrap-anywhere line-clamp-2">
                                        {sectionLabel}
                                      </span>
                                      <Lock
                                        className="mt-0.5 size-3.5 shrink-0"
                                        aria-label={t("goalDetail.module.opensAfterPrevious")}
                                      />
                                    </div>
                                  )}
                                </li>
                              );
                              const virtualComponents =
                                section.virtualComponents ?? [];
                              const components = virtualComponents.map(
                                (component) => (
                                  <li
                                    key={`${section.id}:${component.id}`}
                                    className="min-w-0"
                                  >
                                    {unlocked ? (
                                      <Link
                                        className="ml-6 flex min-w-0 items-start gap-2 overflow-hidden rounded-lg px-3 py-2 text-xs text-[var(--text-500)] hover:bg-[var(--bg-100)] sm:ml-9"
                                        to={`/goals/${goalId}/units/${unit.id}?section=${encodeURIComponent(section.id)}&anchor=${encodeURIComponent(component.anchor)}`}
                                      >
                                        <Puzzle className="mt-0.5 size-3.5 shrink-0 text-[var(--brand-600)]" />
                                        <span className="min-w-0 flex-1 wrap-anywhere line-clamp-2">
                                          {component.title}
                                        </span>
                                        <Badge
                                          className="shrink-0"
                                          variant="outline"
                                        >
                                          {t("goalDetail.module.interactive")}
                                        </Badge>
                                      </Link>
                                    ) : (
                                      <div className="ml-6 flex min-w-0 items-start gap-2 overflow-hidden rounded-lg px-3 py-2 text-xs text-[var(--text-400)] opacity-45 sm:ml-9">
                                        <Puzzle className="mt-0.5 size-3.5 shrink-0" />
                                        <span className="min-w-0 flex-1 wrap-anywhere line-clamp-2">
                                          {component.title}
                                        </span>
                                        <Badge
                                          className="shrink-0"
                                          variant="outline"
                                        >
                                          {t("goalDetail.module.interactive")}
                                        </Badge>
                                      </div>
                                    )}
                                  </li>
                                ),
                              );
                              return [sectionRow, ...components];
                            })}
                          </ol>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </section>

            {requiresCognitiveModel ? (
              <aside className="hidden min-w-0 lg:sticky lg:top-20 lg:block">
                <ModuleMasterySnapshot
                  capabilities={capabilities}
                  generating={generating}
                  loading={cognitive.isLoading || mastery.isLoading}
                  onOpen={() => setView("cognition")}
                  summary={mastery.data}
                />
              </aside>
            ) : null}
          </div>
        )
      ) : cognitive.isLoading ? (
        <Card className="flex items-center gap-3 p-5 text-sm text-[var(--text-500)]">
          <LoaderCircle
            aria-hidden
            className="size-4 animate-spin text-[var(--brand-600)]"
          />
          {t("goalDetail.module.loadingModuleMastery")}
        </Card>
      ) : cognitive.error ? (
        <Card className="p-4 text-sm text-[var(--text-500)]">
          {t("goalDetail.module.masteryStillPreparing")}
        </Card>
      ) : (
        <section aria-labelledby="mastery-heading">
          <Card className="mb-4 flex-row flex-wrap items-start gap-3 border-[var(--brand-200)] bg-[var(--brand-50)] p-4">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-100)] text-[var(--brand-700)]">
              <BrainCircuit aria-hidden className="size-4.5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2
                className="font-bold text-[var(--text-800)]"
                id="mastery-heading"
              >
                {t("goalDetail.module.keyCapabilities")}
              </h2>
              <p className="mt-1 text-xs leading-5 text-[var(--text-600)]">
                {t("goalDetail.module.keyCapabilitiesDescription")}
              </p>
            </div>
            {!generating ? (
              <Link
                className={cn(
                  buttonVariants({ variant: "outline", size: "lg" }),
                  "w-full sm:w-auto",
                )}
                to={`/goals/${goalId}/modules/${moduleId}/diagnostic`}
              >
                <ShieldCheck aria-hidden className="size-4 shrink-0" />
                {t("goalDetail.module.multipleChoiceExitDiagnostic")}
              </Link>
            ) : null}
          </Card>
          {capabilities.length ? (
            <div className="grid gap-4 md:grid-cols-2">
              {capabilities.map((capability) => (
                <CapabilityCard
                  capability={capability}
                  goalId={goalId}
                  key={capability.id}
                  moduleId={moduleId}
                  targetSummary={mastery.data?.targets?.find(
                    (target) => target.learningTargetId === capability.id,
                  )}
                />
              ))}
            </div>
          ) : (
            <Card className="p-5 text-sm text-[var(--text-500)]">
              {t("goalDetail.module.noModuleCapabilities")}
            </Card>
          )}
        </section>
      )}
    </div>
  );
}
