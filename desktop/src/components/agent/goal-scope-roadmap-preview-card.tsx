"use client";

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FolderPlus, Sparkles } from "lucide-react";
import { useT } from "@xue-learn/core/i18n";

export function GoalScopeRoadmapPreviewCard({
  args,
  submitted,
  disabled,
  onSubmit,
  onNavigate,
}: {
  args: Record<string, unknown>;
  submitted?: Record<string, unknown>;
  disabled?: boolean;
  onSubmit: (result: unknown) => void;
  onNavigate?: () => void;
}) {
  const t = useT();
  const proposal =
    args.proposal && typeof args.proposal === "object"
      ? (args.proposal as Record<string, unknown>)
      : null;
  const plannedGoals = useMemo(
    () =>
      (Array.isArray(proposal?.plannedGoals)
        ? proposal.plannedGoals
        : []
      ).filter((goal): goal is Record<string, unknown> =>
        Boolean(goal && typeof goal === "object" && !Array.isArray(goal)),
      ),
    [proposal],
  );
  const proposedSpaces = useMemo(
    () =>
      (Array.isArray(proposal?.createSpaces)
        ? proposal.createSpaces
        : []
      ).filter((space): space is Record<string, unknown> =>
        Boolean(space && typeof space === "object" && !Array.isArray(space)),
      ),
    [proposal],
  );
  const refs = plannedGoals
    .map((goal) => String(goal.ref ?? ""))
    .filter(Boolean);
  const [selected, setSelected] = useState(() => new Set(refs));

  if (submitted && Object.keys(submitted).length > 0) {
    const action = String(submitted.action ?? "");
    const spaceId =
      typeof submitted.spaceId === "string" && submitted.spaceId.trim()
        ? submitted.spaceId.trim()
        : Array.isArray(submitted.spaceIds)
          ? submitted.spaceIds
              .map((value) => (typeof value === "string" ? value.trim() : ""))
              .find(Boolean)
          : undefined;
    const spaceHref = spaceId ? `/spaces/${spaceId}` : undefined;
    return (
      <section
        className="rounded-2xl border border-border bg-card px-4 py-3.5 text-sm shadow-sm"
        role="status"
      >
        <p className="font-semibold text-foreground">
          {action === "apply_roadmap"
            ? t("spaces.scope.saved")
            : action === "continue_single"
              ? t("spaces.scope.continuedSingle")
              : action === "open_existing"
                ? t("spaces.scope.openedExisting")
                : t("spaces.scope.cancelled")}
        </p>
        {spaceHref &&
        (action === "apply_roadmap" || action === "open_existing") ? (
          <p className="mt-2">
            <Link
              to={spaceHref}
              className="font-medium text-primary underline-offset-2 hover:underline"
              onClick={() => onNavigate?.()}
            >
              {t("spaces.viewRoadmap")}
            </Link>
          </p>
        ) : null}
      </section>
    );
  }

  const existingOnly = args.decision === "existing_roadmap" || !proposal;
  return (
    <section className="overflow-hidden rounded-2xl border border-primary/25 bg-card text-sm shadow-sm">
      <div className="border-b border-border/70 px-4 py-4">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="size-4.5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="font-semibold leading-6 text-foreground">
              {t("spaces.scope.title")}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {String(args.summary ?? t("spaces.scope.summary"))}
            </p>
          </div>
        </div>
      </div>

      {!existingOnly ? (
        <div className="max-h-[min(24rem,52vh)] overflow-y-auto">
          {proposedSpaces.map((space) => (
            <div
              key={String(space.ref ?? space.name ?? "")}
              className="border-b border-border/70 bg-primary/[0.035] px-4 py-3"
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <FolderPlus className="size-4" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-[11px] font-semibold uppercase tracking-wide text-primary">
                    {t("spaces.preview.newSpace")}
                  </span>
                  <span className="block font-semibold leading-5 text-foreground">
                    {String(space.name ?? "")}
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                    {String(space.purpose ?? "")}
                  </span>
                </span>
              </div>
            </div>
          ))}
          <div className="divide-y divide-border/70">
            {plannedGoals.map((goal) => {
              const ref = String(goal.ref ?? "");
              const brief =
                goal.goalBrief && typeof goal.goalBrief === "object"
                  ? (goal.goalBrief as Record<string, unknown>)
                  : null;
              return (
                <label
                  key={ref}
                  className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-muted/45"
                >
                  <input
                    type="checkbox"
                    className="mt-1 size-4 shrink-0 accent-[var(--brand-600)]"
                    checked={selected.has(ref)}
                    disabled={disabled}
                    onChange={(event) => {
                      const next = new Set(selected);
                      if (event.target.checked) next.add(ref);
                      else next.delete(ref);
                      setSelected(next);
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("spaces.preview.plannedGoal")}
                    </span>
                    <span className="block font-semibold leading-5 text-foreground">
                      {String(goal.title ?? "")}
                    </span>
                    <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                      {String(brief?.intendedOutcome ?? goal.rationale ?? "")}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="px-4 py-4 text-sm leading-6 text-muted-foreground">
          {t("spaces.scope.existingDescription")}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
        {existingOnly ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              onSubmit({
                action: "open_existing",
                spaceId: args.existingSpaceId,
              })
            }
            className="inline-flex min-h-10 items-center justify-center rounded-xl bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-50"
          >
            {t("spaces.scope.openExisting")}
          </button>
        ) : (
          <button
            type="button"
            disabled={disabled || selected.size < 1}
            onClick={() =>
              onSubmit({
                action: "apply_roadmap",
                selectedGoalRefs: [...selected],
              })
            }
            className="inline-flex min-h-10 items-center justify-center rounded-xl bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-50"
          >
            {t("spaces.scope.saveRoadmap", { count: selected.size })}
          </button>
        )}
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSubmit({ action: "continue_single" })}
          className="inline-flex min-h-10 items-center justify-center rounded-xl border border-border bg-card px-4 font-medium text-foreground disabled:opacity-50"
        >
          {t("spaces.scope.continueSingle")}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSubmit({ action: "cancel" })}
          className="inline-flex min-h-10 items-center justify-center px-3 text-sm font-medium text-muted-foreground disabled:opacity-50"
        >
          {t("spaces.scope.cancel")}
        </button>
      </div>
    </section>
  );
}

