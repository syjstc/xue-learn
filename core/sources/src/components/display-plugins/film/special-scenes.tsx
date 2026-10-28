import {InlineMathText} from "../../markdown/inline-math-text.js";
import {SvgMathText} from "../../markdown/svg-math-text.js";
import React, {type CSSProperties} from 'react';
import type {
  ConceptNetworkPresentationProps,
  PresentationSceneV1,
} from "./special-types.js";
import type {CaptionTrack, CompiledVideoTimelineV1} from './timeline.js';
import {World, Observation} from './world.js';
import {isVisible} from './world-geometry.js';
import {THEME as T, readableAccent, tint} from './theme.js';

/**
 * Boards are ordinary React/SVG, sampled exclusively from the classroom's
 * 48 kHz tick. They contain no Remotion hook, teacher, title, caption or brand.
 *
 * concept-network: props determine immutable node positions. overview retains
 * the whole graph; focus emphasizes named nodes; connect follows one declared
 * directed edge. The fixed lower explanation slot shows the selected node's
 * detail (the destination for connect). No cue changes node wrapping.
 *
 * occlusion-compare: overview is a labeled spatial teaching view; cutaway lifts
 * its wall. observe contains only the canonical model-input renderer, without
 * hidden-state labels/shadows. advance moves each targeted world by exactly one
 * cell, simultaneously for a shared cue; repeated advance is never cumulative.
 * result shows the canonical observation at startCell + moveBy. A later observe
 * retains any move already requested. Unbound beats retain the latest cue.
 */
const WIDTH = 1516.8;
const HEIGHT = 777.6;
const RATE = 48_000;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const ease = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t); };
const lerp = (from: number, to: number, progress: number) => from + (to - from) * progress;
const font = 'var(--font-sans, "PingFang SC", "Noto Sans SC", sans-serif)';
const textStyle: CSSProperties = {fontFamily: font, color: T.ink, boxSizing: 'border-box'};
type Point = {x: number; y: number};
type ScheduledCue = {
  action: string;
  targetIds: readonly string[];
  startTick: number;
  durationTicks: number;
};
type CueState = ScheduledCue & {elapsedSeconds: number; index: number};

function scheduledCues(scenePlan: PresentationSceneV1, timeline: CompiledVideoTimelineV1): ScheduledCue[] {
  const captions = new Map<string, CaptionTrack>();
  for (const track of timeline.tracks) {
    if (track.kind === 'caption' && track.beatId && !captions.has(track.beatId)) captions.set(track.beatId, track as CaptionTrack);
  }
  return scenePlan.cues.flatMap(cue => {
    const caption = captions.get(cue.beatId);
    return caption ? [{...cue, startTick: caption.startTick, durationTicks: caption.durationTicks}] : [];
  }).sort((a, b) => a.startTick - b.startTick);
}

function cueAt(events: readonly ScheduledCue[], tick: number, sceneStart: number): CueState {
  let index = -1;
  for (let i = 0; i < events.length; i++) {
    if (events[i]!.startTick <= tick) index = i;
    else break;
  }
  const current = index < 0
    ? {action: 'overview', targetIds: [], startTick: sceneStart, durationTicks: RATE}
    : events[index]!;
  return {...current, index, elapsedSeconds: Math.max(0, tick - current.startTick) / RATE};
}

function domId(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return `board-${(hash >>> 0).toString(36)}`;
}

function BoardCanvas({children, component, action}: {
  children: React.ReactNode; component: string; action: string;
}) {
  return <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" height="100%"
    data-presentation-component={component} data-presentation-action={action}
    style={{display: 'block', overflow: 'hidden', fontFamily: font, isolation: 'isolate'}}>
    {children}
  </svg>;
}

function HtmlBox({x, y, width, height, children, style}: {
  x: number; y: number; width: number; height: number; children: React.ReactNode; style?: CSSProperties;
}) {
  return <foreignObject x={x} y={y} width={width} height={height}>
    <div style={{...textStyle, width: '100%', height: '100%', ...style}}>{children}</div>
  </foreignObject>;
}

const NODE_WIDTH = 430;
const NODE_HEIGHT = 142;
function nodePositions(count: number, hasDetail: boolean): Point[] {
  const stretch = hasDetail ? 1 : 1.32;
  const y = (value: number) => 80 + (value - 80) * stretch + (hasDetail ? 0 : 38);
  const layouts: Record<number, Point[]> = {
    1: [{x: WIDTH / 2, y: y(250)}],
    2: [{x: 300, y: y(250)}, {x: WIDTH - 300, y: y(250)}],
    3: [{x: WIDTH / 2, y: y(92)}, {x: 300, y: y(390)}, {x: WIDTH - 300, y: y(390)}],
    4: [{x: 300, y: y(102)}, {x: WIDTH - 300, y: y(102)},
      {x: 300, y: y(400)}, {x: WIDTH - 300, y: y(400)}],
    5: [{x: WIDTH / 2, y: y(82)}, {x: 260, y: y(258)}, {x: WIDTH - 260, y: y(258)},
      {x: 430, y: y(434)}, {x: WIDTH - 430, y: y(434)}],
    6: [{x: 280, y: y(82)}, {x: WIDTH - 280, y: y(82)},
      {x: 280, y: y(252)}, {x: WIDTH - 280, y: y(252)},
      {x: 280, y: y(422)}, {x: WIDTH - 280, y: y(422)}],
  };
  return layouts[count] ?? layouts[1]!;
}

type Curve = {from: Point; c1: Point; c2: Point; to: Point};
function edgeCurve(from: Point, to: Point, index: number): Curve {
  if (Math.abs(from.x - to.x) < 40) {
    const side = from.x < WIDTH / 2 ? -1 : 1;
    const port = side * NODE_WIDTH / 2;
    const bend = side < 0 ? 15 : WIDTH - 15;
    return {from: {x: from.x + port, y: from.y}, c1: {x: bend, y: from.y},
      c2: {x: bend, y: to.y}, to: {x: to.x + port, y: to.y}};
  }
  const sign = to.x > from.x ? 1 : -1;
  const a = {x: from.x + sign * NODE_WIDTH / 2, y: from.y};
  const b = {x: to.x - sign * NODE_WIDTH / 2, y: to.y};
  const distance = Math.max(100, Math.abs(b.x - a.x) * .48);
  const bend = from.y === to.y ? (index % 2 ? 26 : -26) : 0;
  return {from: a, c1: {x: a.x + sign * distance, y: a.y + bend},
    c2: {x: b.x - sign * distance, y: b.y + bend}, to: b};
}
function curvePoint(curve: Curve, progress: number): Point {
  const p = clamp(progress), q = 1 - p;
  return {
    x: q ** 3 * curve.from.x + 3 * q * q * p * curve.c1.x + 3 * q * p * p * curve.c2.x + p ** 3 * curve.to.x,
    y: q ** 3 * curve.from.y + 3 * q * q * p * curve.c1.y + 3 * q * p * p * curve.c2.y + p ** 3 * curve.to.y,
  };
}
function curvePath(curve: Curve) {
  return `M${curve.from.x} ${curve.from.y} C${curve.c1.x} ${curve.c1.y},${curve.c2.x} ${curve.c2.y},${curve.to.x} ${curve.to.y}`;
}

function NetworkBoard({props, cue, previousCue, sceneId, sceneSeconds}: {
  props: ConceptNetworkPresentationProps; cue: CueState; previousCue: CueState;
  sceneId: string; sceneSeconds: number;
}) {
  const hasDetail = props.nodes.some(node => !!node.detail) || props.edges.some(edge => !!edge.label);
  const points = nodePositions(props.nodes.length, hasDetail);
  const indexFor = (id: string) => props.nodes.findIndex(node => node.id === id);
  const focused = cue.action !== 'overview' && cue.targetIds.length > 0;
  const enter = ease(cue.elapsedSeconds / .7);
  const focusAmount = (id: string) => {
    const current = !focused || cue.targetIds.includes(id) ? 1 : .28;
    const oldFocused = previousCue.action !== 'overview' && previousCue.targetIds.length > 0;
    const previous = !oldFocused || previousCue.targetIds.includes(id) ? 1 : .28;
    return lerp(previous, current, enter);
  };
  const connectedEdge = cue.action === 'connect'
    ? props.edges.find(edge => edge.from === cue.targetIds[0] && edge.to === cue.targetIds[1]) : undefined;
  const detailId = connectedEdge?.to ?? cue.targetIds[0];
  const detailNode = props.nodes.find(node => node.id === detailId)
    ?? props.nodes.find(node => !!node.detail) ?? props.nodes[0]!;
  const explanationTitle = connectedEdge
    ? connectedEdge.label ?? `${props.nodes[indexFor(connectedEdge.from)]!.label} → ${detailNode.label}`
    : detailNode.label;
  const markerId = domId(`${sceneId}-arrow`);
  return <BoardCanvas component="concept-network.v1" action={cue.action}>
    <defs><marker id={markerId} viewBox="0 0 12 12" refX="10" refY="6"
      markerWidth="9" markerHeight="9" orient="auto-start-reverse">
      <path d="M2 2 L10 6 L2 10" fill="none" stroke={T.accent} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </marker></defs>
    {props.edges.map((edge, index) => {
      const curve = edgeCurve(points[indexFor(edge.from)]!, points[indexFor(edge.to)]!, index);
      const active = cue.action === 'connect'
        ? edge === connectedEdge
        : !focused || cue.targetIds.includes(edge.from) || cue.targetIds.includes(edge.to);
      const progress = cue.action === 'connect' && active ? ease(cue.elapsedSeconds / 1.05) : 1;
      const color = active ? T.accent : T.tertiary;
      return <g key={`${edge.from}-${edge.to}`} data-edge-from={edge.from} data-edge-to={edge.to}>
        <path d={curvePath(curve)} fill="none" stroke={color} strokeWidth="2" strokeOpacity={active ? .25 : .17} />
        <path d={curvePath(curve)} fill="none" stroke={color} strokeWidth={active ? 3 : 1.5}
          strokeOpacity={active ? .8 : .2} pathLength="1" strokeDasharray={`${progress} 1`}
          markerEnd={active && progress > .995 ? `url(#${markerId})` : undefined} />
        {active && Array.from({length: 3}, (_, particle) => {
          const phase = ((cue.elapsedSeconds * .24 + particle / 3) % 1) * progress;
          const p = curvePoint(curve, phase);
          return <g key={particle} opacity={ease(cue.elapsedSeconds / .5) * (focused ? 1 : .5)}>
            <circle cx={p.x} cy={p.y} r="12" fill={color} opacity=".09" />
            <circle cx={p.x} cy={p.y} r="4" fill={color} />
          </g>;
        })}
      </g>;
    })}
    {props.nodes.map((node, index) => {
      const point = points[index]!;
      const amount = focusAmount(node.id);
      const appearing = ease((sceneSeconds - index * .08) / .55);
      const color = index % 2 ? T.compare : T.accent;
      return <g key={node.id} data-concept-id={node.id}
        opacity={appearing} transform={`translate(0 ${(1 - appearing) * 14})`}>
        <rect x={point.x - NODE_WIDTH / 2 - 7} y={point.y - NODE_HEIGHT / 2 - 7}
          width={NODE_WIDTH + 14} height={NODE_HEIGHT + 14} rx={T.radius + 7}
          fill={tint(color, focused ? .04 + amount * .05 : .025)} />
        <rect x={point.x - NODE_WIDTH / 2} y={point.y - NODE_HEIGHT / 2}
          width={NODE_WIDTH} height={NODE_HEIGHT} rx={T.radius}
          fill={T.surface} stroke={focused && amount > .5 ? color : T.border} strokeWidth={1 + amount} />
        <path d={`M${point.x - NODE_WIDTH / 2 + 25} ${point.y - NODE_HEIGHT / 2 + 1} H${point.x + NODE_WIDTH / 2 - 25}`}
          stroke={color} strokeWidth="3" opacity={amount} />
        <circle cx={point.x - NODE_WIDTH / 2 + 30} cy={point.y} r="5" fill={color} opacity={.4 + amount * .6} />
        <HtmlBox x={point.x - NODE_WIDTH / 2 + 43} y={point.y - NODE_HEIGHT / 2 + 14}
          width={NODE_WIDTH - 57} height={NODE_HEIGHT - 28}
          style={{display: 'flex', alignItems: 'center', fontSize: 26, lineHeight: 1.25,
            fontWeight: 650, overflowWrap: 'anywhere', color: focused && amount > .5 ? readableAccent(color) : T.ink}}>
          <span><InlineMathText text={node.label}/></span>
        </HtmlBox>
      </g>;
    })}
    {hasDetail && <>
      <rect x="26" y="526" width={WIDTH - 52} height="234" rx={T.radius}
        fill={T.surface} stroke={T.borderLight} />
      <rect x="26" y="550" width="4" height="185" rx="2" fill={T.accent} />
      <HtmlBox x={53} y={545} width={WIDTH - 106} height={196}>
        <div style={{fontSize: 26, lineHeight: 1.25, fontWeight: 650, color: T.accentText,
          overflowWrap: 'anywhere', marginBottom: 12}}><InlineMathText text={explanationTitle}/></div>
        {detailNode.detail && <div style={{fontSize: 26, lineHeight: 1.35, overflowWrap: 'anywhere'}}><InlineMathText text={detailNode.detail}/></div>}
      </HtmlBox>
    </>}
  </BoardCanvas>;
}

function worldPosition(startCell: number, id: string, events: readonly ScheduledCue[], tick: number, moveBy: number) {
  let movement: ScheduledCue | undefined;
  for (const event of events) {
    if (event.startTick > tick) break;
    if (!event.targetIds.includes(id)) continue;
    if (event.action === 'result') return startCell + moveBy;
    if (event.action === 'advance' && !movement) movement = event;
  }
  if (!movement) return startCell;
  const progress = movement.action === 'result' ? 1 : ease((tick - movement.startTick) / RATE / 1.2);
  return startCell + moveBy * progress;
}

function OcclusionBoard({scenePlan, events, cue, previousCue, tick, sceneSeconds}: {
  scenePlan: Extract<PresentationSceneV1, {componentId: 'occlusion-compare.v1'}>;
  events: readonly ScheduledCue[]; cue: CueState; previousCue: CueState; tick: number; sceneSeconds: number;
}) {
  const {worlds, moveBy} = scenePlan.props;
  const observation = cue.action === 'observe' || cue.action === 'result';
  const advancing = cue.action === 'advance';
  const revealFor = (action: string) => action === 'cutaway' || action === 'advance' ? .94 : 0;
  const reveal = lerp(revealFor(previousCue.action), revealFor(cue.action), ease(cue.elapsedSeconds / .7));
  const positions = worlds.map(world => worldPosition(world.startCell, world.id, events, tick, moveBy));
  const center = WIDTH / 2;
  const cardWidth = worlds.length === 2 ? 684 : 1040;
  const centers = worlds.length === 2 ? [360, WIDTH - 360] : [center];
  const sameObservation = worlds.length === 2 && ((!isVisible(positions[0]!) && !isVisible(positions[1]!))
    || positions[0] === positions[1]);
  const phaseLabel = observation
    ? cue.action === 'result' ? '模型输入 · 移动后的观测' : '模型输入 · 当前观测'
    : advancing ? '教学透视 · 同一次动作' : cue.action === 'cutaway'
      ? '教学透视 · 隐藏状态' : '空间示意 · 非模型输入';
  return <BoardCanvas component="occlusion-compare.v1" action={cue.action}>
    <rect x="25" y="17" width={WIDTH - 50} height="63" rx={T.radiusHud}
      fill={tint(observation ? T.compare : T.accent, .055)} stroke={T.borderLight} />
    <circle cx="52" cy="48" r="5" fill={observation ? T.compare : T.accent} />
    <SvgMathText x="69" y="58" fill={observation ? T.compareText : T.accentText} fontSize="28" fontWeight="600">{phaseLabel}</SvgMathText>
    <SvgMathText x={WIDTH - 53} y="57" textAnchor="end" fill={T.muted} fontSize="23">
      {observation ? '只显示相机能看到的画面' : '墙遮挡第 2–4 格，不阻止移动'}
    </SvgMathText>
    {worlds.map((world, index) => {
      const cx = centers[index]!;
      const position = positions[index]!;
      const color = index ? T.compare : T.accent;
      const selected = cue.targetIds.length === 0 || cue.targetIds.includes(world.id);
      const id = domId(`${scenePlan.sceneId}-${world.id}`);
      return <g key={world.id} data-world-id={world.id}>
        <HtmlBox x={cx - cardWidth / 2 + 9} y={106} width={cardWidth - 18 - (worlds.length === 1 ? 180 : 0)} height={84}
          style={{fontSize: 30, fontWeight: 650, lineHeight: 1.2, overflowWrap: 'anywhere',
            textAlign: 'center', color: readableAccent(color), display: 'grid', placeItems: 'center'}}>
          {world.label}
        </HtmlBox>
        {observation ? <>
          <rect x={cx - cardWidth / 2} y="226" width={cardWidth} height={cardWidth / 2.4}
            rx={T.radius} fill={T.surface} stroke={T.border} />
          <foreignObject x={cx - cardWidth / 2 + 6} y="232" width={cardWidth - 12} height={(cardWidth - 12) / 2.4}
            data-model-input="true">
            <Observation id={`${id}-observation`} position={position} />
          </foreignObject>
        </> : <>
          <foreignObject x={cx - (worlds.length === 2 ? 820 : 1340) / 2} y={174}
            width={worlds.length === 2 ? 820 : 1340} height={411} data-teaching-perspective="true">
            <World id={`${id}-world`} t={sceneSeconds * 30} position={position}
              accent={color} reveal={selected ? reveal : 0} build={ease(sceneSeconds / .7)}
              trail={advancing ? Math.max(0, position - world.startCell) : 0}
              camera={{yaw: lerp(index ? .16 : -.23, index ? .09 : -.12, ease(cue.elapsedSeconds / 1.5)),
                pitch: lerp(.4, advancing ? .55 : .45, ease(cue.elapsedSeconds / 1.2)), scale: worlds.length === 2 ? 1.25 : 1.08}} />
          </foreignObject>
          <SvgMathText x={cx} y="629" textAnchor="middle" fill={T.muted} fontSize="26">
            {cue.action === 'cutaway' || advancing
              ? `第 ${world.startCell} 格${advancing ? ` → 第 ${world.startCell + moveBy} 格` : ''}`
              : '教学空间视角，不能作为模型输入'}
          </SvgMathText>
        </>}
      </g>;
    })}
    {worlds.length === 2 && <path d={`M${center} 203 V605`} stroke={T.border} strokeDasharray="3 9" strokeOpacity=".75" />}
    {advancing && <g transform={`translate(${worlds.length === 1 ? center + cardWidth / 2 - 78 : center} 164) scale(${1 + Math.sin(Math.PI * ease(cue.elapsedSeconds / .8)) * .08})`}>
      <rect x="-67" y="-33" width="134" height="66" rx={T.radiusHud} fill={T.surface} stroke={T.accent} />
      <SvgMathText x="0" y="12" textAnchor="middle" fontSize="38" fontWeight="650" fill={T.accentText}>→ +1</SvgMathText>
    </g>}
    {observation && worlds.length === 2 && <g>
      <circle cx={center} cy="369" r="36" fill={T.stage} />
      <SvgMathText x={center} y="384" textAnchor="middle" fill={sameObservation ? T.accentText : T.cautionText} fontSize="53">
        {sameObservation ? '=' : '≠'}
      </SvgMathText>
    </g>}
    <HtmlBox x={80} y={684} width={WIDTH - 160} height={67}
      style={{display: 'grid', placeItems: 'center', fontSize: 30, lineHeight: 1.35,
        fontWeight: 600, textAlign: 'center', color: observation && !sameObservation && worlds.length === 2 ? T.cautionText : T.ink}}>
      {observation ? worlds.length === 2
        ? sameObservation ? '观测相同' : '观测不同'
        : isVisible(positions[0]!) ? '目标出现在画面中' : '画面中看不到目标'
        : advancing ? '向右移动一格，然后比较新的观测'
        : cue.action === 'cutaway' ? '透视只用来解释实际状态，不会进入模型输入' : '先区分真实状态与能看到的观测'}
    </HtmlBox>
  </BoardCanvas>;
}

export function SpecialBoard({scenePlan, timeline, tick}: {
  scenePlan: PresentationSceneV1;
  timeline: CompiledVideoTimelineV1;
  tick: number;
}) {
  const events = scheduledCues(scenePlan, timeline);
  const interval = timeline.scenes.find(scene => scene.id === scenePlan.sceneId);
  const sceneStart = interval?.startTick ?? 0;
  // During a scene crossfade the outgoing board stays at its own final tick.
  const sampledTick = interval ? Math.max(interval.startTick, Math.min(interval.endTick - 1, tick)) : tick;
  const cue = cueAt(events, sampledTick, sceneStart);
  const previousCue = cue.index > 0
    ? cueAt(events.slice(0, cue.index), sampledTick, sceneStart)
    : cueAt([], sampledTick, sceneStart);
  const sceneSeconds = Math.max(0, sampledTick - sceneStart) / RATE;
  return scenePlan.componentId === 'concept-network.v1'
    ? <NetworkBoard props={scenePlan.props} cue={cue} previousCue={previousCue}
        sceneId={scenePlan.sceneId} sceneSeconds={sceneSeconds} />
    : <OcclusionBoard scenePlan={scenePlan} events={events} cue={cue} previousCue={previousCue}
        tick={sampledTick} sceneSeconds={sceneSeconds} />;
}
