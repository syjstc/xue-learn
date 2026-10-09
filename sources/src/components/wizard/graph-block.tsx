"use client";

import "@xyflow/react/dist/style.css";

import {
  BaseEdge,
  Background,
  BackgroundVariant,
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
import ReactMarkdown from "react-markdown";
import type { InteractiveBlock } from "../../shared/llm/schemas.js";
import {
  graphAccessibilityLabel,
  graphModelFromBlock,
  graphOrthogonalPath,
  graphRelations,
  layoutGraph,
  parseMermaidFlowchart,
  type GraphDirection,
  type GraphLayout,
  type GraphLayoutEdge,
  type GraphLayoutNode,
  type GraphModel,
} from "../../shared/domain/graph.js";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet.js";
import { cn } from "../../shared/utils.js";
import { useT } from "../../shared/i18n/index.js";
import { MaterialVisualFrame } from "./interactive-material/material-visual-frame.js";

type GraphNodeData = {
  graphNode: GraphLayoutNode;
  direction: GraphDirection;
  selected: boolean;
  dimmed: boolean;
  onSelect: (id: string) => void;
};
type GraphEdgeData = { layoutEdge: GraphLayoutEdge; dimmed: boolean };

function nodeHandles(direction: GraphDirection) {
  if (direction === "TB") {
    return {
      target: Position.Top,
      source: Position.Bottom,
    };
  }
  return {
    target: Position.Left,
    source: Position.Right,
  };
}

function CourseGraphNode({ data }: NodeProps<Node<GraphNodeData>>) {
  const node = data.graphNode;
  const handles = nodeHandles(data.direction);
  const diamondPoints = `${node.width / 2},1.5 ${node.width - 1.5},${node.height / 2} ${node.width / 2},${node.height - 1.5} 1.5,${node.height / 2}`;
  return (
    <>
      <Handle type="target" position={handles.target} className="opacity-0" />
      <button
        type="button"
        className={cn(
          "nodrag nopan relative flex size-full items-center justify-center px-3 text-center text-xs leading-4 text-[var(--course-content)] transition",
          node.kind !== "decision" &&
            "border bg-[var(--course-content-surface)] shadow-sm",
          (node.kind === "start" || node.kind === "end") && "rounded-full",
          node.kind !== "decision" &&
            node.kind !== "start" &&
            node.kind !== "end" &&
            "rounded-lg",
          node.kind === "decision" && "border-0 bg-transparent shadow-none",
          node.emphasis === "primary" &&
            node.kind !== "decision" &&
            "border-primary bg-primary/10 font-semibold",
          data.selected && "ring-2 ring-primary ring-offset-2",
          data.dimmed && "opacity-30",
        )}
        aria-label={`${node.label}${node.description ? `: ${node.description}` : ""}`}
        aria-pressed={data.selected}
        onClick={() => data.onSelect(node.id)}
      >
        {node.kind === "decision" ? (
          <svg
            aria-hidden
            className="absolute inset-0 size-full overflow-visible"
            viewBox={`0 0 ${node.width} ${node.height}`}
          >
            <polygon
              points={diamondPoints}
              fill={
                node.emphasis === "primary"
                  ? "color-mix(in oklab, var(--primary) 12%, var(--course-content-surface))"
                  : "var(--course-content-surface)"
              }
              stroke={
                node.emphasis === "primary"
                  ? "var(--primary)"
                  : "var(--course-content-border-accent)"
              }
              strokeWidth={node.emphasis === "primary" ? 2.4 : 1.8}
            />
          </svg>
        ) : null}
        <span className="relative z-10">
          {node.labelLines.map((line, index) => (
            <span className="block" key={`${node.id}-${index}`}>
              {line}
            </span>
          ))}
        </span>
      </button>
      <Handle type="source" position={handles.source} className="opacity-0" />
    </>
  );
}

function CourseGraphGroup({ data }: NodeProps<Node<{ label: string }>>) {
  return (
    <div className="size-full rounded-xl border border-dashed border-[var(--course-content-border-accent)] bg-[var(--course-content-surface-muted)]/40">
      <span className="absolute left-3 top-2 text-[11px] font-semibold text-[var(--course-content-muted)]">
        {data.label}
      </span>
    </div>
  );
}

function CourseGraphEdge(props: EdgeProps<Edge<GraphEdgeData>>) {
  const edge = props.data?.layoutEdge;
  if (!edge) return null;
  return (
    <>
      <BaseEdge
        id={props.id}
        path={graphOrthogonalPath(edge.points)}
        markerStart={props.markerStart}
        markerEnd={props.markerEnd}
        style={{
          stroke: "var(--course-content-border-accent)",
          strokeWidth: 2,
          opacity: props.data?.dimmed ? 0.2 : 1,
        }}
      />
      {edge.label && edge.labelPoint ? (
        <foreignObject
          x={edge.labelPoint.x - 45}
          y={edge.labelPoint.y - 13}
          width={90}
          height={26}
          className={props.data?.dimmed ? "opacity-20" : undefined}
        >
          <div className="mx-auto w-fit max-w-[88px] rounded bg-[var(--course-content-surface)] px-1.5 py-0.5 text-center text-[10px] text-[var(--course-content-muted)]">
            {edge.label}
          </div>
        </foreignObject>
      ) : null}
    </>
  );
}

const nodeTypes = {
  courseGraph: CourseGraphNode,
  courseGraphGroup: CourseGraphGroup,
};
const edgeTypes = { courseGraph: CourseGraphEdge };

function useGraphLayout(model: GraphModel) {
  const [layout, setLayout] = useState<GraphLayout | null>(null);
  useEffect(() => {
    let active = true;
    setLayout(null);
    void layoutGraph(model).then((next) => active && setLayout(next));
    return () => {
      active = false;
    };
  }, [model]);
  return layout;
}

function GraphCanvas({
  model,
  className,
}: {
  model: GraphModel;
  className?: string;
}) {
  const t = useT();
  const layout = useGraphLayout(model);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedNode =
    model.nodes.find((node) => node.id === selectedId) ?? null;
  const connectedIds = useMemo(() => {
    if (!selectedId) return new Set<string>();
    const ids = new Set([selectedId]);
    model.edges.forEach((edge) => {
      if (edge.from === selectedId) ids.add(edge.to);
      if (edge.to === selectedId) ids.add(edge.from);
    });
    return ids;
  }, [model.edges, selectedId]);
  const relations = selectedId ? graphRelations(model, selectedId) : null;

  const flowNodes = useMemo<Node[]>(() => {
    if (!layout) return [];
    const groups: Node[] = layout.groups.map((group) => ({
      id: `group:${group.id}`,
      type: "courseGraphGroup",
      position: { x: group.x, y: group.y },
      style: { width: group.width, height: group.height, zIndex: 0 },
      data: { label: group.label },
      selectable: false,
      draggable: false,
    }));
    return [
      ...groups,
      ...layout.nodes.map((node): Node<GraphNodeData> => ({
        id: node.id,
        type: "courseGraph",
        position: { x: node.x, y: node.y },
        style: { width: node.width, height: node.height, zIndex: 2 },
        data: {
          graphNode: node,
          direction: layout.direction,
          selected: selectedId === node.id,
          dimmed: Boolean(selectedId && !connectedIds.has(node.id)),
          onSelect: setSelectedId,
        },
        selectable: false,
        draggable: false,
      })),
    ];
  }, [connectedIds, layout, selectedId]);

  const flowEdges = useMemo<Edge[]>(() => {
    if (!layout) return [];
    return layout.edges.map((edge) => {
      const active =
        !selectedId || edge.from === selectedId || edge.to === selectedId;
      return {
        id: edge.id,
        source: edge.from,
        target: edge.to,
        type: "courseGraph",
        data: { layoutEdge: edge, dimmed: !active },
        markerStart:
          edge.arrow === "backward" || edge.arrow === "both"
            ? "url(#course-graph-arrow-start)"
            : undefined,
        markerEnd:
          edge.arrow === "forward" || edge.arrow === "both"
            ? "url(#course-graph-arrow-end)"
            : undefined,
      };
    });
  }, [layout, selectedId]);

  if (!layout) {
    return (
      <div className="h-[360px] animate-pulse rounded-lg bg-[var(--course-content-surface-muted)]" />
    );
  }
  if (!layout.nodes.length) {
    return (
      <ul className="space-y-2 text-sm">
        {model.nodes.map((node) => (
          <li key={node.id}>• {node.label}</li>
        ))}
      </ul>
    );
  }

  return (
    <>
      <p className="sr-only">{graphAccessibilityLabel(model)}</p>
      <div
        className={cn(
          "h-[min(520px,62vh)] min-h-[340px] overflow-hidden rounded-lg border",
          className,
        )}
      >
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodeClick={(_, node) => {
            if (!node.id.startsWith("group:")) setSelectedId(node.id);
          }}
          fitView
          fitViewOptions={{ padding: 0.16, minZoom: 0.35, maxZoom: 1.25 }}
          minZoom={0.25}
          maxZoom={2}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          proOptions={{ hideAttribution: true }}
        >
          <svg aria-hidden className="absolute size-0">
            <defs>
              <marker
                id="course-graph-arrow-end"
                markerWidth="8"
                markerHeight="8"
                refX="6"
                refY="3"
                orient="auto"
              >
                <path
                  d="M0,0 L6,3 L0,6 Z"
                  fill="var(--course-content-border-accent)"
                />
              </marker>
              <marker
                id="course-graph-arrow-start"
                markerWidth="8"
                markerHeight="8"
                refX="0"
                refY="3"
                orient="auto"
              >
                <path
                  d="M6,0 L0,3 L6,6 Z"
                  fill="var(--course-content-border-accent)"
                />
              </marker>
            </defs>
          </svg>
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <Sheet
        open={Boolean(selectedNode)}
        onOpenChange={(open) => !open && setSelectedId(null)}
      >
        <SheetContent className="overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{selectedNode?.label}</SheetTitle>
            <SheetDescription>
              {selectedNode?.description ||
                t("wizard.graph.nodeDescriptionFallback")}
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-5 px-4 pb-6 text-sm">
            <RelationList
              title={t("wizard.graph.incoming")}
              items={relations?.incoming ?? []}
            />
            <RelationList
              title={t("wizard.graph.outgoing")}
              items={relations?.outgoing ?? []}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function RelationList({
  title,
  items,
}: {
  title: string;
  items: Array<{ id: string; nodeLabel: string; label?: string }>;
}) {
  const t = useT();
  return (
    <section>
      <h4 className="mb-2 font-semibold">{title}</h4>
      {items.length ? (
        <ul className="space-y-2">
          {items.map((item) => (
            <li className="rounded-lg bg-muted px-3 py-2" key={item.id}>
              {item.nodeLabel}
              {item.label ? ` · ${item.label}` : ""}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">{t("wizard.graph.noRelations")}</p>
      )}
    </section>
  );
}

export function GraphBlock({
  block,
  compact,
}: {
  block: Extract<InteractiveBlock, { type: "graph" }>;
  compact?: boolean;
}) {
  const t = useT();
  const [isExpanded, setIsExpanded] = useState(false);
  const model = useMemo(() => graphModelFromBlock(block), [block]);
  return (
    <MaterialVisualFrame
      title={block.title}
      caption={
        block.caption ? (
          <ReactMarkdown skipHtml>{block.caption}</ReactMarkdown>
        ) : undefined
      }
      compact={compact}
      expanded={isExpanded}
      expandedContent={
        <GraphCanvas
          model={model}
          className="min-h-0 flex-1 rounded-none border-0"
        />
      }
      fullscreenLabel={t("wizard.material.mathScene.fullscreen")}
      onExpandedChange={setIsExpanded}
      onOpenFullscreen={() => setIsExpanded(true)}
    >
      <GraphCanvas model={model} className={cn(compact && "min-h-[300px]")} />
    </MaterialVisualFrame>
  );
}

export function GraphFromMarkdown({
  code,
  className,
}: {
  code: string;
  className?: string;
}) {
  const model = useMemo(() => parseMermaidFlowchart(code), [code]);
  if (!model)
    return (
      <pre className="mt-2 overflow-x-auto rounded-lg border p-3 text-xs">
        <code>{code}</code>
      </pre>
    );
  return (
    <div className={cn("mt-2 rounded-lg", className)}>
      <GraphCanvas model={model} />
    </div>
  );
}
