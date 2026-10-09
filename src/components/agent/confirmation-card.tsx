"use client";

import { useEffect, useState } from "react";
import { Button } from "@xue-learn/core/ui/button";
import { LlmMarkdown } from "@/components/markdown/llm-markdown";
import { cn } from "@xue-learn/core/utils";
import { useTeachingPersonas } from "@/hooks/api/use-teaching-personas";
import {
  isPlanningMode,
  learnerFacingGoalInstructions,
  type PlanningMode,
} from "@xue-learn/core/domain";
import { useI18n } from "@xue-learn/core/i18n";
import { localizeTeachingPersonaName } from "@/shared/teaching-persona-i18n";

function textValue(value: unknown, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value.trim() || fallback;
}

export function ConfirmationCard({
  state,
  contract,
  disabled,
  submitted,
  onSubmit,
}: {
  state: Record<string, unknown>;
  contract?: Record<string, unknown> | null;
  disabled?: boolean;
  submitted?: Record<string, unknown>;
  onSubmit: (result: {
    approved: boolean;
    edits?: Record<string, unknown>;
  }) => void;
}) {
  const { t } = useI18n();
  const locked = submitted?.approved !== undefined;
  const readOnly = disabled || locked;
  const title = textValue(
    state.refinedTitle,
    textValue(state.topic, t("assistant.confirmation.notSet")),
  );
  const level = textValue(state.level, "zero");
  const intentAnalysis = textValue(state.intentAnalysis);
  const intentValue = contract?.teachingIntent ?? state.teachingIntent;
  const teachingIntent =
    intentValue && typeof intentValue === "object"
      ? (intentValue as Record<string, unknown>)
      : undefined;
  const intentRows = teachingIntent
    ? ([
        [
          "assistant.confirmation.targetLevel",
          textValue(teachingIntent.targetLevel),
        ],
        [
          "assistant.confirmation.observableOutcomes",
          teachingIntent.observableOutcomes,
        ],
        ["assistant.confirmation.includedScope", teachingIntent.includedScope],
        ["assistant.confirmation.excludedScope", teachingIntent.excludedScope],
        [
          "assistant.confirmation.prerequisiteBridges",
          teachingIntent.prerequisiteBridges,
        ],
      ] as const)
    : [];
  const generationOptions = learnerFacingGoalInstructions(
    state.generationOptions,
  );
  const initialIsSmallCourse = state.isSmallCourse === true;
  const plannedGoalActivation = state.isPlannedGoalActivation === true;
  const hasDocuments =
    state.hasDocuments === true ||
    (Array.isArray(state.documents) && state.documents.length > 0);
  const [isSmallCourse, setIsSmallCourse] = useState(initialIsSmallCourse);
  const requestedPlanningMode = isPlanningMode(state.planningMode)
    ? state.planningMode
    : "deep";
  const initialPlanningMode =
    requestedPlanningMode === "docs_first" && !hasDocuments
      ? "deep"
      : requestedPlanningMode;
  const [planningMode, setPlanningMode] =
    useState<PlanningMode>(initialPlanningMode);
  const initialLearningMode =
    state.learningMode === "exploration" ? "exploration" : "mastery";
  const [learningMode, setLearningMode] = useState<"exploration" | "mastery">(
    initialLearningMode,
  );
  const personas = useTeachingPersonas();
  const personaName = localizeTeachingPersonaName(personas.data?.current, t);

  useEffect(() => {
    setIsSmallCourse(initialIsSmallCourse);
  }, [initialIsSmallCourse]);

  useEffect(() => {
    setPlanningMode(initialPlanningMode);
  }, [initialPlanningMode]);

  useEffect(() => {
    setLearningMode(initialLearningMode);
  }, [initialLearningMode]);

  return (
    <div className="space-y-3.5 rounded-xl border border-[var(--course-content-callout-warning-border)] bg-[var(--course-content-callout-warning-bg)] p-4">
      <div className="flex items-start gap-2.5">
        <span
          className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--course-content-callout-warning-border)]/30 text-[10px] font-bold text-[var(--course-content-callout-warning-text)]"
          aria-hidden="true"
        >
          !
        </span>
        <div>
          <p className="text-sm font-semibold text-[var(--course-content-callout-warning-text)]">
            {t("assistant.confirmation.title")}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("assistant.confirmation.description")}
          </p>
        </div>
      </div>
      <dl className="grid gap-3 text-sm text-foreground sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">
            {t("assistant.confirmation.teachingAssistant")}
          </dt>
          <dd>
            {personaName}·
            {personas.data?.current.ref === "builtin:xiaohui_female"
              ? t("assistant.confirmation.defaultPersonaTagline")
              : (personas.data?.current.tagline ??
                t("assistant.confirmation.defaultPersonaTagline"))}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            {t("assistant.confirmation.learningGoal")}
          </dt>
          <dd className="font-medium text-foreground">{title}</dd>
        </div>
        {intentAnalysis ? (
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">
              {t("assistant.confirmation.intent")}
            </dt>
            <dd>{intentAnalysis}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-xs text-muted-foreground">
            {t("assistant.confirmation.level")}
          </dt>
          <dd>
            {level === "zero"
              ? t("assistant.confirmation.levelZero")
              : level === "basic"
                ? t("assistant.confirmation.levelBasic")
                : level === "advanced"
                  ? t("assistant.confirmation.levelAdvanced")
                  : level}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            {t("assistant.confirmation.courseScale")}
          </dt>
          <dd className="mt-1 grid gap-2 rounded-lg border border-border bg-card/60 p-2 sm:grid-cols-2">
            <button
              type="button"
              disabled={readOnly}
              className={cn(
                "rounded-lg border px-3 py-2 text-left transition-colors",
                !isSmallCourse
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-muted",
              )}
              onClick={() => setIsSmallCourse(false)}
            >
              <span className="block text-sm font-semibold">
                {t("assistant.confirmation.fullGoal")}
              </span>
              <span className="mt-0.5 block text-xs">
                {t("assistant.confirmation.fullGoalDescription")}
              </span>
            </button>
            <button
              type="button"
              disabled={readOnly}
              className={cn(
                "rounded-lg border px-3 py-2 text-left transition-colors",
                isSmallCourse
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-muted",
              )}
              onClick={() => setIsSmallCourse(true)}
            >
              <span className="block text-sm font-semibold">
                {t("assistant.confirmation.microCourse")}
              </span>
              <span className="mt-0.5 block text-xs">
                {t("assistant.confirmation.microCourseDescription")}
              </span>
            </button>
          </dd>
        </div>
        {!isSmallCourse ? (
          <>
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">
                {t("assistant.confirmation.learningMode")}
              </dt>
              <dd
                className="mt-1.5 grid gap-2 sm:grid-cols-2"
                role="radiogroup"
                aria-label={t("assistant.confirmation.learningMode")}
              >
                {(
                  [
                    {
                      value: "mastery",
                      title: t("assistant.confirmation.masteryMode"),
                      description: t(
                        "assistant.confirmation.masteryModeDescription",
                      ),
                      recommended: true,
                    },
                    {
                      value: "exploration",
                      title: t("assistant.confirmation.explorationMode"),
                      description: t(
                        "assistant.confirmation.explorationModeDescription",
                      ),
                      recommended: false,
                    },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={learningMode === option.value}
                    disabled={readOnly}
                    className={cn(
                      "relative rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      learningMode === option.value
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-card/70 text-muted-foreground hover:bg-muted",
                    )}
                    onClick={() => setLearningMode(option.value)}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-semibold">
                      {option.title}
                      {option.recommended ? (
                        <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          {t("assistant.confirmation.recommended")}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1 block text-xs leading-5">
                      {option.description}
                    </span>
                  </button>
                ))}
              </dd>
              {learningMode === "exploration" ? (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {t("assistant.confirmation.explorationUpgradeHint")}
                </p>
              ) : null}
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">
                {t("assistant.confirmation.planningMode")}
              </dt>
              <dd
                className="mt-1.5 grid gap-2 sm:grid-cols-3"
                role="radiogroup"
                aria-label={t("assistant.confirmation.planningMode")}
              >
                {(
                  [
                    {
                      value: "fast",
                      title: t("assistant.confirmation.fastPlanning"),
                      description: t(
                        "assistant.confirmation.fastPlanningDescription",
                      ),
                    },
                    {
                      value: "deep",
                      title: t("assistant.confirmation.deepPlanning"),
                      description: t(
                        "assistant.confirmation.deepPlanningDescription",
                      ),
                      recommended: !hasDocuments,
                    },
                    ...(hasDocuments
                      ? [
                          {
                            value: "docs_first" as const,
                            title: t(
                              "assistant.confirmation.docsFirstPlanning",
                            ),
                            description: t(
                              "assistant.confirmation.docsFirstPlanningDescription",
                            ),
                            recommended: true,
                          },
                        ]
                      : []),
                  ] satisfies Array<{
                    value: PlanningMode;
                    title: string;
                    description: string;
                    recommended?: boolean;
                  }>
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={planningMode === option.value}
                    disabled={readOnly}
                    className={cn(
                      "relative rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      planningMode === option.value
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-card/70 text-muted-foreground hover:bg-muted",
                    )}
                    onClick={() => setPlanningMode(option.value)}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-semibold">
                      {option.title}
                      {option.recommended ? (
                        <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          {t("assistant.confirmation.recommended")}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1 block text-xs leading-5">
                      {option.description}
                    </span>
                  </button>
                ))}
              </dd>
              {planningMode === "deep" ? (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {t("assistant.confirmation.deepPlanningHint")}
                </p>
              ) : null}
            </div>
          </>
        ) : null}
        {generationOptions ? (
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">
              {t("assistant.confirmation.customInstructions")}
            </dt>
            <dd>
              <LlmMarkdown content={generationOptions} />
            </dd>
          </div>
        ) : null}
        {hasDocuments ? (
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">
              {t("assistant.confirmation.learningMaterials")}
            </dt>
            <dd>
              {Array.isArray(state.documents) && state.documents.length > 0
                ? (state.documents as string[]).join("、")
                : t("assistant.confirmation.uploaded")}
            </dd>
          </div>
        ) : null}
      </dl>
      {teachingIntent ? (
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {intentRows.map(([label, value]) => {
            const items = Array.isArray(value)
              ? value.filter(
                  (item): item is string =>
                    typeof item === "string" && !!item.trim(),
                )
              : [];
            if (!items.length && typeof value !== "string") return null;
            if (typeof value === "string" && !value) return null;
            return (
              <div key={label} className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">{t(label)}</dt>
                <dd>
                  {items.length ? (
                    <ul className="list-disc space-y-1 pl-5">
                      {items.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    String(value)
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : null}
      {teachingIntent &&
      Array.isArray(contract?.constraints) &&
      contract.constraints.length > 0 ? (
        <dl className="text-sm">
          <dt className="text-xs text-muted-foreground">
            {t("assistant.confirmation.constraints")}
          </dt>
          <dd>
            {contract.constraints
              .filter((item): item is string => typeof item === "string")
              .join("、")}
          </dd>
        </dl>
      ) : null}
      {contract && !teachingIntent ? (
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">
              {t("assistant.confirmation.interpretedOutcome")}
            </dt>
            <dd>{textValue(contract.interpretedOutcome)}</dd>
          </div>
          {Array.isArray(contract.includedScope) &&
          contract.includedScope.length > 0 ? (
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">
                {t("assistant.confirmation.includedScope")}
              </dt>
              <dd>{(contract.includedScope as string[]).join("、")}</dd>
            </div>
          ) : null}
          {Array.isArray(contract.constraints) &&
          contract.constraints.length > 0 ? (
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">
                {t("assistant.confirmation.constraints")}
              </dt>
              <dd>{(contract.constraints as string[]).join("、")}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={readOnly}
          onClick={() => onSubmit({ approved: false })}
        >
          {plannedGoalActivation
            ? t("common.cancel")
            : t("assistant.confirmation.goBack")}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={readOnly}
          className={cn(
            "min-w-[7.5rem]",
            submitted?.approved === true && "ring-2 ring-primary/30",
          )}
          onClick={() =>
            onSubmit({
              approved: true,
              edits: { isSmallCourse, planningMode, learningMode },
            })
          }
        >
          {submitted?.approved === true
            ? t("assistant.confirmation.confirmed")
            : t("assistant.confirmation.confirmAndCreate")}
        </Button>
      </div>
    </div>
  );
}
