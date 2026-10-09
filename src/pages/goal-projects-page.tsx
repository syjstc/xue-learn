import {
  ArrowRight,
  BriefcaseBusiness,
  CheckCircle2,
  CircleDashed,
  Layers3,
} from "lucide-react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@xue-learn/core/source/src/components/ui/button.tsx";
import { Card, CardTitle } from "@/components/ui/card";
import { useGoal, useGoalProjects } from "@/hooks/api";
import { cn } from "@xue-learn/core/source/src/lib/utils.ts";
import { isNotFound } from "@/shared/api";
import { projectAttemptStatusLabel } from "@/shared/domain/projects";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";

export function GoalProjectsPage() {
  const t = useT();
  const { goalId = "" } = useParams();
  const goalQuery = useGoal(goalId);
  const projectsQuery = useGoalProjects(goalId);

  if (isNotFound(projectsQuery.error) || isNotFound(goalQuery.error)) {
    return <Navigate to="/404" replace />;
  }
  if (projectsQuery.isPending || goalQuery.isPending) {
    return (
      <p className="text-sm text-[var(--text-400)]">{t("projects.loading")}</p>
    );
  }
  if (projectsQuery.error || goalQuery.error) {
    return (
      <Card className="p-5 text-sm text-destructive">
        {projectsQuery.error?.message ||
          goalQuery.error?.message ||
          t("projects.loadFailed")}
      </Card>
    );
  }

  const projects = projectsQuery.data?.projects ?? [];
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold text-[var(--brand-600)]">
            <BriefcaseBusiness aria-hidden className="size-4" />
            {goalQuery.data?.title ?? t("projects.learningGoal")}
          </p>
          <h1 className="mt-1 text-2xl font-bold text-[var(--text-800)]">
            {t("projects.title")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-500)]">
            {t("projects.description")}
          </p>
        </div>
        <Badge variant="outline">
          {t("projects.count", { count: projects.length })}
        </Badge>
      </header>

      {projects.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {projects.map((project) => {
            const completed = project.milestones.filter(
              (milestone) => milestone.latestAttempt?.status === "evaluated",
            ).length;
            const submitted = project.milestones.filter((milestone) =>
              ["submitted", "evaluated"].includes(
                milestone.latestAttempt?.status ?? "",
              ),
            ).length;
            const progress = project.milestones.length
              ? Math.round((submitted / project.milestones.length) * 100)
              : 0;
            return (
              <Card
                className="flex flex-col border-[var(--border-200)] bg-[var(--bg-50)] p-5"
                key={project.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-50)] text-[var(--brand-600)]">
                    <BriefcaseBusiness aria-hidden className="size-5" />
                  </span>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Badge variant="outline">
                      {t(`projects.difficulty.${project.difficulty}` as never)}
                    </Badge>
                    <Badge variant="outline">
                      {t("projects.definition", {
                        version: project.definitionVersion,
                      })}
                    </Badge>
                  </div>
                </div>
                <CardTitle className="mt-4 text-lg">{project.title}</CardTitle>
                <p className="mt-2 line-clamp-3 text-sm leading-6 text-[var(--text-500)]">
                  {project.instructions}
                </p>

                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-[var(--bg-200)] p-2">
                    <p className="text-lg font-bold text-[var(--text-800)]">
                      {project.milestones.length}
                    </p>
                    <p className="text-[10px] text-[var(--text-500)]">
                      {t("projects.milestones")}
                    </p>
                  </div>
                  <div className="rounded-lg bg-[var(--bg-200)] p-2">
                    <p className="text-lg font-bold text-[var(--text-800)]">
                      {project.deliverableDefinitions.length}
                    </p>
                    <p className="text-[10px] text-[var(--text-500)]">
                      {t("projects.deliverables")}
                    </p>
                  </div>
                  <div className="rounded-lg bg-[var(--bg-200)] p-2">
                    <p className="text-lg font-bold text-[var(--text-800)]">
                      {completed}
                    </p>
                    <p className="text-[10px] text-[var(--text-500)]">
                      {t("projects.evaluated")}
                    </p>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs text-[var(--text-500)]">
                    <span>{t("projects.submissionProgress")}</span>
                    <span>
                      {submitted}/{project.milestones.length}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--bg-300)]">
                    <div
                      className="h-full rounded-full bg-[var(--brand-500)]"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>

                <ul className="mt-4 space-y-1.5">
                  {project.milestones.slice(0, 3).map((milestone) => {
                    const done =
                      milestone.latestAttempt?.status === "evaluated";
                    const Icon = done ? CheckCircle2 : CircleDashed;
                    return (
                      <li
                        className="flex items-center gap-2 text-xs text-[var(--text-500)]"
                        key={milestone.id}
                      >
                        <Icon
                          aria-hidden
                          className={cn(
                            "size-3.5",
                            done
                              ? "text-[var(--success)]"
                              : "text-[var(--text-400)]",
                          )}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {milestone.title}
                        </span>
                        <span>
                          {projectAttemptStatusLabel(
                            milestone.latestAttempt?.status,
                          )}
                        </span>
                      </li>
                    );
                  })}
                  {project.milestones.length > 3 ? (
                    <li className="flex items-center gap-2 text-xs text-[var(--text-400)]">
                      <Layers3 aria-hidden className="size-3.5" />
                      {t("projects.moreMilestones", {
                        count: project.milestones.length - 3,
                      })}
                    </li>
                  ) : null}
                </ul>

                <Link
                  className={cn(
                    buttonVariants({ variant: "default" }),
                    "mt-5 w-full",
                  )}
                  to={`/goals/${goalId}/projects/${project.id}`}
                >
                  {submitted ? t("projects.continue") : t("projects.start")}
                  <ArrowRight aria-hidden className="size-4" />
                </Link>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="p-10 text-center">
          <BriefcaseBusiness
            aria-hidden
            className="mx-auto size-8 text-[var(--text-400)]"
          />
          <h2 className="mt-3 font-semibold text-[var(--text-800)]">
            {t("projects.emptyTitle")}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--text-500)]">
            {t("projects.emptyDescription")}
          </p>
        </Card>
      )}
    </div>
  );
}
