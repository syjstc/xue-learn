import {
  LlmMarkdown,
  LlmMarkdownInline,
} from "@/components/markdown/llm-markdown";
import { Card, CardTitle } from "@/components/ui/card";
import {
  DOMAIN_TAG_LABELS,
  LEARNING_MODE_LABELS,
} from "@/shared/goals/domain-labels";
import type { GoalMapPlan } from "@xue-learn/core/schemas";
import { cn } from "@xue-learn/core/utils";
import { useT } from "@xue-learn/core/i18n";

export function GoalMapPlanDisplay({
  topicOverview,
  plan,
}: {
  topicOverview: string;
  plan: GoalMapPlan;
}) {
  const t = useT();
  const modules =
    plan.schemaVersion === 2 && plan.modules?.length ? plan.modules : null;
  const topLevelCount = modules?.length ?? plan.majorAreas.length;
  const prerequisitesAssumed = plan.prerequisitesAssumed ?? [];

  return (
    <div className="space-y-6">
      <Card className="border-[var(--brand-200)] bg-[var(--brand-50)]">
        <CardTitle style={{ fontFamily: "var(--font-display)" }}>
          {t("goalDetail.plan.domainAndMode")}
        </CardTitle>
        <dl className="mt-4 space-y-3 text-sm">
          <div>
            <dt className="font-medium text-[var(--text-800)]">{t("goalDetail.plan.field")}</dt>
            <dd className="mt-0.5 text-[var(--text-400)]">
              {plan.domainAnalysis.field} → {plan.domainAnalysis.subdomain}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-[var(--text-800)]">{t("goalDetail.plan.learningMode")}</dt>
            <dd className="mt-0.5 text-[var(--text-400)]">
              {LEARNING_MODE_LABELS[plan.domainAnalysis.learningMode]}（
              {DOMAIN_TAG_LABELS[plan.domainAnalysis.domainTag]}）
            </dd>
          </div>
          <div>
            <dt className="font-medium text-[var(--text-800)]">{t("goalDetail.plan.modeExplanation")}</dt>
            <dd
              className="mt-0.5 leading-relaxed text-[var(--text-400)]"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              <LlmMarkdown content={plan.domainAnalysis.modeClarification} />
            </dd>
          </div>
        </dl>
      </Card>

      <Card>
        <CardTitle style={{ fontFamily: "var(--font-display)" }}>
          {t("goalDetail.plan.topicOverview")}
        </CardTitle>
        <div style={{ fontFamily: "var(--font-serif)" }}>
          <LlmMarkdown
            content={topicOverview}
            className="mt-4 text-sm leading-relaxed text-[var(--text-800)]"
          />
        </div>
      </Card>

      <Card>
        <CardTitle style={{ fontFamily: "var(--font-display)" }}>
          {t("goalDetail.courseSettings.whatYouWillLearn")}
        </CardTitle>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[var(--text-800)]">
          {plan.whatYouWillLearn.map((item) => (
            <li key={item}>
              <LlmMarkdownInline content={item} />
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardTitle style={{ fontFamily: "var(--font-display)" }}>
          {modules ? t("goalDetail.plan.sequentialModules") : t("goalDetail.plan.majorAreas")}
        </CardTitle>
        {modules ? (
          <ol className="mt-4 divide-y text-sm">
            {modules.map((module, index) => (
              <li key={module.title} className="py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-[var(--brand-100)] px-2 py-0.5 text-xs font-semibold text-[var(--brand-700)]">
                    {t("goalDetail.plan.moduleNumber", { number: index + 1 })}
                  </span>
                </div>
                <p className="mt-2 font-semibold text-[var(--text-800)]">
                  {module.title}
                </p>
                <div
                  className="mt-1 text-[var(--text-400)]"
                  style={{ fontFamily: "var(--font-serif)" }}
                >
                  <LlmMarkdown content={module.summary} variant="muted" />
                </div>
                <p className="mt-2 text-[var(--text-700)]">
                  {t("goalDetail.plan.capabilityMilestone")} {module.objective}
                </p>
                <p className="mt-1 text-xs text-[var(--text-400)]">
                  {module.dependsOnPrevious}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <ul className="mt-4 divide-y text-sm">
            {plan.majorAreas.map((area) => (
              <li key={area.title} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-[var(--text-800)]">
                    {area.title}
                  </p>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      area.mapRole === "branch"
                        ? "bg-[var(--brand-100)] text-[var(--brand-700)]"
                        : "bg-[var(--bg-200)] text-[var(--text-400)]",
                    )}
                  >
                    {area.mapRole === "branch"
                      ? t("goalDetail.plan.branchUnit")
                      : t("goalDetail.plan.singleUnit")}
                  </span>
                </div>
                <div
                  className="mt-1 text-[var(--text-400)]"
                  style={{ fontFamily: "var(--font-serif)" }}
                >
                  <LlmMarkdown content={area.description} variant="muted" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {!modules ? (
        <Card>
          <CardTitle style={{ fontFamily: "var(--font-display)" }}>
            {t("goalDetail.plan.multilevelMap")}
          </CardTitle>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="font-medium text-[var(--text-800)]">{t("goalDetail.plan.recommendedStructure")}</dt>
              <dd className="mt-0.5 text-[var(--text-400)]">
                {t("goalDetail.plan.structureSummary", { depth: plan.mapStructure.recommendedDepth, count: topLevelCount })}
              </dd>
            </div>
            <div>
              <dt className="font-medium text-[var(--text-800)]">{t("goalDetail.plan.layeringStrategy")}</dt>
              <dd
                className="mt-0.5 leading-relaxed text-[var(--text-400)]"
                style={{ fontFamily: "var(--font-serif)" }}
              >
                <LlmMarkdown content={plan.mapStructure.layeringStrategy} />
              </dd>
            </div>
          </dl>
        </Card>
      ) : null}

      {prerequisitesAssumed.length > 0 && (
        <Card>
          <CardTitle style={{ fontFamily: "var(--font-display)" }}>
            {t("goalDetail.plan.unverifiedFoundations")}
          </CardTitle>
          <p className="mt-1 text-xs text-[var(--text-400)]">
            {t("goalDetail.plan.foundationAssumptionNote")}
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[var(--text-400)]">
            {prerequisitesAssumed.map((item) => (
              <li key={item}>
                <LlmMarkdownInline content={item} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
