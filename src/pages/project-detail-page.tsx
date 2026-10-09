import {
  ArrowLeft,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  ClipboardCheck,
  Gauge,
  ShieldCheck,
} from "lucide-react";
import {
  Link,
  Navigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import {
  ProjectDefinitionList,
  ProjectMilestoneWorkbench,
} from "@/components/projects/project-milestone-workbench";
import { useProjectDetail } from "@/hooks/api";
import { cn } from "@xue-learn/core/source/src/lib/utils.ts";
import { isNotFound } from "@/shared/api";
import { useT, type TranslationKey } from "@xue-learn/core/source/src/shared/i18n/index.tsx";

const DIFFICULTY_KEYS: Record<string, TranslationKey> = {
  easy: "projectDetail.difficulty.easy", medium: "projectDetail.difficulty.medium", hard: "projectDetail.difficulty.hard",
} as const;

const FIELD_KEYS: Record<string, TranslationKey> = {
  audience: "projectDetail.fields.audience", scenario: "projectDetail.fields.scenario", environment: "projectDetail.fields.environment",
  tools: "projectDetail.fields.tools", timeLimit: "projectDetail.fields.timeLimit", scope: "projectDetail.fields.scope",
  goal: "projectDetail.fields.goal", quality: "projectDetail.fields.quality", criteria: "projectDetail.fields.criteria",
};

function displayValue(value: unknown, t: ReturnType<typeof useT>): string | null {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (typeof value === "boolean") return value ? t("projectDetail.common.yes") : t("projectDetail.common.no");
  if (Array.isArray(value)) {
    const items = value
      .map((item) => displayValue(item, t))
      .filter((item): item is string => Boolean(item));
    return items.length ? items.join("、") : null;
  }
  return null;
}

function ReadableRecord({
  value,
  empty,
}: {
  value: Record<string, unknown>;
  empty: string;
}) {
  const t = useT();
  const rows = Object.entries(value).flatMap(([key, raw]) => {
    const text = displayValue(raw, t);
    return text ? [{ key, text }] : [];
  });
  if (!rows.length) {
    return <p className="text-sm text-[var(--text-500)]">{empty}</p>;
  }
  return (
    <dl className="space-y-2">
      {rows.map((row) => (
        <div
          className="rounded-lg border border-[var(--border-200)] bg-[var(--bg-100)] p-3"
          key={row.key}
        >
          <dt className="text-xs font-semibold text-[var(--text-500)]">
            {FIELD_KEYS[row.key] ? t(FIELD_KEYS[row.key]!) : row.key}
          </dt>
          <dd className="mt-1 text-sm leading-6 text-[var(--text-700)]">
            {row.text}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ProjectDetailPage() {
  const t = useT();
  const { goalId = "", projectId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectQuery = useProjectDetail(projectId);

  if (isNotFound(projectQuery.error)) return <Navigate to="/404" replace />;
  if (projectQuery.isPending) {
    return <p className="text-sm text-[var(--text-400)]">{t("projectDetail.loading")}</p>;
  }
  if (projectQuery.error || !projectQuery.data) {
    return (
      <Card className="p-5 text-sm text-destructive">
        {projectQuery.error?.message || t("projectDetail.loadError")}
      </Card>
    );
  }

  const project = projectQuery.data.project;
  if (project.goalId !== goalId) return <Navigate to="/404" replace />;
  const orderedMilestones = [...project.milestones].sort(
    (a, b) => a.milestoneOrder - b.milestoneOrder,
  );
  const requestedMilestoneId = searchParams.get("milestone");
  const selectedMilestone =
    orderedMilestones.find((item) => item.id === requestedMilestoneId) ??
    orderedMilestones.find(
      (item) => item.latestAttempt?.status !== "evaluated",
    ) ??
    orderedMilestones[0] ??
    null;

  function selectMilestone(milestoneId: string) {
    const next = new URLSearchParams(searchParams);
    next.set("milestone", milestoneId);
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="space-y-6">
      <header>
        <Link
          className="inline-flex items-center gap-1 text-sm text-[var(--text-500)] hover:text-[var(--brand-700)]"
          to={`/goals/${goalId}/projects`}
        >
          <ArrowLeft aria-hidden className="size-4" /> {t("projectDetail.backToProjects")}
        </Link>
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-3xl">
            <p className="flex items-center gap-2 text-xs font-semibold text-[var(--brand-600)]">
              <BriefcaseBusiness aria-hidden className="size-4" />
              {t("projectDetail.multiMilestone")}
            </p>
            <h1 className="mt-1 text-2xl font-bold text-[var(--text-800)]">
              {project.title}
            </h1>
            <p className="mt-2 text-sm leading-6 text-[var(--text-600)]">
              {project.instructions}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">
              {t(DIFFICULTY_KEYS[project.difficulty]!)}
            </Badge>
            <Badge variant="outline">{t("projectDetail.definitionVersion", { version: project.definitionVersion })}</Badge>
            <Badge variant="outline">{t("projectDetail.milestoneCount", { count: orderedMilestones.length })}</Badge>
          </div>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge aria-hidden className="size-4 text-[var(--brand-600)]" />
            {t("projectDetail.context")}
          </CardTitle>
          <div className="mt-3">
            <ReadableRecord value={project.context} empty={t("projectDetail.contextFallback")} />
          </div>
        </Card>
        <Card className="p-5">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck aria-hidden className="size-4 text-[var(--brand-600)]" />
            {t("projectDetail.constraints")}
          </CardTitle>
          <div className="mt-3">
            <ProjectDefinitionList
              definitions={project.constraintDefinitions}
              fallback={t("projectDetail.noConstraints")}
            />
          </div>
        </Card>
        <Card className="p-5">
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardCheck aria-hidden className="size-4 text-[var(--brand-600)]" />
            {t("projectDetail.deliverables")}
          </CardTitle>
          <div className="mt-3">
            <ProjectDefinitionList
              definitions={project.deliverableDefinitions}
              fallback={t("projectDetail.deliverablesFallback")}
            />
          </div>
        </Card>
      </div>

      {orderedMilestones.length ? (
        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-[var(--text-800)]">{t("projectDetail.progress")}</h2>
              <p className="mt-1 text-xs text-[var(--text-500)]">
                {t("projectDetail.progressDescription")}
              </p>
            </div>
          </div>
          <div
            aria-label={t("projectDetail.milestonesAria")}
            className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
            role="tablist"
          >
            {orderedMilestones.map((milestone) => {
              const active = milestone.id === selectedMilestone?.id;
              const evaluated = milestone.latestAttempt?.status === "evaluated";
              const Icon = evaluated ? CheckCircle2 : CircleDashed;
              return (
                <button
                  aria-selected={active}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-500)]",
                    active
                      ? "border-[var(--brand-400)] bg-[var(--brand-50)]"
                      : "border-[var(--border-200)] bg-[var(--bg-50)] hover:border-[var(--brand-300)]",
                  )}
                  key={milestone.id}
                  onClick={() => selectMilestone(milestone.id)}
                  role="tab"
                  type="button"
                >
                  <Icon
                    aria-hidden
                    className={cn(
                      "mt-0.5 size-4 shrink-0",
                      evaluated
                        ? "text-[var(--success)]"
                        : "text-[var(--text-400)]",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-[var(--text-400)]">
                      {t("projectDetail.milestoneNumber", { number: milestone.milestoneOrder + 1 })}
                    </span>
                    <span className="mt-0.5 block font-medium text-[var(--text-800)]">
                      {milestone.title}
                    </span>
                    <span className="mt-1 block text-xs text-[var(--text-500)]">
                      {t(`projectDetail.status.${milestone.latestAttempt?.status ?? "notStarted"}` as TranslationKey)}
                    </span>
                  </span>
                  <ChevronRight
                    aria-hidden
                    className="mt-1 size-4 shrink-0 text-[var(--text-400)]"
                  />
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {selectedMilestone ? (
        <section role="tabpanel">
          {selectedMilestone.constraintDefinitions.length ? (
            <Card className="mb-5 p-5">
              <CardTitle className="text-base">{t("projectDetail.stageConstraints")}</CardTitle>
              <div className="mt-3">
                <ProjectDefinitionList
                  definitions={selectedMilestone.constraintDefinitions}
                  fallback={t("projectDetail.noStageConstraints")}
                />
              </div>
            </Card>
          ) : null}
          <ProjectMilestoneWorkbench
            fallbackDeliverables={project.deliverableDefinitions}
            key={selectedMilestone.id}
            milestone={selectedMilestone}
            projectId={project.id}
          />
        </section>
      ) : (
        <Card className="p-8 text-center text-sm text-[var(--text-500)]">
          {t("projectDetail.noMilestones")}
        </Card>
      )}
    </div>
  );
}
