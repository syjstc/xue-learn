import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, Layers3, LayoutDashboard, Settings2 } from "lucide-react";
import { GoalUnitSidebarNav } from "@/components/layout/goal-unit-sidebar-nav";
import { mainlineEnabled } from "@/features/learning-mainline/enabled";
import { useGoal } from "@/hooks/api";
import { deriveUnitContentGenStatus } from "@/shared/domain/unit-content-status";
import {
  buildUnitTree,
  resolveUnitHierarchy,
} from "@/shared/domain/unit-tree-build";
import { useT } from "@xue-learn/core/i18n";
import { cn } from "@xue-learn/core/utils";

function SubviewLink({
  to,
  label,
  icon: Icon,
  active,
}: {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  active: boolean;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm transition-colors",
        active
          ? "bg-[var(--brand-50)] font-medium text-[var(--brand-700)]"
          : "text-[var(--text-500)] hover:bg-[var(--bg-200)] hover:text-[var(--text-800)]",
      )}
      aria-current={active ? "page" : undefined}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </Link>
  );
}

export function GoalWorkspaceSubview({ goalId }: { goalId: string }) {
  const t = useT();
  const { pathname, search } = useLocation();
  const { data: goal } = useGoal(goalId);
  const base = `/goals/${goalId}`;
  const usesMainline = mainlineEnabled();
  const isCatalog = new URLSearchParams(search).get("view") === "catalog";
  const activeUnitId = pathname.startsWith(`${base}/units/`)
    ? pathname.slice(`${base}/units/`.length).split("/")[0] || undefined
    : undefined;
  const routeModuleId = pathname.startsWith(`${base}/modules/`)
    ? pathname.slice(`${base}/modules/`.length).split("/")[0] || undefined
    : undefined;
  const roots = useMemo(
    () =>
      buildUnitTree(
        (goal?.units ?? []).map((unit) => ({
          id: unit.id,
          moduleId: unit.moduleId,
          title: unit.title,
          status: unit.status,
          unitKind: unit.unitKind,
          parentUnitId: unit.parentUnitId,
          orderIndex: unit.orderIndex,
          contentGen: deriveUnitContentGenStatus(unit) ?? undefined,
        })),
      ),
    [goal?.units],
  );
  const activeUnitModuleId =
    goal && activeUnitId
      ? resolveUnitHierarchy(goal, activeUnitId)?.moduleId
      : undefined;
  const activeModuleId = routeModuleId ?? activeUnitModuleId;
  const journeyActive =
    pathname === base ||
    pathname === `${base}/` ||
    pathname.startsWith(`${base}/modules/`) ||
    pathname.startsWith(`${base}/units/`);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-2 pt-3 pb-2">
        <Link
          to="/spaces"
          className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-400)] transition-colors hover:bg-[var(--bg-200)] hover:text-[var(--text-700)]"
          aria-label={t("uiChrome.goalLayout.backAllGoals")}
        >
          <ArrowLeft className="size-3.5 shrink-0" aria-hidden />
          <span>{t("spaces.title")}</span>
        </Link>
      </div>

      <div className="px-3 pb-3">
        <Link to={base} className="block">
          <p className="truncate text-sm font-semibold text-[var(--text-800)]">
            {goal?.title ?? t("uiChrome.loading")}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--text-400)]">
            {t("uiChrome.goalLayout.learningGoal")}
          </p>
        </Link>
      </div>

      <nav
        className="flex flex-col gap-0.5 px-2.5"
        aria-label={t("uiChrome.goalLayout.goalNavigation")}
      >
        <SubviewLink
          to={usesMainline ? `${base}?view=plan` : base}
          label={t(
            usesMainline ? "mainline.plan" : "uiChrome.goalLayout.journey",
          )}
          icon={LayoutDashboard}
          active={
            usesMainline
              ? journeyActive && !isCatalog && !activeModuleId && !activeUnitId
              : journeyActive
          }
        />
        {usesMainline ? (
          <SubviewLink
            to={`${base}?view=catalog`}
            label={t("uiChrome.goalLayout.courseOutline")}
            icon={Layers3}
            active={
              journeyActive &&
              (isCatalog || Boolean(activeModuleId) || Boolean(activeUnitId))
            }
          />
        ) : null}
        {!goal?.parentGoal ? (
          <SubviewLink
            to={`${base}/foundations`}
            label={t("uiChrome.goalLayout.foundations")}
            icon={Layers3}
            active={pathname.startsWith(`${base}/foundations`)}
          />
        ) : null}
        <SubviewLink
          to={`${base}/plan`}
          label={t("uiChrome.goalLayout.settings")}
          icon={Settings2}
          active={pathname.startsWith(`${base}/plan`)}
        />
      </nav>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto border-t border-[var(--border-200)] px-2.5 py-2">
        <GoalUnitSidebarNav
          roots={roots}
          goalId={goalId}
          modules={goal?.modules}
          activeUnitId={activeUnitId}
          activeModuleId={activeModuleId}
        />
      </div>
    </div>
  );
}
