import type { GoalMapPlan } from "@/shared/api";
import { useT } from "@xue-learn/core/i18n";
import { Button } from "@xue-learn/core/ui/button";

type PathDimension = NonNullable<
  GoalMapPlan["learningPath"]
>["baseline"][number]["dimensions"][number];

/** Planned KACOM requirements, deliberately separate from learner mastery. */
export function CapabilityPathDetails({
  plan,
  onMissingFoundation,
  disabled,
}: {
  plan: GoalMapPlan;
  onMissingFoundation?: (title: string) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const path = plan.learningPath;
  if (!path) return null;
  const entities = new Map(
    path.entities.map((entity) => [entity.semanticKey, entity]),
  );
  const units = new Map(
    path.modules.flatMap((module) =>
      module.units.map((unit) => [unit.unitRef, unit] as const),
    ),
  );
  const describe = (entry: {
    entityKey: string;
    dimensions: readonly PathDimension[];
  }) =>
    `${entities.get(entry.entityKey)?.title ?? entry.entityKey} · ${entry.dimensions.map((dimension) => t(`learningState.dimension.${dimension}`)).join(" / ")}`;
  const origin = (source: string) =>
    source === "baseline"
      ? t("capabilityPath.entryFoundation")
      : (units.get(source)?.title ?? source);

  return (
    <section
      className="space-y-3 text-xs"
      aria-label={t("capabilityPath.title")}
    >
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
        <p className="font-semibold text-foreground">
          {t("capabilityPath.checked", {
            modules: path.modules.length,
            units: path.modules.reduce(
              (count, module) => count + module.units.length,
              0,
            ),
          })}
        </p>
        <p className="mt-1 leading-5 text-muted-foreground">
          {t("capabilityPath.conditional")}
        </p>
      </div>
      {path.baseline.length > 0 && (
        <div className="space-y-2">
          <p className="font-medium">{t("capabilityPath.baseline")}</p>
          {path.baseline.map((entry, index) => (
            <div
              key={`${entry.entityKey}-${index}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5"
            >
              <div>
                <p>{describe(entry)}</p>
                <p className="mt-1 text-muted-foreground">
                  {t(`capabilityPath.${entry.status}`)} · {entry.rationale}
                </p>
              </div>
              {onMissingFoundation && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() =>
                    onMissingFoundation(
                      entities.get(entry.entityKey)?.title ?? entry.entityKey,
                    )
                  }
                >
                  {t("capabilityPath.needBridge")}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      {path.modules.map((module, moduleIndex) => (
        <details
          key={module.moduleRef}
          className="rounded-xl border bg-card/50"
        >
          <summary className="cursor-pointer px-3 py-3 font-medium focus-visible:outline-primary">
            {moduleIndex + 1}. {plan.modules?.[moduleIndex]?.title} ·{" "}
            {t("capabilityPath.unitCount", { count: module.units.length })}
          </summary>
          <div className="space-y-3 border-t px-3 py-3">
            <p>
              <strong>{t("capabilityPath.requires")}</strong>{" "}
              {module.requires
                .map((entry) => `${describe(entry)} ← ${origin(entry.source)}`)
                .join("; ") || t("capabilityPath.noPrerequisite")}
            </p>
            <p>
              <strong>{t("capabilityPath.provides")}</strong>{" "}
              {module.provides.map(describe).join("; ")}
            </p>
            <p className="text-muted-foreground">{module.rationale}</p>
            <ol className="space-y-3">
              {module.units.map((unit, unitIndex) => (
                <li key={unit.unitRef} className="rounded-lg border p-3">
                  <p className="font-medium">
                    {moduleIndex + 1}.{unitIndex + 1} {unit.title}
                  </p>
                  <p className="mt-1 leading-5 text-muted-foreground">
                    {unit.summary}
                  </p>
                  <p className="mt-2">
                    <strong>{t("capabilityPath.requires")}</strong>{" "}
                    {unit.requires
                      .map(
                        (entry) =>
                          `${describe(entry)} ← ${origin(entry.source)}`,
                      )
                      .join("; ") || t("capabilityPath.noPrerequisite")}
                  </p>
                  <p className="mt-1">
                    <strong>{t("capabilityPath.provides")}</strong>{" "}
                    {unit.provides.map(describe).join("; ")}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {unit.provides
                      .map((entry) => entities.get(entry.entityKey)?.scope)
                      .filter(
                        (scope, index, all) =>
                          scope && all.indexOf(scope) === index,
                      )
                      .join("; ")}
                  </p>
                  <p className="mt-2">
                    <strong>{t("capabilityPath.verification")}</strong>{" "}
                    {unit.assessment.task}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {unit.assessment.criteria.join("; ")} ·{" "}
                    {t(
                      `capabilityPath.assistance.${unit.assessment.assistance}`,
                    )}{" "}
                    · {t(`capabilityPath.context.${unit.assessment.context}`)}
                  </p>
                </li>
              ))}
            </ol>
            <p>
              <strong>{t("capabilityPath.moduleVerification")}</strong>{" "}
              {module.assessment.task}
            </p>
          </div>
        </details>
      ))}
      <div className="rounded-xl border p-3">
        <p className="font-medium">{t("capabilityPath.finalTask")}</p>
        <p className="mt-1 leading-5">{path.goal.assessment.task}</p>
        <p className="mt-1 text-muted-foreground">
          {path.goal.assessment.criteria.join("; ")}
        </p>
      </div>
    </section>
  );
}
