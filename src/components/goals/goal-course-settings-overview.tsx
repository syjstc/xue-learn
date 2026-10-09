import {
  BookOpen,
  ChevronDown,
  GraduationCap,
  Layers3,
  Target,
} from "lucide-react";
import {
  LlmMarkdown,
  LlmMarkdownInline,
} from "@/components/markdown/llm-markdown";
import type { GoalMapPlan } from "@xue-learn/core/schemas";
import {
  DOMAIN_TAG_LABELS,
  LEARNING_MODE_LABELS,
} from "@/shared/goals/domain-labels";
import { Link } from "react-router-dom";
import { buttonVariants } from "@xue-learn/core/ui/button";
import { useT } from "@xue-learn/core/i18n";
import { KacomDetachDevPanel } from "@/components/goals/kacom-detach-dev-panel";
import { EnableMasteryModePanel } from "@/components/goals/enable-mastery-mode-panel";
import { GoalContentLanguageSettings } from "@/components/goals/goal-content-language-settings";
import {
  supportsGoalKacomDetach,
  supportsGoalMasteryTransition,
} from "@xue-learn/core/client-runtime";

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-[var(--border-200)] py-5 last:border-b-0">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-[var(--brand-600)]" aria-hidden>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-[var(--text-800)]">
            {title}
          </h2>
          <div className="mt-2 text-sm leading-relaxed text-[var(--text-500)]">
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}

export function GoalCourseSettingsOverview({
  topicOverview,
  plan,
  goalId,
  contentLanguage,
  allowFoundationGoal = true,
}: {
  topicOverview: string;
  plan: GoalMapPlan;
  goalId: string;
  contentLanguage?: string | null;
  allowFoundationGoal?: boolean;
}) {
  const t = useT();
  const prerequisites = plan.prerequisitesAssumed ?? [];
  const mobileSections = [
    {
      title: t("goalDetail.courseSettings.learningGoal"),
      icon: <Target className="size-5" />,
      content: <LlmMarkdown content={topicOverview} variant="muted" />,
    },
    {
      title: t("goalDetail.courseSettings.whatYouWillLearn"),
      icon: <BookOpen className="size-5" />,
      content: (
        <ul className="space-y-2">
          {plan.whatYouWillLearn.map((item) => (
            <li key={item} className="flex gap-2">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-[var(--brand-500)]" />
              <LlmMarkdownInline content={item} />
            </li>
          ))}
        </ul>
      ),
    },
    {
      title: t("goalDetail.courseSettings.learningApproach"),
      icon: <GraduationCap className="size-5" />,
      content: (
        <>
          <p className="font-medium text-[var(--text-700)]">
            {LEARNING_MODE_LABELS[plan.domainAnalysis.learningMode]} ·{" "}
            {DOMAIN_TAG_LABELS[plan.domainAnalysis.domainTag]}
          </p>
          <LlmMarkdown
            content={plan.domainAnalysis.modeClarification}
            variant="muted"
          />
        </>
      ),
    },
    ...(prerequisites.length > 0
      ? [
          {
            title: t("goalDetail.foundations.expected"),
            icon: <Layers3 className="size-5" />,
            content: (
              <ul className="space-y-2">
                {prerequisites.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-[var(--text-300)]" />
                    <LlmMarkdownInline content={item} />
                  </li>
                ))}
              </ul>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="px-1">
      <GoalContentLanguageSettings
        goalId={goalId}
        contentLanguage={contentLanguage}
      />
      <div className="sm:hidden">
        {mobileSections.map((section, index) => (
          <details
            className="group border-b border-[var(--border-200)]"
            key={section.title}
            open={index === 0}
          >
            <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 py-3 text-[var(--text-800)] [&::-webkit-details-marker]:hidden">
              <span className="text-[var(--brand-600)]" aria-hidden>
                {section.icon}
              </span>
              <span className="flex-1 font-semibold">{section.title}</span>
              <ChevronDown className="size-4 text-[var(--text-400)] transition-transform group-open:rotate-180" />
            </summary>
            <div className="pb-5 pl-8 text-sm leading-relaxed text-[var(--text-500)]">
              {section.content}
            </div>
          </details>
        ))}
      </div>

      <div className="hidden sm:block">
        <Section
          icon={<Target className="size-5" />}
          title={t("goalDetail.courseSettings.learningGoal")}
        >
          <LlmMarkdown content={topicOverview} variant="muted" />
        </Section>

        <Section
          icon={<BookOpen className="size-5" />}
          title={t("goalDetail.courseSettings.whatYouWillLearn")}
        >
          <ul className="space-y-2">
            {plan.whatYouWillLearn.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-[var(--brand-500)]" />
                <span>
                  <LlmMarkdownInline content={item} />
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          icon={<GraduationCap className="size-5" />}
          title={t("goalDetail.courseSettings.learningApproach")}
        >
          <p className="font-medium text-[var(--text-700)]">
            {LEARNING_MODE_LABELS[plan.domainAnalysis.learningMode]} ·{" "}
            {DOMAIN_TAG_LABELS[plan.domainAnalysis.domainTag]}
          </p>
          <div className="mt-1">
            <LlmMarkdown
              content={plan.domainAnalysis.modeClarification}
              variant="muted"
            />
          </div>
        </Section>

        {prerequisites.length > 0 ? (
          <Section
            icon={<Layers3 className="size-5" />}
            title={t("goalDetail.foundations.expected")}
          >
            <p className="mb-2 text-xs text-[var(--text-400)]">
              {t("goalDetail.courseSettings.assumptionNote")}
            </p>
            <ul className="space-y-2">
              {prerequisites.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-[var(--text-300)]" />
                  <span>
                    <LlmMarkdownInline content={item} />
                  </span>
                </li>
              ))}
            </ul>
            {allowFoundationGoal ? (
              <Link
                className={`${buttonVariants({ variant: "outline", size: "sm" })} mt-3`}
                to={`/goals/${goalId}/foundations`}
              >
                {t("goalDetail.courseSettings.createFoundation")}
              </Link>
            ) : null}
          </Section>
        ) : null}
      </div>

      {supportsGoalKacomDetach() ? (
        <KacomDetachDevPanel goalId={goalId} />
      ) : null}
      {supportsGoalMasteryTransition() ? (
        <EnableMasteryModePanel goalId={goalId} />
      ) : null}

      <p className="py-5 text-xs text-[var(--text-400)]">
        {t("goalDetail.courseSettings.moreSettingsSoon")}
      </p>
    </div>
  );
}
