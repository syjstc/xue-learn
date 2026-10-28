import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
  type ReactNode,
} from "react";
import {
  materialPresentationFrame,
  type MaterialPresentation,
  type MaterialStageLayoutPlan,
  type CourseDisplayBlock,
} from "../../../libs/domain/src/index.js";
import { classroomPresentationTypography } from "./classroom-stage-typography.js";
import "./presentation-stage.css";

type Frame = ReturnType<typeof materialPresentationFrame>;

/** Fit the whole content-sized board, including reserved future cards. Cue
 * transforms never change the width, type or wrapping used for this measure. */
export function usePresentationFit(
  viewportRef: RefObject<HTMLDivElement | null>,
  canvasRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
) {
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (!enabled || !viewport || !canvas) return;
    let disposed = false;
    const measure = () => {
      if (disposed || !viewport.clientWidth || !viewport.clientHeight) return;
      // Reserve the maximum entrance translation as well as the settled copy.
      // Layout dimensions exclude the sampled scale and focus motion; scroll
      // extents would include translated descendants and change with cues.
      const width = canvas.offsetWidth + 24;
      const height = canvas.offsetHeight + 64;
      const scale = Math.min(1, viewport.clientWidth / width, viewport.clientHeight / height);
      const x = Math.max(0, (viewport.clientWidth - width * scale) / 2);
      const y = Math.max(0, (viewport.clientHeight - height * scale) / 2);
      canvas.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
      viewport.dataset.presentationFit = String(scale);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(canvas);
    void document.fonts?.ready.then(measure);
    return () => {
      disposed = true;
      observer.disconnect();
      canvas.style.removeProperty("transform");
      delete viewport.dataset.presentationFit;
    };
  }, [viewportRef, canvasRef, enabled]);
}

function interpolate(from: Frame, to: Frame, progress: number): Frame {
  return {
    ...to,
    items: to.items.map((item, index) => {
      const old = from.items[index] ?? item;
      const mix = (a: number, b: number) => a + (b - a) * progress;
      return {
        ...item,
        reveal: mix(old.reveal, item.reveal),
        emphasis: mix(old.emphasis, item.emphasis),
        opacity: mix(old.opacity, item.opacity),
        weight: mix(old.weight, item.weight),
      };
    }),
  };
}

/** Browser clicks can interrupt; classroom/export always sample the supplied tick. */
export function usePresentationFrame(
  input: Parameters<typeof materialPresentationFrame>[0],
  clocked: boolean,
  animate: boolean,
) {
  const [reduced, setReduced] = useState(false);
  const target = materialPresentationFrame({ ...input, progress: 1 });
  const [paint, setPaint] = useState(target);
  const painted = useRef(paint);
  const destination = useRef(target);
  destination.current = target;
  const key = `${input.mode}:${input.count}:${input.focusedIndexes.join(",")}:${input.revealedIndexes?.join(",")}`;
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(media.matches);
    change();
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useLayoutEffect(() => {
    if (clocked) return;
    const to = destination.current;
    if (!animate || reduced) {
      painted.current = to;
      setPaint(to);
      return;
    }
    const from = painted.current;
    const started = performance.now();
    let handle = 0;
    const update = (now: number) => {
      const p = Math.min(1, (now - started) / 640);
      painted.current = interpolate(from, to, 1 - (1 - p) ** 3);
      setPaint(painted.current);
      if (p < 1) handle = requestAnimationFrame(update);
    };
    handle = requestAnimationFrame(update);
    return () => cancelAnimationFrame(handle);
  }, [key, clocked, animate, reduced]);
  return clocked
    ? materialPresentationFrame({ ...input, progressEased: true, reducedMotion: reduced })
    : reduced || !animate
      ? target
      : paint;
}

export function PresentationStage(props: {
  cardBuild?: boolean;
  revealedIndexes?: readonly number[];
  previousRevealedIndexes?: readonly number[];
  mode: MaterialPresentation;
  plan: MaterialStageLayoutPlan;
  figures: readonly CourseDisplayBlock[];
  contentSize: { width: number; height: number };
  reading: boolean;
  count: number;
  focusedIndexes: readonly number[];
  previousFocusedIndexes: readonly number[];
  progress: number;
  clocked: boolean;
  animate: boolean;
  renderFigure: (index: number) => ReactNode;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  usePresentationFit(viewportRef, canvasRef, !props.reading);
  const frame = usePresentationFrame(props, props.clocked, props.animate);
  const typography = classroomPresentationTypography({
    plan: props.plan,
    figures: props.figures,
    content: props.contentSize,
  });
  const grid = stagePlanGrid(props.plan);
  const board = (
    <div
      ref={canvasRef}
      className="course-presentation"
      data-presentation={props.mode}
      data-card-build={props.cardBuild || undefined}
      data-layout={props.plan.layout}
      data-surface={props.plan.surface}
      data-overview={frame.overview}
      data-count={props.count}
      tabIndex={props.reading ? undefined : 0}
      style={grid.style}
    >
      {props.plan.order.map((index) => {
        const item = frame.items[index]!;
        return (
          <section
            key={String(props.figures[index]?.id ?? index)}
            className="course-presentation-item"
            data-stage-index={index}
            data-slot={
              props.plan.layout === "main+rail"
                ? index === 0
                  ? "main"
                  : "rail"
                : "peer"
            }
            data-pending={item.pending}
            data-active={item.active}
            data-focused={item.active && !frame.overview ? "true" : undefined}
            aria-current={
              item.active && !frame.overview
                ? props.mode === "steps"
                  ? "step"
                  : "true"
                : undefined
            }
            style={
              {
                ...grid.items[index],
                "--lp-stage-type": props.reading
                  ? "1em"
                  : `${typography[index] ?? 30}px`,
                "--presentation-reveal": item.reveal,
                "--presentation-emphasis": item.emphasis,
                "--presentation-rise": `${(1 - item.reveal) * (props.reading ? 24 : 64) - item.emphasis * 6}px`,
                "--presentation-shift": `${props.reading ? 0 : (1 - item.reveal) * 24}px`,
                "--presentation-opacity": item.reveal * (0.86 + item.emphasis * 0.14),
                "--presentation-blur": `${props.reading ? 0 : (1 - item.reveal) * 5}px`,
                "--presentation-scale": props.reading
                  ? 0.975 + item.reveal * 0.025 + item.emphasis * 0.012
                  : 0.94 + item.reveal * 0.045 + item.emphasis * 0.015,
              } as CSSProperties
            }
          >
            {props.mode === "steps" && !props.cardBuild && (
              <div className="course-presentation-marker" aria-hidden="true">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <i />
              </div>
            )}
            <div
              className="course-presentation-copy"
              aria-hidden={item.pending || undefined}
              inert={item.pending || undefined}
            >
              {props.renderFigure(index)}
            </div>
          </section>
        );
      })}
    </div>
  );
  return props.reading ? board : (
    <div className="course-presentation-viewport" ref={viewportRef}>
      {board}
    </div>
  );
}

/** Project shared rectangle edges onto a content-sized grid. No mode-specific
 * geometry: column proportions and spanning slots come only from the plan.
 * Rows grow with text rather than stretching a short code block to canvas height. */
export function stagePlanGrid(plan: MaterialStageLayoutPlan): {
  style: CSSProperties;
  items: CSSProperties[];
} {
  const rounded = (n: number) => Math.round(n * 1e6) / 1e6;
  const axis = (position: "x" | "y", size: "width" | "height") => {
    const edges = [
      ...new Set(
        plan.items.flatMap(({ rect }) => [
          rounded(rect[position]),
          rounded(rect[position] + rect[size]),
        ]),
      ),
    ].sort((a, b) => a - b);
    const tracks = edges
      .slice(0, -1)
      .map((start, i) => {
        const end = edges[i + 1]!;
        const occupied = plan.items.some(
          ({ rect }) =>
            rounded(rect[position]) === start ||
            rounded(rect[position] + rect[size]) === end,
        );
        return !occupied
          ? "var(--presentation-gap)"
          : position === "y"
            ? "auto"
            : `minmax(0, ${rounded(end - start)}fr)`;
      })
      .join(" ");
    return { edges, tracks };
  };
  const columns = axis("x", "width"),
    rows = axis("y", "height");
  const span = (edges: number[], start: number, size: number) =>
    `${edges.indexOf(rounded(start)) + 1} / ${edges.indexOf(rounded(start + size)) + 1}`;
  return {
    style: {
      gridTemplateColumns: columns.tracks,
      gridTemplateRows: rows.tracks,
    },
    items: plan.items.map(({ rect }) => ({
      gridColumn: span(columns.edges, rect.x, rect.width),
      gridRow: span(rows.edges, rect.y, rect.height),
    })),
  };
}
