import React, { useId } from "react";
import {TeachingFocus} from "../teaching-focus.js";
import type { MaterialTeachingItemMotion } from "../../../../../libs/domain/src/index.js";
type TeachingTemplateLayerMotion = {focusId?: string; layers: readonly MaterialTeachingItemMotion[]};
import {
  Diagram,
  Label,
  TextBox,
  Card,
  Arrow,
  T,
  tint,
  progress,
  ease,
  type SceneProps,
} from "./primitives.js";
import {Burst, Comet, GlowRect, Halo, Pop, Shine, Wipe, easeOutBack, easeOutExpo, span} from "./motion-kit.js";
export type QuestionContent = {
  objects: [string, string];
  glyphs: [
    "paper" | "boat" | "read" | "recall" | "object" | "question",
    "paper" | "boat" | "read" | "recall" | "object" | "question",
  ];
  observations: [string, string];
  question: string;
  goal: string;
};
export type LayersContent = { layers: { title: string; detail: string }[] };
export type FlowContent = { nodes: string[]; caption: string };
export type CompareContent = {
  names: [string, string];
  metrics: {
    label: string;
    unit: string;
    values: [number, number];
    max: number;
  }[];
};
export type SummaryContent = {
  concepts: [string, string, string];
  center: string;
  transfer: string;
};
export const QUESTION_PRESETS: QuestionContent[] = [
  {
    objects: ["展开的纸", "折成的纸船"],
    glyphs: ["paper", "boat"],
    observations: ["接触水后逐渐下沉", "相同材料，形状改变"],
    question: "为什么形状会改变浮沉？",
    goal: "用排水体积解释浮力",
  },
  {
    objects: ["反复阅读", "主动回忆"],
    glyphs: ["read", "recall"],
    observations: ["熟悉内容", "尝试提取内容"],
    question: "熟悉，是否等于记住？",
    goal: "用延迟测试比较记忆",
  },
];
export const LAYERS_PRESETS: LayersContent[] = [
  {
    layers: [
      { title: "应用层", detail: "用户想完成什么" },
      { title: "系统层", detail: "协调资源与服务" },
      { title: "硬件层", detail: "执行与存储" },
    ],
  },
  {
    layers: [
      { title: "主张", detail: "需要说明的结论" },
      { title: "推理", detail: "证据如何支持主张" },
      { title: "证据", detail: "可观察、可核查的事实" },
    ],
  },
];
export const FLOW_PRESETS: FlowContent[] = [
  {
    nodes: ["光线", "视网膜", "神经信号", "视觉知觉"],
    caption: "沿着信息传递的方向，逐步追踪变化",
  },
  {
    nodes: ["需求", "设计", "原型", "检验"],
    caption: "每一步产生下一步可使用的结果",
  },
];
export const COMPARE_PRESETS: CompareContent[] = [
  {
    names: ["反复阅读", "主动回忆"],
    metrics: [
      { label: "当天测试", unit: "分", values: [88, 82], max: 100 },
      { label: "一周后测试", unit: "分", values: [52, 76], max: 100 },
      { label: "练习时间", unit: "分钟", values: [20, 20], max: 30 },
    ],
  },
  {
    names: ["公交方案", "步行方案"],
    metrics: [
      { label: "耗时", unit: "分钟", values: [18, 35], max: 40 },
      { label: "费用", unit: "元", values: [2, 0], max: 4 },
      { label: "步行距离", unit: "公里", values: [0.5, 2.4], max: 3 },
    ],
  },
];
export const SUMMARY_PRESETS: SummaryContent[] = [
  {
    concepts: ["共同变化", "排除其他解释", "可重复验证"],
    center: "因果判断",
    transfer: "新情境：成绩提高，能否归因于某一种练习？",
  },
  {
    concepts: ["组成要素", "连接关系", "反馈与边界"],
    center: "系统理解",
    transfer: "新情境：校园食堂排队，瓶颈可能在哪里？",
  },
];
function ObservationGlyph({
  kind,
  color,
  time,
  focus,
}: {
  kind: QuestionContent["glyphs"][number];
  color: string;
  time: number;
  focus: number;
}) {
  if (kind === "object" || kind === "question")
    return (
      <g>
        <rect x="-36" y="-36" width="72" height="72" rx="18" fill={tint(color, 0.15)} stroke={color} strokeWidth="2" />
        {kind === "question" ? <Label x={0} y={15} size={43} color={color}>?</Label> : <path d="M-19 -11 L0 -22 L19 -11 V12 L0 23 L-19 12Z M0 0 L19 -11 M0 0 L-19 -11 M0 0 V23" fill="none" stroke={color} strokeWidth="2" />}
      </g>
    );
  if (kind === "paper" || kind === "boat")
    return (
      <g>
        <path
          d="M-55 23 Q-40 17 -25 23 T5 23 T35 23 T60 23"
          stroke={T.compare}
          strokeWidth="2"
          fill="none"
        />
        {kind === "paper" ? (
          <g transform={`translate(0 ${focus * 25}) rotate(-9)`}>
            <rect
              x="-37"
              y="-14"
              width="74"
              height="22"
              rx="2"
              fill={tint(color, 0.22)}
              stroke={color}
              strokeWidth="2"
            />
            <path d="M-27 -4 H27" stroke={color} />
          </g>
        ) : (
          <g transform={`translate(0 ${Math.sin(time * 1.4) * 2})`}>
            <path
              d="M-48 3 H48 L25 22 H-25 Z M-24 3 L3 -26 L27 3"
              fill={tint(color, 0.3)}
              stroke={color}
              strokeWidth="2"
            />
            <path d="M3 -26 V3" stroke={color} />
          </g>
        )}
      </g>
    );
  return (
    <g>
      <path
        d="M0 -24 Q-20 -39 -43 -28 V26 Q-20 16 0 30 Q20 16 43 26 V-28 Q20 -39 0 -24 Z"
        fill={tint(color, 0.15)}
        stroke={color}
        strokeWidth="2"
      />
      <path d="M0 -24 V30" stroke={color} strokeWidth="2" />
      {kind === "read"
        ? [-15, -3, 9].map((y) => (
            <path
              key={y}
              d={`M-32 ${y} L-10 ${y + 3} M10 ${y + 3} L32 ${y}`}
              stroke={color}
              strokeWidth="2"
            />
          ))
        : [0, 1, 2].map((i) => (
            <circle
              key={i}
              cx={-25 + i * 25}
              cy={-40 - focus * (12 + (i % 2) * 8)}
              r="5"
              fill={color}
            />
          ))}
    </g>
  );
}
export function QuestionScene({
  content,
  frame,
  fps,
  motionSeconds,
}: SceneProps & { content: QuestionContent; motionSeconds?: number }) {
  const t = frame / fps,
    lin = (start: number, duration: number) => Math.max(0, Math.min(1, (t - start) / duration)),
    focus = progress(frame, fps, 4, 2),
    answer = lin(8, 1.1);
  const colors = [T.accent, T.compare];
  return (
    <Diagram label="问题与学习目标">
      {motionSeconds !== undefined && <g aria-hidden="true" opacity={0.5 * lin(0, 1.5)}
        transform={`rotate(${motionSeconds * 4} 500 166)`}>
        <circle cx="500" cy="166" r="232" fill="none" stroke={T.border} strokeWidth="1.5" strokeDasharray="3 13"/>
      </g>}
      {[0, 1].map((i) => {
        const cx = 300 + i * 400, color = colors[i]!, enter = lin(0.3 + i * 0.45, 0.95);
        return (
          <g key={i} opacity={Math.min(1, enter * 3)}>
            <Halo cx={cx} cy={165} r={78} seconds={motionSeconds} amount={focus * (1 - answer * 0.7)} color={color} period={2.6}/>
            <Pop x={cx} y={165} amount={enter} rise={26}>
              <circle cx={cx} cy="165" r={72 + (i ? focus * 12 : 0)} fill={tint(color, 0.12)}/>
              <circle cx={cx} cy="165" r={72 + (i ? focus * 12 : 0)} fill="none" stroke={color} strokeWidth="2.5"
                pathLength={1} strokeDasharray={1} strokeDashoffset={1 - easeOutExpo(span(enter, 0.15, 1))}
                transform={`rotate(-90 ${cx} 165)`}/>
              <circle cx={cx} cy="165" r={58} fill="none" stroke={tint(color, 0.35)} strokeWidth="1" strokeDasharray="2 6"/>
              <g transform={`translate(${cx} 165)`}>
                <ObservationGlyph kind={content.glyphs[i]} color={color} time={t} focus={focus}/>
              </g>
            </Pop>
            <TeachingFocus id={`object-${i + 1}`} operations={["observe", "compare"]} x={215 + i * 400} y={82} width={170} height={224}/>
            <TeachingFocus id={`observation-${i + 1}`} operations={[]} x={126 + i * 400} y={313} width={348} height={68}/>
            <g opacity={span(enter, 0.35, 1)} transform={`translate(0 ${(1 - easeOutExpo(span(enter, 0.35, 1))) * 14})`}>
              <TextBox x={135 + i * 400} y={255} width={330} height={57} text={content.objects[i]} size={22} lineHeight={27}/>
              <TextBox x={130 + i * 400} y={316} width={340} height={63} text={content.observations[i]} size={17} lineHeight={20} color={T.muted} weight={450}/>
            </g>
          </g>
        );
      })}
      <TeachingFocus id="question" operations={[]} x={38} y={7} width={924} height={78}/>
      <Wipe x={40} y={0} width={920} height={90} amount={lin(0, 1.1)}>
        <TextBox x={40} y={9} width={920} height={74} text={content.question} size={24} lineHeight={30}/>
      </Wipe>
      <rect x={500 - 90 * easeOutExpo(lin(0.7, 0.9))} y="86" width={180 * easeOutExpo(lin(0.7, 0.9))} height="4" rx="2" fill={T.accent}/>
      <g opacity={focus}>
        {[0, 1].map(side => <path key={side} d={side ? "M630 166 H548" : "M370 166 H452"} stroke={T.muted} strokeWidth="2.5"
          strokeLinecap="round" strokeDasharray="6 9" strokeDashoffset={motionSeconds !== undefined ? -motionSeconds * 36 : 0}/>)}
        <Burst cx={500} cy={166} r={34} amount={focus} color={T.accent}/>
        <Pop x={500} y={166} amount={focus}>
          <rect x="455" y="146" width="90" height="40" rx="20" fill={T.surface} stroke={T.accent} strokeWidth="2"/>
          <Label x={500} y={172} size={18} color={T.accentText}>比较</Label>
        </Pop>
      </g>
      <g opacity={Math.min(1, answer * 4)}>
        <GlowRect x={90} y={404} width={820} height={76} radius={24} amount={answer}/>
        <Wipe x={90} y={400} width={820} height={84} amount={answer}>
          <rect x="90" y="404" width="820" height="76" rx="24" fill={T.accent} />
          <TextBox x={110} y={411} width={780} height={62} text={content.goal} color={T.inverse} size={23} lineHeight={28}/>
        </Wipe>
        <Shine x={90} y={404} width={820} height={76} radius={24} amount={lin(8.9, 1.3)}/>
        <TeachingFocus id="learning-goal" operations={["goal"]} x={88} y={402} width={824} height={80} color={T.caution}/>
      </g>
    </Diagram>
  );
}
export function LayersScene({
  content,
  frame,
  fps,
  layerMotion,
  structureProgress,
  itemTargetIds,
}: SceneProps & { content: LayersContent; layerMotion?: TeachingTemplateLayerMotion; structureProgress?: number; itemTargetIds?: readonly string[] }) {
  const id = useId().replace(/:/g, "");
  const count = content.layers.length;
  const spread = structureProgress === undefined ? progress(frame, fps, 1, 5) : ease(structureProgress);
  const rowStep = count >= 5 ? 100 : count === 4 ? 124 : count === 3 ? 144 : 184;
  const cardHeight = count >= 5 ? 94 : count === 4 ? 118 : 130;
  const rowTop = (500 - ((count - 1) * rowStep + cardHeight)) / 2;
  const colors = [T.accent, T.compare, T.positive, T.caution, T.tertiary].slice(0, Math.max(4, count));
  const layers = content.layers.map((layer, index) => {
    const target = layerMotion?.layers[index];
    const reveal = target ? ease(target.reveal) : progress(frame, fps, 1 + index * (3.8 / count), 1.1);
    const focus = target ? ease(target.focus) : 0;
    const cardY = rowTop + index * rowStep;
    const assembledY = 210 + index * 18;
    const explodedY = cardY + cardHeight / 2 - 4;
    return {layer, index, color: colors[index], reveal, focus, cardY,
      x: 88 + (count - index - 1) * 10 - focus * 8,
      y: assembledY + (explodedY - assembledY) * spread - focus * 5};
  });
  return (
    <Diagram label="结构分层">
      <defs>
        {colors.map((color, index) => <React.Fragment key={color}>
          <linearGradient id={`layer-top-${id}-${index}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={T.surface}/><stop offset="1" stopColor={tint(color, .3)}/>
          </linearGradient>
          <linearGradient id={`layer-front-${id}-${index}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={tint(color, .65)}/><stop offset="1" stopColor={tint(color, .38)}/>
          </linearGradient>
        </React.Fragment>)}
        <filter id={`layer-shadow-${id}`} x="-30%" y="-100%" width="160%" height="300%"><feGaussianBlur stdDeviation="7"/></filter>
      </defs>
      <ellipse cx="309" cy={302 + spread * 162} rx="201" ry="15" fill={tint(T.ink, .09)} filter={`url(#layer-shadow-${id})`}/>
      {layers.slice().reverse().map(({index, color, focus, x, y}) => <g key={index} transform={`translate(${x} ${y})`} data-layer-object={`layer-${index + 1}`} data-lp-target={itemTargetIds?.[index]} data-layer-focus={focus}>
        <path d="M15 20 L105 -17 H405 L315 20Z" fill={tint(color, .1 + focus * .12)} transform="translate(0 19)" filter={`url(#layer-shadow-${id})`}/>
        <path d="M315 20 L405 -17 V3 L315 40Z" fill={tint(color, .54 + focus * .18)}/>
        <path d="M15 20 H315 V40 H15Z" fill={`url(#layer-front-${id}-${index})`}/>
        <path d="M15 20 L105 -17 H405 L315 20Z" fill={`url(#layer-top-${id}-${index})`} stroke={tint(color, .75)} strokeWidth={1.5 + focus * 1.5} strokeLinejoin="round"/>
        <path d="M17 21 H314" stroke={T.surface} strokeWidth="1.5" opacity=".75"/>
        <path d="M36 31 H58" stroke={T.surface} strokeWidth="3" strokeLinecap="round" opacity=".85"/>
      </g>)}
      {layers.map(({layer, index, color, reveal, focus, x, y, cardY}) => <g key={index} data-layer-detail={`layer-${index + 1}`} data-layer-reveal={reveal} opacity={reveal}>
        <path d={`M${x + 371} ${y + 9} C${x + 427} ${y + 9} 499 ${cardY + cardHeight / 2} 548 ${cardY + cardHeight / 2}`} fill="none" stroke={tint(color, .42 + focus * .4)} strokeWidth={1.5 + focus} pathLength="1" strokeDasharray="1" strokeDashoffset={1 - reveal}/>
        <circle cx={x + 371} cy={y + 9} r={3 + focus} fill={color}/>
        <g transform={`translate(${(1 - reveal) * 18} 0)`}>
          <rect x="550" y={cardY + 3} width="429" height={cardHeight} rx="17" fill={tint(T.ink, .025)}/>
          <rect x="548" y={cardY} width="429" height={cardHeight} rx="17" fill={T.surface} stroke={tint(color, .22 + focus * .4)} strokeWidth={1 + focus}/>
          <rect x="548" y={cardY} width="429" height={cardHeight} rx="17" fill={tint(color, .025 + focus * .04)}/>
          <rect x="548" y={cardY + 24} width="3" height={cardHeight - 48} rx="1.5" fill={color}/>
          <circle cx="574" cy={cardY + 27} r="9" fill={tint(color, .15)}/>
          <circle cx="574" cy={cardY + 27} r="3" fill={color}/>
          <TeachingFocus id={`layer-title-${index + 1}`} operations={[`layer-${index + 1}`]} x={551} y={cardY + 1} width={421} height={count >= 5 ? 45 : 54} focus={layerMotion && !layerMotion.focusId ? focus : undefined}/>
          <TeachingFocus id={`layer-detail-${index + 1}`} x={564} y={cardY + (count >= 5 ? 48 : 58)} width={395} height={count >= 5 ? 44 : cardHeight - 61}/>
          <TextBox x={594} y={cardY + 5} width={363} height={count >= 5 ? 42 : 52} text={layer.title} size={count >= 5 ? 17 : count === 4 ? 20 : 22} lineHeight={count >= 5 ? 20 : 24} align="start"/>
          <TextBox x={571} y={cardY + (count >= 5 ? 49 : 60)} width={386} height={count >= 5 ? 44 : count === 4 ? 56 : 66} text={layer.detail} size={count >= 5 ? 12 : count === 4 ? 15 : 16} lineHeight={count >= 5 ? 14 : count === 4 ? 18 : 21} align="start" color={T.muted} weight={450}/>
        </g>
      </g>)}
    </Diagram>
  );
}
export function FlowScene({
  content,
  frame,
  fps,
  itemMotion,
  details,
  itemTargetIds,
  motionSeconds,
}: SceneProps & { content: FlowContent; itemMotion?: readonly MaterialTeachingItemMotion[]; details?: readonly string[]; itemTargetIds?: readonly string[]; motionSeconds?: number }) {
  // Transfer keeps flowing after a cue's reveal/focus transition has finished.
  // The supplied narration clock also makes pause and reverse seeks exact.
  const time = motionSeconds ?? frame / fps,
    count = content.nodes.length,
    width = Math.min(180, (880 - (count - 1) * 40) / count),
    step = width + 40,
    left = (1000 - (count * width + (count - 1) * 40)) / 2;
  const nodes = content.nodes.map((_, i) => {
    const motion = itemMotion?.find(item => item.id === `node-${i + 1}`);
    const raw = itemMotion ? motion?.reveal ?? 0 : Math.max(0, Math.min(1, (frame / fps - i * 1.4) / 0.9));
    return {raw, p: ease(raw), focus: motion?.focus ?? 0};
  });
  const reached = nodes.reduce((sum, node) => sum + node.p, 0);
  const trackStart = left + width / 2, trackEnd = 1000 - left - width / 2;
  const trackFill = count > 1 ? Math.max(0, Math.min(1, (reached - 1) / (count - 1))) : 1;
  const badgeY = details ? 338 : 336;
  return (
    <Diagram label="因果与信息流">
      <TextBox x={50} y={33} width={900} height={99} text={content.caption} size={24} lineHeight={30}/>
      <rect x={trackStart} y={badgeY - 2} width={trackEnd - trackStart} height="4" rx="2" fill={T.inset}/>
      <rect x={trackStart} y={badgeY - 2} width={(trackEnd - trackStart) * trackFill} height="4" rx="2" fill={tint(T.accent, .7)}/>
      {content.nodes.map((node, i) => {
        const x = left + i * step, {raw, p, focus} = nodes[i]!;
        const next = nodes[i + 1];
        const link = next ? Math.min(p, itemMotion ? ease(next.raw) : progress(frame, fps, i * 1.4 + 1, 1)) : 0;
        const cardFocus = ease(focus);
        return (
          <g key={i} data-teaching-node={`node-${i + 1}`} data-node-reveal={p} data-lp-target={itemTargetIds?.[i]} data-active={focus > .5}>
            {next && (
              <>
                <path d={`M${x + width + 4} 238 H${x + width + 36}`} stroke={T.border} strokeWidth="3" strokeLinecap="round"/>
                <path d={`M${x + width + 4} 238 H${x + width + 36}`} stroke={T.accent} strokeWidth="3" strokeLinecap="round"
                  pathLength={1} strokeDasharray={1} strokeDashoffset={1 - link}/>
                <path d={`M${x + width + 29} 231 L${x + width + 37} 238 L${x + width + 29} 245`} fill="none" stroke={link > .9 ? T.accent : T.border}
                  strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                {Array.from({ length: 2 }, (_, j) => (
                  <g key={j} data-flow-particle={`${i + 1}-${j + 1}`}>
                    <Comet x1={x + width - 6} y1={238} x2={x + width + 46} y2={238} phase={time * 0.55 - j * 0.5 - i * 0.15}
                      opacity={link} radius={4}/>
                  </g>
                ))}
              </>
            )}
            <g opacity={Math.min(1, raw * 4)}>
              <GlowRect x={x} y={180 - cardFocus * 12} width={width} height={116} amount={cardFocus * .9} color={T.caution}/>
              <Halo cx={x + width / 2} cy={badgeY} r={15} seconds={motionSeconds} amount={cardFocus} color={T.caution} period={1.8}/>
              <Pop x={x + width / 2} y={238} amount={raw} rise={30}>
                <g transform={`translate(0 ${-cardFocus * 12})`}>
                  <Card
                    x={x}
                    y={180}
                    width={width}
                    height={116}
                    label={node}
                    fitLabel
                    labelSize={count === 5 ? 16 : 20}
                    color={focus > 0 ? T.caution : T.accent}
                  />
                  <Shine x={x} y={180} width={width} height={116} radius={18} amount={span(focus, 0.05, 0.95)} opacity={0.7}/>
                </g>
              </Pop>
            </g>
            <TeachingFocus id={`node-label-${i + 1}`} operations={[`node-${i + 1}`]} x={x - 4} y={176 - cardFocus * 12} width={width + 8} height={124} focus={itemTargetIds ? focus : undefined}/>
            {details && <TeachingFocus id={`node-detail-${i + 1}`} x={x - 9} y={356} width={width + 18} height={118}/>}
            <g opacity={0.35 + 0.65 * p}>
              <circle cx={x + width / 2} cy={badgeY} r={14 + cardFocus * 2} fill={p > .5 ? (focus > 0 ? T.caution : T.accent) : T.surface}
                stroke={focus > 0 ? T.caution : p > .5 ? T.accent : T.border} strokeWidth="2"/>
              <Label x={x + width / 2} y={badgeY + 5} color={p > .5 ? T.inverse : T.tertiary} size={13} weight={700}>
                {String(i + 1).padStart(2, "0")}
              </Label>
            </g>
            {details && <g opacity={0.45 + 0.55 * p}><TextBox x={x - 7} y={358} width={width + 14} height={114} text={details[i] ?? ""} size={14} lineHeight={18} color={T.muted} weight={450}/></g>}
          </g>
        );
      })}
      {!details && <><path
        d={`M${1000 - left - width / 2} 352 Q${1000 - left - width / 2} 410 500 410 Q${left + width / 2} 410 ${left + width / 2} 356`}
        fill="none"
        stroke={T.compare}
        strokeWidth="2"
        strokeDasharray="7 8"
        strokeDashoffset={motionSeconds !== undefined ? motionSeconds * 22 : 0}
        opacity={progress(frame, fps, 8, 2)}
      />
      <Label x={500} y={454} color={T.muted} size={18}>
        回看每个中间环节，检查解释是否完整
      </Label></>}
    </Diagram>
  );
}
export function formatComparisonValue(value: number): string {
  const exact = String(value);
  if (exact.length <= 12) return exact;
  const rounded = Number(value.toPrecision(6));
  return `${rounded === value ? '' : '≈'}${rounded}`;
}

export function CompareScene({
  content,
  frame,
  fps,
  itemMotion,
}: SceneProps & { content: CompareContent; itemMotion?: readonly MaterialTeachingItemMotion[] }) {
  const id = useId().replace(/:/g, "");
  const t = frame / fps;
  const lin = (start: number, duration: number) => Math.max(0, Math.min(1, (t - start) / duration));
  const colors = [T.accent, T.compare];
  const gridTop = 145, gridBottom = 164 + (content.metrics.length - 1) * 106 + 72;
  return (
    <Diagram label="共同尺度下的证据比较">
      <defs>
        {colors.map((color, j) => <linearGradient key={j} id={`bar-${id}-${j}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={tint(color, .72)}/><stop offset="1" stopColor={color}/>
        </linearGradient>)}
      </defs>
      <Label x={500} y={52} size={18} color={T.muted}>
        同一指标共用刻度与基线
      </Label>
      {[0.25, 0.5, 0.75, 1].map((fraction, k) => <line key={fraction} x1={245 + 570 * fraction} x2={245 + 570 * fraction}
        y1={gridTop} y2={gridTop + (gridBottom - gridTop) * easeOutExpo(lin(0.2 + k * 0.08, 0.8))}
        stroke={T.border} strokeWidth="1" strokeDasharray="3 6"/>)}
      {content.names.map((name, i) => {
        const enter = lin(0.15 + i * 0.25, 0.7);
        return (
          <g key={name} opacity={Math.min(1, enter * 3)}>
            <Pop x={420 + i * 380} y={96} amount={enter}>
              <rect x={252 + i * 380} y={70} width={318} height={52} rx={26} fill={tint(colors[i]!, .1)} stroke={tint(colors[i]!, .45)} strokeWidth="1.5"/>
              <circle cx={274 + i * 380} cy="96" r="9" fill={colors[i]}/>
              <circle cx={274 + i * 380} cy="96" r="4" fill={T.surface}/>
              <TextBox x={290 + i * 380} y={65} width={270} height={62} text={name} size={21} lineHeight={25} align="start"/>
            </Pop>
          </g>
        );
      })}
      {content.metrics.map((metric, i) => {
        const y = 164 + i * 106;
        const raw = itemMotion ? itemMotion.find(item => item.id === `metric-${i + 1}`)?.reveal ?? 0 : lin(0.6 + i * 1.6, 2.2);
        const rowFocus = ease(itemMotion?.find(item => item.id === `metric-${i + 1}`)?.focus ?? 0);
        return (
          <g key={metric.label} opacity={itemMotion && !raw ? 0 : 1}>
            <rect x={49} y={y - 15} width={880 * easeOutExpo(span(raw, 0, .45))} height={100} rx={16}
              fill={tint(T.accent, .035 + rowFocus * .05)} opacity={Math.max(.5, rowFocus)}/>
            <TeachingFocus id={`metric-${i + 1}`} operations={[`metric-${i + 1}`]} x={49} y={y - 15} width={880} height={100}/>
            <g opacity={span(raw, 0, .3)} transform={`translate(${(1 - easeOutExpo(span(raw, 0, .5))) * -18} 0)`}>
              <TextBox x={55} y={y - 10} width={165} height={76} text={metric.label} size={20} lineHeight={24} align="start"/>
              <TextBox x={55} y={y + 67} width={165} height={22} text={metric.unit} size={16} lineHeight={19} color={T.muted} align="start" weight={450}/>
            </g>
            <line x1="245" y1={y - 9} x2="245" y2={y + 72} stroke={T.ink} strokeOpacity=".35" strokeWidth="2"/>
            {[0, 1].map((j) => {
              const grow = easeOutExpo(span(raw, .15 + j * .12, .85 + j * .12));
              const target = metric.values[j];
              const decimals = Math.min(6, String(target).split(".")[1]?.length ?? 0);
              // Count up at the precision of the authored value, then show it exactly.
              const value = grow >= 1 ? target : Number((target * grow).toFixed(decimals)),
                w = Math.max(0, ((target * grow) / metric.max) * 570);
              return (
                <g key={j}>
                  <TeachingFocus id={`value-${i + 1}-${j + 1}`} x={238} y={y + j * 36 - 4} width={683} height={33} color={j ? T.compare : T.accent}/>
                  <rect x="245" y={y + j * 36} width={570} height="25" rx="12.5" fill={T.inset}/>
                  <rect x="245" y={y + j * 36} width={w} height="25" rx="12.5" fill={`url(#bar-${id}-${j})`}/>
                  {grow > 0 && grow < 1 && w > 14 && <>
                    <circle cx={245 + w - 6} cy={y + j * 36 + 12.5} r={14} fill={tint(colors[j]!, .25)}/>
                    <circle cx={245 + w - 6} cy={y + j * 36 + 12.5} r={5} fill={T.surface}/>
                  </>}
                  <Shine x={245} y={y + j * 36} width={Math.max(1, w)} height={25} radius={12.5} amount={span(raw, .75 + j * .08, 1)}/>
                  <g opacity={span(raw, .15 + j * .12, .4 + j * .12)}>
                    <Label x={850} y={y + 20 + j * 36} anchor="start" size={22} weight={700} color={j ? T.compareText : T.accentText}>
                      {formatComparisonValue(value)}
                    </Label>
                  </g>
                </g>
              );
            })}
          </g>
        );
      })}
    </Diagram>
  );
}
export function SummaryScene({
  content,
  frame,
  fps,
  itemMotion,
  motionSeconds,
}: SceneProps & { content: SummaryContent; itemMotion?: readonly MaterialTeachingItemMotion[]; motionSeconds?: number }) {
  // Leave a real visible connector between the central circle and every card.
  // The former lower card began at y=311, just one pixel below the circle.
  const center = [500, 170],
    points = [
      [200, 130],
      [800, 130],
      [500, 365],
    ];
  const t = frame / fps;
  const ring = itemMotion ? Math.max(0, Math.min(1, Math.max(...itemMotion.map(item => item.reveal), 0) * 1.6)) : Math.max(0, Math.min(1, t / 1.2));
  const transfer = itemMotion?.find(item => item.id === "transfer");
  const transferReveal = itemMotion ? transfer?.reveal ?? 0 : progress(frame, fps, 8, 2);
  const transferFocus = ease(transfer?.focus ?? 0);
  const anyFocus = Math.max(0, ...(itemMotion ?? []).map(item => item.focus));
  return (
    <Diagram label="关键关系与迁移">
      {motionSeconds !== undefined && <g aria-hidden="true" opacity={ring}>
        <circle cx={center[0]} cy={center[1]} r={112} fill="none" stroke={tint(T.accent, .45)} strokeWidth="1.5" strokeDasharray="2 10"
          transform={`rotate(${motionSeconds * 9} ${center[0]} ${center[1]})`}/>
        <circle cx={center[0]} cy={center[1]} r={128} fill="none" stroke={tint(T.compare, .35)} strokeWidth="1" strokeDasharray="22 14"
          transform={`rotate(${-motionSeconds * 5} ${center[0]} ${center[1]})`}/>
      </g>}
      <Halo cx={center[0]} cy={center[1]} r={92} seconds={motionSeconds} amount={ring * (1 - anyFocus * .6)} period={3.2}/>
      {content.concepts.map((concept, i) => {
        const item = itemMotion?.find(item => item.id === `concept-${i + 1}`),
          raw = itemMotion ? item?.reveal ?? 0 : Math.max(0, Math.min(1, (t - i * 1.7) / 1.5)),
          p = ease(raw),
          focus = ease(item?.focus ?? 0),
          [x, y] = points[i];
        const fly = easeOutBack(span(raw, .25, 1), 1.2);
        const cardX = center[0] + (x - center[0]) * fly, cardY = center[1] + (y - center[1]) * fly;
        return (
          <g key={concept} data-summary-item={`concept-${i + 1}`} data-summary-focus={focus} data-summary-reveal={p} opacity={Math.min(1, raw * 3)}>
            <path
              data-summary-link={`concept-${i + 1}`}
              d={`M${center[0]} ${center[1]} L${center[0] + (x - center[0]) * p} ${center[1] + (y - center[1]) * p}`}
              stroke={focus > 0 ? T.accent : T.compare}
              strokeWidth={3 + focus * 2}
              strokeLinecap="round"
            />
            <Comet x1={center[0]} y1={center[1]} x2={x} y2={y} phase={motionSeconds !== undefined ? motionSeconds * .45 + i * .33 : 0}
              opacity={motionSeconds !== undefined && raw >= 1 ? .55 + focus * .45 : 0} color={focus > 0 ? T.caution : T.accent} radius={4}/>
            <g transform={`translate(${cardX - x} ${cardY - y})`}>
              <GlowRect x={x - 147} y={y - 61} width={294} height={122} radius={24} amount={focus}/>
              <Pop x={x} y={y} amount={span(raw, .2, 1)}>
                <rect x={x - 147} y={y - 61} width={294} height={122} rx={24}
                  fill={tint(T.accent, .14)} stroke={T.accent} strokeWidth={2.5}
                  opacity={focus} data-summary-focus-plate="true"/>
                <Card
                  x={x - 140}
                  y={y - 54}
                  width={280}
                  height={108}
                  label={concept}
                  fitLabel
                  labelSize={22}
                />
                <Shine x={x - 140} y={y - 54} width={280} height={108} radius={18} amount={span(focus, .1, 1)} opacity={.6}/>
              </Pop>
            </g>
            <TeachingFocus id={`concept-${i + 1}-detail`} operations={[`concept-${i + 1}`]} x={x - 145} y={y - 59} width={290} height={118} focus={itemMotion?.find(item => item.id === `concept-${i + 1}`)?.focus}/>
            <Burst cx={x} cy={y} r={70} amount={item?.focus ?? 0}/>
          </g>
        );
      })}
      <circle cx={center[0]} cy={center[1]} r={90} fill={T.surface}/>
      <circle cx={center[0]} cy={center[1]} r={90} fill="none" stroke={T.accent} strokeWidth="2.5"
        pathLength={1} strokeDasharray={1} strokeDashoffset={1 - easeOutExpo(ring)} transform={`rotate(-90 ${center[0]} ${center[1]})`}/>
      <circle cx={center[0]} cy={center[1]} r={80} fill={tint(T.accent, .05)} stroke={tint(T.accent, .2)} strokeWidth="1"/>
      <TeachingFocus id="center" x={409} y={79} width={182} height={182} radius={90}/>
      <g opacity={span(ring, .3, 1)}>
        <TextBox x={432} y={center[1] - 56} width={136} height={112} text={content.center} size={21} lineHeight={26}/>
      </g>
      <g data-summary-item="transfer" data-summary-focus={transferFocus}
        data-summary-reveal={transferReveal}
        opacity={Math.min(1, transferReveal * 3)}>
        <GlowRect x={44} y={424} width={912} height={74} amount={transferFocus * .8}/>
        <rect x="44" y="424" width="912" height="74" rx="18" fill={tint(T.accent, .14)} stroke={T.accent} strokeWidth={2.5}
          opacity={transferFocus} data-summary-focus-plate="true"/>
        <Wipe x={44} y={420} width={912} height={82} amount={transferReveal}>
          <rect x="50" y="430" width="900" height="62" rx="12" fill={T.inset} />
          <TextBox x={65} y={434} width={870} height={54} text={content.transfer} size={20} lineHeight={25}/>
        </Wipe>
        <Shine x={50} y={430} width={900} height={62} radius={12} amount={span(transfer?.focus ?? 0, .1, 1)}/>
        <TeachingFocus id="transfer-detail" operations={["transfer"]} x={47} y={427} width={906} height={68} focus={transfer?.focus}/>
      </g>
    </Diagram>
  );
}
export function GeneralScene({
  id,
  variant = 0,
  ...time
}: SceneProps & { id: string; variant?: number }) {
  const v = Math.abs(variant) % 2;
  if (id === "general-question")
    return <QuestionScene {...time} content={QUESTION_PRESETS[v]} />;
  if (id === "general-layers")
    return <LayersScene {...time} content={LAYERS_PRESETS[v]} />;
  if (id === "general-flow")
    return <FlowScene {...time} content={FLOW_PRESETS[v]} />;
  if (id === "general-compare")
    return <CompareScene {...time} content={COMPARE_PRESETS[v]} />;
  return <SummaryScene {...time} content={SUMMARY_PRESETS[v]} />;
}
