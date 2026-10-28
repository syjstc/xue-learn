import { useLayoutEffect, useRef, useState } from "react";
import type {
  FormalDocument,
  HistoryEntry,
  SubjectRef,
} from "../../formal-expression-core/src/index.js";
import {
  emphasisBoxForSubject,
  highlightForCoveredPrimitive,
  hitsFromPrimitives,
  layoutFormalMotion,
  primitiveCoveredByEmphasis,
} from "./layout.js";
import {
  interpolateScenes,
  resolveMotionFromScene,
  scenesEquivalent,
  withPaths,
} from "./tween.js";
import { fitMotionEm } from "./fit.js";
import { DEFAULT_EM } from "./metrics.js";
import { stretchFilled, stretchStrokeWidth } from "./paths.js";
import type { MotionAlign, MotionPrimitive, MotionScene } from "./types.js";
import "./styles.css";

export type FormalMotionHighlightTone =
  | "primary"
  | "success"
  | "warning"
  | "danger"
  | "muted";

export interface FormalMotionRendererProps {
  snapshot: FormalDocument;
  previousSnapshot?: FormalDocument;
  historyEntry?: HistoryEntry;
  selected?: SubjectRef[];
  highlights?: Array<{
    subject: SubjectRef;
    tone: FormalMotionHighlightTone;
    emphasis?: "soft" | "strong";
  }>;
  dimOthers?: boolean;
  /**
   * `wash` paints a padded background rect (reading / admin).
   * `ink` recolors covered glyphs and skips the plate (classroom video).
   */
  emphasisMode?: "wash" | "ink";
  onSelect?: (subject: SubjectRef) => void;
  showDebug?: boolean;
  className?: string;
  motionScale?: number;
  align?: MotionAlign;
  /** Typesetting em. When omitted, the renderer fits `em` to the host box. */
  em?: number;
  fit?: boolean;
  minEm?: number;
  maxEm?: number;
  /**
   * External clock in `[0, 1]`. When set, interpolation is a pure function of
   * this value (lesson performance). Course playback leaves it unset.
   */
  progress?: number;
}

const DURATION_MS = 640;

export function FormalMotionRenderer({
  snapshot,
  previousSnapshot,
  selected = [],
  highlights = [],
  dimOthers = false,
  emphasisMode = "wash",
  onSelect,
  showDebug = false,
  className,
  motionScale = 1,
  align = "center",
  em: emProp,
  fit = true,
  minEm,
  maxEm,
  progress,
}: FormalMotionRendererProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const node = hostRef.current;
    if (!node) return;
    const apply = (width: number, height: number) => {
      setViewport((current) =>
        Math.abs(current.width - width) < 0.5 && Math.abs(current.height - height) < 0.5
          ? current
          : { width, height },
      );
    };
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) apply(rect.width, rect.height);
    });
    observer.observe(node);
    const style = getComputedStyle(node);
    const padX =
      Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
    const padY =
      Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
    apply(node.clientWidth - padX, node.clientHeight - padY);
    return () => observer.disconnect();
  }, []);

  const design = layoutFormalMotion(snapshot, { em: DEFAULT_EM });
  const em =
    emProp ??
    (fit && viewport.width > 8 && viewport.height > 8
      ? fitMotionEm({
          designWidth: design.width,
          designHeight: design.height,
          availableWidth: viewport.width,
          availableHeight: viewport.height,
          minEm,
          maxEm,
        })
      : DEFAULT_EM);
  const target = em === DEFAULT_EM ? design : layoutFormalMotion(snapshot, { em });
  const display = useRef<MotionScene>(target);
  const frameRef = useRef<number | undefined>(undefined);
  const previousSnapshotRef = useRef(previousSnapshot);
  previousSnapshotRef.current = previousSnapshot;
  const [frame, setFrame] = useState<MotionScene>(target);

  useLayoutEffect(() => {
    const next = layoutFormalMotion(snapshot, { em });
    const hinted = previousSnapshotRef.current
      ? layoutFormalMotion(previousSnapshotRef.current, { em })
      : undefined;
    const origin = resolveMotionFromScene(display.current, next, hinted);
    if (typeof progress === "number") {
      const from = hinted ?? next;
      const t = Math.min(1, Math.max(0, progress));
      const interpolated = interpolateScenes(from, next, t);
      const scene: MotionScene = {
        width: interpolated.width,
        height: interpolated.height,
        primitives: interpolated.primitives,
        hits: hitsFromPrimitives(interpolated.primitives),
      };
      display.current = scene;
      setFrame(scene);
      return;
    }
    if (scenesEquivalent(origin, next)) {
      display.current = next;
      setFrame(next);
      return;
    }
    const from: MotionScene = {
      width: origin.width,
      height: origin.height,
      primitives: origin.primitives.map((item) => ({ ...item })),
      hits: origin.hits,
    };
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    const started = performance.now();
    const duration = Math.max(180, DURATION_MS * motionScale);
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / duration);
      if (t >= 1) {
        display.current = next;
        setFrame(next);
        return;
      }
      const interpolated = interpolateScenes(from, next, t);
      const scene: MotionScene = {
        width: interpolated.width,
        height: interpolated.height,
        primitives: interpolated.primitives,
        hits: hitsFromPrimitives(interpolated.primitives),
      };
      display.current = scene;
      setFrame(scene);
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [snapshot, motionScale, em, progress]);

  const highlightByKey = new Map(
    highlights.map((item) => [
      `${item.subject.type}:${item.subject.id}`,
      item,
    ]),
  );
  const emphasisTargets = [
    ...selected.map((subject) => ({
      key: `${subject.type}:${subject.id}`,
      subject,
      tone: "primary" as FormalMotionHighlightTone,
      emphasis: "soft" as const,
    })),
    ...highlights.map((item) => ({
      key: `${item.subject.type}:${item.subject.id}`,
      subject: item.subject,
      tone: item.tone,
      emphasis: item.emphasis ?? "soft",
    })),
  ];
  const seenEmphasis = new Set<string>();
  const emphasisBoxes = emphasisTargets.flatMap((item) => {
    if (seenEmphasis.has(item.key)) return [];
    seenEmphasis.add(item.key);
    const box = emphasisBoxForSubject(snapshot, frame.primitives, item.subject);
    if (!box) return [];
    return [{ ...item, box }];
  });
  const emphasisSubjects = emphasisTargets.map((item) => item.subject);
  const painted = withPaths(frame.primitives);
  return (
    <div
      ref={hostRef}
      className={["fer-motion-renderer", className].filter(Boolean).join(" ")}
      data-align={align}
    >
      <svg
        className="fer-motion-svg"
        width={frame.width}
        height={frame.height}
        viewBox={`0 0 ${Math.max(frame.width, 1)} ${Math.max(frame.height, 1)}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
      >
        {emphasisMode === "wash"
          ? emphasisBoxes.map((item) => (
              <rect
                key={`emphasis:${item.key}`}
                className={`fer-motion-emphasis is-${item.tone}${
                  item.emphasis === "strong" ? " is-strong" : ""
                }`}
                x={item.box.x}
                y={item.box.y}
                width={item.box.width}
                height={item.box.height}
                rx={Math.min(
                  item.box.height * 0.28,
                  item.box.width * 0.28,
                  (frame.primitives[0]?.em ?? DEFAULT_EM) * 0.22,
                )}
                pointerEvents="none"
              />
            ))
          : null}
        {painted.map((primitive) => {
          const key = primitive.subject
            ? `${primitive.subject.type}:${primitive.subject.id}`
            : "";
          const highlight =
            emphasisMode === "ink"
              ? highlightForCoveredPrimitive(primitive, snapshot, emphasisTargets)
              : key
                ? highlightByKey.get(key)
                : undefined;
          const covered = primitiveCoveredByEmphasis(
            primitive,
            snapshot,
            emphasisSubjects,
          );
          return (
          <Primitive
            key={primitive.id}
            primitive={primitive}
            dim={dimOthers && emphasisTargets.length > 0 && !covered}
            highlight={highlight}
          />
          );
        })}
        {frame.hits.map((hit) => {
          const key = `${hit.subject.type}:${hit.subject.id}`;
          return (
            <rect
              key={key}
              className="fer-motion-hit"
              x={hit.x}
              y={hit.y}
              width={hit.width}
              height={hit.height}
              onClick={(event) => {
                event.stopPropagation();
                onSelect?.(hit.subject);
              }}
            />
          );
        })}
        {showDebug
          ? frame.hits.map((hit) => (
              <rect
                key={`debug:${hit.subject.type}:${hit.subject.id}`}
                className="fer-motion-debug"
                x={hit.x}
                y={hit.y}
                width={hit.width}
                height={hit.height}
              />
            ))
          : null}
      </svg>
    </div>
  );
}

function Primitive({
  primitive,
  dim,
  highlight,
}: {
  primitive: MotionPrimitive & { path: string };
  dim: boolean;
  highlight?: {
    tone: FormalMotionHighlightTone;
    emphasis?: "soft" | "strong";
  };
}) {
  const opacity = primitive.opacity * (dim ? 0.28 : 1);
  const toneClass = highlight
    ? `is-highlight-${highlight.tone}${highlight.emphasis === "strong" ? " is-highlight-strong" : ""}`
    : "";
  if (primitive.role && primitive.path) {
    const filled = stretchFilled(primitive.role);
    const stroke = filled ? 0 : stretchStrokeWidth(primitive.role, primitive.em);
    return (
      <path
        className={`fer-motion-mark fer-motion-mark-${primitive.role} ${toneClass}`.trim()}
        d={primitive.path}
        transform={`translate(${primitive.x} ${primitive.y})`}
        opacity={opacity}
        fill={filled ? "currentColor" : "none"}
        fillRule={primitive.role === "circ" ? "evenodd" : undefined}
        stroke={filled ? "none" : "currentColor"}
        strokeWidth={stroke}
        strokeLinecap={primitive.role === "times" ? "butt" : "round"}
        shapeRendering="geometricPrecision"
        strokeLinejoin="round"
      />
    );
  }
  if (!primitive.text) return null;
  const cjk = /[\u2e80-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(primitive.text);
  return (
    <text
      className={`fer-motion-glyph ${toneClass}`.trim()}
      x={primitive.x}
      y={primitive.y}
      fontSize={primitive.em}
      fontStyle={primitive.italic && !cjk ? "italic" : "normal"}
      data-italic={primitive.italic && !cjk ? "true" : "false"}
      data-script={cjk ? "cjk" : undefined}
      opacity={opacity}
    >
      {primitive.text}
    </text>
  );
}
