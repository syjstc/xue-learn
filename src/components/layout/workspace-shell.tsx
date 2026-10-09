import { MainlineFootprints } from "@/features/learning-mainline/footprints";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Link, useLocation } from "react-router-dom";
import {
  AlertTriangle,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CircleStop,
  Compass,
  Folder,
  FolderOpen,
  GripVertical,
  LoaderCircle,
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import { useAssistant } from "@/components/agent/assistant-provider";
import { GoalCreationRetryButton } from "@/components/agent/goal-creation-retry-button";
import { NavBrand } from "@/components/brand/brand-logo";
import { GoalIcon } from "@/components/goals/goal-icon";
import { AccountMenu } from "@/components/layout/account-menu";
import { rememberNonSettingsLocation } from "@/components/layout/workspace-sidebar-back-button";
import { DesktopTitlebarTargetProvider } from "@/components/layout/desktop-titlebar";
import {
  resolveWorkspaceSidebarView,
  type WorkspaceSidebarViewRegistration,
} from "@/components/layout/workspace-sidebar-view-registry";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ResizablePanelHandle } from "@/components/ui/resizable-panel-handle";
import {
  type LearningSpaceGoal,
  useGoal,
  useLearningSpaces,
  useMoveGoalToLearningSpace,
} from "@/hooks/api";
import { useActiveGoalCreationSession } from "@/hooks/use-goal-creation-session";
import {
  goalCreationNeedsRetry,
  goalCreationShortStatus,
} from "@/shared/agent/goal-creation-session";
import { getAuthUser } from "@/shared/auth";
import { cn } from "@xue-learn/core/source/src/shared/utils.ts";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import {
  canUseBrowserPersistentStorage,
  getClientRuntime,
  isDesktopLocalRuntime,
} from "@xue-learn/core/source/src/shared/runtime/client-runtime.ts";
import {
  formatSidebarShortcut,
  matchesSidebarShortcut,
  readSidebarShortcut,
  SIDEBAR_SHORTCUT_CHANGED_EVENT,
  type SidebarShortcut,
} from "@/shared/runtime/sidebar-shortcut";
import {
  readLocalClientPreference,
  writeLocalClientPreference,
} from "@/shared/runtime/local-client-preferences";

const STORAGE_KEY = "xue-learn:workspace-explorer-collapsed";
const WIDTH_STORAGE_KEY = "xue-learn:workspace-explorer-width";
const EXPANDED_SPACES_STORAGE_KEY =
  "xue-learn:workspace-explorer-expanded-spaces";
const UNORGANIZED_SPACE_KEY = "unorganized";
const DEFAULT_EXPLORER_WIDTH = 256;
const MIN_EXPLORER_WIDTH = 224;
const MAX_EXPLORER_WIDTH = 400;
const SIDEBAR_PREVIEW_CLOSE_DELAY_MS = 320;
const SIDEBAR_PREVIEW_HOVER_SELECTOR = [
  "[data-workspace-sidebar]:hover",
  "[data-desktop-sidebar-toggle]:hover",
  "[data-desktop-sidebar-edge-trigger]:hover",
  "[data-desktop-sidebar-tooltip]:hover",
].join(",");
const NO_SIDEBAR_VIEWS: readonly WorkspaceSidebarViewRegistration[] = [];

function clampExplorerWidth(width: number) {
  return Math.min(MAX_EXPLORER_WIDTH, Math.max(MIN_EXPLORER_WIDTH, width));
}

function readExplorerWidth() {
  if (!canUseBrowserPersistentStorage()) {
    return clampExplorerWidth(
      readLocalClientPreference(WIDTH_STORAGE_KEY, DEFAULT_EXPLORER_WIDTH),
    );
  }
  const value = window.localStorage.getItem(WIDTH_STORAGE_KEY);
  if (value === null) return DEFAULT_EXPLORER_WIDTH;
  const stored = Number(value);
  return Number.isFinite(stored)
    ? clampExplorerWidth(stored)
    : DEFAULT_EXPLORER_WIDTH;
}

function routeGoalId(pathname: string) {
  return pathname.match(/^\/goals\/([^/]+)/)?.[1] ?? null;
}

function NavRow({
  to,
  label,
  icon: Icon,
  active,
  compact = false,
  count,
}: {
  to: string;
  label: string;
  icon: LucideIcon;
  active?: boolean;
  compact?: boolean;
  count?: number;
}) {
  return (
    <Link
      to={to}
      title={compact ? label : undefined}
      aria-label={compact ? label : undefined}
      className={cn(
        "flex h-9 items-center rounded-lg text-sm transition-colors",
        compact ? "justify-center px-2" : "gap-2.5 px-2.5",
        active
          ? "bg-[var(--brand-50)] font-medium text-[var(--brand-700)]"
          : "text-[var(--text-500)] hover:bg-[var(--bg-200)] hover:text-[var(--text-800)]",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      {!compact ? (
        <>
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {typeof count === "number" && count > 0 ? (
            <span
              className={cn(
                "ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                active
                  ? "bg-[var(--brand-100)] text-[var(--brand-700)]"
                  : "bg-[var(--bg-200)] text-[var(--text-400)]",
              )}
            >
              {count}
            </span>
          ) : null}
        </>
      ) : null}
    </Link>
  );
}

function CreateGoalButton({ compact }: { compact: boolean }) {
  const t = useT();
  const { openGoalCreationPrompt, openGoalCreationModal } = useAssistant();
  const activeCreation = useActiveGoalCreationSession();
  const session = activeCreation.data?.session ?? null;
  const stopped = session?.status === "stopped";
  const needsRetry = goalCreationNeedsRetry(session);

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => openGoalCreationPrompt()}
        title={compact ? t("spaces.newGoal") : undefined}
        aria-label={compact ? t("spaces.newGoal") : undefined}
        className={cn(
          "flex h-9 w-full items-center rounded-lg bg-[var(--sidebar-primary)] font-semibold text-[var(--sidebar-primary-foreground)] shadow-sm transition-colors hover:bg-[var(--brand-600)]",
          compact ? "justify-center px-2" : "gap-2 px-3 text-sm",
        )}
      >
        <Plus className="size-4 shrink-0" aria-hidden />
        {!compact ? <span>{t("spaces.newGoal")}</span> : null}
      </button>
      {session ? (
        <div
          className={cn(
            "flex min-h-9 w-full items-center rounded-lg border text-left",
            stopped || needsRetry
              ? "border-destructive/25 bg-destructive/5 text-destructive"
              : "border-[var(--brand-200)] bg-[var(--brand-50)] text-[var(--brand-700)]",
            compact ? "justify-center px-2" : "gap-1 px-2 py-2",
          )}
        >
          <button
            type="button"
            onClick={openGoalCreationModal}
            title={compact ? goalCreationShortStatus(session, t) : undefined}
            aria-label={
              compact ? goalCreationShortStatus(session, t) : undefined
            }
            className={cn(
              "flex min-w-0 items-center text-left transition-colors",
              compact ? "justify-center" : "flex-1 gap-2 px-1",
              stopped || needsRetry
                ? "hover:text-destructive"
                : "hover:text-[var(--brand-800)]",
            )}
          >
            {stopped ? (
              <CircleStop className="size-4 shrink-0" aria-hidden />
            ) : needsRetry ? (
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
            ) : (
              <LoaderCircle
                className="size-4 shrink-0 animate-spin"
                aria-hidden
              />
            )}
            {!compact ? (
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold">
                  {stopped
                    ? t("goals.creationStopped")
                    : needsRetry
                      ? t("goals.creationNeedsAttention")
                      : t("goals.creationRunning")}
                </span>
                <span className="mt-0.5 block text-[11px] leading-4 text-[var(--text-400)]">
                  {goalCreationShortStatus(session, t)}
                </span>
              </span>
            ) : null}
          </button>
          {!compact && needsRetry ? (
            <GoalCreationRetryButton sessionId={session.id} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function readExpandedSpaces() {
  if (typeof window === "undefined") return new Set<string>();
  if (!canUseBrowserPersistentStorage()) {
    return new Set(
      readLocalClientPreference<string[]>(EXPANDED_SPACES_STORAGE_KEY, []),
    );
  }
  try {
    const value = JSON.parse(
      window.localStorage.getItem(EXPANDED_SPACES_STORAGE_KEY) ?? "[]",
    );
    return new Set(
      Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === "string")
        : [],
    );
  } catch {
    return new Set<string>();
  }
}

function SidebarGoalRow({
  goal,
  spaceId,
  active,
}: {
  goal: LearningSpaceGoal;
  spaceId: string | null;
  active: boolean;
}) {
  const t = useT();
  const draggable = useDraggable({
    id: `workspace-goal:${goal.id}`,
    data: {
      type: "goal",
      goalId: goal.id,
      title: goal.title,
      sourceSpaceId: spaceId,
    },
  });

  return (
    <div
      ref={draggable.setNodeRef}
      className={cn(
        "group/goal ml-5 flex h-8 min-w-0 items-center rounded-md text-xs transition-colors",
        active
          ? "bg-[var(--brand-50)] font-medium text-[var(--brand-700)]"
          : "text-[var(--text-500)] hover:bg-[var(--bg-200)] hover:text-[var(--text-800)]",
        draggable.isDragging && "opacity-40",
      )}
    >
      <button
        type="button"
        ref={draggable.setActivatorNodeRef}
        {...draggable.listeners}
        {...draggable.attributes}
        aria-label={t("spaces.dragGoal", { title: goal.title })}
        className="flex size-6 shrink-0 cursor-grab items-center justify-center rounded text-[var(--text-300)] opacity-0 transition-opacity hover:text-[var(--text-600)] focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-300)] active:cursor-grabbing group-hover/goal:opacity-100"
      >
        <GripVertical className="size-3.5" aria-hidden />
      </button>
      <Link
        to={`/goals/${goal.id}`}
        className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-2"
        title={goal.title}
      >
        <GoalIcon
          title={goal.title}
          iconSvg={goal.iconSvg}
          iconTint={goal.iconTint}
          className="size-4 rounded-md border-border/50 shadow-none"
        />
        <span className="truncate">{goal.title}</span>
      </Link>
    </div>
  );
}

function SpaceTreeRow({
  spaceId,
  name,
  goals,
  expanded,
  active,
  activeGoalId,
  dragOver,
  onToggle,
  onCreateGoal,
}: {
  spaceId: string | null;
  name: string;
  goals: LearningSpaceGoal[];
  expanded: boolean;
  active: boolean;
  activeGoalId: string | null;
  dragOver: boolean;
  onToggle: () => void;
  onCreateGoal: () => void;
}) {
  const t = useT();
  const droppable = useDroppable({
    id: `workspace-space:${spaceId ?? UNORGANIZED_SPACE_KEY}`,
    data: { type: "space", spaceId, name },
  });
  const path = spaceId ? `/spaces/${spaceId}` : "/spaces/unorganized";

  return (
    <div
      ref={droppable.setNodeRef}
      className={cn(
        "rounded-lg transition-colors",
        (droppable.isOver || dragOver) &&
          "bg-[var(--brand-50)] ring-1 ring-inset ring-[var(--brand-300)]",
      )}
    >
      <div className="group/space relative flex h-9 min-w-0 items-center rounded-lg">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={
            expanded
              ? t("spaces.collapseGoals", { name })
              : t("spaces.expandGoals", { name })
          }
          className="ml-0.5 flex size-7 shrink-0 items-center justify-center rounded text-[var(--text-400)] hover:bg-[var(--bg-200)] hover:text-[var(--text-700)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-300)]"
        >
          {expanded ? (
            <ChevronDown className="size-3.5" aria-hidden />
          ) : (
            <ChevronRight className="size-3.5" aria-hidden />
          )}
        </button>
        <Link
          to={path}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 py-1.5 text-sm transition-colors",
            active
              ? "font-medium text-[var(--brand-700)]"
              : "text-[var(--text-500)] hover:text-[var(--text-800)]",
          )}
        >
          {expanded ? (
            <FolderOpen className="size-4 shrink-0" aria-hidden />
          ) : (
            <Folder className="size-4 shrink-0" aria-hidden />
          )}
          <span className="truncate">{name}</span>
        </Link>
        <span className="mr-2 rounded-full bg-[var(--bg-200)] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-[var(--text-400)] transition-opacity group-hover/space:opacity-0 group-focus-within/space:opacity-0">
          {goals.length}
        </span>
        <button
          type="button"
          onClick={onCreateGoal}
          aria-label={t("spaces.newGoalInSpace", { name })}
          className="absolute right-3 flex size-7 items-center justify-center rounded text-[var(--text-400)] opacity-0 transition-opacity hover:bg-[var(--brand-100)] hover:text-[var(--brand-700)] focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-300)] group-hover/space:opacity-100 group-focus-within/space:opacity-100"
        >
          <Plus className="size-3.5" aria-hidden />
        </button>
      </div>
      {expanded ? (
        <div className="mb-1 ml-3 border-l border-[var(--border-200)] pb-0.5">
          {goals.length ? (
            goals.map((goal) => (
              <SidebarGoalRow
                key={goal.id}
                goal={goal}
                spaceId={spaceId}
                active={activeGoalId === goal.id}
              />
            ))
          ) : (
            <p className="ml-8 py-1.5 text-[11px] text-[var(--text-300)]">
              {t("spaces.noGoalsShort")}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function WorkspaceExplorer({
  collapsed,
  contentOnly = false,
}: {
  collapsed: boolean;
  contentOnly?: boolean;
}) {
  const t = useT();
  const runtime = getClientRuntime();
  const showTodayNav = isDesktopLocalRuntime();
  const { pathname } = useLocation();
  const { openGoalCreationPrompt } = useAssistant();
  const portfolio = useLearningSpaces();
  const moveGoal = useMoveGoalToLearningSpace();
  const goalId = routeGoalId(pathname);
  const [expandedSpaces, setExpandedSpaces] = useState(readExpandedSpaces);
  const [activeGoal, setActiveGoal] = useState<LearningSpaceGoal | null>(null);
  const [dragOverSpace, setDragOverSpace] = useState<string | null | undefined>(
    undefined,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const expandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduledSpaceRef = useRef<string | null | undefined>(undefined);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const goalSpaceKey = useMemo(() => {
    if (!goalId || !portfolio.data) return null;
    const containingSpace = portfolio.data.spaces.find((space) =>
      space.items.some((item) => item.goalId === goalId),
    );
    if (containingSpace) return containingSpace.id;
    return portfolio.data.unorganizedGoals.some((goal) => goal.id === goalId)
      ? UNORGANIZED_SPACE_KEY
      : null;
  }, [goalId, portfolio.data]);

  useEffect(() => {
    if (canUseBrowserPersistentStorage()) {
      window.localStorage.setItem(
        EXPANDED_SPACES_STORAGE_KEY,
        JSON.stringify([...expandedSpaces]),
      );
    } else {
      writeLocalClientPreference(EXPANDED_SPACES_STORAGE_KEY, [
        ...expandedSpaces,
      ]);
    }
  }, [expandedSpaces]);

  useEffect(() => {
    if (!goalSpaceKey) return;
    setExpandedSpaces((current) => {
      if (current.has(goalSpaceKey)) return current;
      return new Set(current).add(goalSpaceKey);
    });
  }, [goalSpaceKey]);

  useEffect(
    () => () => {
      if (expandTimerRef.current) clearTimeout(expandTimerRef.current);
    },
    [],
  );

  function toggleSpace(key: string) {
    setExpandedSpaces((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function createGoalInSpace(spaceId: string | null) {
    openGoalCreationPrompt(
      undefined,
      spaceId ? { targetSpaceId: spaceId } : undefined,
    );
  }

  function clearExpandTimer() {
    if (expandTimerRef.current) clearTimeout(expandTimerRef.current);
    expandTimerRef.current = null;
    scheduledSpaceRef.current = undefined;
  }

  function handleDragStart(event: DragStartEvent) {
    const draggedGoalId = event.active.data.current?.goalId;
    const goal = portfolio.data
      ? [
          ...portfolio.data.unorganizedGoals,
          ...portfolio.data.spaces.flatMap((space) =>
            space.items.flatMap((item) => (item.goal ? [item.goal] : [])),
          ),
        ].find((candidate) => candidate.id === draggedGoalId)
      : undefined;
    setActiveGoal(goal ?? null);
    setNotice(null);
  }

  function handleDragOver(event: DragOverEvent) {
    const target = event.over?.data.current;
    if (target?.type !== "space") {
      clearExpandTimer();
      setDragOverSpace(undefined);
      return;
    }
    const targetSpaceId = (target.spaceId as string | null) ?? null;
    const targetKey = targetSpaceId ?? UNORGANIZED_SPACE_KEY;
    setDragOverSpace(targetSpaceId);
    if (scheduledSpaceRef.current !== targetSpaceId) clearExpandTimer();
    if (expandedSpaces.has(targetKey)) return;
    if (scheduledSpaceRef.current === targetSpaceId) return;
    scheduledSpaceRef.current = targetSpaceId;
    expandTimerRef.current = setTimeout(() => {
      setExpandedSpaces((current) => new Set(current).add(targetKey));
      clearExpandTimer();
    }, 600);
  }

  function handleDragEnd(event: DragEndEvent) {
    clearExpandTimer();
    setActiveGoal(null);
    setDragOverSpace(undefined);
    const goalIdToMove = event.active.data.current?.goalId;
    const sourceSpaceId =
      (event.active.data.current?.sourceSpaceId as string | null) ?? null;
    const target = event.over?.data.current;
    if (typeof goalIdToMove !== "string" || target?.type !== "space") return;
    const targetSpaceId = (target.spaceId as string | null) ?? null;
    if (sourceSpaceId === targetSpaceId) return;
    const targetKey = targetSpaceId ?? UNORGANIZED_SPACE_KEY;
    setExpandedSpaces((current) => new Set(current).add(targetKey));
    void moveGoal
      .mutateAsync({ goalId: goalIdToMove, spaceId: targetSpaceId })
      .catch(() => setNotice(t("spaces.goalMoveFailed")));
  }

  if (collapsed) {
    return (
      <nav
        className="flex flex-1 flex-col gap-1 px-2 py-3"
        aria-label={t("spaces.explorer")}
      >
        {showTodayNav ? (
          <NavRow
            to="/today"
            label={t("nav.today")}
            icon={CalendarDays}
            compact
            active={pathname.startsWith("/today")}
          />
        ) : null}
        <NavRow
          to="/spaces"
          label={t("spaces.title")}
          icon={FolderOpen}
          compact
          active={pathname.startsWith("/spaces") || Boolean(goalId)}
        />
        <NavRow
          to="/reviews"
          label={t("spaces.reviews")}
          icon={RotateCcw}
          compact
          active={pathname.startsWith("/reviews")}
        />
        {runtime.capabilities.publicCatalog ? (
          <NavRow
            to="/explore"
            label={t("spaces.explore")}
            icon={Compass}
            compact
            active={pathname.startsWith("/explore")}
          />
        ) : null}
        <div className="mt-auto border-t border-[var(--border-200)] pt-2">
          <AccountMenu placement="sidebar" collapsed />
        </div>
      </nav>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {!contentOnly ? (
        <nav className="space-y-1 px-2 py-3" aria-label={t("spaces.explorer")}>
          {showTodayNav ? (
            <NavRow
              to="/today"
              label={t("nav.today")}
              icon={CalendarDays}
              active={pathname.startsWith("/today")}
            />
          ) : null}
          <NavRow
            to="/reviews"
            label={t("spaces.reviews")}
            icon={RotateCcw}
            active={pathname.startsWith("/reviews")}
          />
          {runtime.capabilities.publicCatalog ? (
            <NavRow
              to="/explore"
              label={t("spaces.explore")}
              icon={Compass}
              active={pathname.startsWith("/explore")}
            />
          ) : null}
        </nav>
      ) : null}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragCancel={() => {
          clearExpandTimer();
          setActiveGoal(null);
          setDragOverSpace(undefined);
        }}
        onDragEnd={handleDragEnd}
      >
        <div
          className={cn(
            "workspace-sidebar-scroll relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3",
            !contentOnly && "border-t border-[var(--border-200)]",
          )}
        >
          <div className="mb-2 flex items-center justify-between px-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-300)]">
              {t("spaces.title")}
            </span>
            <Link
              to="/spaces?create=1"
              aria-label={t("spaces.new")}
              className="rounded p-1 text-[var(--text-400)] hover:bg-[var(--bg-200)]"
            >
              <Plus className="size-3.5" />
            </Link>
          </div>
          {portfolio.isPending ? (
            <div
              className="space-y-2 px-1 py-1"
              aria-label={t("spaces.loading")}
            >
              {[0, 1, 2].map((index) => (
                <div
                  key={index}
                  className="h-9 animate-pulse rounded-lg bg-[var(--bg-200)]"
                />
              ))}
            </div>
          ) : null}
          {portfolio.data ? (
            <div className="space-y-0.5">
              <SpaceTreeRow
                spaceId={null}
                name={t("spaces.unorganized")}
                goals={portfolio.data.unorganizedGoals}
                expanded={expandedSpaces.has(UNORGANIZED_SPACE_KEY)}
                active={pathname === "/spaces/unorganized"}
                activeGoalId={goalId}
                dragOver={dragOverSpace === null}
                onToggle={() => toggleSpace(UNORGANIZED_SPACE_KEY)}
                onCreateGoal={() => createGoalInSpace(null)}
              />
              {portfolio.data.spaces.map((space) => (
                <SpaceTreeRow
                  key={space.id}
                  spaceId={space.id}
                  name={space.name}
                  goals={space.items.flatMap((item) =>
                    item.goal ? [item.goal] : [],
                  )}
                  expanded={expandedSpaces.has(space.id)}
                  active={pathname === `/spaces/${space.id}`}
                  activeGoalId={goalId}
                  dragOver={dragOverSpace === space.id}
                  onToggle={() => toggleSpace(space.id)}
                  onCreateGoal={() => createGoalInSpace(space.id)}
                />
              ))}
            </div>
          ) : null}
          {notice ? (
            <p
              className="mx-1 mt-2 rounded-md bg-[var(--bg-200)] px-2 py-1.5 text-[11px] text-[var(--text-500)]"
              role="status"
            >
              {notice}
            </p>
          ) : null}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeGoal ? (
            <div className="flex h-8 max-w-56 items-center gap-2 rounded-md border border-[var(--brand-200)] bg-[var(--bg-50)] px-2 text-xs font-medium text-[var(--text-700)] shadow-lg">
              <GoalIcon
                title={activeGoal.title}
                iconSvg={activeGoal.iconSvg}
                iconTint={activeGoal.iconTint}
                className="size-4 rounded-md border-border/50 shadow-none"
              />
              <span className="truncate">{activeGoal.title}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      {!contentOnly ? (
        <div className="border-t border-[var(--border-200)] px-3 py-2">
          <AccountMenu placement="sidebar" collapsed={false} />
        </div>
      ) : null}
    </div>
  );
}

export function WorkspaceShell({
  children,
  sidebarViews = NO_SIDEBAR_VIEWS,
}: {
  children: React.ReactNode;
  sidebarViews?: readonly WorkspaceSidebarViewRegistration[];
}) {
  const t = useT();
  const location = useLocation();
  const { pathname } = location;
  const { immersiveLearningActive } = useAssistant();
  const runtime = getClientRuntime();
  const [collapsed, setCollapsed] = useState(() =>
    canUseBrowserPersistentStorage()
      ? window.localStorage.getItem(STORAGE_KEY) === "true"
      : readLocalClientPreference(STORAGE_KEY, false),
  );
  const [explorerWidth, setExplorerWidth] = useState(readExplorerWidth);
  const [resizing, setResizing] = useState(false);
  const [sidebarPreviewed, setSidebarPreviewed] = useState(false);
  const sidebarPreviewLockedRef = useRef(false);
  const [desktopTitlebarTarget, setDesktopTitlebarTarget] =
    useState<HTMLElement | null>(null);
  const [sidebarShortcut, setSidebarShortcut] =
    useState<SidebarShortcut>(readSidebarShortcut);
  const previewCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const user = getAuthUser();

  // Capture the route before the learner can interact with a settings entry
  // point. Settings tabs and local-control redirects must never replace it.
  useLayoutEffect(() => {
    rememberNonSettingsLocation(
      `${location.pathname}${location.search}${location.hash}`,
    );
  }, [location.hash, location.pathname, location.search]);
  const activeGoalId = routeGoalId(pathname);
  const hasDesktopCourseDetailTitlebar = Boolean(
    activeGoalId && pathname.startsWith(`/goals/${activeGoalId}/units/`),
  );
  const activeGoal = useGoal(user ? (activeGoalId ?? "") : "");
  const hasGoalSubview =
    activeGoal.data?.goalKind === "full" &&
    Boolean(activeGoal.data.modules?.length);
  const subviewGoalId = activeGoalId && hasGoalSubview ? activeGoalId : null;
  const sidebarView = useMemo(
    () =>
      resolveWorkspaceSidebarView(
        {
          pathname,
          goalSubviewId: subviewGoalId,
        },
        sidebarViews,
      ),
    [pathname, sidebarViews, subviewGoalId],
  );
  const [lastSidebarView, setLastSidebarView] = useState(sidebarView);
  const sidebarLockedOpen = sidebarView?.locksSidebarOpen === true;
  const sidebarCollapsed = collapsed && !sidebarLockedOpen;
  const collapsedWidth =
    runtime.kind === "desktop-local" && runtime.os === "macos" ? 0 : 56;
  const usesDesktopOverlaySidebar =
    runtime.kind === "desktop-local" && runtime.os === "macos";
  const canPreviewSidebar = sidebarCollapsed && usesDesktopOverlaySidebar;
  const explorerVisuallyCollapsed = sidebarCollapsed && !sidebarPreviewed;
  const rendersCollapsedExplorer =
    explorerVisuallyCollapsed && !usesDesktopOverlaySidebar;
  const renderedExplorerWidth = explorerVisuallyCollapsed
    ? collapsedWidth
    : explorerWidth;
  const toggleShortcutLabel = formatSidebarShortcut(
    sidebarShortcut,
    runtime.os,
  );

  useEffect(() => {
    if (sidebarView) setLastSidebarView(sidebarView);
  }, [sidebarView]);

  const updateExplorerWidth = useCallback((width: number) => {
    const next = clampExplorerWidth(width);
    setExplorerWidth(next);
    if (canUseBrowserPersistentStorage()) {
      window.localStorage.setItem(WIDTH_STORAGE_KEY, String(next));
    } else {
      writeLocalClientPreference(WIDTH_STORAGE_KEY, next);
    }
  }, []);

  const toggleExplorer = useCallback(() => {
    if (sidebarLockedOpen) return;
    if (previewCloseTimerRef.current) {
      clearTimeout(previewCloseTimerRef.current);
      previewCloseTimerRef.current = null;
    }
    setSidebarPreviewed(false);
    setCollapsed((current) => {
      const next = !current;
      if (canUseBrowserPersistentStorage()) {
        window.localStorage.setItem(STORAGE_KEY, String(next));
      } else {
        writeLocalClientPreference(STORAGE_KEY, next);
      }
      return next;
    });
  }, [sidebarLockedOpen]);

  const previewSidebar = useCallback(() => {
    if (!canPreviewSidebar) return;
    if (previewCloseTimerRef.current) {
      clearTimeout(previewCloseTimerRef.current);
      previewCloseTimerRef.current = null;
    }
    setSidebarPreviewed(true);
  }, [canPreviewSidebar]);

  useEffect(() => {
    if (runtime.kind !== "desktop-local") return;
    const syncShortcut = (event: Event) => {
      if (event instanceof CustomEvent) {
        setSidebarShortcut(event.detail as SidebarShortcut);
      } else {
        setSidebarShortcut(readSidebarShortcut());
      }
    };
    window.addEventListener(SIDEBAR_SHORTCUT_CHANGED_EVENT, syncShortcut);
    window.addEventListener("storage", syncShortcut);
    return () => {
      window.removeEventListener(SIDEBAR_SHORTCUT_CHANGED_EVENT, syncShortcut);
      window.removeEventListener("storage", syncShortcut);
    };
  }, [runtime.kind]);

  useEffect(() => {
    if (runtime.kind !== "desktop-local") return;
    const handleShortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        !matchesSidebarShortcut(event, sidebarShortcut, runtime.os)
      ) {
        return;
      }
      event.preventDefault();
      toggleExplorer();
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [runtime.kind, runtime.os, sidebarShortcut, toggleExplorer]);

  const scheduleSidebarPreviewClose = useCallback(() => {
    if (!canPreviewSidebar) return;
    if (previewCloseTimerRef.current) {
      clearTimeout(previewCloseTimerRef.current);
    }
    previewCloseTimerRef.current = setTimeout(() => {
      if (
        sidebarPreviewLockedRef.current ||
        document.querySelector(SIDEBAR_PREVIEW_HOVER_SELECTOR)
      ) {
        previewCloseTimerRef.current = null;
        return;
      }
      setSidebarPreviewed(false);
      previewCloseTimerRef.current = null;
    }, SIDEBAR_PREVIEW_CLOSE_DELAY_MS);
  }, [canPreviewSidebar]);

  const handleSidebarAccountMenuOpenChange = useCallback(
    (open: boolean) => {
      sidebarPreviewLockedRef.current = open;
      if (open) {
        if (previewCloseTimerRef.current) {
          clearTimeout(previewCloseTimerRef.current);
          previewCloseTimerRef.current = null;
        }
        if (canPreviewSidebar) setSidebarPreviewed(true);
        return;
      }
      scheduleSidebarPreviewClose();
    },
    [canPreviewSidebar, scheduleSidebarPreviewClose],
  );

  useEffect(
    () => () => {
      if (previewCloseTimerRef.current) {
        clearTimeout(previewCloseTimerRef.current);
      }
    },
    [],
  );

  const beginResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (sidebarCollapsed) return;
      event.preventDefault();
      setResizing(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const move = (moveEvent: PointerEvent) => {
        updateExplorerWidth(moveEvent.clientX);
      };
      const up = () => {
        setResizing(false);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up, { once: true });
      window.addEventListener("pointercancel", up, { once: true });
    },
    [sidebarCollapsed, updateExplorerWidth],
  );
  const excluded = useMemo(
    () =>
      !user ||
      pathname === "/" ||
      pathname === "/login" ||
      pathname === "/register" ||
      pathname === "/onboarding" ||
      pathname === "/privacy" ||
      pathname === "/terms",
    [pathname, user],
  );

  if (excluded) {
    return <div data-desktop-unframed-content>{children}</div>;
  }

  return (
    <DesktopTitlebarTargetProvider target={desktopTitlebarTarget}>
      <div
        data-workspace-shell
        data-sidebar-resizing={resizing || undefined}
        data-sidebar-previewed={
          (canPreviewSidebar && sidebarPreviewed) || undefined
        }
        data-desktop-course-detail={hasDesktopCourseDetailTitlebar || undefined}
        className="flex min-h-screen min-w-0"
        style={
          {
            "--desktop-sidebar-width": `${immersiveLearningActive || sidebarCollapsed ? 0 : explorerWidth}px`,
            "--desktop-titlebar-sidebar-width": `${immersiveLearningActive || (sidebarCollapsed && !sidebarPreviewed) ? 0 : explorerWidth}px`,
          } as React.CSSProperties
        }
      >
        <div data-desktop-titlebar role="toolbar" aria-label={t("app.brand")}>
          {!sidebarLockedOpen ? (
            <Tooltip>
              <TooltipTrigger
                data-desktop-sidebar-toggle
                type="button"
                onClick={toggleExplorer}
                onPointerEnter={previewSidebar}
                onPointerLeave={scheduleSidebarPreviewClose}
                onFocus={previewSidebar}
                onBlur={scheduleSidebarPreviewClose}
                className="flex size-6 shrink-0 items-center justify-center rounded-full text-[var(--text-400)] transition-colors hover:bg-[var(--bg-200)] hover:text-[var(--text-700)]"
                aria-label={
                  sidebarCollapsed
                    ? t("spaces.expandExplorer")
                    : t("spaces.collapseExplorer")
                }
              >
                <PanelLeft className="size-4" aria-hidden />
              </TooltipTrigger>
              <TooltipContent
                data-desktop-sidebar-tooltip
                side="bottom"
                sideOffset={6}
                onPointerEnter={previewSidebar}
                onPointerLeave={scheduleSidebarPreviewClose}
              >
                <span>
                  {sidebarCollapsed
                    ? t("spaces.expandExplorer")
                    : t("spaces.collapseExplorer")}
                </span>
                {toggleShortcutLabel ? (
                  <kbd
                    data-slot="kbd"
                    className="border border-background/25 bg-background/15 px-1.5 py-0.5 font-sans text-[10px] text-background"
                  >
                    {toggleShortcutLabel}
                  </kbd>
                ) : null}
              </TooltipContent>
            </Tooltip>
          ) : null}
          <div data-desktop-titlebar-main>
            <div ref={setDesktopTitlebarTarget} data-desktop-titlebar-slot />
          </div>
        </div>
        {sidebarCollapsed ? (
          <div
            data-desktop-sidebar-edge-trigger
            onPointerEnter={previewSidebar}
            onPointerLeave={scheduleSidebarPreviewClose}
            aria-hidden
          />
        ) : null}
        <aside
          data-workspace-sidebar
          data-collapsed={explorerVisuallyCollapsed || undefined}
          className={cn(
            immersiveLearningActive
              ? "hidden"
              : "sticky top-0 z-[calc(var(--z-sticky)+1)] hidden h-screen min-h-0 shrink-0 flex-col border-r border-[var(--border-200)] bg-[var(--bg-100)] md:flex",
            usesDesktopOverlaySidebar && "absolute inset-y-0 left-0",
            canPreviewSidebar &&
              sidebarPreviewed &&
              "shadow-[12px_0_28px_color-mix(in_srgb,var(--text-900)_12%,transparent)]",
            usesDesktopOverlaySidebar &&
              (explorerVisuallyCollapsed
                ? "-translate-x-full"
                : "translate-x-0"),
            !resizing && usesDesktopOverlaySidebar
              ? sidebarPreviewed
                ? "transform-gpu transition-transform duration-180 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
                : "transform-gpu transition-transform duration-280 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
              : !resizing &&
                  "transition-[width] duration-280 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
          )}
          style={{
            // The desktop explorer keeps a stable internal width and moves as a
            // single composited layer. Its sibling content reserves/releases
            // space independently through --desktop-sidebar-width.
            width: usesDesktopOverlaySidebar
              ? explorerWidth
              : renderedExplorerWidth,
          }}
          onPointerEnter={previewSidebar}
          onPointerLeave={scheduleSidebarPreviewClose}
          aria-hidden={
            immersiveLearningActive ||
            (usesDesktopOverlaySidebar &&
              sidebarCollapsed &&
              !sidebarPreviewed) ||
            undefined
          }
          inert={
            usesDesktopOverlaySidebar && sidebarCollapsed && !sidebarPreviewed
          }
          aria-label={t("spaces.explorer")}
        >
          {!sidebarCollapsed ? (
            <ResizablePanelHandle
              panelSide="left"
              label={t("spaces.resizeExplorer")}
              min={MIN_EXPLORER_WIDTH}
              max={MAX_EXPLORER_WIDTH}
              value={explorerWidth}
              className="absolute inset-y-0 right-0 z-20 translate-x-1/2"
              onPointerDown={beginResize}
              onReset={() => updateExplorerWidth(DEFAULT_EXPLORER_WIDTH)}
              onResizeBy={(delta) => updateExplorerWidth(explorerWidth + delta)}
            />
          ) : null}
          <div
            data-workspace-sidebar-header
            className={cn(
              "flex h-12 items-center border-b border-[var(--border-200)]",
              rendersCollapsedExplorer ? "px-3" : "px-4",
            )}
          >
            <Link
              to="/spaces"
              aria-label={t("app.brand")}
              aria-hidden={rendersCollapsedExplorer || undefined}
              tabIndex={rendersCollapsedExplorer ? -1 : undefined}
              className={cn(
                "group flex min-w-0 items-center transition-[opacity,transform] duration-200 motion-reduce:transition-none",
                rendersCollapsedExplorer
                  ? "pointer-events-none -translate-x-2 opacity-0"
                  : "translate-x-0 opacity-100 delay-100",
              )}
            >
              <NavBrand size="sm" />
            </Link>
            {!sidebarLockedOpen ? (
              <button
                data-workspace-sidebar-toggle
                type="button"
                onClick={toggleExplorer}
                className="ml-auto flex size-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-400)] transition-colors hover:bg-[var(--bg-200)] hover:text-[var(--text-700)]"
                aria-label={
                  sidebarCollapsed
                    ? t("spaces.expandExplorer")
                    : t("spaces.collapseExplorer")
                }
              >
                {sidebarCollapsed ? (
                  <PanelLeftOpen className="size-4" />
                ) : (
                  <PanelLeftClose className="size-4" />
                )}
              </button>
            ) : null}
          </div>
          <div
            className={cn(
              "pt-3 transition-[padding] duration-260 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
              rendersCollapsedExplorer ? "px-2" : "px-4",
            )}
          >
            {!rendersCollapsedExplorer ? <MainlineFootprints /> : null}
            <CreateGoalButton compact={rendersCollapsedExplorer} />
          </div>
          {rendersCollapsedExplorer ? (
            <WorkspaceExplorer collapsed />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <nav
                className="space-y-1 px-3 py-3"
                aria-label={t("spaces.explorer")}
              >
                {isDesktopLocalRuntime() ? (
                  <NavRow
                    to="/today"
                    label={t("nav.today")}
                    icon={CalendarDays}
                    active={pathname.startsWith("/today")}
                  />
                ) : null}
                <NavRow
                  to="/reviews"
                  label={t("spaces.reviews")}
                  icon={RotateCcw}
                  active={pathname.startsWith("/reviews")}
                />
                {getClientRuntime().capabilities.publicCatalog ? (
                  <NavRow
                    to="/explore"
                    label={t("spaces.explore")}
                    icon={Compass}
                    active={pathname.startsWith("/explore")}
                  />
                ) : null}
              </nav>
              <div className="min-h-0 flex-1 overflow-hidden border-t border-[var(--border-200)]">
                <div
                  className={cn(
                    "flex h-full min-h-0 w-[200%] transform-gpu transition-transform duration-300 ease-out motion-reduce:transition-none",
                    sidebarView ? "-translate-x-1/2" : "translate-x-0",
                  )}
                >
                  <div
                    className={cn(
                      "flex h-full min-h-0 min-w-0 basis-1/2 flex-col",
                      sidebarView && "pointer-events-none",
                    )}
                    aria-hidden={Boolean(sidebarView)}
                    inert={Boolean(sidebarView)}
                  >
                    <WorkspaceExplorer collapsed={false} contentOnly />
                  </div>
                  <div
                    className={cn(
                      "flex h-full min-h-0 min-w-0 basis-1/2 flex-col",
                      !sidebarView && "pointer-events-none",
                    )}
                    aria-hidden={!sidebarView}
                    inert={!sidebarView}
                  >
                    {(sidebarView ?? lastSidebarView)?.render()}
                  </div>
                </div>
              </div>
              <div className="border-t border-[var(--border-200)] px-3 py-2">
                <AccountMenu
                  placement="sidebar"
                  collapsed={false}
                  onOpenChange={handleSidebarAccountMenuOpenChange}
                />
              </div>
            </div>
          )}
        </aside>
        <div data-workspace-content className="flex min-w-0 flex-1 flex-col">
          <div data-workspace-scroll className="min-h-0 min-w-0 flex-1">
            {children}
          </div>
        </div>
      </div>
    </DesktopTitlebarTargetProvider>
  );
}
