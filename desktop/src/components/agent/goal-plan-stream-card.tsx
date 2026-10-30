"use client";

import type { ReactNode } from "react";
import {
  Check,
  LoaderCircle,
  Route,
  Sparkles,
  Target,
  ListChecks,
} from "lucide-react";
import { LlmMarkdown } from "@/components/markdown/llm-markdown";
import type { GoalMapPlan } from "@/shared/api";
import {
  parseGoalPlanStreamPreview,
  type GoalPlanStreamPreview,
} from "@/shared/agent/goal-plan-stream-preview";
import { LEARNING_MODE_LABELS } from "@/shared/goals/domain-labels";
import { cn } from "@xue-learn/core/utils";
import { useI18n } from "@xue-learn/core/i18n";

function previewFromPlan(plan: GoalMapPlan) {
  return {
    refinedTitle: plan.refinedTitle ?? "",
    field: plan.domainAnalysis.field,
    subdomain: plan.domainAnalysis.subdomain,
    learningMode: plan.domainAnalysis.learningMode,
    topicOverview: plan.topicOverview,
    outcomes: plan.whatYouWillLearn,
    unitCount:
      plan.learningPath?.modules.reduce(
        (count, module) => count + module.units.length,
        0,
      ) ?? 0,
    modules:
      plan.schemaVersion === 2 && plan.modules?.length
        ? plan.modules.map((module) => ({
            title: module.title,
            summary: module.summary,
          }))
        : plan.majorAreas.map((area) => ({
            title: area.title,
            summary: area.description,
          })),
  };
}

export function GoalPlanStreamCard({
  source = "",
  preview: restoredPreview,
  plan,
  ready = false,
  children,
}: {
  source?: string;
  preview?: GoalPlanStreamPreview;
  plan?: GoalMapPlan;
  ready?: boolean;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const steps = [
    { label: t("assistant.plan.direction"), icon: Target },
    { label: t("assistant.plan.outcomes"), icon: Sparkles },
    { label: t("assistant.plan.route"), icon: Route },
    ...(!ready || plan?.learningPath
      ? [{ label: t("capabilityPath.checkStep"), icon: ListChecks }]
      : []),
  ];
  const preview = plan
    ? previewFromPlan(plan)
    : (restoredPreview ?? parseGoalPlanStreamPreview(source));
  const completedSteps = [
    ready || Boolean(preview.field),
    ready || preview.outcomes.length > 0,
    // Module headings arrive before their lesson contracts. Keep the route
    // active until the complete, validated plan is available.
    ready,
    ready,
  ];
  const activeStep = Math.min(
    completedSteps.findIndex((complete) => !complete),
    steps.length - 1,
  );
  const resolvedActiveStep = activeStep < 0 ? steps.length - 1 : activeStep;
  const title = preview.refinedTitle || preview.subdomain || preview.field;
  const learningModeLabel =
    LEARNING_MODE_LABELS[
      preview.learningMode as keyof typeof LEARNING_MODE_LABELS
    ];
  const subtitle = [preview.field, preview.subdomain, learningModeLabel]
    .filter((value) => value && value !== title)
    .join(" · ");

  return (
    <section
      className="overflow-hidden rounded-2xl border border-[var(--course-content-border-accent)] bg-[var(--course-content-surface-accent)]"
      aria-live="polite"
      aria-label={t("assistant.plan.generatingAria")}
    >
      <div className="flex items-start gap-3 px-4 py-3.5">
        <span
          className={cn(
            "mt-0.5 grid size-8 shrink-0 place-items-center rounded-full text-primary",
            ready ? "bg-primary text-primary-foreground" : "bg-primary/10",
          )}
        >
          {ready ? (
            <Check className="size-4" aria-hidden="true" />
          ) : (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            {ready
              ? t("assistant.plan.readyTitle")
              : t("assistant.plan.generatingTitle")}
          </p>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            {ready
              ? t("assistant.plan.readyDescription")
              : t("assistant.plan.generatingDescription")}
          </p>
        </div>
      </div>

      <div
        className={cn(
          "grid gap-y-2 border-y border-[var(--course-content-border)] bg-[var(--bg-50)]/55 px-3 py-2.5",
          steps.length === 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3",
        )}
      >
        {steps.map((step, index) => {
          const Icon = completedSteps[index] ? Check : step.icon;
          const active = index === resolvedActiveStep && !completedSteps[index];
          return (
            <div
              key={step.label}
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex items-center justify-center gap-1.5 text-[11px] sm:text-xs",
                completedSteps[index] || active
                  ? "font-medium text-primary"
                  : "text-muted-foreground/70",
              )}
            >
              <span
                className={cn(
                  "grid size-5 place-items-center rounded-full",
                  completedSteps[index] && "bg-primary text-primary-foreground",
                  active && "bg-primary/10",
                )}
              >
                <Icon
                  className={cn("size-3", active && "animate-pulse")}
                  aria-hidden="true"
                />
              </span>
              <span>{step.label}</span>
            </div>
          );
        })}
      </div>

      <div className="space-y-3 px-4 py-3.5">
        {title ? (
          <div>
            <p className="text-sm font-semibold text-foreground">{title}</p>
            {subtitle ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
        ) : (
          <PreviewSkeleton className="h-9 w-3/5" />
        )}

        {preview.topicOverview ? (
          ready ? (
            <LlmMarkdown
              className="text-xs leading-5 text-foreground/80"
              content={preview.topicOverview}
              variant="default"
            />
          ) : (
            <p className="line-clamp-3 text-xs leading-5 text-foreground/80">
              {preview.topicOverview}
            </p>
          )
        ) : completedSteps[0] ? (
          <div className="space-y-1.5">
            <PreviewSkeleton className="h-3 w-full" />
            <PreviewSkeleton className="h-3 w-4/5" />
          </div>
        ) : null}

        {preview.outcomes.length > 0 ? (
          <div>
            <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
              {t("assistant.plan.youWillGain")}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {preview.outcomes
                .slice(0, ready ? preview.outcomes.length : 4)
                .map((outcome) => (
                  <span
                    key={outcome}
                    className={cn(
                      "max-w-full rounded-full border border-[var(--course-content-border)] bg-[var(--bg-50)]/75 px-2.5 py-1 text-[11px] text-foreground",
                      !ready && "truncate",
                    )}
                  >
                    {outcome}
                  </span>
                ))}
            </div>
          </div>
        ) : null}

        {preview.modules.length > 0 ? (
          <div>
            <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
              {t("assistant.plan.moduleCount", {
                count: preview.modules.length,
              })}
              {preview.unitCount > 0
                ? ` · ${t("capabilityPath.unitCount", { count: preview.unitCount })}`
                : ""}
            </p>
            <ol className="space-y-1.5">
              {preview.modules
                .slice(ready ? 0 : -4)
                .map((module, index, visibleModules) => (
                  <li
                    key={`${index}-${module.title}`}
                    className="flex gap-2 rounded-lg border border-[var(--course-content-border)] bg-[var(--bg-50)]/70 px-2.5 py-2"
                  >
                    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                      {preview.modules.length -
                        visibleModules.length +
                        index +
                        1}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-foreground">
                        {module.title}
                      </span>
                      {module.summary ? (
                        <span
                          className={cn(
                            "mt-0.5 block text-[11px] text-muted-foreground",
                            !ready && "line-clamp-1",
                          )}
                        >
                          {module.summary}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
            </ol>
          </div>
        ) : null}

        {children ? (
          <div className="border-t border-[var(--course-content-border)] pt-3">
            {children}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function PreviewSkeleton({ className }: { className: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-full bg-[var(--course-content-border)]/70",
        className,
      )}
      aria-hidden="true"
    />
  );
}
