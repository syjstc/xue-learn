import { mainlineEnabled } from "@/features/learning-mainline/enabled";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  Navigate,
  Outlet,
  useLocation,
  useParams,
} from "react-router-dom";
import {
  ArrowLeft,
  ChevronRight,
  LayoutDashboard,
  Menu,
  Settings2,
  Layers3,
} from "lucide-react";
import { GoalUnitSidebarNav } from "@/components/layout/goal-unit-sidebar-nav";
import { deriveUnitContentGenStatus } from "@/shared/domain/unit-content-status";
import {
  buildUnitTree,
  resolveUnitHierarchy,
} from "@/shared/domain/unit-tree-build";
import { useGoal } from "@/hooks/api";
import {
  isMicroGoal,
  resolveMicroLessonUnit,
  microGoalNavigatePath,
} from "@/shared/domain/goal-kind";
import { cn } from "@xue-learn/core/source/src/shared/utils.ts";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@xue-learn/core/source/src/components/ui/sheet.tsx";
import { LlmMarkdownInline } from "@/components/markdown/llm-markdown";
import type { UnitTreeNode } from "@/shared/domain/unit-tree-build";
import type { GoalModule } from "@/shared/api";
import { useGoalCreationSessionByGoal } from "@/hooks/use-goal-creation-session";
import { GoalCreationStatusCard } from "@/components/agent/goal-creation-status-card";
import { DesktopTitlebarPortal } from "@/components/layout/desktop-titlebar";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type GoalNavItem = {
  id: "overview" | "foundations" | "settings";
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
  match?: (pathname: string, base: string) => boolean;
};

function goalNavItems(
  goalId: string,
  sequentialJourney: boolean,
  t: ReturnType<typeof useT>,
): GoalNavItem[] {
  const base = `/goals/${goalId}`;
  const items: GoalNavItem[] = [
    {
      id: "overview",
      to: base,
      label: sequentialJourney
        ? t("uiChrome.goalLayout.journey")
        : t("uiChrome.goalLayout.overview"),
      icon: LayoutDashboard,
      end: !sequentialJourney,
      match: sequentialJourney
        ? (pathname) =>
            pathname === base ||
            pathname === `${base}/` ||
            pathname.startsWith(`${base}/modules/`) ||
            pathname.startsWith(`${base}/units/`)
        : undefined,
    },
  ];
  items.push({
    id: "foundations",
    to: `${base}/foundations`,
    label: t("uiChrome.goalLayout.foundations"),
    icon: Layers3,
    match: (pathname) => pathname.startsWith(`${base}/foundations`),
  });
  items.push({
    id: "settings",
    to: `${base}/plan`,
    label: t("uiChrome.goalLayout.settings"),
    icon: Settings2,
    match: (pathname) => pathname.startsWith(`${base}/plan`),
  });
  return items;
}

function isNavActive(item: GoalNavItem, pathname: string): boolean {
  if (item.match) return item.match(pathname, item.to);
  if (item.end) {
    return pathname === item.to || pathname === `${item.to}/`;
  }
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

function findUnitPath(
  nodes: UnitTreeNode[],
  targetId: string,
  path: UnitTreeNode[] = [],
): UnitTreeNode[] {
  for (const node of nodes) {
    const nextPath = [...path, node];
    if (node.id === targetId) return nextPath;
    const found = findUnitPath(node.children, targetId, nextPath);
    if (found.length > 0) return found;
  }
  return [];
}

type BreadcrumbUnit = {
  id: string;
  moduleId?: string | null;
  title: string;
  orderIndex: number;
};

function ModuleUnitsHoverMenu({
  base,
  module,
  units,
  activeUnitId,
  className,
}: {
  base: string;
  module: GoalModule;
  units: BreadcrumbUnit[];
  activeUnitId?: string;
  className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moduleUnits = useMemo(
    () =>
      units
        .filter((unit) => unit.moduleId === module.id)
        .sort((a, b) => a.orderIndex - b.orderIndex),
    [module.id, units],
  );

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const openMenu = () => {
    cancelClose();
    setOpen(true);
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  if (moduleUnits.length === 0) {
    return (
      <Link to={`${base}/modules/${module.id}`} className={className}>
        {module.title}
      </Link>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Link
            to={`${base}/modules/${module.id}`}
            className={className}
            onPointerEnter={openMenu}
            onPointerLeave={scheduleClose}
            onFocus={openMenu}
            onBlur={scheduleClose}
          >
            {module.title}
          </Link>
        }
      />
      {/* Avoid restoring focus to this hover trigger: its onFocus handler would
          immediately reopen the menu after an outside click or navigation. */}
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={8}
        finalFocus={false}
        className="w-80 gap-1 rounded-xl border border-[var(--border-200)] bg-[var(--bg-50)] p-1.5 shadow-lg"
        onPointerEnter={openMenu}
        onPointerLeave={scheduleClose}
        onFocusCapture={openMenu}
        onBlurCapture={scheduleClose}
        aria-label={t("uiChrome.goalNav.units")}
      >
        <Link
          to={`${base}/modules/${module.id}`}
          onClick={() => setOpen(false)}
          className="block rounded-lg px-2.5 py-2 transition-colors hover:bg-[var(--bg-200)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-300)]"
        >
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-400)]">
            {t("uiChrome.goalNav.courseOutline")}
          </span>
          <span className="mt-0.5 block truncate text-xs font-semibold text-[var(--text-800)]">
            {module.title}
          </span>
        </Link>
        <div className="max-h-72 overflow-y-auto py-0.5">
          {moduleUnits.map((unit, index) => {
            const isActive = unit.id === activeUnitId;
            return (
              <Link
                key={unit.id}
                to={`${base}/units/${unit.id}`}
                onClick={() => setOpen(false)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-start gap-2 rounded-lg px-2.5 py-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-300)]",
                  isActive
                    ? "bg-[var(--brand-50)] font-medium text-[var(--brand-700)]"
                    : "text-[var(--text-600)] hover:bg-[var(--bg-200)] hover:text-[var(--text-800)]",
                )}
              >
                <span
                  className={cn(
                    "mt-px w-5 shrink-0 text-right tabular-nums",
                    isActive
                      ? "text-[var(--brand-500)]"
                      : "text-[var(--text-400)]",
                  )}
                >
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 leading-snug">
                  <LlmMarkdownInline content={unit.title} />
                </span>
              </Link>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function GoalNavLink({
  item,
  active,
  variant,
  collapsed = false,
}: {
  item: GoalNavItem;
  active: boolean;
  variant: "sidebar" | "tab";
  collapsed?: boolean;
}) {
  const Icon = item.icon;

  if (variant === "tab") {
    return (
      <Link
        to={item.to}
        className={cn(
          "flex min-h-12 min-w-0 flex-1 touch-manipulation flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-center transition-colors",
          active
            ? "text-[var(--brand-600)]"
            : "text-[var(--text-400)] active:text-[var(--text-600)]",
        )}
        aria-current={active ? "page" : undefined}
      >
        <div className="flex h-5 items-center justify-center">
          <Icon
            className="h-5 w-5 shrink-0"
            aria-hidden
            style={{
              transform:
                Icon === LayoutDashboard
                  ? "translateY(1px)"
                  : Icon === Settings2
                    ? "translateY(-0.5px)"
                    : undefined,
            }}
          />
        </div>
        <span className="max-w-full truncate text-[10px] font-medium leading-tight">
          {item.label}
        </span>
      </Link>
    );
  }

  return (
    <Link
      to={item.to}
      className={cn(
        "flex touch-manipulation items-center rounded-lg text-sm transition-colors",
        collapsed ? "h-9 justify-center px-2" : "gap-2 px-2.5 py-2",
        active
          ? "bg-[var(--brand-50)] font-medium text-[var(--brand-700)]"
          : "text-[var(--text-500)] hover:bg-[var(--bg-200)] hover:text-[var(--text-800)]",
      )}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      title={collapsed ? item.label : undefined}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      {!collapsed && <span>{item.label}</span>}
    </Link>
  );
}

export function GoalLayout() {
  const t = useT();
  const { goalId = "" } = useParams();
  const { pathname } = useLocation();
  const [outlineOpen, setOutlineOpen] = useState(false);
  const activeUnitId = useMemo(() => {
    const prefix = `/goals/${goalId}/units/`;
    if (!pathname.startsWith(prefix)) return undefined;
    return pathname.slice(prefix.length).split("/")[0] || undefined;
  }, [goalId, pathname]);
  const routeModuleId = useMemo(() => {
    const prefix = `/goals/${goalId}/modules/`;
    if (!pathname.startsWith(prefix)) return undefined;
    return pathname.slice(prefix.length).split("/")[0] || undefined;
  }, [goalId, pathname]);
  const { data: goal, isPending } = useGoal(goalId);
  const creationSession = useGoalCreationSessionByGoal(goalId);
  const goalTitle = goal?.title ?? null;
  const units = goal?.units ?? [];
  const goalLoaded = !isPending;
  const base = `/goals/${goalId}`;
  const planPath = `${base}/plan`;
  const isUnitPage = pathname.startsWith(`${base}/units/`);
  const isLessonPerformancePage =
    isUnitPage && pathname.endsWith("/lesson-performance");
  const isModulePage = pathname.startsWith(`${base}/modules/`);
  const hasSequentialJourney =
    goal?.curriculumVersion === 2 && Boolean(goal.modules?.length);
  const hasCourse =
    units.length > 0 || Boolean(goal?.overviewCourse) || hasSequentialJourney;
  const isMicro = goal ? isMicroGoal(goal) : false;
  const isPlanPage = pathname.startsWith(`${base}/plan`);
  const isProjectPage = pathname.startsWith(`${base}/projects`);

  const unitTreeRoots = useMemo(
    () =>
      buildUnitTree(
        units.map((u) => ({
          id: u.id,
          moduleId: u.moduleId,
          title: u.title,
          status: u.status,
          unitKind: u.unitKind,
          parentUnitId: u.parentUnitId,
          orderIndex: u.orderIndex,
          contentGen: deriveUnitContentGenStatus(u) ?? undefined,
        })),
      ),
    [units],
  );
  const activeUnitPath = useMemo(
    () => (activeUnitId ? findUnitPath(unitTreeRoots, activeUnitId) : []),
    [activeUnitId, unitTreeRoots],
  );
  const activeUnit = useMemo(
    () => units.find((unit) => unit.id === activeUnitId),
    [activeUnitId, units],
  );
  const activeUnitHierarchy = useMemo(
    () =>
      goal && activeUnitId
        ? resolveUnitHierarchy(goal, activeUnitId)
        : undefined,
    [activeUnitId, goal],
  );
  const activeUnitModule = useMemo(
    () =>
      goal?.modules?.find(
        (module) => module.id === activeUnitHierarchy?.moduleId,
      ),
    [activeUnitHierarchy?.moduleId, goal?.modules],
  );
  const activeModuleId = routeModuleId ?? activeUnitModule?.id;
  const unitParentPath = mainlineEnabled()
    ? `${base}?view=plan`
    : activeUnitModule
      ? `${base}/modules/${activeUnitModule.id}`
      : base;
  const unitParentLabel = mainlineEnabled()
    ? t("mainline.plan")
    : activeUnitModule
      ? t("uiChrome.goalLayout.backModule")
      : t("uiChrome.goalLayout.backJourney");

  useEffect(() => {
    setOutlineOpen(false);
  }, [pathname]);

  const microUnit = useMemo(
    () => (isMicro && goal ? resolveMicroLessonUnit(goal) : null),
    [goal, isMicro],
  );
  const microIsOverview =
    goal?.overviewCourseStatus === "ready" ||
    microUnit?.unitKind === "overview" ||
    Boolean(goal?.overviewCourse);
  const microUnitPath = microUnit
    ? microGoalNavigatePath(goalId, microUnit, microIsOverview)
    : null;

  const items = useMemo(() => {
    const all = goalNavItems(goalId, hasSequentialJourney, t);
    if (isMicro) {
      if (!hasCourse) return all.filter((item) => item.id === "settings");
      return all
        .filter((item) => item.id === "overview")
        .map((item) => ({
          ...item,
          to: base,
          label: t("uiChrome.goalLayout.microCourse"),
        }));
    }
    if (hasCourse) {
      return goal?.parentGoal
        ? all.filter((item) => item.id !== "foundations")
        : all;
    }
    return all.filter((item) => item.id === "settings");
  }, [
    goalId,
    hasCourse,
    hasSequentialJourney,
    isMicro,
    base,
    goal?.parentGoal,
    t,
  ]);

  const isDashboard = pathname === base || pathname === `${base}/`;

  if (creationSession.data?.session?.status === "stopped") {
    return (
      <div className="mx-auto min-h-screen max-w-5xl px-4 py-8 md:px-6">
        <GoalCreationStatusCard session={creationSession.data.session} />
      </div>
    );
  }

  if (goalLoaded && isMicro) {
    const microTarget = microUnitPath ?? planPath;
    if (isPlanPage && hasCourse) {
      return <Navigate to={microTarget} replace />;
    }
    if (isDashboard) {
      return <Navigate to={hasCourse ? microTarget : planPath} replace />;
    }
  }

  if (goalLoaded && !hasCourse && !isMicro && isDashboard) {
    return <Navigate to={planPath} replace />;
  }

  const goalHomePath = hasCourse ? base : planPath;

  return (
    <div className="min-h-screen min-w-0">
      {isUnitPage && !isMicro ? (
        <DesktopTitlebarPortal>
          <div
            data-desktop-goal-titlebar
            className="flex min-w-0 flex-1 items-center gap-3"
          >
            <nav
              className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-[var(--text-400)]"
              aria-label={t("uiChrome.breadcrumbs")}
            >
              <Link
                to="/goals"
                className="shrink-0 transition-colors hover:text-[var(--text-700)]"
              >
                {t("uiChrome.goalLayout.allGoals")}
              </Link>
              <ChevronRight
                className="size-3.5 shrink-0 text-[var(--text-300)]"
                aria-hidden
              />
              <Link
                to={goalHomePath}
                className="max-w-48 shrink-0 truncate transition-colors hover:text-[var(--text-700)]"
              >
                {goalTitle ?? t("uiChrome.goalLayout.course")}
              </Link>
              {activeUnitModule && !mainlineEnabled() ? (
                <>
                  <ChevronRight
                    className="size-3.5 shrink-0 text-[var(--text-300)]"
                    aria-hidden
                  />
                  <ModuleUnitsHoverMenu
                    base={base}
                    module={activeUnitModule}
                    units={units}
                    activeUnitId={activeUnitId}
                    className="hidden max-w-48 shrink-0 truncate transition-colors hover:text-[var(--text-700)] focus-visible:outline-none focus-visible:text-[var(--text-700)] lg:block"
                  />
                </>
              ) : null}
              {activeUnit ? (
                <>
                  <ChevronRight
                    className="size-3.5 shrink-0 text-[var(--text-300)]"
                    aria-hidden
                  />
                  <span
                    className="min-w-0 truncate font-medium text-[var(--text-700)]"
                    aria-current="page"
                  >
                    <LlmMarkdownInline content={activeUnit.title} />
                  </span>
                </>
              ) : null}
            </nav>
            <Link
              to={unitParentPath}
              className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-[var(--text-500)] transition-colors hover:bg-[var(--bg-200)] hover:text-[var(--text-800)]"
              aria-label={unitParentLabel}
              title={unitParentLabel}
            >
              <ArrowLeft className="size-3.5" aria-hidden />
              <span>{unitParentLabel}</span>
            </Link>
          </div>
        </DesktopTitlebarPortal>
      ) : null}
      {isMicro ? (
        <header className="sticky top-0 z-sticky border-b border-[var(--border-200)] bg-[var(--bg-50)]/92 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-6xl items-center px-4 md:px-6">
            <Link
              to="/goals"
              className="flex items-center gap-1.5 rounded-lg px-1 py-1 text-sm text-[var(--text-500)] transition-colors hover:text-[var(--brand-600)]"
              aria-label={t("uiChrome.goalLayout.backAllGoals")}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              <span>{t("uiChrome.goalLayout.back")}</span>
            </Link>
          </div>
        </header>
      ) : null}

      {/* Mobile header — minimal */}
      {!isMicro ? (
        <header
          className={cn(
            "sticky top-0 z-sticky border-b border-[var(--border-200)] bg-[var(--bg-50)]/90 backdrop-blur-md md:hidden",
            isUnitPage && "hidden",
          )}
        >
          <div className="flex items-center gap-3 px-4 h-12">
            <Link
              to="/goals"
              className="flex shrink-0 items-center gap-1 rounded-lg p-1 text-[var(--text-400)] transition-colors hover:text-[var(--brand-600)]"
              aria-label={t("uiChrome.goalLayout.backAllGoals")}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </Link>
            <p className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--text-800)]">
              {goalTitle ?? t("uiChrome.loading")}
            </p>
          </div>
        </header>
      ) : null}

      {!isMicro && !isUnitPage ? (
        <nav
          className="sticky top-12 z-sticky flex border-b border-[var(--border-200)] bg-[var(--bg-50)]/95 px-3 md:hidden"
          aria-label={t("uiChrome.goalLayout.goalNavigation")}
        >
          {items.map((item) => (
            <GoalNavLink
              key={item.label}
              item={item}
              active={isNavActive(item, pathname)}
              variant="tab"
            />
          ))}
        </nav>
      ) : null}

      <div className="flex min-w-0 md:min-h-screen">
        {/* Main content */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {isUnitPage && !isMicro && (
            <header
              data-goal-unit-header
              className="sticky top-0 z-sticky border-b border-[var(--border-200)] bg-[var(--bg-50)]/92 backdrop-blur-md"
            >
              <div className="mx-auto flex h-12 max-w-6xl items-center gap-2 px-3 sm:gap-3 sm:px-4 md:px-6">
                <button
                  type="button"
                  onClick={() => setOutlineOpen(true)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border-200)] bg-[var(--bg-50)] text-[var(--text-700)] transition-colors hover:bg-[var(--bg-200)] sm:w-auto sm:gap-2 sm:px-3 sm:text-sm sm:font-medium md:hidden"
                  aria-label={t("uiChrome.goalLayout.openOutline")}
                >
                  <Menu className="h-4 w-4" aria-hidden />
                  <span className="hidden sm:inline">
                    {t("uiChrome.goalLayout.courseOutline")}
                  </span>
                </button>
                <nav
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-[var(--text-400)]"
                  aria-label={t("uiChrome.breadcrumbs")}
                >
                  <Link
                    to="/goals"
                    className="hidden shrink-0 transition-colors hover:text-[var(--brand-600)] sm:inline"
                  >
                    {t("uiChrome.goalLayout.allGoals")}
                  </Link>
                  <ChevronRight
                    className="hidden h-3.5 w-3.5 shrink-0 text-[var(--text-300)] sm:inline"
                    aria-hidden
                  />
                  <Link
                    to={goalHomePath}
                    className="hidden max-w-40 shrink-0 truncate transition-colors hover:text-[var(--brand-600)] md:inline"
                  >
                    {goalTitle ?? t("uiChrome.goalLayout.course")}
                  </Link>
                  {activeUnitModule && activeUnit ? (
                    <>
                      <ChevronRight
                        className="hidden h-3.5 w-3.5 shrink-0 text-[var(--text-300)] md:inline"
                        aria-hidden
                      />
                      <ModuleUnitsHoverMenu
                        base={base}
                        module={activeUnitModule}
                        units={units}
                        activeUnitId={activeUnitId}
                        className="hidden max-w-44 shrink-0 truncate transition-colors hover:text-[var(--brand-600)] focus-visible:outline-none focus-visible:text-[var(--brand-600)] lg:inline"
                      />
                      <ChevronRight
                        className="hidden h-3.5 w-3.5 shrink-0 text-[var(--text-300)] lg:inline"
                        aria-hidden
                      />
                      <span
                        className="min-w-0 truncate font-medium text-[var(--text-700)]"
                        aria-current="page"
                      >
                        <LlmMarkdownInline content={activeUnit.title} />
                      </span>
                    </>
                  ) : (
                    <>
                      {activeUnitPath.length > 2 && (
                        <>
                          <ChevronRight
                            className="hidden h-3.5 w-3.5 shrink-0 text-[var(--text-300)] md:inline"
                            aria-hidden
                          />
                          <Link
                            to={base}
                            className="hidden max-w-36 shrink-0 truncate transition-colors hover:text-[var(--brand-600)] md:inline"
                          >
                            <LlmMarkdownInline
                              content={activeUnitPath[0].title}
                            />
                          </Link>
                          <span className="hidden shrink-0 text-[var(--text-400)] md:inline">
                            …
                          </span>
                        </>
                      )}
                      {(activeUnitPath.length <= 2
                        ? activeUnitPath
                        : activeUnitPath.slice(-1)
                      ).map((node, index) => {
                        const isCurrent =
                          index === activeUnitPath.length - 1 ||
                          (activeUnitPath.length > 2 && index === 0);
                        return (
                          <span key={node.id} className="contents">
                            <ChevronRight
                              className="hidden h-3.5 w-3.5 shrink-0 text-[var(--text-300)] md:inline"
                              aria-hidden
                            />
                            {isCurrent ? (
                              <span
                                className="min-w-0 truncate font-medium text-[var(--text-700)]"
                                aria-current="page"
                              >
                                <LlmMarkdownInline content={node.title} />
                              </span>
                            ) : (
                              <Link
                                to={base}
                                className="hidden max-w-44 truncate transition-colors hover:text-[var(--brand-600)] md:inline"
                              >
                                <LlmMarkdownInline content={node.title} />
                              </Link>
                            )}
                          </span>
                        );
                      })}
                    </>
                  )}
                </nav>
                <Link
                  to={unitParentPath}
                  className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-xs text-[var(--text-500)] transition-colors hover:bg-[var(--bg-200)] hover:text-[var(--brand-600)]"
                  aria-label={unitParentLabel}
                  title={unitParentLabel}
                >
                  <ArrowLeft className="h-3.5 w-3.5 sm:hidden" aria-hidden />
                  <span className="hidden sm:inline">{unitParentLabel}</span>
                </Link>
              </div>
            </header>
          )}
          <main
            className={cn(
              "mx-auto w-full min-w-0 flex min-h-0 flex-1 flex-col px-4 pt-4",
              "pb-4 md:py-6 md:pb-6",
              isLessonPerformancePage
                ? "md:px-6 md:pt-7"
                : isUnitPage
                  ? "max-w-[100rem] md:px-6 md:pt-7"
                  : isProjectPage
                    ? "max-w-6xl"
                    : isModulePage
                      ? "max-w-6xl"
                      : isDashboard && hasSequentialJourney
                        ? "max-w-6xl"
                        : "max-w-4xl",
            )}
          >
            {goal?.parentGoal && !isUnitPage ? (
              <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-[var(--border-200)] bg-[var(--brand-50)] px-3 py-2 text-sm">
                <span className="min-w-0 truncate text-[var(--text-600)]">
                  {t("uiChrome.goalLayout.foundationFor", {
                    title: goal.parentGoal.title,
                  })}
                </span>
                <Link
                  className="shrink-0 font-medium text-[var(--brand-700)]"
                  to={`/goals/${goal.parentGoal.id}`}
                >
                  {t("uiChrome.goalLayout.backParentGoal")}
                </Link>
              </div>
            ) : null}
            <Outlet />
          </main>
        </div>
      </div>

      {isUnitPage && !isMicro && (
        <Sheet open={outlineOpen} onOpenChange={setOutlineOpen}>
          <SheetContent
            side="left"
            className="w-[88vw] max-w-sm gap-0 bg-[var(--bg-100)]"
          >
            <SheetHeader className="border-b border-[var(--border-200)] px-5 py-4">
              <SheetTitle className="pr-10 text-base text-[var(--text-800)]">
                {goalTitle ?? t("uiChrome.goalLayout.courseOutline")}
              </SheetTitle>
              <SheetDescription className="text-xs">
                {hasSequentialJourney
                  ? t("uiChrome.goalLayout.modulesAndUnits")
                  : t("uiChrome.goalLayout.navigationAndUnits")}
              </SheetDescription>
            </SheetHeader>
            <div className="border-b border-[var(--border-200)] p-3">
              <nav
                className="flex flex-col gap-1"
                aria-label={t("uiChrome.goalLayout.courseNavigation")}
              >
                {items.map((item) => (
                  <GoalNavLink
                    key={item.label}
                    item={item}
                    active={isNavActive(item, pathname)}
                    variant="sidebar"
                  />
                ))}
              </nav>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <GoalUnitSidebarNav
                roots={unitTreeRoots}
                goalId={goalId}
                modules={hasSequentialJourney ? goal?.modules : undefined}
                activeUnitId={activeUnitId}
                activeModuleId={activeModuleId}
              />
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
