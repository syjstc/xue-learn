import "@xyflow/react/dist/style.css";

import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import {
  BookOpen,
  Check,
  ChevronRight,
  CircleDot,
  Folder,
  GitBranch,
  LayoutGrid,
  MoreHorizontal,
  MoveRight,
  Plus,
  RotateCcw,
  Settings2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useAssistant } from "@/components/agent/assistant-provider";
import { GoalDeleteButton } from "@/components/goals/goal-delete-button";
import { GoalIcon } from "@/components/goals/goal-icon";
import {
  ConfirmActionDialog,
  EmptyRoadmapIllustration,
  MoveGoalDialog,
  RelationDialog,
  SPACE_ACCENT_STYLE,
  SpaceIdentityDialog,
} from "@/components/spaces/learning-space-dialogs";
import { ApiErrorNotice } from "@/components/ui/api-error-notice";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@xue-learn/core/source/src/components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
  LearningSpaceGoal,
  LearningSpaceItem,
  LearningSpaceRelation,
} from "@/hooks/api";
import {
  useDeleteLearningSpace,
  useCreateLearningSpaceRelation,
  useGoals,
  useLearningSpaces,
  useMoveGoalToLearningSpace,
  useRemoveLearningSpaceItem,
  useUpdateLearningSpace,
} from "@/hooks/api";
import { useAgenda } from "@/hooks/api/use-agenda";
import { useTeachingPersonas } from "@/hooks/api/use-teaching-personas";
import { useI18n, useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import { supportsAssistantSpaceOrganization } from "@xue-learn/core/source/src/shared/runtime/client-runtime.ts";
import {
  layoutGraph,
  type GraphLayout,
  type GraphLayoutEdge,
  type GraphModel,
} from "@xue-learn/core/source/src/shared/domain/graph.ts";
import {
  findMostRecentGoalByLastLearned,
  resolveGoalListContinueTarget,
  type GoalListContinueTarget,
} from "@/shared/domain/last-learned-unit";
import { localizeTeachingPersonaName } from "@/shared/teaching-persona-i18n";
import { cn } from "@xue-learn/core/source/src/shared/utils.ts";

type SpaceContinueBannerModel =
  | {
      source: "agenda";
      href: string;
      unitTitle: string;
      meta: string;
      mode: "continue";
    }
  | {
      source: "last_learned";
      href: string;
      unitTitle: string;
      meta: string;
      mode: GoalListContinueTarget["mode"];
      linkState?: { startNewQuiz: true };
    };

function formatSpaceContinueDate(iso: string, locale: string) {
  return new Date(iso).toLocaleString(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SpaceContinueBanner({ banner }: { banner: SpaceContinueBannerModel }) {
  const t = useT();
  const isReview = banner.mode === "review";

  return (
    <Link
      to={banner.href}
      state={banner.source === "last_learned" ? banner.linkState : undefined}
      className="group flex min-h-14 items-center gap-3 rounded-xl border border-[var(--brand-200)] bg-[var(--brand-50)] px-3 py-2.5 transition hover:border-[var(--brand-300)] sm:px-4"
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-100)] text-[var(--brand-700)]">
        {isReview ? (
          <RotateCcw className="size-4" />
        ) : (
          <BookOpen className="size-4" />
        )}
      </div>
      <div className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-3">
        <p className="truncate text-sm font-semibold text-[var(--text-800)]">
          {banner.unitTitle}
        </p>
        <p className="truncate text-xs text-[var(--text-500)]">{banner.meta}</p>
      </div>
      <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-[var(--brand-700)]">
        {isReview
          ? t("goals.review")
          : banner.source === "agenda"
            ? t("spaces.resume")
            : t("spaces.continue")}{" "}
        <ChevronRight className="size-4 transition group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

type MoveTarget = {
  goalId: string;
  title: string;
  currentSpaceId: string | null;
};
type RemoveTarget = { itemId: string; title: string };
type SpaceContentFilter = "all" | "full" | "micro" | "planned";
type SpaceView = "cards" | "roadmap";

function itemTitle(item: LearningSpaceItem) {
  return item.goal?.title || item.plannedTitle;
}

function unorganizedGoalItem(goal: LearningSpaceGoal): LearningSpaceItem {
  return {
    id: `unorganized:${goal.id}`,
    spaceId: "",
    itemType: "goal",
    goalId: goal.id,
    plannedTitle: "",
    rationale: "",
    suggestedGoalKind: goal.goalKind,
    source: "unorganized",
    sortIndex: 0,
    goal,
  };
}

function SpaceContentCard({
  item,
  progress,
  level,
  pathSource,
  mutationPending,
  onActivate,
  onMove,
  onRemove,
}: {
  item: LearningSpaceItem;
  progress?: number;
  level?: string;
  pathSource?: string;
  mutationPending: boolean;
  onActivate: () => void;
  onMove?: () => void;
  onRemove?: () => void;
}) {
  const t = useT();
  const planned = item.itemType === "planned_goal";
  const completed = !planned && (progress ?? 0) >= 100;
  const title = itemTitle(item);

  return (
    <article className="group flex h-full w-full flex-col rounded-2xl border border-[var(--border-200)] bg-[var(--bg-50)] p-3 shadow-sm transition duration-200 hover:border-[var(--brand-200)] hover:shadow-md sm:p-3.5">
      <div className="flex items-start gap-3">
        {planned ? (
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-dashed border-[var(--brand-200)] bg-[var(--brand-50)] text-[var(--brand-600)]">
            <Sparkles className="size-4" />
          </div>
        ) : (
          <GoalIcon
            title={title}
            iconSvg={item.goal?.iconSvg}
            iconTint={item.goal?.iconTint}
            className="size-10 rounded-xl"
          />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              {planned ? (
                <h3 className="line-clamp-2 break-words text-base font-semibold text-[var(--text-800)]">
                  {title}
                </h3>
              ) : (
                <Link
                  to={`/goals/${item.goalId}`}
                  className="line-clamp-2 break-words text-base font-semibold text-[var(--text-800)] transition-colors hover:text-[var(--brand-600)]"
                >
                  {title}
                </Link>
              )}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge
                  variant={planned ? "outline" : "secondary"}
                  className={cn(
                    "h-5 px-2 text-[10px]",
                    planned &&
                      "border-dashed border-[var(--brand-200)] text-[var(--brand-700)]",
                  )}
                >
                  {planned
                    ? t("spaces.plannedGoal")
                    : t(`spaces.goalKind.${item.goal?.goalKind ?? "full"}`)}
                </Badge>
                {completed ? (
                  <Badge className="h-5 bg-emerald-50 px-2 text-[10px] text-emerald-700 hover:bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-300">
                    {t("spaces.completed")}
                  </Badge>
                ) : null}
              </div>
            </div>

            {planned || item.goalId || onMove || onRemove ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="-mr-2 -mt-2 min-h-10 min-w-10 text-[var(--text-400)]"
                      aria-label={t("spaces.itemActions", { title })}
                      disabled={mutationPending}
                    />
                  }
                >
                  <MoreHorizontal className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-48">
                  {!planned && onMove ? (
                    <DropdownMenuItem onClick={onMove}>
                      <MoveRight /> {t("spaces.moveGoal")}
                    </DropdownMenuItem>
                  ) : null}
                  {planned ? (
                    <DropdownMenuItem onClick={onActivate}>
                      <Sparkles /> {t("spaces.activate")}
                    </DropdownMenuItem>
                  ) : null}
                  {onRemove || (!planned && item.goalId) ? (
                    <>
                      <DropdownMenuSeparator />
                      {onRemove ? (
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={onRemove}
                        >
                          <Trash2 /> {t("spaces.remove")}
                        </DropdownMenuItem>
                      ) : null}
                      {!planned && item.goalId ? (
                        <GoalDeleteButton
                          goalId={item.goalId}
                          goalTitle={title}
                          display="menu-item"
                        />
                      ) : null}
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
      </div>

      {planned ? (
        <p className="mt-2.5 line-clamp-2 pb-1.5 text-sm leading-5 text-[var(--text-400)]">
          {item.rationale || t("spaces.plannedGoalFallback")}
        </p>
      ) : (
        <>
          {level && pathSource ? (
            <p className="mt-2.5 text-xs text-[var(--text-400)]">
              {t(`goals.level.${level}` as never)} ·{" "}
              {t(`goals.pathSource.${pathSource}` as never)}
            </p>
          ) : null}
          <div className="mt-2.5 pb-1.5">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="font-medium text-[var(--text-500)]">
                {completed ? t("spaces.completed") : t("spaces.active")}
              </span>
              <span className="font-semibold text-[var(--brand-600)]">
                {Math.round(progress ?? 0)}%
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-300)]">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  completed ? "bg-emerald-500" : "bg-[var(--brand-500)]",
                )}
                style={{
                  width: `${Math.max(0, Math.min(100, progress ?? 0))}%`,
                }}
              />
            </div>
          </div>
        </>
      )}

      <div className="mt-auto flex min-h-8 justify-end border-t border-[var(--border-100)] pt-1">
        {planned ? (
          <Button
            size="xs"
            variant="ghost"
            className="mt-1"
            onClick={onActivate}
          >
            <Sparkles className="size-3.5" /> {t("spaces.activate")}
          </Button>
        ) : (
          <Link
            to={`/goals/${item.goalId}`}
            className="mt-1 inline-flex h-7 items-center gap-1 rounded-lg px-1.5 text-sm font-medium text-[var(--brand-700)] transition hover:bg-[var(--brand-50)]"
          >
            {t("spaces.openGoal")} <ChevronRight className="size-3.5" />
          </Link>
        )}
      </div>
    </article>
  );
}

const ROADMAP_NODE_WIDTH = 248;
const ROADMAP_NODE_HEIGHT = 164;

function RoadmapGraphNode({
  item,
  progress,
  onActivate,
}: {
  item: LearningSpaceItem;
  progress?: number;
  onActivate: () => void;
}) {
  const t = useT();
  const planned = item.itemType === "planned_goal";
  const completed = !planned && (progress ?? 0) >= 100;
  const title = itemTitle(item);

  return (
    <article
      className={cn(
        "nodrag nopan relative h-full min-w-0 overflow-hidden rounded-xl border bg-[var(--bg-50)] p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md",
        planned
          ? "border-dashed border-[var(--brand-300)]"
          : completed
            ? "border-emerald-200 dark:border-emerald-900"
            : "border-[var(--border-200)]",
      )}
    >
      <div className="flex items-start gap-2.5">
        {planned ? (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-dashed border-[var(--brand-200)] bg-[var(--brand-50)] text-[var(--brand-700)]">
            <Sparkles className="size-3.5" />
          </span>
        ) : completed ? (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500 text-white">
            <Check className="size-3.5" />
          </span>
        ) : (
          <GoalIcon
            title={title}
            iconSvg={item.goal?.iconSvg}
            iconTint={item.goal?.iconTint}
            className="size-8 shrink-0 rounded-lg"
          />
        )}
        <div className="min-w-0 flex-1">
          {planned ? (
            <h3 className="line-clamp-2 text-sm font-semibold leading-[1.25rem] text-[var(--text-800)]">
              {title}
            </h3>
          ) : (
            <Link
              to={`/goals/${item.goalId}`}
              className="nodrag nopan line-clamp-2 text-sm font-semibold leading-[1.25rem] text-[var(--text-850)] hover:text-[var(--brand-700)] hover:underline hover:underline-offset-4"
            >
              {title}
            </Link>
          )}
          <div className="mt-1.5 flex flex-wrap gap-1">
            <Badge
              variant="outline"
              className={cn(
                "h-5 px-2 text-[10px]",
                planned
                  ? "border-[var(--brand-200)] text-[var(--brand-700)]"
                  : completed
                    ? "border-emerald-200 text-emerald-700 dark:border-emerald-900 dark:text-emerald-300"
                    : "text-[var(--text-500)]",
              )}
            >
              {planned
                ? t("spaces.plannedGoal")
                : completed
                  ? t("spaces.completed")
                  : t("spaces.active")}
            </Badge>
            {!planned && item.goal ? (
              <Badge variant="secondary" className="h-5 px-2 text-[10px]">
                {t(`spaces.goalKind.${item.goal.goalKind}`)}
              </Badge>
            ) : null}
          </div>
        </div>
      </div>

      {planned ? (
        <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-[var(--text-400)]">
          {item.rationale || t("spaces.plannedGoalFallback")}
        </p>
      ) : typeof progress === "number" ? (
        <div className="mt-3 flex items-center gap-2">
          <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--bg-200)]">
            <div
              className={cn(
                "h-full rounded-full",
                completed ? "bg-emerald-500" : SPACE_ACCENT_STYLE.line,
              )}
              style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
            />
          </div>
          <span className="text-xs font-medium text-[var(--text-500)]">
            {Math.round(progress)}%
          </span>
        </div>
      ) : null}

      <div className="absolute inset-x-3 bottom-3">
        {planned ? (
          <Button
            size="sm"
            className="nodrag nopan h-8 min-h-8 w-full"
            onClick={onActivate}
          >
            {t("spaces.activate")}
          </Button>
        ) : (
          <Button
            render={<Link to={`/goals/${item.goalId}`} />}
            variant="outline"
            size="sm"
            className="nodrag nopan h-8 min-h-8 w-full"
          >
            {t("spaces.openGoal")} <ChevronRight className="size-3.5" />
          </Button>
        )}
      </div>
    </article>
  );
}

type RoadmapNodeData = {
  item: LearningSpaceItem;
  progress?: number;
  onActivate: () => void;
};

type RoadmapEdgeData = {
  layoutEdge: GraphLayoutEdge;
  relationType: LearningSpaceRelation["relationType"];
};

function RoadmapFlowNode({ data }: NodeProps<Node<RoadmapNodeData>>) {
  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        className="pointer-events-none opacity-0"
        isConnectable={false}
      />
      <RoadmapGraphNode {...data} />
      <Handle
        type="source"
        position={Position.Bottom}
        className="pointer-events-none opacity-0"
        isConnectable={false}
      />
    </>
  );
}

function roadmapEdgePath(points: GraphLayoutEdge["points"]) {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
}

function roadmapEdgeColor(relationType: LearningSpaceRelation["relationType"]) {
  if (relationType === "prerequisite") return "var(--brand-500)";
  if (relationType === "supports") return "rgb(245 158 11)";
  if (relationType === "follow_up") return "rgb(139 92 246)";
  return "var(--text-300)";
}

function RoadmapFlowEdge(props: EdgeProps<Edge<RoadmapEdgeData>>) {
  const data = props.data;
  if (!data) return null;
  return (
    <BaseEdge
      id={props.id}
      path={roadmapEdgePath(data.layoutEdge.points)}
      markerEnd={props.markerEnd}
      interactionWidth={16}
      style={{
        stroke: roadmapEdgeColor(data.relationType),
        strokeWidth: 2,
        strokeDasharray: data.relationType === "related" ? "6 6" : undefined,
        opacity: 0.82,
      }}
    />
  );
}

const roadmapNodeTypes = { roadmap: RoadmapFlowNode };
const roadmapEdgeTypes = { roadmap: RoadmapFlowEdge };

function RoadmapGraph({
  items,
  relations,
  progressByGoalId,
  onActivate,
}: {
  items: LearningSpaceItem[];
  relations: LearningSpaceRelation[];
  progressByGoalId: Map<string, number | undefined>;
  onActivate: (item: LearningSpaceItem) => void;
}) {
  const t = useT();
  const [layout, setLayout] = useState<GraphLayout | null>(null);
  const model = useMemo<GraphModel>(
    () => ({
      variant: "process_flow",
      direction: "TB",
      nodes: items.map((item) => ({
        id: item.id,
        label: itemTitle(item),
        kind: "concept",
      })),
      edges: relations.map((relation) => ({
        id: relation.id,
        from: relation.fromItemId,
        to: relation.toItemId,
        arrow: relation.relationType === "related" ? "none" : "forward",
      })),
    }),
    [items, relations],
  );
  const itemById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  );
  const relationById = useMemo(
    () => new Map(relations.map((relation) => [relation.id, relation])),
    [relations],
  );
  const itemNames = new Map(items.map((item) => [item.id, itemTitle(item)]));

  useEffect(() => {
    let active = true;
    setLayout(null);
    void layoutGraph(model, {
      nodeSize: { width: ROADMAP_NODE_WIDTH, height: ROADMAP_NODE_HEIGHT },
      nodeSpacing: 36,
      layerSpacing: 64,
    }).then((nextLayout) => {
      if (active) setLayout(nextLayout);
    });
    return () => {
      active = false;
    };
  }, [model]);

  const flowNodes = useMemo<Node<RoadmapNodeData>[]>(() => {
    if (!layout) return [];
    return layout.nodes.flatMap((layoutNode) => {
      const item = itemById.get(layoutNode.id);
      if (!item) return [];
      return [
        {
          id: item.id,
          type: "roadmap",
          position: { x: layoutNode.x, y: layoutNode.y },
          // React Flow otherwise disables pointer events for nodes that are
          // intentionally neither selectable nor draggable.
          style: {
            width: layoutNode.width,
            height: layoutNode.height,
            pointerEvents: "all",
          },
          data: {
            item,
            progress: item.goalId
              ? progressByGoalId.get(item.goalId)
              : undefined,
            onActivate: () => onActivate(item),
          },
          draggable: false,
          selectable: false,
        },
      ];
    });
  }, [itemById, layout, onActivate, progressByGoalId]);

  const flowEdges = useMemo<Edge<RoadmapEdgeData>[]>(() => {
    if (!layout) return [];
    return layout.edges.flatMap((layoutEdge) => {
      const relation = relationById.get(layoutEdge.id);
      if (!relation) return [];
      return [
        {
          id: layoutEdge.id,
          source: layoutEdge.from,
          target: layoutEdge.to,
          type: "roadmap",
          data: { layoutEdge, relationType: relation.relationType },
          markerEnd:
            relation.relationType === "related"
              ? undefined
              : `url(#roadmap-arrow-${relation.relationType})`,
        },
      ];
    });
  }, [layout, relationById]);

  return (
    <div className="mt-4">
      <div
        className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-[var(--text-500)] sm:text-xs"
        aria-label={t("spaces.relationships")}
      >
        {(["prerequisite", "supports", "follow_up", "related"] as const).map(
          (relationType) => (
            <span
              key={relationType}
              className="inline-flex items-center gap-1.5"
            >
              <span
                className={cn(
                  "h-0.5 w-4 rounded-full sm:w-5",
                  relationType === "prerequisite" && "bg-[var(--brand-500)]",
                  relationType === "supports" && "bg-amber-500",
                  relationType === "follow_up" && "bg-violet-500",
                  relationType === "related" &&
                    "border-t-2 border-dashed border-[var(--text-300)]",
                )}
              />
              {t(`spaces.relation.${relationType}`)}
            </span>
          ),
        )}
      </div>
      <ul className="sr-only">
        {relations.map((relation) => (
          <li key={relation.id}>
            {itemNames.get(relation.fromItemId) ?? t("spaces.unknownItem")} —{" "}
            {t(`spaces.relation.${relation.relationType}`)} →{" "}
            {itemNames.get(relation.toItemId) ?? t("spaces.unknownItem")}
          </li>
        ))}
      </ul>
      <div className="h-[min(620px,58dvh)] min-h-[360px] overflow-hidden rounded-xl border border-[var(--border-100)] bg-[var(--bg-100)] sm:h-[min(680px,68dvh)] sm:min-h-[440px]">
        {layout ? (
          <ReactFlow
            className="space-roadmap-flow"
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={roadmapNodeTypes}
            edgeTypes={roadmapEdgeTypes}
            fitView
            fitViewOptions={{ padding: 0.08, minZoom: 0.68, maxZoom: 1 }}
            minZoom={0.45}
            maxZoom={1.5}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            zoomOnDoubleClick={false}
            proOptions={{ hideAttribution: true }}
          >
            <svg aria-hidden className="absolute size-0">
              <defs>
                {(["prerequisite", "supports", "follow_up"] as const).map(
                  (relationType) => (
                    <marker
                      key={relationType}
                      id={`roadmap-arrow-${relationType}`}
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="7"
                      markerHeight="7"
                      orient="auto"
                    >
                      <path
                        d="M 0 0 L 10 5 L 0 10 z"
                        fill={roadmapEdgeColor(relationType)}
                      />
                    </marker>
                  ),
                )}
              </defs>
            </svg>
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              size={1}
              color="var(--border-200)"
            />
            <Controls
              className="space-roadmap-controls"
              showInteractive={false}
            />
          </ReactFlow>
        ) : (
          <div className="size-full animate-pulse bg-[var(--bg-200)]/50" />
        )}
      </div>
    </div>
  );
}

export function LearningSpacePage({
  unorganized = false,
}: {
  unorganized?: boolean;
}) {
  const t = useT();
  const { locale } = useI18n();
  const navigate = useNavigate();
  const { spaceId = "" } = useParams();
  const portfolio = useLearningSpaces();
  const goalsQuery = useGoals();
  const agenda = useAgenda(undefined, unorganized ? undefined : spaceId);
  const personas = useTeachingPersonas();
  const { openAssistant, openGoalCreation, openGoalCreationPrompt } =
    useAssistant();
  const assistantOrganizationAvailable = supportsAssistantSpaceOrganization();
  const createRelation = useCreateLearningSpaceRelation();
  const moveGoal = useMoveGoalToLearningSpace();
  const removeItem = useRemoveLearningSpaceItem();
  const updateSpace = useUpdateLearningSpace();
  const deleteSpace = useDeleteLearningSpace();
  const [spaceView, setSpaceView] = useState<SpaceView>("cards");
  const [contentFilter, setContentFilter] = useState<SpaceContentFilter>("all");
  const [identityOpen, setIdentityOpen] = useState(false);
  const [relationOpen, setRelationOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null);
  const [deleteSpaceOpen, setDeleteSpaceOpen] = useState(false);

  const space = unorganized
    ? null
    : portfolio.data?.spaces.find((item) => item.id === spaceId);
  const goalDetails = useMemo(
    () => new Map((goalsQuery.data ?? []).map((goal) => [goal.id, goal])),
    [goalsQuery.data],
  );
  const roadmapProgress = useMemo(
    () =>
      new Map(
        (goalsQuery.data ?? []).map((goal) => [goal.id, goal.progressPercent]),
      ),
    [goalsQuery.data],
  );
  const goalIds = useMemo(() => {
    if (unorganized) {
      return new Set(
        (portfolio.data?.unorganizedGoals ?? []).map((goal) => goal.id),
      );
    }
    return new Set(
      space?.items.flatMap((item) => (item.goalId ? [item.goalId] : [])) ?? [],
    );
  }, [portfolio.data?.unorganizedGoals, space?.items, unorganized]);
  const spaceGoals = useMemo(
    () => (goalsQuery.data ?? []).filter((goal) => goalIds.has(goal.id)),
    [goalIds, goalsQuery.data],
  );
  const continueBanner = useMemo((): SpaceContinueBannerModel | null => {
    const agendaContinue =
      agenda.data?.continueItem &&
      goalIds.has(agenda.data.continueItem.goalId)
        ? agenda.data.continueItem
        : null;
    if (agendaContinue) {
      return {
        source: "agenda",
        href: agendaContinue.navigationTarget,
        unitTitle: agendaContinue.unitTitle,
        meta: `${agendaContinue.goalTitle} · ${t("spaces.minutes", {
          count: agendaContinue.estimatedMinutes,
        })}`,
        mode: "continue",
      };
    }

    const recent = findMostRecentGoalByLastLearned(spaceGoals);
    if (!recent) return null;
    const target = resolveGoalListContinueTarget(recent);
    if (!target) return null;

    const displayUnitTitle =
      recent.lastLearnedUnit?.title ?? target.unitTitle;
    const learnedMeta = target.learnedAt
      ? formatSpaceContinueDate(target.learnedAt, locale)
      : t("goals.lastLearned");
    return {
      source: "last_learned",
      href: target.href,
      unitTitle: displayUnitTitle,
      meta: `${target.goalTitle} · ${learnedMeta}`,
      mode: target.mode,
      linkState: target.mode === "review" ? { startNewQuiz: true } : undefined,
    };
  }, [agenda.data?.continueItem, goalIds, locale, spaceGoals, t]);
  const teacherName = localizeTeachingPersonaName(personas.data?.current, t);
  const pending = moveGoal.isPending || removeItem.isPending;

  if (!unorganized && !portfolio.isPending && !space)
    return <Navigate to="/spaces" replace />;

  if (portfolio.isPending) {
    return (
      <div className="space-y-6" aria-label={t("spaces.loading")}>
        <div className="h-40 animate-pulse rounded-3xl bg-[var(--bg-200)]" />
        <div className="h-72 animate-pulse rounded-3xl bg-[var(--bg-200)]" />
      </div>
    );
  }

  if (portfolio.error) return <ApiErrorNotice error={portfolio.error} />;

  if (unorganized) {
    const unorganizedGoals = portfolio.data?.unorganizedGoals ?? [];
    const defaultFilter = contentFilter === "planned" ? "all" : contentFilter;
    const filteredUnorganizedGoals = unorganizedGoals.filter(
      (goal) => defaultFilter === "all" || goal.goalKind === defaultFilter,
    );
    const defaultFilters = [
      {
        key: "all" as const,
        label: t("spaces.filterAll"),
        count: unorganizedGoals.length,
      },
      {
        key: "full" as const,
        label: t("spaces.filterGoals"),
        count: unorganizedGoals.filter((goal) => goal.goalKind === "full")
          .length,
      },
      {
        key: "micro" as const,
        label: t("spaces.filterMicro"),
        count: unorganizedGoals.filter((goal) => goal.goalKind === "micro")
          .length,
      },
    ];
    return (
      <div className="space-y-5 sm:space-y-6">
        <header className="rounded-2xl border border-[var(--border-200)] bg-[var(--bg-50)] p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--bg-200)] text-[var(--text-500)]">
                <Folder className="size-4" />
              </div>
              <div className="min-w-0">
                <h1 className="text-2xl font-bold tracking-tight text-[var(--text-900)]">
                  {t("spaces.unorganized")}
                </h1>
                <p className="mt-1 max-w-2xl text-sm leading-5 text-[var(--text-500)]">
                  {t("spaces.unorganizedTriageDescription")}
                </p>
              </div>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row-reverse">
              <Button
                className="min-h-11 w-full sm:min-h-9 sm:w-auto"
                onClick={() => openGoalCreationPrompt()}
              >
                <Plus className="size-4" /> {t("spaces.newGoal")}
              </Button>
              {assistantOrganizationAvailable ? (
                <Button
                  variant="outline"
                  className="min-h-11 w-full sm:min-h-9 sm:w-auto"
                  onClick={() =>
                    openAssistant(
                      t("spaces.organizePrompt", {
                        name: t("spaces.unorganized"),
                      }),
                    )
                  }
                >
                  <Sparkles className="size-4" />{" "}
                  {t("spaces.askAssistant", { name: teacherName })}
                </Button>
              ) : null}
            </div>
          </div>
        </header>

        {continueBanner ? <SpaceContinueBanner banner={continueBanner} /> : null}

        <section aria-labelledby="inbox-heading">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2
                id="inbox-heading"
                className="text-lg font-semibold text-[var(--text-850)]"
              >
                {t("spaces.goalsToOrganize", {
                  count: unorganizedGoals.length,
                })}
              </h2>
              <p className="mt-1 text-sm text-[var(--text-400)]">
                {t("spaces.goalsToOrganizeHint")}
              </p>
            </div>
            {!portfolio.data?.spaces.length ? (
              <Link
                to="/spaces?create=1"
                className={cn(
                  buttonVariants({ variant: "default" }),
                  "min-h-11",
                )}
              >
                <Plus /> {t("spaces.new")}
              </Link>
            ) : null}
          </div>

          {unorganizedGoals.length ? (
            <>
              <div
                className="mb-4 flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-[var(--border-200)] bg-[var(--bg-200)] p-1"
                aria-label={t("spaces.contentFilters")}
              >
                {defaultFilters.map((filter) => (
                  <button
                    key={filter.key}
                    type="button"
                    className={cn(
                      "flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-all",
                      defaultFilter === filter.key
                        ? "bg-[var(--bg-50)] text-[var(--text-800)] shadow-[var(--shadow-xs)]"
                        : "text-[var(--text-400)] hover:text-[var(--text-600)]",
                    )}
                    aria-pressed={defaultFilter === filter.key}
                    onClick={() => setContentFilter(filter.key)}
                  >
                    {filter.label}
                    <span className="text-xs text-[var(--text-400)]">
                      {filter.count}
                    </span>
                  </button>
                ))}
              </div>

              {filteredUnorganizedGoals.length ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {filteredUnorganizedGoals.map((goal) => {
                    const detail = goalDetails.get(goal.id);
                    return (
                      <SpaceContentCard
                        key={goal.id}
                        item={unorganizedGoalItem(goal)}
                        progress={detail?.progressPercent}
                        level={detail?.level}
                        pathSource={detail?.pathSource}
                        mutationPending={moveGoal.isPending}
                        onActivate={() => undefined}
                        onMove={
                          portfolio.data?.spaces.length
                            ? () =>
                                setMoveTarget({
                                  goalId: goal.id,
                                  title: goal.title,
                                  currentSpaceId: null,
                                })
                            : undefined
                        }
                      />
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-2xl border border-[var(--border-200)] bg-[var(--bg-50)] px-6 py-10 text-center text-sm text-[var(--text-500)]">
                  {t("spaces.emptyFilter")}
                </div>
              )}
            </>
          ) : (
            <div className="rounded-3xl border border-dashed border-[var(--border-200)] bg-[var(--bg-50)] px-6 py-12 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-300">
                <Check className="size-5" />
              </div>
              <h3 className="mt-4 font-semibold text-[var(--text-800)]">
                {t("spaces.inboxClearTitle")}
              </h3>
              <p className="mt-1 text-sm text-[var(--text-400)]">
                {t("spaces.inboxClearDescription")}
              </p>
              <Link
                to="/spaces"
                className={cn(
                  buttonVariants({ variant: "outline" }),
                  "mt-5 min-h-11",
                )}
              >
                {t("spaces.backToSpaces")}
              </Link>
            </div>
          )}

          {!portfolio.data?.spaces.length && unorganizedGoals.length ? (
            <div className="mt-4 rounded-2xl border border-[var(--brand-200)] bg-[var(--brand-50)] p-4 text-sm text-[var(--brand-800)] sm:flex sm:items-center sm:justify-between sm:gap-4">
              <div>
                <p className="font-semibold">
                  {t("spaces.createBeforeOrganizingTitle")}
                </p>
                <p className="mt-1 text-[var(--brand-700)]">
                  {t("spaces.createBeforeOrganizingDescription")}
                </p>
              </div>
              <Link
                to="/spaces?create=1"
                className={cn(
                  buttonVariants({ variant: "default" }),
                  "mt-3 min-h-11 sm:mt-0",
                )}
              >
                <Plus /> {t("spaces.new")}
              </Link>
            </div>
          ) : null}
        </section>

        <MoveGoalDialog
          open={Boolean(moveTarget)}
          goalTitle={moveTarget?.title ?? ""}
          spaces={portfolio.data?.spaces ?? []}
          currentSpaceId={moveTarget?.currentSpaceId ?? null}
          pending={moveGoal.isPending}
          error={moveGoal.error}
          onOpenChange={(open) => {
            if (!open) setMoveTarget(null);
          }}
          onMove={async (targetSpaceId) => {
            if (!moveTarget) return;
            await moveGoal.mutateAsync({
              goalId: moveTarget.goalId,
              spaceId: targetSpaceId,
            });
            setMoveTarget(null);
          }}
        />
      </div>
    );
  }

  if (!space) return null;

  const realGoalCount = space.items.filter((item) => item.goalId).length;
  const plannedCount = space.items.filter(
    (item) => item.itemType === "planned_goal",
  ).length;
  const fullGoalCount = space.items.filter(
    (item) => item.goal?.goalKind === "full",
  ).length;
  const microGoalCount = space.items.filter(
    (item) => item.goal?.goalKind === "micro",
  ).length;
  const filteredItems = space.items.filter((item) => {
    if (contentFilter === "all") return true;
    if (contentFilter === "planned") return item.itemType === "planned_goal";
    return item.itemType === "goal" && item.goal?.goalKind === contentFilter;
  });
  const contentFilters = [
    {
      key: "all" as const,
      label: t("spaces.filterAll"),
      count: space.items.length,
    },
    {
      key: "full" as const,
      label: t("spaces.filterGoals"),
      count: fullGoalCount,
    },
    {
      key: "micro" as const,
      label: t("spaces.filterMicro"),
      count: microGoalCount,
    },
    {
      key: "planned" as const,
      label: t("spaces.filterPlanned"),
      count: plannedCount,
    },
  ];

  return (
    <div className="space-y-5 sm:space-y-6">
      <header className="relative overflow-hidden rounded-2xl border border-[var(--border-200)] bg-[var(--bg-50)] p-4 sm:p-5">
        <span
          className={cn(
            "absolute inset-y-0 left-0 w-1",
            SPACE_ACCENT_STYLE.line,
          )}
        />
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-xl",
                SPACE_ACCENT_STYLE.soft,
                SPACE_ACCENT_STYLE.text,
              )}
            >
              <GitBranch className="size-4" />
            </div>
            <div className="min-w-0">
              <p
                className={cn(
                  "text-[11px] font-semibold uppercase tracking-wider",
                  SPACE_ACCENT_STYLE.text,
                )}
              >
                {t("spaces.space")}
              </p>
              <h1 className="mt-0.5 break-words text-2xl font-bold tracking-tight text-[var(--text-900)]">
                {space.name}
              </h1>
              <p className="mt-1 max-w-3xl text-sm leading-5 text-[var(--text-500)]">
                {space.purpose || t("spaces.addPurposeSuggestion")}
              </p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-400)]">
                <span>{t("spaces.goalsCount", { count: realGoalCount })}</span>
                <span>{t("spaces.plannedCount", { count: plannedCount })}</span>
                {space.relations.length ? (
                  <span>
                    {t("spaces.relationsCount", {
                      count: space.relations.length,
                    })}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 lg:shrink-0 lg:flex-nowrap lg:justify-end">
            <Button
              variant="outline"
              className="min-h-9 flex-1 sm:flex-none"
              onClick={() => setIdentityOpen(true)}
            >
              <Settings2 className="size-4" /> {t("spaces.settingsAction")}
            </Button>
            <Button
              className="min-h-9 flex-1 sm:flex-none"
              onClick={() =>
                openGoalCreationPrompt(undefined, {
                  targetSpaceId: space.id,
                })
              }
            >
              <Plus className="size-4" /> {t("spaces.newGoal")}
            </Button>
          </div>
        </div>
      </header>

      {continueBanner ? <SpaceContinueBanner banner={continueBanner} /> : null}

      {spaceView === "cards" || space.items.length === 0 ? (
        <section aria-labelledby="space-content-heading">
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 sm:flex sm:items-baseline sm:gap-3">
              <h2
                id="space-content-heading"
                className="shrink-0 text-lg font-semibold text-[var(--text-850)]"
              >
                {t("spaces.contents")}
              </h2>
              <p className="mt-0.5 truncate text-sm text-[var(--text-400)] sm:mt-0">
                {t("spaces.contentsDescription")}
              </p>
            </div>
            {space.items.length ? (
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                {space.items.length >= 2 ? (
                  <Button
                    variant="outline"
                    className="min-h-9 w-full sm:w-auto"
                    onClick={() => setRelationOpen(true)}
                  >
                    <GitBranch className="size-4" /> {t("spaces.addRelation")}
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  className="min-h-9 w-full sm:w-auto"
                  onClick={() => setSpaceView("roadmap")}
                >
                  <GitBranch className="size-4" /> {t("spaces.viewRoadmap")}
                </Button>
              </div>
            ) : null}
          </div>

          {space.items.length ? (
            <div
              className="mb-4 flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-[var(--border-200)] bg-[var(--bg-200)] p-1"
              aria-label={t("spaces.contentFilters")}
            >
              {contentFilters.map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  className={cn(
                    "flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-all",
                    contentFilter === filter.key
                      ? "bg-[var(--bg-50)] text-[var(--text-800)] shadow-[var(--shadow-xs)]"
                      : "text-[var(--text-400)] hover:text-[var(--text-600)]",
                  )}
                  aria-pressed={contentFilter === filter.key}
                  onClick={() => setContentFilter(filter.key)}
                >
                  {filter.label}
                  <span className="text-xs text-[var(--text-400)]">
                    {filter.count}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {space.items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--border-200)] bg-[var(--bg-50)] p-5 sm:p-6">
              <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--brand-50)] text-[var(--brand-600)]">
                  <Folder className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-[var(--text-800)]">
                    {t("spaces.emptyContentsTitle")}
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-[var(--text-400)]">
                    {t("spaces.emptyContentsDescription")}
                  </p>
                </div>
                <Button
                  className="min-h-11 w-full shrink-0 sm:w-auto"
                  onClick={() =>
                    openGoalCreationPrompt(undefined, {
                      targetSpaceId: space.id,
                    })
                  }
                >
                  <Plus className="size-4" /> {t("spaces.newGoal")}
                </Button>
              </div>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="rounded-2xl border border-[var(--border-200)] bg-[var(--bg-50)] px-6 py-12 text-center text-sm text-[var(--text-500)]">
              {t("spaces.emptyFilter")}
            </div>
          ) : (
            <div className="grid items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filteredItems.map((item) => {
                const detail = item.goalId
                  ? goalDetails.get(item.goalId)
                  : null;
                return (
                  <SpaceContentCard
                    key={item.id}
                    item={item}
                    progress={detail?.progressPercent}
                    level={detail?.level}
                    pathSource={detail?.pathSource}
                    mutationPending={pending}
                    onActivate={() =>
                      openGoalCreation({
                        topic: item.plannedTitle,
                        files: [],
                        urls: [],
                        goalDraft: {
                          topic: item.plannedTitle,
                          targetSpaceId: space.id,
                          targetSpaceItemId: item.id,
                        },
                      })
                    }
                    onMove={() =>
                      item.goalId &&
                      setMoveTarget({
                        goalId: item.goalId,
                        title: itemTitle(item),
                        currentSpaceId: space.id,
                      })
                    }
                    onRemove={() =>
                      setRemoveTarget({
                        itemId: item.id,
                        title: itemTitle(item),
                      })
                    }
                  />
                );
              })}
            </div>
          )}
        </section>
      ) : (
        <section
          aria-labelledby="roadmap-heading"
          className="rounded-2xl border border-[var(--border-200)] bg-[var(--bg-50)] p-3 sm:p-5"
        >
          <div className="flex flex-col gap-3 border-b border-[var(--border-100)] pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <CircleDot
                  className={cn("size-4.5", SPACE_ACCENT_STYLE.text)}
                />
                <h2
                  id="roadmap-heading"
                  className="text-lg font-semibold text-[var(--text-850)]"
                >
                  {t("spaces.roadmap")}
                </h2>
              </div>
              <p className="mt-1 text-xs leading-5 text-[var(--text-400)] sm:text-sm">
                {t("spaces.roadmapDescription")}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <Button
                variant="ghost"
                size="sm"
                className="min-w-0"
                onClick={() => setSpaceView("cards")}
              >
                <LayoutGrid /> {t("spaces.backToContents")}
              </Button>
              {space.items.length >= 2 ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="min-w-0"
                  onClick={() => setRelationOpen(true)}
                >
                  <GitBranch /> {t("spaces.addRelation")}
                </Button>
              ) : null}
              {assistantOrganizationAvailable ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="min-w-0"
                  onClick={() =>
                    openAssistant(
                      t("spaces.organizePrompt", { name: space.name }),
                    )
                  }
                >
                  <Sparkles />
                  {t("spaces.askAssistant", { name: teacherName })}
                </Button>
              ) : null}
            </div>
          </div>

          {space.items.length ? (
            <RoadmapGraph
              items={space.items}
              relations={space.relations}
              progressByGoalId={roadmapProgress}
              onActivate={(item) =>
                openGoalCreation({
                  topic: item.plannedTitle,
                  files: [],
                  urls: [],
                  goalDraft: {
                    topic: item.plannedTitle,
                    targetSpaceId: space.id,
                    targetSpaceItemId: item.id,
                  },
                })
              }
            />
          ) : (
            <div className="px-4 py-12 text-center sm:py-16">
              <EmptyRoadmapIllustration />
              <h3 className="mt-5 font-semibold text-[var(--text-800)]">
                {t("spaces.emptyRoadmapTitle")}
              </h3>
              <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-[var(--text-400)]">
                {t("spaces.emptyRoadmapDescription")}
              </p>
              <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
                <Button
                  className="min-h-11"
                  onClick={() =>
                    openGoalCreationPrompt(undefined, {
                      targetSpaceId: space.id,
                    })
                  }
                >
                  <Plus /> {t("spaces.newGoal")}
                </Button>
                {assistantOrganizationAvailable ? (
                  <Button
                    variant="outline"
                    className="min-h-11"
                    onClick={() =>
                      openAssistant(
                        t("spaces.organizePrompt", { name: space.name }),
                      )
                    }
                  >
                    <Sparkles />
                    {t("spaces.askAssistant", { name: teacherName })}
                  </Button>
                ) : null}
              </div>
            </div>
          )}
        </section>
      )}

      <RelationDialog
        open={relationOpen}
        items={space.items}
        pending={createRelation.isPending}
        error={createRelation.error}
        onOpenChange={setRelationOpen}
        onSubmit={async (value) => {
          await createRelation.mutateAsync({
            spaceId: space.id,
            ...value,
          });
          setRelationOpen(false);
        }}
      />
      <SpaceIdentityDialog
        open={identityOpen}
        mode="edit"
        initial={space}
        pending={updateSpace.isPending || deleteSpace.isPending}
        error={updateSpace.error}
        onOpenChange={setIdentityOpen}
        onSubmit={async (value) => {
          await updateSpace.mutateAsync({ spaceId: space.id, ...value });
          setIdentityOpen(false);
        }}
        onDelete={() => {
          setIdentityOpen(false);
          setDeleteSpaceOpen(true);
        }}
      />
      <MoveGoalDialog
        open={Boolean(moveTarget)}
        goalTitle={moveTarget?.title ?? ""}
        spaces={portfolio.data?.spaces ?? []}
        currentSpaceId={moveTarget?.currentSpaceId ?? null}
        pending={moveGoal.isPending}
        error={moveGoal.error}
        onOpenChange={(open) => {
          if (!open) setMoveTarget(null);
        }}
        onMove={async (targetSpaceId) => {
          if (!moveTarget) return;
          await moveGoal.mutateAsync({
            goalId: moveTarget.goalId,
            spaceId: targetSpaceId,
          });
          setMoveTarget(null);
        }}
      />
      <ConfirmActionDialog
        open={Boolean(removeTarget)}
        title={t("spaces.removeConfirmTitle")}
        description={t("spaces.removeConfirmDescription", {
          title: removeTarget?.title ?? "",
        })}
        pending={removeItem.isPending}
        confirmLabel={t("spaces.remove")}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        onConfirm={async () => {
          if (!removeTarget) return;
          await removeItem.mutateAsync(removeTarget.itemId);
          setRemoveTarget(null);
        }}
      />
      <ConfirmActionDialog
        open={deleteSpaceOpen}
        title={t("spaces.deleteConfirmTitle")}
        description={t("spaces.deleteConfirm", { name: space.name })}
        pending={deleteSpace.isPending}
        confirmLabel={t("spaces.delete")}
        onOpenChange={setDeleteSpaceOpen}
        onConfirm={async () => {
          await deleteSpace.mutateAsync(space.id);
          setDeleteSpaceOpen(false);
          navigate("/spaces");
        }}
      />
    </div>
  );
}
