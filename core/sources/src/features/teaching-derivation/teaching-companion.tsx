import { useRef } from "react";
import {
  teachingPolynomialIntegral, teachingPolynomialValue,
  type TeachingDerivationDocumentV1, type TeachingPlotV1, type TeachingVisualV1,
} from "../../../libs/teaching-derivation/src/index.js";
import type { GuidedImageDisplay as GuidedDisplay, MaterialTeachingCueInterval } from "../../../libs/domain/src/index.js";
import { CourseBoardContent } from "../../components/course-display/course-board-content.js";
import { GuidedImageDisplay } from "../../components/course-display/guided-image-display.js";
import { GuidedImageTimelineContext } from "../../components/course-display/use-guided-image-transition.js";
import { usePresentationFit } from "../../components/course-display/presentation-stage.js";
import { SvgMathText } from "../../components/markdown/svg-math-text.js";
import { BoardText } from "./board-text.js";
import { useT } from "../../shared/i18n/index.js";
import "./teaching-companion.css";

const valueLabel = (value: number) => {
  const rounded = Number(value.toPrecision(5));
  return `${Math.abs(value - rounded) > Math.max(Number.MIN_VALUE, Math.abs(value) * 1e-10) ? "≈" : ""}${Object.is(rounded, -0) ? 0 : rounded}`;
};

/** A mathematical plot, evaluated from facts. Geometry never changes on cues. */
export function TeachingFunctionPlot({ plot, targetIds }: { plot: TeachingPlotV1; targetIds: readonly string[] }) {
  const [from, to] = plot.domain;
  const value = (x: number) => teachingPolynomialValue(plot.coefficients, x);
  const xs = Array.from({ length: 241 }, (_, index) => from + (to - from) * index / 240);
  const ys = xs.map(value);
  const low = Math.min(0, ...ys), high = Math.max(0, ...ys);
  const span = high > low ? high - low : 1;
  const ymin = low - span * .16, ymax = high + span * .16;
  const px = (x: number) => 88 + (x - from) / (to - from) * 644;
  const py = (y: number) => 354 - (y - ymin) / (ymax - ymin) * 292;
  const line = xs.map((x, index) => `${index ? "L" : "M"}${px(x)},${py(ys[index]!)}`).join(" ");
  const focused = targetIds.length > 0;
  const ticks = [...new Set([from, to, ...(from <= 0 && to >= 0 ? [0] : []), ...plot.regions.flatMap(region => region.interval), ...plot.markers.map(marker => marker.x)])].sort((a, b) => a - b);
  // Split shading at every sign crossing. The signed result uses the exact
  // polynomial antiderivative, independently of SVG sampling resolution.
  const areaPaths = (a: number, b: number) => {
    const samples = Array.from({ length: 121 }, (_, index) => ({ x: a + (b - a) * index / 120, y: value(a + (b - a) * index / 120) }));
    const segments: { positive: boolean; points: typeof samples }[] = [];
    let segment = { positive: value(a + (b - a) / 10000) >= 0, points: [samples[0]!] };
    for (const next of samples.slice(1)) {
      const previous = segment.points.at(-1)!;
      if (next.y !== 0 && (next.y >= 0) !== segment.positive) {
        const zero = previous.y === 0 ? previous : { x: previous.x + (next.x - previous.x) * Math.abs(previous.y) / (Math.abs(previous.y) + Math.abs(next.y)), y: 0 };
        segment.points.push(zero); segments.push(segment);
        segment = { positive: next.y >= 0, points: [zero] };
      }
      segment.points.push(next);
    }
    segments.push(segment);
    return segments.map(segment => ({ positive: segment.positive,
      d: `M${px(segment.points[0]!.x)},${py(0)} ${segment.points.map(point => `L${px(point.x)},${py(point.y)}`).join(" ")} L${px(segment.points.at(-1)!.x)},${py(0)} Z`,
    }));
  };
  return <figure className="teaching-function-plot" aria-label={plot.title}>
    <svg viewBox="0 0 800 440" role="img" aria-label={plot.title}>
      <line x1="88" x2="732" y1={py(0)} y2={py(0)} className="teaching-plot-axis" />
      <line x1={px(Math.max(from, Math.min(to, 0)))} x2={px(Math.max(from, Math.min(to, 0)))} y1="62" y2="354" className="teaching-plot-axis" />
      {plot.regions.flatMap(region => areaPaths(...region.interval).map((area, index) =>
        <path key={`${region.id}:${index}`} d={area.d} data-visual-target={region.id}
          data-selected={targetIds.includes(region.id)} className={`teaching-plot-area is-${area.positive ? "positive" : "negative"}`}
          opacity={focused && !targetIds.includes(region.id) ? .14 : .42} />))}
      <path d={line} className="teaching-plot-curve" />
      {ticks.map(x => <g key={x}>
        <line x1={px(x)} x2={px(x)} y1={py(0) - 5} y2={py(0) + 5} className="teaching-plot-axis" />
        <text x={px(x)} y="384" textAnchor="middle">{valueLabel(x)}</text>
      </g>)}
      {[low, high].filter((y, index, all) => all.indexOf(y) === index).map(y =>
        <text key={y} x="72" y={py(y) + 7} textAnchor="end">{valueLabel(y)}</text>)}
      {plot.markers.map(marker => <g key={marker.id} data-visual-target={marker.id} data-selected={targetIds.includes(marker.id)}
        opacity={focused && !targetIds.includes(marker.id) ? .4 : 1}>
        <line x1={px(marker.x)} x2={px(marker.x)} y1={py(0)} y2={py(value(marker.x))} className="teaching-plot-guide" />
        <circle cx={px(marker.x)} cy={py(value(marker.x))} r="6" className="teaching-plot-marker" />
      </g>)}
      <SvgMathText x={410} y={414} mathWidth={400} fontSize={32} mathHeight={40} textAnchor="middle">{plot.xLabel}</SvgMathText>
      <SvgMathText x={88} y={28} mathWidth={600} fontSize={32} mathHeight={40}>{plot.yLabel}</SvgMathText>
    </svg>
    {plot.regions.length || plot.markers.length ? <figcaption>
      {plot.regions.map(region => <span key={region.id} data-selected={targetIds.includes(region.id)}>
        <BoardText text={region.label} /> <strong>{valueLabel(teachingPolynomialIntegral(plot.coefficients, ...region.interval))}</strong>
      </span>)}
      {plot.markers.map(marker => <span key={marker.id} data-selected={targetIds.includes(marker.id)} style={{opacity: focused && !targetIds.includes(marker.id) ? .35 : 1}}>
        <BoardText text={marker.label} /> <strong>({valueLabel(marker.x)}, {valueLabel(value(marker.x))})</strong>
      </span>)}
    </figcaption> : null}
  </figure>;
}

function AcceptedDisplay({ source, targetIds, previousTargetIds, progress, timeline }: {
  source: NonNullable<TeachingDerivationDocumentV1["visualDisplays"]>[number]; targetIds: readonly string[];
  previousTargetIds: readonly string[]; progress: number;
  timeline?: { intervals: readonly MaterialTeachingCueInterval[]; tick: number };
}) {
  const viewport = useRef<HTMLDivElement>(null), canvas = useRef<HTMLDivElement>(null);
  usePresentationFit(viewport, canvas, true);
  return <div ref={viewport} className="teaching-companion-viewport course-display-board">
    <div ref={canvas} className="teaching-companion-canvas">
      <CourseBoardContent scene={source.scene} mediaBlock={source.display}
        activeTargetIds={targetIds} previousActiveTargetIds={previousTargetIds} clocked beatEnter={progress}
        teachingTimeline={timeline} mode="classroom" contentSize={{ width: 1000, height: 620 }} />
    </div>
  </div>;
}

/** Same companion contract in reading, classroom and film. Accepted resources
 * go through the existing course renderer, including exact observed pixels. */
export function TeachingCompanion({ document, visual, targetIds = [], previousTargetIds = [], progress = 1, timeline }: {
  document: TeachingDerivationDocumentV1; visual: TeachingVisualV1; targetIds?: readonly string[];
  previousTargetIds?: readonly string[]; progress?: number;
  timeline?: { intervals: readonly MaterialTeachingCueInterval[]; tick: number };
}) {
  const t = useT();
  if (visual.kind === "plot") return <TeachingFunctionPlot plot={visual} targetIds={targetIds} />;
  if (visual.kind === "display") {
    const source = document.visualDisplays?.find(item => item.id === visual.displayId);
    return source ? <AcceptedDisplay source={source} targetIds={targetIds} previousTargetIds={previousTargetIds} progress={progress} timeline={timeline} />
      : <p role="status">{t("teachingDerivation.visualUnavailable")}</p>;
  }
  const asset = document.visualAssets?.find(item => item.id === visual.assetId);
  if (!asset) return <p role="status">{t("teachingDerivation.visualUnavailable")}</p>;
  const display: GuidedDisplay = {
    type: "guided_image", schemaVersion: 1, id: asset.id, image: asset.image, segmentation: asset.segmentation,
    intent: { id: asset.id, title: asset.title, language: document.locale, learningGoal: document.teachingGoal,
      assumedKnowledge: "", composition: "", parts: [], relationships: [] },
    cutouts: [], beats: [], persona: { ref: "", name: "", avatarCode: "" }, sourceFingerprint: asset.image.sha256,
  };
  return <GuidedImageTimelineContext.Provider value>
    <GuidedImageDisplay display={display} activeTargetIds={targetIds} previousActiveTargetIds={previousTargetIds}
      clocked beatEnter={progress} interactive={false} />
  </GuidedImageTimelineContext.Provider>;
}
