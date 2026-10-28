import { useId, type CSSProperties } from "react";
import {
  materialVisualTarget,
  materialVisualBarFractions,
  type MaterialVisual,
} from "../../../libs/domain/src/index.js";
import { classroomVisualTypography } from "./classroom-stage-typography.js";
import { usePresentationFrame } from "./presentation-stage.js";
import { ProseMarkdown } from "../markdown/prose-markdown.js";
import "./visual-board.css";
import { ProcessDiagram } from "./process-diagram.js";
import {TeachingVisualArt, supportsTeachingVisualArt} from "./teaching/teaching-visual.js";

/** All moving values are sampled by the same host clock as narration. */
export function VisualBoard({
  block,
  activeTargetIds = [],
  previousActiveTargetIds = [],
  progress = 1,
  reading = false,
  animate = false,
  contentSize,
  timelineTick,
}: {
  block: MaterialVisual;
  activeTargetIds?: readonly string[];
  previousActiveTargetIds?: readonly string[];
  progress?: number;
  reading?: boolean;
  animate?: boolean;
  contentSize?: { width: number; height: number };
  timelineTick?: number;
}) {
  const marker = useId().replace(/:/g, "");
  const selection = (ids: readonly string[]) =>
    ids.includes("whole")
      ? []
      : block.items.flatMap((item, i) =>
          ids.includes(materialVisualTarget(block.id, item.id)) ? [i] : [],
        );
  const frame = usePresentationFrame(
    {
      mode: "focus",
      count: block.items.length,
      focusedIndexes: selection(activeTargetIds),
      previousFocusedIndexes: selection(previousActiveTargetIds),
      progress,
    },
    !reading,
    animate,
  );
  const ink = (i: number): CSSProperties =>
    ({
      "--visual-emphasis": frame.items[i]?.emphasis ?? 0,
      opacity: frame.items[i]?.opacity ?? 1,
    }) as CSSProperties;
  const target = (i: number) =>
    materialVisualTarget(block.id, block.items[i]!.id);
  const number = (i: number) => String(i + 1).padStart(2, "0");
  const fractions = materialVisualBarFractions(block.items);
  const value = (n: number) => `${n}${block.unit ? ` ${block.unit}` : ""}`;
  const copy = (content: string) => <ProseMarkdown content={content} variant="inline" />;
  // A target-local pointer enters with the sampled focus. It holds throughout
  // repeated explanation and never changes the label's measured geometry.
  const pointer = (i: number) => <span className="visual-focus-indicator" data-focus-indicator={target(i)}
    aria-hidden="true" style={{opacity: frame.items[i]?.emphasis ?? 0}}>
    <svg viewBox="0 0 12 12"><path d="M2 2L8 6L2 10"/></svg>
  </span>;
  const ordered = block.items.map((item, i) => ({ item, i }));
  if (block.kind === "layers") ordered.reverse();
  const legend = (
    <ol className="visual-legend">
      {ordered.map(({ item, i }) => (
        <li
          key={item.id}
          style={ink(i)}
          data-lp-target={target(i)}
          data-active={frame.items[i]?.active}
        >
          {pointer(i)}
          <span className="visual-index" aria-hidden="true">
            {number(i)}
          </span>
          <div>
            <strong>{copy(item.label)}</strong>
            {item.detail && <p>{copy(item.detail)}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
  if (supportsTeachingVisualArt(block)) return (
    <section className="visual-board visual-board-teaching" data-visual-kind={block.kind} data-reading={reading}
      data-active={frame.items.some(item => item.active)} aria-label={block.title}
      style={{"--visual-type": reading ? "1em" : `${classroomVisualTypography(contentSize)}px`} as CSSProperties}>
      <h3 className="visual-heading">{copy(block.title)}</h3>
      <div className="visual-teaching-art"><TeachingVisualArt block={block} emphasis={frame.items.map(item => item.emphasis)} motionSeconds={timelineTick === undefined ? undefined : timelineTick / 48_000}/></div>
    </section>
  );
  return (
    <section
      className="visual-board"
      data-visual-kind={block.kind}
      data-reading={reading}
      aria-label={block.title}
      style={
        {
          "--visual-type": reading
            ? "1em"
            : `${classroomVisualTypography(contentSize)}px`,
        } as CSSProperties
      }
    >
      <h3 className="visual-heading">{copy(block.title)}</h3>
      {block.kind === "process" && !reading ? (
        <ProcessDiagram block={block} emphasis={frame.items.map(item => item.emphasis)} />
      ) : block.kind === "process" ? (
        <ol className="visual-process">
          {block.items.map((item, i) => (
            <li
              key={item.id}
              style={ink(i)}
              data-lp-target={target(i)}
              data-active={frame.items[i]?.active}
            >
              <div className="visual-process-track" aria-hidden="true">
                <span className="visual-orbit">
                  <span>{number(i)}</span>
                </span>
                {i < block.items.length - 1 && (
                  <span className="visual-connector">
                    <i />
                    <svg viewBox="0 0 12 12" fill="none">
                      <path d="M1 6h9M6 2l4 4-4 4" />
                    </svg>
                  </span>
                )}
              </div>
              <strong>{copy(item.label)}</strong>
              {item.detail && <p>{copy(item.detail)}</p>}
            </li>
          ))}
        </ol>
      ) : block.kind === "bars" ? (
        <div className="visual-bars">
          <div className="visual-bar-axis" aria-hidden="true">
            <span>0</span>
            <span>{value(Math.max(...block.items.map((i) => i.value!)))}</span>
          </div>
          {block.items.map((item, i) => (
            <div
              className="visual-bar-item"
              key={item.id}
              style={ink(i)}
              data-lp-target={target(i)}
              data-active={frame.items[i]?.active}
            >
              {pointer(i)}
              <div className="visual-bar-caption">
                <strong>{copy(item.label)}</strong>
                <span>{value(item.value!)}</span>
              </div>
              <div className="visual-bar-track" aria-hidden="true">
                <div style={{ width: `${fractions[i]! * 100}%` }} />
              </div>
              {item.detail && <p>{copy(item.detail)}</p>}
            </div>
          ))}
        </div>
      ) : (
        <div className="visual-spatial">
          <svg
            className="visual-drawing"
            viewBox="0 0 600 480"
            aria-hidden="true"
          >
            <defs>
              <marker
                id={marker}
                markerWidth="7"
                markerHeight="7"
                refX="5"
                refY="3.5"
                orient="auto"
              >
                <path d="M0 0L6 3.5L0 7" fill="currentColor" />
              </marker>
            </defs>
            {block.kind === "cycle" ? (
              <>
                <circle className="visual-guide" cx="300" cy="240" r="104" />
                <path
                  className="visual-center-arrow"
                  d="M276 243a27 27 0 1 1 43 20m-3-16 4 17 17-4"
                />
                {block.items.map((item, i) => {
                  const angle =
                    -Math.PI / 2 + (i * Math.PI * 2) / block.items.length;
                  const next = angle + (Math.PI * 2) / block.items.length;
                  const point = (a: number) => [
                    300 + 175 * Math.cos(a),
                    240 + 175 * Math.sin(a),
                  ];
                  const [x, y] = point(angle),
                    [sx, sy] = point(angle + 0.27),
                    [ex, ey] = point(next - 0.31);
                  const e = frame.items[i]?.emphasis ?? 0;
                  return (
                    <g key={item.id} style={ink(i)} data-lp-target={target(i)}>
                      <g data-focus-indicator={target(i)} opacity={e}
                        transform={`translate(${x! - 60 - (1 - e) * 12} ${y!})`}>
                        <path className="visual-focus-arrow" d="M-10 -7L0 0L-10 7"/>
                      </g>
                      <circle className="visual-focus-ring" cx={x} cy={y} r="48"
                        pathLength="1" strokeDasharray={`${e} 1`} opacity={e}
                        transform={`rotate(-90 ${x} ${y})`}/>
                      <path
                        className="visual-cycle-link"
                        d={`M${sx} ${sy} A175 175 0 0 1 ${ex} ${ey}`}
                        markerEnd={`url(#${marker})`}
                      />
                      <circle
                        className="visual-node-halo"
                        cx={x}
                        cy={y}
                        r={42 + e * 10}
                        style={{ opacity: 0.15 + e * 0.35 }}
                      />
                      <circle
                        className="visual-node"
                        cx={x}
                        cy={y}
                        r={32 + e * 4}
                      />
                      <text
                        className="visual-node-number"
                        x={x}
                        y={y}
                        dy=".35em"
                        textAnchor="middle"
                      >
                        {number(i)}
                      </text>
                    </g>
                  );
                })}
              </>
            ) : (
              <>
                <path className="visual-guide" d="M280 56V442" />
                {block.items.map((item, i) => {
                  const y =
                      74 +
                      ((block.items.length - 1 - i) * 255) /
                        (block.items.length - 1),
                    e = frame.items[i]?.emphasis ?? 0;
                  return (
                    <g
                      key={item.id}
                      style={ink(i)}
                      transform={`translate(${e * 24} ${y - e * 12})`}
                      data-lp-target={target(i)}
                    >
                      <path className="visual-focus-arrow" data-focus-indicator={target(i)} opacity={e}
                        transform={`translate(${57 - (1 - e) * 12} 65)`} d="M-10 -7L0 0L-10 7"/>
                      <path
                        className="visual-plane-edge"
                        d="M80 65L280 148 480 65V80L280 163 80 80Z"
                      />
                      <path
                        className="visual-plane"
                        d="M80 65L280 -18 480 65 280 148Z"
                      />
                      <path
                        className="visual-plane-line"
                        d="M280 15L400 65 280 115 160 65Z"
                      />
                      <text
                        className="visual-plane-number"
                        x="280"
                        y="74"
                        textAnchor="middle"
                      >
                        {number(i)}
                      </text>
                    </g>
                  );
                })}
              </>
            )}
          </svg>
          {legend}
        </div>
      )}
    </section>
  );
}
