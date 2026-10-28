import type { ElkExtendedEdge, ElkNode, ElkPoint } from "elkjs/lib/elk-api.js";
import { elk } from "./graph-elk-runtime.js";

export type GraphVariant =
  | "process_flow"
  | "concept_map";
export type GraphDirection = "LR" | "TB" | "RADIAL";
export type GraphNodeKind =
  | "process"
  | "decision"
  | "start"
  | "end"
  | "io"
  | "concept"
  | "system"
  | "source"
  | "outcome";
export type GraphArrow = "forward" | "backward" | "both" | "none";

export type GraphNode = {
  id: string;
  label: string;
  description?: string;
  kind: GraphNodeKind;
  groupId?: string;
  emphasis?: "primary" | "normal";
};
export type GraphEdge = {
  id: string;
  from: string;
  to: string;
  label?: string;
  arrow?: GraphArrow;
};
export type GraphGroup = { id: string; label: string; description?: string };
export type GraphModel = {
  variant: GraphVariant;
  direction: GraphDirection;
  nodes: GraphNode[];
  edges: GraphEdge[];
  groups?: GraphGroup[];
  title?: string;
  caption?: string;
};

export type GraphPoint = { x: number; y: number };
export type GraphLayoutNode = GraphNode & {
  x: number;
  y: number;
  width: number;
  height: number;
  labelLines: string[];
};
export type GraphLayoutEdge = GraphEdge & {
  points: GraphPoint[];
  arrow: GraphArrow;
  labelPoint?: GraphPoint;
};
export type GraphLayoutGroup = GraphGroup & {
  x: number;
  y: number;
  width: number;
  height: number;
};
export type GraphLayout = {
  width: number;
  height: number;
  nodes: GraphLayoutNode[];
  edges: GraphLayoutEdge[];
  groups: GraphLayoutGroup[];
  direction: GraphDirection;
  usedFallback: boolean;
};

export type GraphLayoutOptions = {
  nodeSize?: { width: number; height: number };
  nodeSpacing?: number;
  layerSpacing?: number;
};

const PAD = 32;
const GROUP_PAD = 42;
const NODE_MIN_WIDTH = 120;
const NODE_MAX_WIDTH = 228;
const DECISION_MAX_SIZE = 280;
const TEXT_LINE_HEIGHT = 17;
const MAX_LABEL_LINES = 4;
const EDGE_LABEL_MAX_WIDTH = 96;
const NODE_GAP = 16;
const layoutCache = new Map<string, Promise<GraphLayout>>();

function estimateTextWidth(value: string): number {
  return Array.from(value).reduce(
    (width, char) => width + (/[^\u0000-\u00ff]/.test(char) ? 14 : 8),
    0,
  );
}

export function wrapGraphLabel(value: string, maxWidth = NODE_MAX_WIDTH - 30) {
  const result: string[] = [];
  for (const rawLine of value.replace(/\\n/g, "\n").split("\n")) {
    let line = "";
    for (const char of Array.from(rawLine.trim())) {
      if (line && estimateTextWidth(`${line}${char}`) > maxWidth) {
        result.push(line);
        line = char;
      } else {
        line += char;
      }
    }
    if (line) result.push(line);
  }
  if (result.length <= MAX_LABEL_LINES) return result.length ? result : [""];
  const visible = result.slice(0, MAX_LABEL_LINES);
  visible[MAX_LABEL_LINES - 1] =
    `${visible[MAX_LABEL_LINES - 1]!.replace(/…$/, "")}…`;
  return visible;
}

function nodeMeasurement(node: GraphNode, options?: GraphLayoutOptions) {
  const wrapWidth = node.kind === "decision" ? 100 : NODE_MAX_WIDTH - 28;
  const labelLines = wrapGraphLabel(node.label, wrapWidth);
  if (options?.nodeSize) {
    return { ...options.nodeSize, labelLines };
  }
  const textWidth = Math.max(...labelLines.map(estimateTextWidth), 0);
  const textHeight = Math.max(
    TEXT_LINE_HEIGHT,
    labelLines.length * TEXT_LINE_HEIGHT,
  );
  if (node.kind === "decision") {
    const size = Math.min(
      DECISION_MAX_SIZE,
      Math.max(148, Math.ceil((textWidth + textHeight) / 0.7 + 20)),
    );
    return { width: size, height: size, labelLines };
  }
  return {
    width: Math.min(
      NODE_MAX_WIDTH,
      Math.max(NODE_MIN_WIDTH, textWidth + 32),
    ),
    height: Math.max(
      node.kind === "start" || node.kind === "end" ? 48 : 56,
      textHeight + 28,
    ),
    labelLines,
  };
}

function defaultNodeSpacing(model: GraphModel) {
  return model.nodes.some((node) => node.kind === "decision") ? 64 : 56;
}

function defaultLayerSpacing(model: GraphModel) {
  return model.nodes.some((node) => node.kind === "decision") ? 108 : 92;
}

function edgeLabelSize(label: string) {
  const lines = wrapGraphLabel(label, EDGE_LABEL_MAX_WIDTH - 16);
  const textWidth = Math.max(...lines.map(estimateTextWidth), 24);
  return {
    width: Math.min(EDGE_LABEL_MAX_WIDTH + 8, Math.max(40, textWidth + 16)),
    height: Math.max(22, lines.length * 14 + 8),
  };
}

export function graphOrthogonalPath(
  points: GraphPoint[],
  radius = 10,
): string {
  if (points.length < 2) return "";
  if (points.length === 2) {
    return `M ${points[0]!.x} ${points[0]!.y} L ${points[1]!.x} ${points[1]!.y}`;
  }
  let path = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const prev = points[index - 1]!;
    const curr = points[index]!;
    const next = points[index + 1]!;
    const inX = curr.x - prev.x;
    const inY = curr.y - prev.y;
    const outX = next.x - curr.x;
    const outY = next.y - curr.y;
    const inLen = Math.hypot(inX, inY);
    const outLen = Math.hypot(outX, outY);
    const corner = Math.min(radius, inLen / 2, outLen / 2);
    if (corner < 1 || inLen === 0 || outLen === 0) {
      path += ` L ${curr.x} ${curr.y}`;
      continue;
    }
    path += ` L ${curr.x - (inX / inLen) * corner} ${curr.y - (inY / inLen) * corner}`;
    path += ` Q ${curr.x} ${curr.y} ${curr.x + (outX / outLen) * corner} ${curr.y + (outY / outLen) * corner}`;
  }
  const last = points[points.length - 1]!;
  path += ` L ${last.x} ${last.y}`;
  return path;
}

function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  gap: number,
) {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}

function segmentIntersectsRect(
  start: GraphPoint,
  end: GraphPoint,
  node: GraphLayoutNode,
) {
  const inset = Math.max(8, Math.min(node.width, node.height) * 0.22);
  const left = node.x + inset;
  const right = node.x + node.width - inset;
  const top = node.y + inset;
  const bottom = node.y + node.height - inset;
  if (right <= left || bottom <= top) return false;
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);
  return (
    Math.min(maxX, right) - Math.max(minX, left) > 0 &&
    Math.min(maxY, bottom) - Math.max(minY, top) > 0
  );
}

export function graphLayoutHasOverlaps(
  layout: GraphLayout,
  minGap = NODE_GAP,
): boolean {
  for (let index = 0; index < layout.nodes.length; index += 1) {
    for (let other = index + 1; other < layout.nodes.length; other += 1) {
      if (rectsOverlap(layout.nodes[index]!, layout.nodes[other]!, minGap)) {
        return true;
      }
    }
  }
  for (const edge of layout.edges) {
    const skip = new Set([edge.from, edge.to]);
    for (const node of layout.nodes) {
      if (skip.has(node.id)) continue;
      for (let index = 0; index < edge.points.length - 1; index += 1) {
        if (
          segmentIntersectsRect(
            edge.points[index]!,
            edge.points[index + 1]!,
            node,
          )
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

export function graphModelFromBlock(block: GraphModel): GraphModel {
  return {
    ...block,
    groups: block.groups ?? [],
    nodes: block.nodes.map((node) => ({
      ...node,
      emphasis: node.emphasis ?? "normal",
    })),
    edges: block.edges.map((edge) => ({
      ...edge,
      arrow: edge.arrow ?? "forward",
    })),
  };
}

export function projectGraphForPhone(model: GraphModel, isPhone: boolean) {
  if (!isPhone || model.direction !== "LR") return model;
  return { ...model, direction: "TB" as const };
}

export function graphStableHash(model: GraphModel): string {
  const source = JSON.stringify(model);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function midpoint(a: GraphPoint, b: GraphPoint): GraphPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function longestSegmentMidpoint(points: GraphPoint[]): GraphPoint | undefined {
  if (points.length < 2) return undefined;
  let bestStart = points[0]!;
  let bestEnd = points[1]!;
  let bestLength = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]!;
    const end = points[index + 1]!;
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length > bestLength) {
      bestLength = length;
      bestStart = start;
      bestEnd = end;
    }
  }
  return midpoint(bestStart, bestEnd);
}

function buildElkGraph(
  model: GraphModel,
  options?: GraphLayoutOptions,
): ElkNode {
  const measured = new Map(
    model.nodes.map((node) => [node.id, nodeMeasurement(node, options)]),
  );
  const child = (node: GraphNode): ElkNode => ({
    id: node.id,
    width: measured.get(node.id)!.width,
    height: measured.get(node.id)!.height,
  });
  const grouped = new Set<string>();
  const children: ElkNode[] = (model.groups ?? []).map((group) => {
    const groupChildren = model.nodes
      .filter((node) => node.groupId === group.id)
      .map((node) => {
        grouped.add(node.id);
        return child(node);
      });
    return {
      id: group.id,
      children: groupChildren,
      layoutOptions: {
        "elk.padding": `[top=${GROUP_PAD},left=24,bottom=24,right=24]`,
        "elk.spacing.nodeNode": String(options?.nodeSpacing ?? 48),
      },
    };
  });
  children.push(
    ...model.nodes.filter((node) => !grouped.has(node.id)).map(child),
  );
  return {
    id: "root",
    children,
    edges: model.edges.map((edge): ElkExtendedEdge => {
      const label = edge.label?.trim();
      const size = label ? edgeLabelSize(label) : null;
      return {
        id: edge.id,
        sources: [edge.from],
        targets: [edge.to],
        ...(size
          ? {
              labels: [
                {
                  id: `${edge.id}:label`,
                  text: label,
                  width: size.width,
                  height: size.height,
                },
              ],
            }
          : {}),
      };
    }),
    layoutOptions:
      model.direction === "RADIAL"
        ? {
            "elk.algorithm": "radial",
            "elk.spacing.nodeNode": "56",
            "elk.spacing.edgeNode": "24",
          }
        : {
            "elk.algorithm": "layered",
            "elk.direction": model.direction === "LR" ? "RIGHT" : "DOWN",
            "elk.edgeRouting": "ORTHOGONAL",
            "elk.hierarchyHandling": "INCLUDE_CHILDREN",
            "elk.padding": "[top=20,left=20,bottom=20,right=20]",
            "elk.separateConnectedComponents": "true",
            "elk.spacing.componentComponent": "48",
            "elk.spacing.nodeNode": String(
              options?.nodeSpacing ?? defaultNodeSpacing(model),
            ),
            "elk.spacing.edgeNode": "28",
            "elk.spacing.edgeEdge": "18",
            "elk.layered.spacing.nodeNodeBetweenLayers": String(
              options?.layerSpacing ?? defaultLayerSpacing(model),
            ),
            "elk.layered.spacing.edgeNodeBetweenLayers": "36",
            "elk.layered.spacing.edgeEdgeBetweenLayers": "20",
            "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
            "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
            "elk.layered.thoroughness": "12",
            "elk.edgeLabels.placement": "CENTER",
          },
  };
}

function flattenElkNodes(
  children: ElkNode[] | undefined,
  model: GraphModel,
  options?: GraphLayoutOptions,
  offsetX = PAD,
  offsetY = PAD,
): { nodes: GraphLayoutNode[]; groups: GraphLayoutGroup[] } {
  const nodes: GraphLayoutNode[] = [];
  const groups: GraphLayoutGroup[] = [];
  const modelNodeById = new Map(model.nodes.map((node) => [node.id, node]));
  const modelGroupById = new Map(
    (model.groups ?? []).map((group) => [group.id, group]),
  );
  for (const item of children ?? []) {
    const x = offsetX + (item.x ?? 0);
    const y = offsetY + (item.y ?? 0);
    const graphNode = modelNodeById.get(item.id);
    if (graphNode) {
      const measurement = nodeMeasurement(graphNode, options);
      nodes.push({
        ...graphNode,
        x,
        y,
        width: item.width ?? measurement.width,
        height: item.height ?? measurement.height,
        labelLines: measurement.labelLines,
      });
      continue;
    }
    const group = modelGroupById.get(item.id);
    if (group) {
      groups.push({
        ...group,
        x,
        y,
        width: item.width ?? 0,
        height: item.height ?? 0,
      });
      const nested = flattenElkNodes(item.children, model, options, x, y);
      nodes.push(...nested.nodes);
      groups.push(...nested.groups);
    }
  }
  return { nodes, groups };
}

function edgePointsFromNodes(
  edge: GraphEdge,
  nodeById: Map<string, GraphLayoutNode>,
  direction: GraphDirection,
) {
  const from = nodeById.get(edge.from);
  const to = nodeById.get(edge.to);
  if (!from || !to) return [];
  const horizontal = direction === "LR";
  const start = horizontal
    ? { x: from.x + from.width, y: from.y + from.height / 2 }
    : { x: from.x + from.width / 2, y: from.y + from.height };
  const end = horizontal
    ? { x: to.x, y: to.y + to.height / 2 }
    : { x: to.x + to.width / 2, y: to.y };
  const middle = midpoint(start, end);
  return horizontal
    ? [start, { x: middle.x, y: start.y }, { x: middle.x, y: end.y }, end]
    : [start, { x: start.x, y: middle.y }, { x: end.x, y: middle.y }, end];
}

function normalizeElkPoint(point: ElkPoint): GraphPoint {
  return { x: point.x + PAD, y: point.y + PAD };
}

function layoutFromElk(
  model: GraphModel,
  result: ElkNode,
  options?: GraphLayoutOptions,
): GraphLayout {
  const flattened = flattenElkNodes(result.children, model, options);
  const nodeById = new Map(flattened.nodes.map((node) => [node.id, node]));
  const elkEdgeById = new Map(
    (result.edges ?? []).map((edge) => [edge.id, edge]),
  );
  const edges = model.edges.flatMap((edge): GraphLayoutEdge[] => {
    const elkEdge = elkEdgeById.get(edge.id);
    const section = elkEdge?.sections?.[0];
    const points = section
      ? [
          section.startPoint,
          ...(section.bendPoints ?? []),
          section.endPoint,
        ].map(normalizeElkPoint)
      : edgePointsFromNodes(edge, nodeById, model.direction);
    if (points.length < 2) return [];
    const elkLabel = elkEdge?.labels?.[0];
    const labelPoint = edge.label
      ? elkLabel && Number.isFinite(elkLabel.x) && Number.isFinite(elkLabel.y)
        ? normalizeElkPoint({
            x: (elkLabel.x ?? 0) + (elkLabel.width ?? 0) / 2,
            y: (elkLabel.y ?? 0) + (elkLabel.height ?? 0) / 2,
          })
        : longestSegmentMidpoint(points)
      : undefined;
    return [
      {
        ...edge,
        arrow: edge.arrow ?? "forward",
        points,
        ...(labelPoint ? { labelPoint } : {}),
      },
    ];
  });
  return normalizeLayoutBounds({
    width: Math.max(260, Math.ceil((result.width ?? 0) + PAD * 2)),
    height: Math.max(180, Math.ceil((result.height ?? 0) + PAD * 2)),
    nodes: flattened.nodes,
    groups: flattened.groups,
    edges,
    direction: model.direction,
    usedFallback: false,
  });
}

function normalizeLayoutBounds(layout: GraphLayout): GraphLayout {
  const points = [
    ...layout.nodes.flatMap((node) => [
      { x: node.x, y: node.y },
      { x: node.x + node.width, y: node.y + node.height },
    ]),
    ...layout.groups.flatMap((group) => [
      { x: group.x, y: group.y },
      { x: group.x + group.width, y: group.y + group.height },
    ]),
    ...layout.edges.flatMap((edge) => {
      const size = edge.label ? edgeLabelSize(edge.label) : null;
      return [
        ...edge.points,
        ...(edge.labelPoint && size
          ? [
              {
                x: edge.labelPoint.x - size.width / 2,
                y: edge.labelPoint.y - size.height / 2,
              },
              {
                x: edge.labelPoint.x + size.width / 2,
                y: edge.labelPoint.y + size.height / 2,
              },
            ]
          : edge.labelPoint
            ? [edge.labelPoint]
            : []),
      ];
    }),
  ];
  if (!points.length) return layout;
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const shiftX = PAD - minX;
  const shiftY = PAD - minY;
  const move = (point: GraphPoint): GraphPoint => ({
    x: point.x + shiftX,
    y: point.y + shiftY,
  });
  const nodes = layout.nodes.map((node) => ({
    ...node,
    x: node.x + shiftX,
    y: node.y + shiftY,
  }));
  const groups = layout.groups.map((group) => ({
    ...group,
    x: group.x + shiftX,
    y: group.y + shiftY,
  }));
  const edges = layout.edges.map((edge) => ({
    ...edge,
    points: edge.points.map(move),
    ...(edge.labelPoint ? { labelPoint: move(edge.labelPoint) } : {}),
  }));
  const maxX = Math.max(
    ...nodes.map((node) => node.x + node.width),
    ...groups.map((group) => group.x + group.width),
    ...edges.flatMap((edge) => edge.points.map((point) => point.x)),
    240,
  );
  const maxY = Math.max(
    ...nodes.map((node) => node.y + node.height),
    ...groups.map((group) => group.y + group.height),
    ...edges.flatMap((edge) => edge.points.map((point) => point.y)),
    160,
  );
  return {
    ...layout,
    width: Math.ceil(maxX + PAD),
    height: Math.ceil(maxY + PAD),
    nodes,
    groups,
    edges,
  };
}

function isUsableLayout(model: GraphModel, layout: GraphLayout) {
  const finite = (value: number) => Number.isFinite(value);
  if (
    !finite(layout.width) ||
    !finite(layout.height) ||
    layout.width <= 0 ||
    layout.height <= 0 ||
    layout.width > 6000 ||
    layout.height > 6000 ||
    layout.nodes.length !== model.nodes.length
  ) {
    return false;
  }
  const expectedIds = new Set(model.nodes.map((node) => node.id));
  return layout.nodes.every(
    (node) =>
      expectedIds.delete(node.id) &&
      [node.x, node.y, node.width, node.height].every(finite) &&
      node.width > 0 &&
      node.height > 0 &&
      node.x >= 0 &&
      node.y >= 0 &&
      node.x + node.width <= layout.width &&
      node.y + node.height <= layout.height,
  );
}

export function fallbackGraphLayout(
  model: GraphModel,
  options?: GraphLayoutOptions,
): GraphLayout {
  const measurements = new Map(
    model.nodes.map((node) => [node.id, nodeMeasurement(node, options)]),
  );
  const nodes: GraphLayoutNode[] = [];
  if (model.direction === "RADIAL") {
    const primary = model.nodes.find((node) => node.emphasis === "primary");
    const ordered = primary
      ? [primary, ...model.nodes.filter((node) => node.id !== primary.id)]
      : model.nodes;
    const radius = Math.max(150, ordered.length * 24);
    const center = radius + PAD + NODE_MAX_WIDTH / 2;
    ordered.forEach((node, index) => {
      const size = measurements.get(node.id)!;
      const isCenter = index === 0;
      const angle =
        ((index - 1) / Math.max(1, ordered.length - 1)) * Math.PI * 2;
      nodes.push({
        ...node,
        x:
          (isCenter ? center : center + Math.cos(angle) * radius) -
          size.width / 2,
        y:
          (isCenter ? center : center + Math.sin(angle) * radius) -
          size.height / 2,
        ...size,
      });
    });
  } else {
    model.nodes.forEach((node, index) => {
      const size = measurements.get(node.id)!;
      const column = model.direction === "LR" ? index : index % 2;
      const row = model.direction === "LR" ? index % 2 : index;
      const columnWidth = options?.nodeSize?.width ?? NODE_MAX_WIDTH;
      const rowHeight = options?.nodeSize?.height ?? 54;
      nodes.push({
        ...node,
        x: PAD + column * (columnWidth + (options?.nodeSpacing ?? 70)),
        y: PAD + row * (rowHeight + (options?.layerSpacing ?? 56)),
        ...size,
      });
    });
  }
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges = model.edges.flatMap((edge): GraphLayoutEdge[] => {
    const points = edgePointsFromNodes(edge, nodeById, model.direction);
    return points.length
      ? [
          {
            ...edge,
            arrow: edge.arrow ?? "forward",
            points,
            labelPoint: edge.label
              ? midpoint(points[0]!, points.at(-1)!)
              : undefined,
          },
        ]
      : [];
  });
  const width =
    Math.max(...nodes.map((node) => node.x + node.width), 240) + PAD;
  const height =
    Math.max(...nodes.map((node) => node.y + node.height), 160) + PAD;
  return {
    width,
    height,
    nodes,
    edges,
    groups: [],
    direction: model.direction,
    usedFallback: true,
  };
}

export function layoutGraph(
  model: GraphModel,
  options?: GraphLayoutOptions,
): Promise<GraphLayout> {
  const normalized = graphModelFromBlock(model);
  const key = `${graphStableHash(normalized)}:${JSON.stringify(options ?? {})}`;
  const cached = layoutCache.get(key);
  if (cached) return cached;
  const pending = (async () => {
    const attempts: Array<GraphLayoutOptions | undefined> = [
      options,
      {
        ...options,
        nodeSpacing:
          (options?.nodeSpacing ?? defaultNodeSpacing(normalized)) * 1.45,
        layerSpacing:
          (options?.layerSpacing ?? defaultLayerSpacing(normalized)) * 1.25,
      },
    ];
    let bestUsable: GraphLayout | null = null;
    for (const attempt of attempts) {
      try {
        const result = await elk.layout(buildElkGraph(normalized, attempt));
        const layout = layoutFromElk(normalized, result, attempt);
        if (!isUsableLayout(normalized, layout)) continue;
        if (!graphLayoutHasOverlaps(layout)) return layout;
        bestUsable = layout;
      } catch {
        continue;
      }
    }
    return bestUsable ?? fallbackGraphLayout(normalized, options);
  })();
  layoutCache.set(key, pending);
  return pending;
}

export function graphAccessibilityLabel(model: GraphModel): string {
  const labels = new Map(model.nodes.map((node) => [node.id, node.label]));
  return [
    model.title,
    ...model.edges.map((edge) => {
      const from = labels.get(edge.from) ?? edge.from;
      const to = labels.get(edge.to) ?? edge.to;
      const connector =
        edge.arrow === "both" ? "↔" : edge.arrow === "none" ? "—" : "→";
      return `${from}${edge.label ? ` (${edge.label})` : ""} ${connector} ${to}`;
    }),
  ]
    .filter(Boolean)
    .join(". ");
}

export function graphRelations(model: GraphModel, nodeId: string) {
  const labels = new Map(model.nodes.map((node) => [node.id, node.label]));
  return {
    incoming: model.edges
      .filter((edge) => edge.to === nodeId)
      .map((edge) => ({
        ...edge,
        nodeLabel: labels.get(edge.from) ?? edge.from,
      })),
    outgoing: model.edges
      .filter((edge) => edge.from === nodeId)
      .map((edge) => ({ ...edge, nodeLabel: labels.get(edge.to) ?? edge.to })),
  };
}

function unwrapLabel(raw: string) {
  return raw.trim().replace(/^["']|["']$/g, "");
}

function parseMermaidNode(raw: string): GraphNode | null {
  const value = raw.trim();
  const patterns: Array<[RegExp, GraphNodeKind]> = [
    [/^([A-Za-z_][\w-]*)\(\((.+)\)\)$/, "start"],
    [/^([A-Za-z_][\w-]*)\{(.+)\}$/, "decision"],
    [/^([A-Za-z_][\w-]*)\[\[(.+)\]\]$/, "io"],
    [/^([A-Za-z_][\w-]*)\[(.+)\]$/, "process"],
    [/^([A-Za-z_][\w-]*)\((.+)\)$/, "end"],
  ];
  for (const [pattern, kind] of patterns) {
    const match = value.match(pattern);
    if (match) return { id: match[1]!, label: unwrapLabel(match[2]!), kind };
  }
  return /^[A-Za-z_][\w-]*$/.test(value)
    ? { id: value, label: value, kind: "process" }
    : null;
}

export function parseMermaidFlowchart(source: string): GraphModel | null {
  const lines = source
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("%%"));
  if (!lines.length) return null;
  const header = lines[0]!.match(/^(?:flowchart|graph)\s+(LR|TB|RL|BT)\b/i);
  const direction = header && /TB|BT/i.test(header[1]!) ? "TB" : "LR";
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const rememberNode = (node: GraphNode) => {
    const existing = nodes.get(node.id);
    if (!existing) {
      nodes.set(node.id, node);
      return;
    }
    nodes.set(node.id, {
      ...existing,
      ...(node.label !== node.id ? { label: node.label } : {}),
      ...(node.kind !== "process" ? { kind: node.kind } : {}),
    });
  };
  lines.slice(header ? 1 : 0).forEach((line) => {
    const match = line.match(
      /^(.+?)\s*(<-->|<->|-->|---|-.->|<--)\s*(?:\|([^|]+)\|)?\s*(.+)$/,
    );
    if (!match) return;
    const from = parseMermaidNode(match[1]!);
    const to = parseMermaidNode(match[4]!);
    if (!from || !to) return;
    rememberNode(from);
    rememberNode(to);
    const op = match[2]!;
    edges.push({
      id: `e${edges.length + 1}`,
      from: from.id,
      to: to.id,
      label: match[3]?.trim(),
      arrow:
        op.includes("<->") || op.includes("<-->")
          ? "both"
          : op.includes(">")
            ? "forward"
            : op.startsWith("<")
              ? "backward"
              : "none",
    });
  });
  if (nodes.size < 2 || !edges.length) return null;
  return {
    variant: "process_flow",
    direction,
    nodes: [...nodes.values()],
    edges,
  };
}

function mermaidNode(node: GraphNode) {
  const label = node.label.replace(/"/g, "'");
  if (node.kind === "decision") return `${node.id}{"${label}"}`;
  if (node.kind === "start") return `${node.id}(("${label}"))`;
  if (node.kind === "end") return `${node.id}("${label}")`;
  if (node.kind === "io") return `${node.id}[["${label}"]]`;
  return `${node.id}["${label}"]`;
}

export function graphToMermaid(model: GraphModel): string {
  const direction = model.direction === "RADIAL" ? "TB" : model.direction;
  const lines = [`flowchart ${direction}`];
  const grouped = new Set<string>();
  for (const group of model.groups ?? []) {
    lines.push(`  subgraph ${group.id}["${group.label.replace(/"/g, "'")}"]`);
    model.nodes
      .filter((node) => node.groupId === group.id)
      .forEach((node) => {
        grouped.add(node.id);
        lines.push(`    ${mermaidNode(node)}`);
      });
    lines.push("  end");
  }
  model.nodes
    .filter((node) => !grouped.has(node.id))
    .forEach((node) => lines.push(`  ${mermaidNode(node)}`));
  model.edges.forEach((edge) => {
    const op =
      edge.arrow === "both"
        ? "<-->"
        : edge.arrow === "none"
          ? "---"
          : edge.arrow === "backward"
            ? "<--"
            : "-->";
    lines.push(
      `  ${edge.from} ${op}${edge.label ? `|${edge.label}|` : ""} ${edge.to}`,
    );
  });
  return lines.join("\n");
}

export function isGraphFenceLanguage(
  language: string | null | undefined,
  code: string,
) {
  const value = (language ?? "").toLowerCase();
  return (
    value === "flowchart" ||
    (value === "mermaid" &&
      /^\s*(?:flowchart|graph)\s+(?:LR|TB|RL|BT)\b/im.test(code))
  );
}
