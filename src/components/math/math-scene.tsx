"use client";

import {
  mathScene2dViewport,
  mathSceneObjectsInPaintOrder,
  removeStaticMathSceneDuplicates,
  resolveMathSceneObjects,
  sampleMathExpression,
  sampleParametricExpression,
  samplePolarExpression,
  sampleSurfaceExpression,
  type MathPoint2,
  type MathPoint3,
  type MathScene,
  type MathSceneObject,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import {
  Focus,
  Hand,
  List,
  RotateCcw,
  Tags,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import { cn } from "@xue-learn/core/source/src/shared/utils.ts";
import { ProseMarkdown } from "@xue-learn/core/source/src/components/markdown/prose-markdown.tsx";
import {
  MaterialVisualFrame,
  MaterialVisualToolbar,
  MaterialVisualToolbarButton,
} from "@xue-learn/core/source/src/components/wizard/interactive-material/material-visual-frame.tsx";
import { resolveMathScene2dScale } from "./math-scene-layout.ts";

const WIDTH = 760;
const HEIGHT = 480;
const PAD = 54;
const MIN_VIEW_SCALE = 0.5;
const MAX_VIEW_SCALE = 4;
type ViewTransform = { scale: number; x: number; y: number };
const DEFAULT_VIEW_TRANSFORM: ViewTransform = { scale: 1, x: 0, y: 0 };

function readViewportSize() {
  if (typeof window === "undefined") return { width: WIDTH, height: HEIGHT };
  return {
    width: Math.max(1, Math.round(window.innerWidth)),
    height: Math.max(1, Math.round(window.innerHeight)),
  };
}
const PALETTE = [
  "var(--chart-1)",
  "var(--chart-6)",
  "var(--chart-2)",
  "var(--info)",
  "var(--warning)",
];

const LEGACY_COLOR_TOKENS: Record<string, string> = {
  "#c25b56": "var(--chart-1)",
  "#5b8fc2": "var(--info)",
  "#6baf7c": "var(--chart-6)",
  "#d4a03c": "var(--warning)",
  "#9b6b9e": "var(--chart-2)",
};

type PlacedLabel = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

function labelsOverlap(first: PlacedLabel, second: PlacedLabel) {
  return !(
    first.right + 6 < second.left ||
    first.left > second.right + 6 ||
    first.bottom + 4 < second.top ||
    first.top > second.bottom + 4
  );
}

function colorFor(object: MathSceneObject, index: number) {
  const authoredColor = object.color?.toLowerCase();
  if (authoredColor && LEGACY_COLOR_TOKENS[authoredColor]) {
    return LEGACY_COLOR_TOKENS[authoredColor]!;
  }
  return authoredColor &&
    /^(?:#[0-9a-f]{3,8}|[a-z]{3,20})$/i.test(authoredColor)
    ? authoredColor
    : PALETTE[index % PALETTE.length]!;
}

function ticks([minimum, maximum]: [number, number], count = 8) {
  const span = maximum - minimum;
  const raw = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const step =
    (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) *
    magnitude;
  const first = Math.ceil(minimum / step) * step;
  const values: number[] = [];
  for (let value = first; value <= maximum + step * 0.001; value += step) {
    values.push(Number(value.toPrecision(12)));
  }
  return values;
}

function formatTick(value: number) {
  if (Math.abs(value) < 1e-10) return "0";
  if (Math.abs(value) >= 10_000 || Math.abs(value) < 0.001)
    return value.toExponential(1);
  return Number(value.toFixed(3)).toString();
}

function MathScene2d({
  scene,
  markerId,
  parameterValues,
  viewport: fixedViewport,
  onDragObject,
  width = WIDTH,
  height = HEIGHT,
  pad = PAD,
}: {
  scene: MathScene;
  markerId: string;
  parameterValues: Readonly<Record<string, number>>;
  viewport?: ReturnType<typeof mathScene2dViewport>;
  onDragObject?: (objectId: string, position: MathPoint2) => void;
  width?: number;
  height?: number;
  pad?: number;
}) {
  const viewport = fixedViewport ?? mathScene2dViewport(scene);
  const [xMin, xMax] = viewport.xRange;
  const [yMin, yMax] = viewport.yRange;
  const availableWidth = width - pad * 2;
  const availableHeight = height - pad * 2;
  const scale = resolveMathScene2dScale(
    scene,
    availableWidth,
    availableHeight,
    xMax - xMin,
    yMax - yMin,
  );
  const scaleX = scale.x;
  const scaleY = scale.y;
  const naturalScale = Math.min(scaleX, scaleY);
  const plotWidth = (xMax - xMin) * scaleX;
  const plotHeight = (yMax - yMin) * scaleY;
  const left = (width - plotWidth) / 2;
  const top = (height - plotHeight) / 2;
  const right = left + plotWidth;
  const bottom = top + plotHeight;
  const sx = (x: number) => left + (x - xMin) * scaleX;
  const sy = (y: number) => bottom - (y - yMin) * scaleY;
  const path = (points: MathPoint2[]) => {
    let previous: MathPoint2 | null = null;
    let previousWasVisible = false;
    return points
      .map((point) => {
        const isVisible =
          point[0] >= xMin - 0.01 &&
          point[0] <= xMax + 0.01 &&
          point[1] >= yMin - 0.01 &&
          point[1] <= yMax + 0.01;
        const jump =
          previous && Math.abs(point[1] - previous[1]) > (yMax - yMin) * 1.5;
        const command = !previousWasVisible || jump ? "M" : "L";
        previous = point;
        previousWasVisible = isVisible;
        if (!isVisible) return "";
        return `${command}${sx(point[0]).toFixed(2)},${sy(point[1]).toFixed(2)}`;
      })
      .filter(Boolean)
      .join(" ");
  };
  const elements: ReactNode[] = [];
  const placedLabels: PlacedLabel[] = [];
  const label = (
    key: string,
    text: string,
    anchorX: number,
    anchorY: number,
    color: string,
    preferred: "above" | "below" = "above",
  ) => {
    const width = Math.min(220, Math.max(40, text.length * 7.4));
    const height = 18;
    const horizontalOffsets = [10, -width - 10, -width / 2];
    const verticalOffsets =
      preferred === "above" ? [-12, 24, -34, 46] : [24, -12, 46, -34];
    let placement: PlacedLabel | null = null;
    for (const yOffset of verticalOffsets) {
      for (const xOffset of horizontalOffsets) {
        const leftEdge = Math.max(
          left + 4,
          Math.min(right - width - 4, anchorX + xOffset),
        );
        const baseline = Math.max(
          top + height,
          Math.min(bottom - 4, anchorY + yOffset),
        );
        const candidate = {
          left: leftEdge,
          right: leftEdge + width,
          top: baseline - height,
          bottom: baseline + 3,
        };
        if (!placedLabels.some((item) => labelsOverlap(item, candidate))) {
          placement = candidate;
          break;
        }
      }
      if (placement) break;
    }
    if (!placement) {
      const fallbackLeft = Math.max(
        left + 4,
        Math.min(right - width - 4, anchorX + 10),
      );
      placement = {
        left: fallbackLeft,
        right: fallbackLeft + width,
        top: Math.max(top + 2, anchorY - 30),
        bottom: Math.max(top + height, anchorY - 9),
      };
    }
    placedLabels.push(placement);
    return (
      <text
        key={key}
        x={placement.left}
        y={placement.bottom - 3}
        fill={color}
        fontSize="13"
        fontWeight="650"
        stroke="var(--course-content-surface, white)"
        strokeWidth="5"
        strokeLinejoin="round"
        paintOrder="stroke"
      >
        {text}
      </text>
    );
  };
  const dragHandle = (
    object: MathSceneObject,
    point: MathPoint2,
    color: string,
  ) => {
    if (!object.draggable || !onDragObject) return null;
    const moveFromPointer = (event: ReactPointerEvent<SVGCircleElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      const matrix = event.currentTarget.getScreenCTM();
      const svg = event.currentTarget.ownerSVGElement;
      if (!matrix || !svg) return;
      const screenPoint = svg.createSVGPoint();
      screenPoint.x = event.clientX;
      screenPoint.y = event.clientY;
      const local = screenPoint.matrixTransform(matrix.inverse());
      onDragObject(object.id, [
        Math.max(xMin, Math.min(xMax, (local.x - left) / scaleX + xMin)),
        Math.max(yMin, Math.min(yMax, (bottom - local.y) / scaleY + yMin)),
      ]);
    };
    return (
      <g key={`${object.id}-drag-handle`}>
        <circle
          cx={sx(point[0])}
          cy={sy(point[1])}
          r="18"
          fill="transparent"
          stroke="transparent"
          strokeWidth="2"
          className="cursor-grab touch-none outline-none active:cursor-grabbing focus-visible:stroke-[var(--course-content-link)]"
          role="button"
          tabIndex={0}
          aria-label={object.label ?? object.id}
          onPointerDown={(event) => {
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={moveFromPointer}
          onPointerUp={(event) => {
            moveFromPointer(event);
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
          onPointerCancel={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
          onKeyDown={(event) => {
            const direction = {
              ArrowLeft: [-1, 0],
              ArrowRight: [1, 0],
              ArrowUp: [0, 1],
              ArrowDown: [0, -1],
            }[event.key];
            if (!direction) return;
            event.preventDefault();
            const multiplier = event.shiftKey ? 5 : 1;
            const xStep = (xMax - xMin) / 50;
            const yStep = (yMax - yMin) / 50;
            onDragObject(object.id, [
              Math.max(
                xMin,
                Math.min(xMax, point[0] + direction[0]! * xStep * multiplier),
              ),
              Math.max(
                yMin,
                Math.min(yMax, point[1] + direction[1]! * yStep * multiplier),
              ),
            ]);
          }}
        />
        <circle
          cx={sx(point[0])}
          cy={sy(point[1])}
          r="7"
          fill="var(--course-content-surface, white)"
          fillOpacity="0.9"
          stroke={color}
          strokeWidth="2.5"
          pointerEvents="none"
          aria-hidden
        />
      </g>
    );
  };

  if (scene.showGrid) {
    if (scene.coordinateSystem === "polar") {
      const maxRadius = Math.min(
        Math.max(Math.abs(xMin), Math.abs(xMax)),
        Math.max(Math.abs(yMin), Math.abs(yMax)),
      );
      for (const radius of ticks([0, maxRadius], 5).filter(
        (value) => value > 0,
      )) {
        elements.push(
          <circle
            key={`gr-${radius}`}
            cx={sx(0)}
            cy={sy(0)}
            r={radius * naturalScale}
            fill="none"
            stroke="currentColor"
            opacity="0.11"
          />,
        );
      }
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 6) {
        elements.push(
          <line
            key={`ga-${angle}`}
            x1={sx(0)}
            y1={sy(0)}
            x2={sx(Math.cos(angle) * maxRadius)}
            y2={sy(Math.sin(angle) * maxRadius)}
            stroke="currentColor"
            opacity="0.1"
          />,
        );
      }
    } else {
      for (const value of ticks(viewport.xRange)) {
        elements.push(
          <g key={`gx-${value}`}>
            <line
              x1={sx(value)}
              x2={sx(value)}
              y1={top}
              y2={bottom}
              stroke="currentColor"
              opacity="0.1"
            />
            <text
              x={sx(value)}
              y={bottom + 18}
              textAnchor="middle"
              fill="currentColor"
              opacity="0.62"
              fontSize="11"
            >
              {formatTick(value)}
            </text>
          </g>,
        );
      }
      for (const value of ticks(viewport.yRange)) {
        elements.push(
          <g key={`gy-${value}`}>
            <line
              x1={left}
              x2={right}
              y1={sy(value)}
              y2={sy(value)}
              stroke="currentColor"
              opacity="0.1"
            />
            <text
              x={left - 8}
              y={sy(value) + 4}
              textAnchor="end"
              fill="currentColor"
              opacity="0.62"
              fontSize="11"
            >
              {formatTick(value)}
            </text>
          </g>,
        );
      }
    }
  }
  if (scene.showAxes) {
    const axisX = yMin <= 0 && yMax >= 0 ? sy(0) : sy(yMin);
    const axisY = xMin <= 0 && xMax >= 0 ? sx(0) : sx(xMin);
    elements.push(
      <g key="axes" stroke="currentColor" opacity="0.55" strokeWidth="1.3">
        <line x1={left} x2={right} y1={axisX} y2={axisX} />
        <line x1={axisY} x2={axisY} y1={top} y2={bottom} />
      </g>,
    );
  }

  mathSceneObjectsInPaintOrder(scene.objects).forEach(
    ({ object, originalIndex: index }) => {
      const color = colorFor(object, index);
      const common = {
        stroke: color,
        opacity: object.opacity ?? 1,
        strokeWidth: 2.5,
        strokeDasharray: object.dashed ? "7 5" : undefined,
        fill: "none",
      };
      if (object.kind === "point") {
        const point = object.position as MathPoint2;
        elements.push(
          <g key={object.id}>
            <circle cx={sx(point[0])} cy={sy(point[1])} r="5" fill={color} />
            {dragHandle(object, point, color)}
            {object.label
              ? label(
                  `${object.id}-label`,
                  object.label,
                  sx(point[0]),
                  sy(point[1]),
                  color,
                  index % 2 === 0 ? "above" : "below",
                )
              : null}
          </g>,
        );
      } else if (object.kind === "vector" || object.kind === "segment") {
        const from = (
          object.kind === "vector" ? (object.start ?? [0, 0]) : object.from
        ) as MathPoint2;
        const to = (
          object.kind === "vector" ? object.end : object.to
        ) as MathPoint2;
        elements.push(
          <g key={object.id}>
            <line
              {...common}
              x1={sx(from[0])}
              y1={sy(from[1])}
              x2={sx(to[0])}
              y2={sy(to[1])}
              markerEnd={
                object.kind === "vector"
                  ? `url(#${markerId}-${index})`
                  : undefined
              }
            />
            {dragHandle(object, to, color)}
            {object.label
              ? label(
                  `${object.id}-label`,
                  object.label,
                  sx(to[0]),
                  sy(to[1]),
                  color,
                )
              : null}
          </g>,
        );
      } else {
        let points: MathPoint2[] = [];
        try {
          if (object.kind === "function")
            points = sampleMathExpression(
              object.expression,
              object.variable,
              object.domain,
              96,
              parameterValues,
            );
          if (object.kind === "parametric")
            points = sampleParametricExpression(
              object,
              96,
              parameterValues,
            ).map((value) => value.slice(0, 2) as MathPoint2);
          if (object.kind === "polar_function")
            points = samplePolarExpression(object, 120, parameterValues);
        } catch {
          points = [];
        }
        const visible = points.filter(
          ([x, y]) =>
            x >= xMin - 0.01 &&
            x <= xMax + 0.01 &&
            y >= yMin - 0.01 &&
            y <= yMax + 0.01,
        );
        if (visible.length > 1) {
          elements.push(<path key={object.id} {...common} d={path(points)} />);
          if (object.label) {
            const labelPoint = visible[Math.floor(visible.length * 0.78)]!;
            elements.push(
              label(
                `${object.id}-label`,
                object.label,
                sx(labelPoint[0]),
                sy(labelPoint[1]),
                color,
              ),
            );
          }
        }
      }
    },
  );
  return <>{elements}</>;
}

function project3d(
  scene: MathScene,
  point: MathPoint3,
  camera: { azimuth: number; elevation: number },
  width: number,
  height: number,
): MathPoint2 {
  const zRange = scene.zRange ?? [-5, 5];
  const normalize = (value: number, range: [number, number]) =>
    ((value - range[0]) / (range[1] - range[0])) * 2 - 1;
  const x = normalize(point[0], scene.xRange);
  const y = normalize(point[1], scene.yRange);
  const z = normalize(point[2], zRange);
  const azimuth = (camera.azimuth * Math.PI) / 180;
  const elevation = (camera.elevation * Math.PI) / 180;
  const rx = x * Math.cos(azimuth) - y * Math.sin(azimuth);
  const ry = x * Math.sin(azimuth) + y * Math.cos(azimuth);
  const py = ry * Math.cos(elevation) - z * Math.sin(elevation);
  const depth = ry * Math.sin(elevation) + z * Math.cos(elevation);
  const perspective = 1 / (1.25 - depth * 0.12);
  return [
    width / 2 + rx * (width * 0.3) * perspective,
    height / 2 + py * (height * 0.36) * perspective,
  ];
}

function MathScene3d({
  scene,
  markerId,
  camera,
  parameterValues,
  showObjectLabels = true,
  width = WIDTH,
  height = HEIGHT,
}: {
  scene: MathScene;
  markerId: string;
  camera: { azimuth: number; elevation: number };
  parameterValues: Readonly<Record<string, number>>;
  showObjectLabels?: boolean;
  width?: number;
  height?: number;
}) {
  const elements: ReactNode[] = [];
  const project = (point: MathPoint3) =>
    project3d(scene, point, camera, width, height);
  const path3 = (points: MathPoint3[]) =>
    points
      .map((point, index) => {
        const [x, y] = project(point);
        return `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  if (scene.showAxes) {
    const origin: MathPoint3 = [0, 0, 0];
    const axes: Array<[string, MathPoint3, string]> = [
      ["x", [scene.xRange[1], 0, 0], "var(--chart-1)"],
      ["y", [0, scene.yRange[1], 0], "var(--chart-6)"],
      ["z", [0, 0, (scene.zRange ?? [-5, 5])[1]], "var(--chart-2)"],
    ];
    axes.forEach(([label, end, color]) => {
      const [x1, y1] = project(origin);
      const [x2, y2] = project(end);
      elements.push(
        <g key={`axis-${label}`}>
          <line
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={color}
            strokeWidth="1.7"
            opacity="0.7"
          />
          <text x={x2 + 5} y={y2 - 5} fill={color} fontSize="12">
            {label}
          </text>
        </g>,
      );
    });
  }
  scene.objects.forEach((object, index) => {
    const color = colorFor(object, index);
    const common = {
      stroke: color,
      opacity: object.opacity ?? 0.9,
      strokeWidth: 2.2,
      strokeDasharray: object.dashed ? "7 5" : undefined,
      fill: "none",
    };
    if (object.kind === "surface") {
      try {
        const grid = sampleSurfaceExpression(object, 15, parameterValues);
        grid.forEach((row, rowIndex) =>
          elements.push(
            <path
              key={`${object.id}-r-${rowIndex}`}
              d={path3(row)}
              {...common}
              strokeWidth="1.1"
              opacity="0.55"
            />,
          ),
        );
        for (let column = 0; column < grid[0]!.length; column += 1) {
          elements.push(
            <path
              key={`${object.id}-c-${column}`}
              d={path3(grid.map((row) => row[column]!))}
              {...common}
              strokeWidth="1.1"
              opacity="0.55"
            />,
          );
        }
      } catch {
        // Invalid expressions are rejected by the server; stored compatibility data may still be incomplete.
      }
    } else if (object.kind === "parametric") {
      try {
        const points = sampleParametricExpression(
          object,
          96,
          parameterValues,
        ).filter((point): point is MathPoint3 => point.length === 3);
        if (points.length > 1)
          elements.push(<path key={object.id} d={path3(points)} {...common} />);
      } catch {
        // See compatibility note above.
      }
    } else if (object.kind === "point") {
      const [x, y] = project(object.position as MathPoint3);
      elements.push(
        <g key={object.id}>
          <circle cx={x} cy={y} r="5" fill={color} />
          {showObjectLabels && object.label ? (
            <text
              x={x + 8}
              y={y - 8}
              fill={color}
              fontSize="13"
              fontWeight="600"
            >
              {object.label}
            </text>
          ) : null}
        </g>,
      );
    } else if (object.kind === "vector" || object.kind === "segment") {
      const from = (
        object.kind === "vector" ? (object.start ?? [0, 0, 0]) : object.from
      ) as MathPoint3;
      const to = (
        object.kind === "vector" ? object.end : object.to
      ) as MathPoint3;
      const [x1, y1] = project(from);
      const [x2, y2] = project(to);
      elements.push(
        <g key={object.id}>
          <line
            {...common}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            markerEnd={
              object.kind === "vector"
                ? `url(#${markerId}-${index})`
                : undefined
            }
          />
          {showObjectLabels && object.label ? (
            <text
              x={x2 + 8}
              y={y2 - 8}
              fill={color}
              fontSize="13"
              fontWeight="600"
            >
              {object.label}
            </text>
          ) : null}
        </g>,
      );
    }
  });
  return <>{elements}</>;
}

export function MathSceneView({
  scene,
  compact = false,
}: {
  scene: MathScene;
  compact?: boolean;
}) {
  const t = useT();
  const markerId = useId().replace(/:/g, "");
  const authoredCamera = scene.camera ?? { azimuth: 38, elevation: 24 };
  const [camera, setCamera] = useState(authoredCamera);
  const [showInline3dLabels, setShowInline3dLabels] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedViewport, setExpandedViewport] = useState(readViewportSize);
  const [viewTransform, setViewTransform] = useState({
    ...DEFAULT_VIEW_TRANSFORM,
  });
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const panStart = useRef<{
    pointerX: number;
    pointerY: number;
    x: number;
    y: number;
  } | null>(null);
  const expandedSvgRef = useRef<SVGSVGElement | null>(null);
  const expandedStageRef = useRef<HTMLDivElement | null>(null);
  const [dragPositions, setDragPositions] = useState<
    Record<string, MathPoint2>
  >({});
  const pendingDragPosition = useRef<{
    objectId: string;
    position: MathPoint2;
  } | null>(null);
  const dragAnimationFrame = useRef<number | null>(null);
  const [parameterValues, setParameterValues] = useState<
    Record<string, number>
  >(() =>
    Object.fromEntries(
      (scene.parameters ?? []).map((parameter) => [
        parameter.id,
        parameter.default,
      ]),
    ),
  );
  useEffect(() => {
    setParameterValues(
      Object.fromEntries(
        (scene.parameters ?? []).map((parameter) => [
          parameter.id,
          parameter.default,
        ]),
      ),
    );
    setCamera(scene.camera ?? { azimuth: 38, elevation: 24 });
    setShowInline3dLabels(false);
    setDragPositions({});
  }, [scene]);
  useEffect(
    () => () => {
      if (dragAnimationFrame.current !== null) {
        cancelAnimationFrame(dragAnimationFrame.current);
      }
    },
    [],
  );
  const queueDragPosition = (objectId: string, position: MathPoint2) => {
    pendingDragPosition.current = { objectId, position };
    if (dragAnimationFrame.current !== null) return;
    dragAnimationFrame.current = requestAnimationFrame(() => {
      dragAnimationFrame.current = null;
      const pending = pendingDragPosition.current;
      pendingDragPosition.current = null;
      if (!pending) return;
      setDragPositions((current) => ({
        ...current,
        [pending.objectId]: pending.position,
      }));
    });
  };
  const interactiveScene: MathScene = useMemo(
    () => ({
      ...scene,
      objects: removeStaticMathSceneDuplicates(
        resolveMathSceneObjects(
          scene.objects,
          scene.dimension === "2d" ? dragPositions : {},
          parameterValues,
        ),
        (scene.parameters ?? []).map((parameter) => parameter.id),
      ),
    }),
    [dragPositions, parameterValues, scene],
  );
  const fixed2dViewport = useMemo(() => mathScene2dViewport(scene), [scene]);
  const hasDraggableObjects = useMemo(
    () => scene.objects.some((object) => object.draggable),
    [scene.objects],
  );
  useEffect(() => {
    if (!isExpanded) return;
    const stage = expandedStageRef.current;
    if (!stage) return;
    const updateViewport = () => {
      const bounds = stage.getBoundingClientRect();
      if (bounds.width > 0 && bounds.height > 0) {
        setExpandedViewport({
          width: Math.max(1, Math.round(bounds.width)),
          height: Math.max(1, Math.round(bounds.height)),
        });
      }
    };
    updateViewport();
    const observer = new ResizeObserver(updateViewport);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [isExpanded]);
  const legendItems = useMemo(
    () =>
      interactiveScene.objects.flatMap((object, index) =>
        object.label
          ? [
              {
                id: object.id,
                label: object.label,
                color: colorFor(object, index),
              },
            ]
          : [],
      ),
    [interactiveScene.objects],
  );
  const hasChangedParameters = (scene.parameters ?? []).some(
    (parameter) => parameterValues[parameter.id] !== parameter.default,
  );
  const resetParameters = () =>
    setParameterValues(
      Object.fromEntries(
        (scene.parameters ?? []).map((parameter) => [
          parameter.id,
          parameter.default,
        ]),
      ),
    );
  const hasChangedCamera =
    camera.azimuth !== authoredCamera.azimuth ||
    camera.elevation !== authoredCamera.elevation;
  const resetScene = () => {
    if (dragAnimationFrame.current !== null) {
      cancelAnimationFrame(dragAnimationFrame.current);
      dragAnimationFrame.current = null;
    }
    pendingDragPosition.current = null;
    resetParameters();
    setCamera(authoredCamera);
    setDragPositions({});
  };
  const rotateCamera = (azimuthDelta: number, elevationDelta: number) =>
    setCamera((current) => ({
      azimuth: current.azimuth + azimuthDelta,
      elevation: Math.max(
        -75,
        Math.min(75, current.elevation + elevationDelta),
      ),
    }));
  const handlePointerDown = (
    event: ReactPointerEvent<SVGSVGElement>,
    expanded: boolean,
  ) => {
    if (scene.dimension === "2d") {
      if (!expanded) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      panStart.current = {
        pointerX: event.clientX,
        pointerY: event.clientY,
        x: viewTransform.x,
        y: viewTransform.y,
      };
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = { x: event.clientX, y: event.clientY };
  };
  const handlePointerMove = (
    event: ReactPointerEvent<SVGSVGElement>,
    expanded: boolean,
  ) => {
    if (scene.dimension === "2d") {
      if (!expanded || !panStart.current) return;
      const start = panStart.current;
      setViewTransform((current) => ({
        ...current,
        x: start.x + event.clientX - start.pointerX,
        y: start.y + event.clientY - start.pointerY,
      }));
      return;
    }
    if (!dragStart.current) return;
    const previous = dragStart.current;
    dragStart.current = { x: event.clientX, y: event.clientY };
    rotateCamera(
      (event.clientX - previous.x) * 0.35,
      (previous.y - event.clientY) * 0.3,
    );
  };
  const handlePointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    panStart.current = null;
    dragStart.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const handleKeyDown = (event: ReactKeyboardEvent<SVGSVGElement>) => {
    if (scene.dimension !== "3d") return;
    const rotation = {
      ArrowLeft: [-5, 0],
      ArrowRight: [5, 0],
      ArrowUp: [0, 5],
      ArrowDown: [0, -5],
    }[event.key];
    if (!rotation) return;
    event.preventDefault();
    rotateCamera(rotation[0]!, rotation[1]!);
  };
  const canReset =
    scene.dimension === "3d" ||
    Boolean(scene.parameters?.length) ||
    hasDraggableObjects;
  const hasChanged =
    hasChangedParameters ||
    hasChangedCamera ||
    Object.keys(dragPositions).length > 0;
  const setScaleAroundPoint = (
    requestedScale: number,
    centerX: number,
    centerY: number,
  ) =>
    setViewTransform((current) => {
      const scale = Math.max(
        MIN_VIEW_SCALE,
        Math.min(MAX_VIEW_SCALE, requestedScale),
      );
      if (scale === current.scale) return current;
      const ratio = scale / current.scale;
      return {
        scale,
        x: centerX - (centerX - current.x) * ratio,
        y: centerY - (centerY - current.y) * ratio,
      };
    });
  const zoomBy = (factor: number) =>
    setScaleAroundPoint(
      viewTransform.scale * factor,
      expandedViewport.width / 2,
      expandedViewport.height / 2,
    );
  const resetView = () => setViewTransform({ ...DEFAULT_VIEW_TRANSFORM });
  const centerView = () =>
    setViewTransform((current) => ({
      ...current,
      x: (expandedViewport.width / 2) * (1 - current.scale),
      y: (expandedViewport.height / 2) * (1 - current.scale),
    }));
  const centeredViewOffset = {
    x: (expandedViewport.width / 2) * (1 - viewTransform.scale),
    y: (expandedViewport.height / 2) * (1 - viewTransform.scale),
  };
  useEffect(() => {
    const svg = expandedSvgRef.current;
    if (!isExpanded || scene.dimension !== "2d" || !svg) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = svg.getBoundingClientRect();
      const centerX =
        ((event.clientX - bounds.left) / bounds.width) * expandedViewport.width;
      const centerY =
        ((event.clientY - bounds.top) / bounds.height) *
        expandedViewport.height;
      setViewTransform((current) => {
        const requestedScale =
          current.scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15);
        const scale = Math.max(
          MIN_VIEW_SCALE,
          Math.min(MAX_VIEW_SCALE, requestedScale),
        );
        if (scale === current.scale) return current;
        const ratio = scale / current.scale;
        return {
          scale,
          x: centerX - (centerX - current.x) * ratio,
          y: centerY - (centerY - current.y) * ratio,
        };
      });
    };
    svg.addEventListener("wheel", handleWheel, { passive: false });
    return () => svg.removeEventListener("wheel", handleWheel);
  }, [
    expandedViewport.height,
    expandedViewport.width,
    isExpanded,
    scene.dimension,
  ]);
  const renderLabelModeToggle = () =>
    scene.dimension === "3d" && legendItems.length ? (
      <button
        type="button"
        onClick={() => setShowInline3dLabels((current) => !current)}
        aria-pressed={showInline3dLabels}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--course-content-border)] bg-[var(--course-content-surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--course-content-muted)] transition hover:border-[var(--course-content-border-accent)] hover:text-[var(--course-content)]"
        title={
          showInline3dLabels
            ? t("wizard.material.mathScene.labelsInLegend")
            : t("wizard.material.mathScene.labelsOnGraph")
        }
      >
        {showInline3dLabels ? (
          <List className="size-3.5" aria-hidden />
        ) : (
          <Tags className="size-3.5" aria-hidden />
        )}
        <span className="hidden sm:inline">
          {showInline3dLabels
            ? t("wizard.material.mathScene.labelsInLegend")
            : t("wizard.material.mathScene.labelsOnGraph")}
        </span>
      </button>
    ) : null;
  const renderLegend = (expanded = false) =>
    scene.dimension === "3d" && !showInline3dLabels && legendItems.length ? (
      <div
        className={cn(
          "rounded-xl border border-[var(--course-content-border)] bg-[var(--course-content-surface)]/92 p-2.5 shadow-sm backdrop-blur",
          expanded
            ? "w-full"
            : "absolute left-3 top-3 z-10 max-w-[min(17rem,calc(100%-1.5rem))]",
        )}
        aria-label={t("wizard.material.mathScene.legend")}
      >
        <div className="mb-1.5 flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--course-content-muted)]">
          <span>{t("wizard.material.mathScene.legend")}</span>
          <span>{legendItems.length}</span>
        </div>
        <ul
          className={cn(
            "grid gap-1.5",
            !expanded && "max-h-32 overflow-y-auto pr-1",
          )}
        >
          {legendItems.map((item) => (
            <li
              key={item.id}
              className="flex min-w-0 items-start gap-2 text-xs leading-snug text-[var(--course-content)]"
            >
              <span
                className="mt-1 size-2.5 shrink-0 rounded-full ring-2 ring-current/15"
                style={{ backgroundColor: item.color, color: item.color }}
                aria-hidden
              />
              <span className="min-w-0 break-words">{item.label}</span>
            </li>
          ))}
        </ul>
      </div>
    ) : null;
  const renderScene = (mode: "inline" | "expanded") => {
    const expanded = mode === "expanded";
    const scopedMarkerId = `${markerId}-${mode}`;
    const sceneWidth = expanded ? expandedViewport.width : WIDTH;
    const sceneHeight = expanded ? expandedViewport.height : HEIGHT;
    const scenePad = expanded
      ? Math.min(64, Math.max(48, Math.min(sceneWidth, sceneHeight) * 0.08))
      : PAD;
    return (
      <div
        ref={expanded ? expandedStageRef : undefined}
        className={
          expanded
            ? "relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[var(--course-content-surface)]"
            : cn(
                "relative mx-auto overflow-hidden rounded-xl bg-[var(--course-content-surface)]",
                compact ? "max-w-lg" : "max-w-3xl",
              )
        }
      >
        {!expanded ? renderLegend() : null}
        <svg
          ref={expanded ? expandedSvgRef : undefined}
          role="img"
          aria-label={`${scene.title}。${scene.summary}${
            scene.dimension === "3d"
              ? `。${t("wizard.material.mathScene.rotateHint")}`
              : hasDraggableObjects
                ? `。${t("wizard.material.mathScene.objectDragHint")}`
                : ""
          }`}
          viewBox={`0 0 ${sceneWidth} ${sceneHeight}`}
          tabIndex={scene.dimension === "3d" ? 0 : undefined}
          onKeyDown={handleKeyDown}
          onPointerDown={(event) => handlePointerDown(event, expanded)}
          onPointerMove={(event) => handlePointerMove(event, expanded)}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className={cn(
            "block w-full",
            expanded ? "h-full" : "h-auto",
            expanded &&
              scene.dimension === "2d" &&
              "cursor-grab touch-none select-none active:cursor-grabbing",
            scene.dimension === "3d" &&
              "cursor-grab touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--course-content-link)]/40 active:cursor-grabbing",
          )}
          style={{ color: "var(--course-content-muted)" }}
        >
          <defs>
            {interactiveScene.objects.map((object, index) => (
              <marker
                key={object.id}
                id={`${scopedMarkerId}-${index}`}
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path
                  d="M 0 0 L 10 5 L 0 10 z"
                  fill={colorFor(object, index)}
                />
              </marker>
            ))}
          </defs>
          <rect
            width={sceneWidth}
            height={sceneHeight}
            fill="var(--course-content-surface, transparent)"
          />
          <g
            transform={
              expanded && scene.dimension === "2d"
                ? `translate(${viewTransform.x} ${viewTransform.y}) scale(${viewTransform.scale})`
                : undefined
            }
          >
            {scene.dimension === "2d" ? (
              <MathScene2d
                scene={interactiveScene}
                markerId={scopedMarkerId}
                parameterValues={parameterValues}
                viewport={fixed2dViewport}
                onDragObject={queueDragPosition}
                width={sceneWidth}
                height={sceneHeight}
                pad={scenePad}
              />
            ) : (
              <MathScene3d
                scene={interactiveScene}
                markerId={scopedMarkerId}
                camera={camera}
                parameterValues={parameterValues}
                showObjectLabels={showInline3dLabels}
                width={sceneWidth}
                height={sceneHeight}
              />
            )}
          </g>
        </svg>
      </div>
    );
  };
  const renderParameters = (expanded = false) =>
    scene.parameters?.length ? (
      <div
        className={cn(
          "grid grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-2.5",
          expanded ? "shrink-0 pt-3" : "p-3 sm:p-4",
        )}
      >
        {scene.parameters.map((parameter) => (
          <label
            key={parameter.id}
            className="block rounded-xl border border-[var(--course-content-border)] bg-[var(--course-content-surface)] px-3 py-2.5 text-sm transition focus-within:border-[var(--course-content-border-accent)] focus-within:ring-2 focus-within:ring-[var(--course-content-link)]/10"
          >
            <span className="flex min-h-7 items-center justify-between gap-3">
              <span className="font-medium leading-snug text-[var(--course-content)]">
                {parameter.name}
              </span>
              <output className="min-w-12 rounded-md bg-[var(--course-content-surface-accent)] px-2 py-1 text-center font-mono text-sm font-semibold tabular-nums text-[var(--course-content)]">
                {parameterValues[parameter.id]}
              </output>
            </span>
            <input
              type="range"
              className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-full bg-[var(--course-content-surface-muted)] accent-[var(--course-content-link)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--course-content-link)]/30"
              min={parameter.min}
              max={parameter.max}
              step={parameter.step}
              value={parameterValues[parameter.id] ?? parameter.default}
              aria-label={parameter.name}
              onChange={(event) =>
                setParameterValues((current) => ({
                  ...current,
                  [parameter.id]: Number(event.target.value),
                }))
              }
            />
          </label>
        ))}
      </div>
    ) : null;
  const openFullscreen = () => {
    setExpandedViewport(readViewportSize());
    resetView();
    setIsExpanded(true);
  };
  return (
    <MaterialVisualFrame
      title={scene.title}
      caption={
        <ProseMarkdown
          content={scene.summary}
          variant="muted"
          className="text-sm leading-6"
        />
      }
      compact={compact}
      actions={
        <>
          {renderLabelModeToggle()}
          {canReset ? (
            <button
              type="button"
              onClick={resetScene}
              disabled={!hasChanged}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--course-content-border)] bg-[var(--course-content-surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--course-content-muted)] transition hover:border-[var(--course-content-border-accent)] hover:text-[var(--course-content)] disabled:cursor-default disabled:opacity-40"
            >
              <RotateCcw className="size-3.5" aria-hidden />
              <span className="hidden sm:inline">
                {t("wizard.material.mathScene.reset")}
              </span>
            </button>
          ) : null}
        </>
      }
      expanded={isExpanded}
      fullscreenLabel={t("wizard.material.mathScene.fullscreen")}
      fullscreenHint={
        scene.dimension === "3d"
          ? t("wizard.material.mathScene.rotateHint")
          : hasDraggableObjects
            ? t("wizard.material.mathScene.objectDragHint")
            : t("wizard.material.mathScene.dragHint")
      }
      onExpandedChange={setIsExpanded}
      onOpenFullscreen={openFullscreen}
      expandedContent={
        <div className="flex min-h-0 flex-1 flex-col bg-[var(--course-content-surface)] md:flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {renderScene("expanded")}
          </div>
          {scene.parameters?.length ||
          (scene.dimension === "3d" && legendItems.length) ? (
            <aside className="flex max-h-[42dvh] shrink-0 flex-col gap-3 overflow-y-auto border-t border-[var(--course-content-border)] bg-[var(--course-content-surface-muted)]/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:max-h-none md:w-80 md:border-l md:border-t-0">
              {scene.dimension === "3d" && legendItems.length ? (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-[var(--course-content)]">
                    {t("wizard.material.mathScene.display")}
                  </span>
                  {renderLabelModeToggle()}
                </div>
              ) : null}
              {renderLegend(true)}
              {renderParameters(true)}
            </aside>
          ) : null}
        </div>
      }
      expandedToolbar={
        scene.dimension === "2d" ? (
          <MaterialVisualToolbar
            label={t("wizard.material.mathScene.viewTools")}
          >
            <MaterialVisualToolbarButton
              type="button"
              onClick={() => zoomBy(1 / 1.25)}
              disabled={viewTransform.scale <= MIN_VIEW_SCALE}
              className="inline-flex size-10 items-center justify-center rounded-xl text-foreground transition hover:bg-muted disabled:opacity-35"
              aria-label={t("wizard.material.mathScene.zoomOut")}
              title={t("wizard.material.mathScene.zoomOut")}
            >
              <ZoomOut className="size-5" aria-hidden />
            </MaterialVisualToolbarButton>
            <div
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-medium text-foreground"
              role="status"
              aria-live="polite"
              title={t("wizard.material.mathScene.dragHint")}
            >
              <Hand className="size-4" aria-hidden />
              <span className="tabular-nums">
                {Math.round(viewTransform.scale * 100)}%
              </span>
            </div>
            <MaterialVisualToolbarButton
              type="button"
              onClick={() => zoomBy(1.25)}
              disabled={viewTransform.scale >= MAX_VIEW_SCALE}
              className="inline-flex size-10 items-center justify-center rounded-xl text-foreground transition hover:bg-muted disabled:opacity-35"
              aria-label={t("wizard.material.mathScene.zoomIn")}
              title={t("wizard.material.mathScene.zoomIn")}
            >
              <ZoomIn className="size-5" aria-hidden />
            </MaterialVisualToolbarButton>
            <MaterialVisualToolbarButton
              type="button"
              onClick={centerView}
              disabled={
                Math.abs(viewTransform.x - centeredViewOffset.x) < 0.01 &&
                Math.abs(viewTransform.y - centeredViewOffset.y) < 0.01
              }
              className="inline-flex size-10 items-center justify-center rounded-xl text-foreground transition hover:bg-muted disabled:opacity-35"
              aria-label={t("wizard.material.mathScene.centerView")}
              title={t("wizard.material.mathScene.centerView")}
            >
              <Focus className="size-4.5" aria-hidden />
            </MaterialVisualToolbarButton>
            <MaterialVisualToolbarButton
              type="button"
              onClick={resetView}
              disabled={
                viewTransform.scale === 1 &&
                viewTransform.x === 0 &&
                viewTransform.y === 0
              }
              className="inline-flex size-10 items-center justify-center rounded-xl text-foreground transition hover:bg-muted disabled:opacity-35"
              aria-label={t("wizard.material.mathScene.resetView")}
              title={t("wizard.material.mathScene.resetView")}
            >
              <RotateCcw className="size-4.5" aria-hidden />
            </MaterialVisualToolbarButton>
          </MaterialVisualToolbar>
        ) : undefined
      }
    >
      {renderScene("inline")}
      {renderParameters()}
    </MaterialVisualFrame>
  );
}
