import {TeachingFocus} from "../teaching-focus.js";
import React from "react";
import type {MaterialTeachingSample} from "../../../../../libs/domain/src/index.js";
import {materialTeachingSortTrace, materialTeachingRecursionTrace} from "../../../../../libs/domain/src/index.js";
import {
  Arrow,
  Card,
  Diagram,
  Formula,
  Label,
  T,
  clamp,
  ease,
  progress,
  tint,
  type SceneProps,
} from "./primitives.js";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const stageOf = (frame: number, fps: number) =>
  Math.min(2, Math.floor(Math.max(0, frame) / fps / 4));

function Chapters({
  stage,
  labels,
}: {
  stage: number;
  labels: [string, string, string];
}) {
  return (
    <g className="rt-diagram-chapters">
      {labels.map((label, i) => (
        <g key={label}>
          <rect
            x={34 + i * 320}
            y={18}
            width={292}
            height={42}
            rx={21}
            fill={i === stage ? T.accentSoft : T.surface}
            stroke={i === stage ? T.accent : T.border}
          />
          <Label
            x={180 + i * 320}
            y={45}
            size={18}
            color={i === stage ? T.accentText : T.muted}
          >{`0${i + 1}  ${label}`}</Label>
        </g>
      ))}
    </g>
  );
}
function Note({ children }: { children: React.ReactNode }) {
  return (
    <g>
      <rect
        x={40}
        y={438}
        width={920}
        height={44}
        rx={13}
        fill={T.surface}
        stroke={T.border}
      />
      <Label x={500} y={466} size={18} color={T.muted} weight={500}>
        {children}
      </Label>
    </g>
  );
}
function Badge({
  x,
  y,
  text,
  color = T.accent,
  width = 160,
}: {
  x: number;
  y: number;
  text: string;
  color?: string;
  width?: number;
}) {
  return (
    <g>
      <rect
        x={x - width / 2}
        y={y - 25}
        width={width}
        height={38}
        rx={19}
        fill={tint(color, 0.12)}
      />
      <Label x={x} y={y} size={18} color={color}>
        {text}
      </Label>
    </g>
  );
}

export type ReactionAtom = {
  id: string;
  element: string;
  color: string;
  start: [number, number];
  loose: [number, number];
  end: [number, number];
  radius: number;
};
export type ReactionConfig = {
  latex: string;
  atoms: ReactionAtom[];
  before: [number, number, number?][];
  after: [number, number, number?][];
  counters: string[];
  reactantLabels?: {label: string; x: number; y: number}[];
  productLabels?: {label: string; x: number; y: number}[];
};
export const REACTION_PRESETS: readonly ReactionConfig[] = [
  {
    latex:
      "2\\mathrm{H}_2 + \\mathrm{O}_2 \\longrightarrow 2\\mathrm{H}_2\\mathrm{O}",
    atoms: [
      {
        id: "h1",
        element: "H",
        color: T.accent,
        start: [180, 230],
        loose: [210, 175],
        end: [320, 290],
        radius: 27,
      },
      {
        id: "h2",
        element: "H",
        color: T.accent,
        start: [252, 230],
        loose: [335, 320],
        end: [420, 290],
        radius: 27,
      },
      {
        id: "h3",
        element: "H",
        color: T.accent,
        start: [398, 230],
        loose: [560, 170],
        end: [620, 290],
        radius: 27,
      },
      {
        id: "h4",
        element: "H",
        color: T.accent,
        start: [470, 230],
        loose: [790, 320],
        end: [720, 290],
        radius: 27,
      },
      {
        id: "o1",
        element: "O",
        color: T.caution,
        start: [702, 230],
        loose: [390, 190],
        end: [370, 225],
        radius: 34,
      },
      {
        id: "o2",
        element: "O",
        color: T.caution,
        start: [790, 230],
        loose: [650, 245],
        end: [670, 225],
        radius: 34,
      },
    ],
    before: [
      [0, 1],
      [2, 3],
      [4, 5, 2],
    ],
    after: [
      [0, 4],
      [1, 4],
      [2, 5],
      [3, 5],
    ],
    counters: ["氢原子：始终 4 个", "氧原子：始终 2 个"],
  },
  {
    latex: "\\mathrm{H}_2 + \\mathrm{Cl}_2 \\longrightarrow 2\\mathrm{HCl}",
    atoms: [
      {
        id: "h1",
        element: "H",
        color: T.accent,
        start: [220, 230],
        loose: [220, 170],
        end: [292, 255],
        radius: 27,
      },
      {
        id: "h2",
        element: "H",
        color: T.accent,
        start: [292, 230],
        loose: [365, 319],
        end: [620, 255],
        radius: 27,
      },
      {
        id: "cl1",
        element: "Cl",
        color: T.positive,
        start: [660, 230],
        loose: [583, 170],
        end: [380, 255],
        radius: 35,
      },
      {
        id: "cl2",
        element: "Cl",
        color: T.positive,
        start: [748, 230],
        loose: [785, 316],
        end: [708, 255],
        radius: 35,
      },
    ],
    before: [
      [0, 1],
      [2, 3],
    ],
    after: [
      [0, 2],
      [1, 3],
    ],
    counters: ["氢原子：始终 2 个", "氯原子：始终 2 个"],
  },
];
/** Motion samples preserve the same bounded atom inventory on forward/reverse seek. */
export function sampleReaction(config: ReactionConfig, seconds: number) {
  const spread = ease((seconds - 3.8) / 1.5),
    assemble = ease((seconds - 6.1) / 2.1);
  return config.atoms.map((atom) => ({
    ...atom,
    x: lerp(lerp(atom.start[0], atom.loose[0], spread), atom.end[0], assemble),
    y: lerp(lerp(atom.start[1], atom.loose[1], spread), atom.end[1], assemble),
  }));
}
/** Stable atom identities are conserved across breaking and forming bonds. */
function ChemicalReaction({
  frame,
  fps,
  config,
}: SceneProps & { config: ReactionConfig }) {
  const stage = stageOf(frame, fps);
  const breakBonds = progress(frame, fps, 3.4, 0.9),
    formBonds = progress(frame, fps, 7, 1.4);
  const atoms = sampleReaction(config, frame / fps);
  const bond = (
    [a, b, order = 1]: [number, number, number?],
    opacity: number,
    prefix: string,
  ) => (
    <g key={`${prefix}-${a}-${b}`} opacity={opacity}>
      {Array.from({ length: order }, (_, i) => (
        <line
          key={i}
          x1={atoms[a].x}
          y1={atoms[a].y + (i - (order - 1) / 2) * 12}
          x2={atoms[b].x}
          y2={atoms[b].y + (i - (order - 1) / 2) * 12}
          stroke={T.tertiary}
          strokeWidth={7}
        />
      ))}
    </g>
  );
  return (
    <Diagram label="原子守恒与化学键重组">
      <Chapters stage={stage} labels={["反应物", "旧键断裂", "新键形成"]} />
      <Formula
        x={180}
        y={76}
        width={640}
        height={70}
        latex={config.latex}
        size={34}
      />
      {config.before.map((b) => bond(b, 1 - breakBonds, "before"))}
      {config.after.map((b) => bond(b, formBonds, "after"))}
      {config.reactantLabels?.map((item, i) => <g key={`reactant-${i}`} opacity={1 - breakBonds}><Label x={item.x} y={item.y} size={18}>{item.label}</Label></g>)}
      {config.productLabels?.map((item, i) => <g key={`product-${i}`} opacity={formBonds}><Label x={item.x} y={item.y} size={18}>{item.label}</Label></g>)}
      {atoms.map((atom) => (
        <g key={atom.id} transform={`translate(${atom.x},${atom.y})`}>
          <TeachingFocus id={`atom-${atom.id}`} operations={["atoms", "rearrange"]} x={-atom.radius - 6} y={-atom.radius - 6} width={2 * atom.radius + 12} height={2 * atom.radius + 12} radius={atom.radius + 6} color={atom.color}/>
          <circle
            r={atom.radius}
            fill={T.surface}
            stroke={atom.color}
            strokeWidth={4}
          />
          <circle cx={-9} cy={-10} r={8} fill={tint(atom.color, 0.18)} />
          <Label x={0} y={9} size={26} color={atom.color}>
            {atom.element}
          </Label>
        </g>
      ))}
      {config.counters.map((counter, i) => <Badge key={counter} x={500 + (i - (config.counters.length - 1) / 2) * (config.counters.length <= 2 ? 310 : 220)} y={396} text={counter} color={i ? T.cautionText : T.accent} width={config.counters.length <= 2 ? 260 : 200} />)}
      <Note>化学计量与键重组示意；不表示真实反应路径或分子尺度</Note>
      {config.before.map(([a, b], i) => <TeachingFocus key={`old-${i}`} id="old-bonds" operations={["break-bonds"]} x={Math.min(atoms[a].x, atoms[b].x) - 9} y={Math.min(atoms[a].y, atoms[b].y) - 9} width={Math.abs(atoms[a].x - atoms[b].x) + 18} height={Math.abs(atoms[a].y - atoms[b].y) + 18}/>)}
      {config.after.map(([a, b], i) => <TeachingFocus key={`new-${i}`} id="new-bonds" operations={["form-bonds"]} x={Math.min(atoms[a].x, atoms[b].x) - 9} y={Math.min(atoms[a].y, atoms[b].y) - 9} width={Math.abs(atoms[a].x - atoms[b].x) + 18} height={Math.abs(atoms[a].y - atoms[b].y) + 18} color={T.positive}/>)}
      <TeachingFocus id="equation" operations={["conservation"]} x={179} y={75} width={642} height={72}/>

    </Diagram>
  );
}

export type TitrationConfig = {
  acidMl: number;
  acidMolarity: number;
  baseMolarity: number;
};
export const TITRATION_PRESETS: readonly TitrationConfig[] = [
  { acidMl: 25, acidMolarity: 0.1, baseMolarity: 0.1 },
  { acidMl: 25, acidMolarity: 0.05, baseMolarity: 0.1 },
];
/** Exact ideal strong-acid/strong-base balance including water at 25 °C. */
export function titrationPh(
  baseMl: number,
  config: TitrationConfig = TITRATION_PRESETS[0],
): number {
  const difference =
    (config.acidMolarity * config.acidMl -
      config.baseMolarity * Math.max(0, baseMl)) /
    (config.acidMl + Math.max(0, baseMl));
  const root = Math.sqrt(difference * difference + 4e-14);
  const hydrogen =
    difference >= 0 ? (difference + root) / 2 : 2e-14 / (root - difference);
  return -Math.log10(hydrogen);
}
function Titration({
  frame,
  fps,
  config,
}: SceneProps & { config: TitrationConfig }) {
  const stage = stageOf(frame, fps);
  const seconds = frame / fps;
  const equivalentMl =
    (config.acidMl * config.acidMolarity) / config.baseMolarity;
  const maximumMl = equivalentMl * 2;
  const volume =
    equivalentMl *
    (seconds < 4
      ? 0.96 * progress(frame, fps, 0, 4)
      : seconds < 8
        ? 0.96 + 0.08 * progress(frame, fps, 4, 4)
        : 1.04 + 0.96 * progress(frame, fps, 8, 4));
  const ph = titrationPh(volume, config);
  const x = (v: number) => 440 + (v / maximumMl) * 450;
  const y = (p: number) => 371 - p * 18;
  const points = Array.from(
    { length: 501 },
    (_, i) =>
      `${x((i / 500) * maximumMl)},${y(titrationPh((i / 500) * maximumMl, config))}`,
  ).join(" ");
  const done = Array.from(
    { length: Math.floor((volume / maximumMl) * 500) + 1 },
    (_, i) =>
      `${x((i / 500) * maximumMl)},${y(titrationPh((i / 500) * maximumMl, config))}`,
  ).join(" ");
  return (
    <Diagram label="强酸强碱滴定的体积与 pH 曲线">
      <Chapters stage={stage} labels={["酸过量", "跨越等当点", "碱过量"]} />
      <Label x={200} y={95} size={18} color={T.muted}>
        {config.baseMolarity.toFixed(3)} mol/L NaOH
      </Label>
      <path
        d="M180 115 L180 205 L190 223 L190 247 L210 247 L210 223 L220 205 L220 115"
        fill={tint(T.accent, 0.12)}
        stroke={T.accent}
        strokeWidth={3}
      />
      <line
        x1={180}
        y1={140 + (volume / maximumMl) * 45}
        x2={220}
        y2={140 + (volume / maximumMl) * 45}
        stroke={T.accent}
        strokeWidth={3}
      />
      <line
        x1={176}
        y1={233}
        x2={222}
        y2={233}
        stroke={T.ink}
        strokeWidth={4}
      />
      <path
        d="M200 256 Q188 273 200 280 Q212 273 200 256"
        fill={T.accent}
        opacity={
          0.4 +
          0.6 * Math.sin(Math.PI * ((frame % Math.max(1, fps)) / fps)) ** 2
        }
      />
      <path
        d="M115 281 L135 382 Q200 410 265 382 L285 281"
        fill="none"
        stroke={T.tertiary}
        strokeWidth={4}
      />
      <path
        d={`M125 ${337 - (volume / maximumMl) * 27.5} L135 382 Q200 410 265 382 L275 ${337 - (volume / maximumMl) * 27.5} Z`}
        fill={tint(T.compare, 0.23)}
      />
      <Label x={200} y={422} size={16} color={T.muted}>
        {config.acidMl.toFixed(1)} mL · {config.acidMolarity.toFixed(3)} mol/L
        HCl
      </Label>
      <Arrow x1={430} y1={380} x2={925} y2={380} color={T.tertiary} />
      <Arrow x1={440} y1={385} x2={440} y2={96} color={T.tertiary} />
      {[0, 7, 14].map((p) => (
        <g key={p}>
          <line
            x1={440}
            y1={y(p)}
            x2={899}
            y2={y(p)}
            stroke={T.border}
            strokeDasharray="4 6"
          />
          <Label x={424} y={y(p) + 6} anchor="end" size={15} color={T.muted}>
            {Number(p.toFixed(1))}
          </Label>
        </g>
      ))}
      {[0, equivalentMl, maximumMl].map((v) => (
        <Label key={v} x={x(v)} y={407} size={15} color={T.muted}>
          {v}
        </Label>
      ))}
      <Label x={434} y={84} size={16}>
        pH
      </Label>
      <Label x={925} y={429} size={16} anchor="end" color={T.muted}>
        NaOH / mL
      </Label>
      <polyline points={points} fill="none" stroke={T.border} strokeWidth={4} />
      <polyline points={done} fill="none" stroke={T.accent} strokeWidth={5} />
      <line
        x1={x(equivalentMl)}
        y1={y(0)}
        x2={x(equivalentMl)}
        y2={y(14)}
        stroke={T.caution}
        strokeDasharray="5 5"
      />
      <circle
        cx={x(volume)}
        cy={y(ph)}
        r={8}
        fill={T.accent}
        stroke={T.surface}
        strokeWidth={3}
      />
      <Badge
        x={690}
        y={88}
        text={`${volume.toFixed(1)} mL     pH ${ph.toFixed(2)}`}
        width={290}
      />
      <Note>
        25 °C 理想稀溶液；等当点为 {equivalentMl.toFixed(1)} mL，pH =
        7.00；液体颜色不代表指示剂
      </Note>
      <TeachingFocus id="apparatus" operations={["before-equivalence"]} x={165} y={108} width={70} height={148}/>
      <TeachingFocus id="ph-curve" x={x(volume) - 17} y={y(ph) - 17} width={34} height={34} radius={17}/>
      <TeachingFocus id="equivalence-point" operations={["equivalence"]} x={x(equivalentMl) - 15} y={y(7) - 15} width={30} height={30} radius={15} color={T.caution}/>
      <TeachingFocus id="measurement" operations={["excess"]} x={543} y={60} width={294} height={46}/>

    </Diagram>
  );
}

export type MitosisConfig = { chromosomeCount: 2 | 4 };
export const MITOSIS_PRESETS: readonly MitosisConfig[] = [
  { chromosomeCount: 2 },
  { chromosomeCount: 4 },
];
function Mitosis({
  frame,
  fps,
  config,
}: SceneProps & { config: MitosisConfig }) {
  const stage = stageOf(frame, fps),
    separate = progress(frame, fps, 4, 3),
    divide = progress(frame, fps, 8, 2.5);
  const left = lerp(500, 310, divide),
    right = lerp(500, 690, divide);
  const membrane = `M500 112 C${760 - divide * 55} 105 ${820 - divide * 100} 375 500 382 C${180 + divide * 100} 375 ${240 + divide * 55} 105 500 112`;
  const colors = [T.accent, T.caution, T.compare, T.positive].slice(
    0,
    config.chromosomeCount,
  );
  const rowY = (i: number) =>
    247 +
    (i - (config.chromosomeCount - 1) / 2) *
      (config.chromosomeCount === 2 ? 78 : 52);
  const arm = config.chromosomeCount === 2 ? 25 : 17;
  return (
    <Diagram label="有丝分裂中复制的染色体分离示意">
      <Chapters
        stage={stage}
        labels={["复制后排列", "姐妹染色单体分离", "形成两个子细胞"]}
      />
      <g opacity={1 - divide}>
        <path
          d={membrane}
          fill={tint(T.compare, 0.06)}
          stroke={T.compare}
          strokeWidth={3}
        />
        <line
          x1={500}
          y1={130}
          x2={500}
          y2={366}
          stroke={T.border}
          strokeWidth={2}
          strokeDasharray="6 7"
        />
        {colors.flatMap((_, i) =>
          [-1, 1].map((side) => (
            <line
              key={`${i}-${side}`}
              x1={500 + side * 210}
              y1={247}
              x2={500 + side * separate * 130}
              y2={rowY(i)}
              stroke={tint(colors[i], 0.25)}
              strokeWidth={2}
            />
          )),
        )}
        <circle cx={290} cy={247} r={8} fill={T.compare} />
        <circle cx={710} cy={247} r={8} fill={T.compare} />
      </g>
      <g opacity={divide}>
        <ellipse
          cx={left}
          cy={247}
          rx={155}
          ry={132}
          fill={tint(T.compare, 0.06)}
          stroke={T.compare}
          strokeWidth={3}
        />
        <ellipse
          cx={right}
          cy={247}
          rx={155}
          ry={132}
          fill={tint(T.compare, 0.06)}
          stroke={T.compare}
          strokeWidth={3}
        />
      </g>
      {colors.flatMap((color, i) =>
        [-1, 1].map((side) => {
          const cx = 500 + side * lerp(separate * 130, 190, divide),
            cy = rowY(i);
          return (
            <g key={`${i}-${side}`}>
              <TeachingFocus id={`chromosome-${i + 1}`} operations={["alignment", "separation"]} x={cx - 29} y={cy - arm - 10} width={58} height={arm * 2 + 20} color={color}/>
              <path
                d={`M${cx + side * (1 - separate) * 23} ${cy - arm} L${cx} ${cy} L${cx - side * (1 - separate) * 23} ${cy + arm}`}
                fill="none"
                stroke={color}
                strokeWidth={12}
                strokeLinecap="round"
              />
              <circle cx={cx} cy={cy} r={5} fill={T.ink} />
            </g>
          );
        }),
      )}
      <Badge
        x={500}
        y={412}
        text={
          stage === 2
            ? `每个子细胞：${config.chromosomeCount} 条染色体`
            : stage === 1
              ? `每一侧获得 ${config.chromosomeCount} 条染色体`
              : `${config.chromosomeCount} 条复制染色体 · ${config.chromosomeCount * 2} 条染色单体`
        }
        width={400}
      />
      <Label x={137} y={112} size={16} color={T.muted}>
        2n = {config.chromosomeCount} 模型
      </Label>
      <Note>
        简化动物细胞示意：省略前期与核膜变化；DNA 复制发生在有丝分裂之前
      </Note>
      {divide > 0 && <><TeachingFocus id="daughter-left" operations={["division"]} x={left - 158} y={112} width={316} height={270} radius={120}/><TeachingFocus id="daughter-right" operations={["division"]} x={right - 158} y={112} width={316} height={270} radius={120}/></>}

    </Diagram>
  );
}
export type EnzymeConfig = {
  enzyme: string;
  substrate: string;
  products: [string, string];
  note: string;
};
export const ENZYME_PRESETS: readonly EnzymeConfig[] = [
  {
    enzyme: "乳糖酶",
    substrate: "乳糖",
    products: ["葡萄糖", "半乳糖"],
    note: "乳糖水解形成葡萄糖与半乳糖；省略水分子与真实分子构象",
  },
  {
    enzyme: "蔗糖酶",
    substrate: "蔗糖",
    products: ["葡萄糖", "果糖"],
    note: "蔗糖水解形成葡萄糖与果糖；省略水分子与真实分子构象",
  },
];
function Enzyme({ frame, fps, config }: SceneProps & { config: EnzymeConfig }) {
  const stage = stageOf(frame, fps),
    bind = progress(frame, fps, 0.8, 3.2),
    release = progress(frame, fps, 7.5, 3);
  const sx = lerp(300, 500, bind),
    sy = lerp(125, 220, bind);
  return (
    <Diagram label="酶催化中的结合、转化与产物释放">
      <Chapters stage={stage} labels={["底物识别", "形成复合物", "产物释放"]} />
      <path
        d="M400 218 Q352 248 369 316 Q387 369 453 367 L563 367 Q622 354 629 295 Q626 241 597 218 L540 218 L500 268 L460 218 Z"
        fill={tint(T.accent, 0.18)}
        stroke={T.accent}
        strokeWidth={4}
      />
      <path
        d="M460 218 L500 268 L540 218"
        fill="none"
        stroke={T.accent}
        strokeWidth={6}
      />
      <g
        transform={`translate(${lerp(sx, 715, release)},${lerp(sy, 138, release)})`}
      >
        <path
          d="M-40 0 L0 50 L0 0 Z"
          transform={`translate(${-release * 19},0)`}
          fill={tint(T.caution, 0.34)}
          stroke={T.caution}
          strokeWidth={3}
        />
        <path
          d="M0 0 L0 50 L40 0 Z"
          transform={`translate(${release * 19},0)`}
          fill={tint(T.compare, 0.34)}
          stroke={T.compare}
          strokeWidth={3}
        />
        <line
          x1={0}
          y1={6}
          x2={0}
          y2={37}
          stroke={T.ink}
          strokeWidth={3}
          opacity={1 - progress(frame, fps, 5.5, 1)}
        />
      </g>
      <Label x={500} y={329} size={27} color={T.accentText}>
        {config.enzyme}
      </Label>
      <Label x={251} y={141} size={21} anchor="end" color={T.cautionText}>
        {config.substrate}
      </Label>
      <Label x={737} y={248} size={21} color={T.compareText} weight={600}>
        {config.products.join(" + ")}
      </Label>
      <Arrow x1={285} y1={185} x2={393} y2={225} opacity={1 - release} />
      <Arrow x1={604} y1={210} x2={671} y2={171} opacity={release} />
      <Formula
        x={215}
        y={377}
        width={600}
        height={59}
        latex={
          "\\mathrm E + \\mathrm S \\rightleftharpoons \\mathrm{ES} \\longrightarrow \\mathrm E + \\mathrm P"
        }
        size={29}
      />
      <Note>{config.note}；酶在反应后再生</Note>
      <TeachingFocus id="enzyme" operations={["recognition"]} x={397} y={295} width={209} height={62}/>
      <TeachingFocus id="active-site" operations={["binding"]} x={456} y={212} width={88} height={64}/>
      <TeachingFocus id="substrate" x={sx - 46} y={sy - 8} width={92} height={66} color={T.caution}/>
      <TeachingFocus id="products" operations={["reaction", "release"]} x={lerp(sx, 715, release) - 65} y={lerp(sy, 138, release) - 8} width={130} height={66} color={T.compare}/>

    </Diagram>
  );
}

export type CycleNode = {
  label: string;
  glyph:
    | "water"
    | "vapor"
    | "cloud"
    | "drop"
    | "magma"
    | "rock"
    | "sediment"
    | "strata";
};
export type GeographicCycleConfig = {
  title: string;
  nodes: [CycleNode, CycleNode, CycleNode, CycleNode, CycleNode];
  transitions: [string, string, string, string, string];
  stages: [string, string, string];
  note: string;
};
export const GEOGRAPHIC_CYCLE_PRESETS: readonly GeographicCycleConfig[] = [
  {
    title: "水循环",
    nodes: [
      { label: "海洋", glyph: "water" },
      { label: "水汽", glyph: "vapor" },
      { label: "云滴", glyph: "cloud" },
      { label: "降水", glyph: "drop" },
      { label: "河流", glyph: "water" },
    ],
    transitions: ["蒸发", "凝结", "降水", "汇流", "径流"],
    stages: ["蒸发与凝结", "降水与汇流", "回到海洋"],
    note: "一条可能的路径：太阳供能促蒸发，重力驱动降水与径流；时间不按实际比例",
  },
  {
    title: "岩石循环",
    nodes: [
      { label: "岩浆", glyph: "magma" },
      { label: "火成岩", glyph: "rock" },
      { label: "沉积物", glyph: "sediment" },
      { label: "沉积岩", glyph: "strata" },
      { label: "变质岩", glyph: "rock" },
    ],
    transitions: ["冷却结晶", "风化侵蚀", "压实胶结", "高温高压", "熔融"],
    stages: ["结晶与风化", "沉积与成岩", "变质与熔融"],
    note: "岩石循环的一条路径；真实循环有多条分支，风化侵蚀通常需经历抬升出露",
  },
];
function CycleGlyph({
  kind,
  x,
  y,
  color,
}: {
  kind: CycleNode["glyph"];
  x: number;
  y: number;
  color: string;
}) {
  return (
    <g transform={`translate(${x},${y})`}>
      {kind === "water" &&
        [-10, 3, 16].map((v) => (
          <path
            key={v}
            d={`M-29 ${v} Q-15 ${v - 10} 0 ${v} T29 ${v}`}
            fill="none"
            stroke={color}
            strokeWidth={4}
          />
        ))}
      {kind === "vapor" &&
        [-16, 0, 16].map((v) => (
          <path
            key={v}
            d={`M${v} 25 Q${v - 12} 10 ${v} 0 Q${v + 12} -10 ${v} -27`}
            fill="none"
            stroke={color}
            strokeWidth={3}
          />
        ))}
      {kind === "cloud" && (
        <path
          d="M-27 12 C-47 4 -36 -16 -19 -13 C-13 -40 15 -30 17 -15 C39 -20 44 11 26 17 L-25 17Z"
          fill={tint(color, 0.15)}
          stroke={color}
          strokeWidth={3}
        />
      )}
      {kind === "drop" && (
        <path
          d="M0 -32 Q-38 9 -18 24 Q0 39 18 24 Q38 9 0 -32Z"
          fill={tint(color, 0.22)}
          stroke={color}
          strokeWidth={3}
        />
      )}
      {(kind === "rock" || kind === "strata" || kind === "magma") && (
        <g>
          <path
            d="M-34 19 L-30 -14 L-9 -30 L28 -22 L35 19 L17 31 L-19 28Z"
            fill={tint(color, 0.19)}
            stroke={color}
            strokeWidth={3}
          />
          {kind === "strata" ? (
            [-12, 0, 12].map((v) => (
              <path
                key={v}
                d={`M-28 ${v} Q0 ${v + 8} 29 ${v + 2}`}
                fill="none"
                stroke={color}
                strokeWidth={2}
              />
            ))
          ) : (
            <path
              d="M-9 -28 L0 0 L-18 25 M0 0 L31 19"
              fill="none"
              stroke={color}
              strokeWidth={2}
            />
          )}
        </g>
      )}
      {kind === "sediment" &&
        Array.from({ length: 9 }, (_, i) => (
          <circle
            key={i}
            cx={((i % 3) - 1) * 20 + (Math.floor(i / 3) % 2) * 6}
            cy={(Math.floor(i / 3) - 1) * 18}
            r={5 + (i % 3)}
            fill={tint(color, 0.45)}
            stroke={color}
          />
        ))}
    </g>
  );
}
function WaterCycle({
  frame,
  fps,
  config,
  teachingSample,
}: SceneProps & { config: GeographicCycleConfig; teachingSample?: MaterialTeachingSample }) {
  const stage = stageOf(frame, fps),
    time = clamp(frame / fps / 12);
  const positions = [
    [175, 285],
    [306, 134],
    [622, 124],
    [824, 284],
    [491, 353],
  ];
  const raw = Math.min(4.99999, time * 5),
    // A completed spoken path remains that path until the next semantic cue.
    // Inferring the index from its end time would select the following edge.
    index = teachingSample
      ? Math.max(0, Math.min(positions.length - 1, teachingSample.stepIndex))
      : Math.floor(raw),
    f = ease(teachingSample ? teachingSample.progress : raw - index);
  const next = (index + 1) % positions.length,
    px = lerp(positions[index][0], positions[next][0], f),
    py = lerp(positions[index][1], positions[next][1], f);
  return (
    <Diagram label={`${config.title}：状态转化与物质迁移`}>
      <Chapters stage={stage} labels={config.stages} />
      {positions.map((node, i) => {
        const end = positions[(i + 1) % positions.length],
          dx = end[0] - node[0],
          dy = end[1] - node[1],
          length = Math.hypot(dx, dy),
          color = i === index ? T.accent : T.border;
        return (
          <g key={i} data-cycle-path={`path-${i + 1}`} data-cycle-active={i === index}>
            <Arrow
              x1={node[0] + (dx / length) * 57}
              y1={node[1] + (dy / length) * 57}
              x2={end[0] - (dx / length) * 58}
              y2={end[1] - (dy / length) * 58}
              color={color}
              width={4}
            />
            <rect
              x={(node[0] + end[0]) / 2 - config.transitions[i].length * 8 - 7}
              y={(node[1] + end[1]) / 2 - 37}
              width={config.transitions[i].length * 16 + 14}
              height={28}
              rx={8}
              fill={T.stage}
            />
            <Label
              x={(node[0] + end[0]) / 2}
              y={(node[1] + end[1]) / 2 - 17}
              size={16}
              color={T.muted}
            >
              {config.transitions[i]}
            </Label>
          </g>
        );
      })}
      {config.nodes.map((node, i) => (
        <g key={`${i}-${node.label}`}>
          <circle
            cx={positions[i][0]}
            cy={positions[i][1]}
            r={48}
            fill={T.surface}
            stroke={i === index || i === next ? T.accent : T.border}
            strokeWidth={2}
          />
          <CycleGlyph
            kind={node.glyph}
            x={positions[i][0]}
            y={positions[i][1]}
            color={node.glyph === "magma" ? T.caution : T.accent}
          />
          <Label x={positions[i][0]} y={positions[i][1] + 73} size={20}>
            {node.label}
          </Label>
        </g>
      ))}
      <circle
        data-cycle-particle
        cx={px}
        cy={py}
        r={10}
        fill={T.accent}
        stroke={T.surface}
        strokeWidth={3}
      />
      <Label x={501} y={240} size={30} color={T.accentText}>
        {config.title}
      </Label>
      <Label x={501} y={269} size={17} color={T.muted}>
        物质改变状态，继续迁移
      </Label>
      <Note>{config.note}</Note>
      {positions.map(([x, y], i) => <TeachingFocus key={i} id={`node-${i + 1}`} operations={[`path-${i + 1}`]} x={x - 70} y={y - 55} width={140} height={108}/>)}

    </Diagram>
  );
}

// Dates verified against primary collection and mission records.
export const PRINTING_HISTORY_SOURCES = [
  "https://idp.bl.uk/discover/learning/dunhuang/collection-items/cave-17-the-library-cave/",
  "https://www.loc.gov/exhibits/bibles/the-gutenberg-bible.html",
  "https://www.nasa.gov/mission/apollo-11/",
  "https://science.nasa.gov/mission/hubble/overview/the-history-of-hubble/",
];
export type TimelineEvent = {
  year: number;
  label: string;
  evidence: string;
  approximate?: boolean;
  kind: "block" | "type" | "moon" | "telescope" | "event";
};
export type HistoryTimelineConfig = {
  range: [number, number];
  events: [TimelineEvent, TimelineEvent];
  caution: string;
  conclusion: string;
};
export const HISTORY_PRESETS: readonly HistoryTimelineConfig[] = [
  {
    range: [800, 1500],
    events: [
      {
        year: 868,
        label: "雕版《金刚经》",
        evidence: "整块木版刻字印刷",
        kind: "block",
      },
      {
        year: 1455,
        label: "谷登堡《圣经》",
        evidence: "欧洲金属活字印刷",
        approximate: true,
        kind: "type",
      },
    ],
    caution: "868 年存世有纪年印本 ≠ 雕版印刷发明于 868 年",
    conclusion: "史料证明当时已有该技术；两件文物本身不能证明直接传播关系",
  },
  {
    range: [1960, 2000],
    events: [
      {
        year: 1969,
        label: "阿波罗 11 号登月",
        evidence: "人类在月球实地考察",
        kind: "moon",
      },
      {
        year: 1990,
        label: "哈勃望远镜发射",
        evidence: "地球轨道上的天文观测",
        kind: "telescope",
      },
    ],
    caution: "两个事件采用不同探索方式；年代先后不等同于因果关系",
    conclusion: "同一时间轴可以比较不同技术路径；关系解释仍需额外史料",
  },
];
function HistoryTimeline({
  frame,
  fps,
  config,
  teachingSample,
}: SceneProps & { config: HistoryTimelineConfig; teachingSample?: MaterialTeachingSample }) {
  const stage = stageOf(frame, fps),
    reveal = progress(frame, fps, 0, 8);
  const yearX = (year: number) =>
    140 +
    ((year - config.range[0]) / (config.range[1] - config.range[0])) * 720;
  return (
    <Diagram label="根据史料比较不同事件的年代与路径">
      <Chapters
        stage={stage}
        labels={["读取事件年代", "比较不同路径", "区分事实与推断"]}
      />
      <line
        x1={140}
        y1={320}
        x2={860}
        y2={320}
        stroke={T.border}
        strokeWidth={5}
      />
      <line
        x1={140}
        y1={320}
        x2={140 + 720 * reveal}
        y2={320}
        stroke={T.accent}
        strokeWidth={5}
      />
      {Array.from(
        { length: 5 },
        (_, i) =>
          config.range[0] + ((config.range[1] - config.range[0]) * i) / 4,
      ).map((year) => (
        <g key={year}>
          <line
            x1={yearX(year)}
            y1={312}
            x2={yearX(year)}
            y2={330}
            stroke={T.tertiary}
          />
          <Label x={yearX(year)} y={355} size={16} color={T.muted}>
            {year}
          </Label>
        </g>
      ))}
      {config.events.map((event, i) => {
        const center = i === 0 ? 220 : 754,
          color = i === 0 ? T.accent : T.compare;
        return (
          <g key={event.year} opacity={teachingSample ? teachingSample.items.find(item => item.id === `event-${i + 1}`)?.reveal ?? 0 : 1}>
            <rect
              x={center - 125}
              y={94}
              width={250}
              height={174}
              rx={13}
              fill={T.surface}
              stroke={tint(color, 0.4)}
            />
            {(event.kind === "block" || event.kind === "type") &&
              Array.from({ length: 15 }, (_, j) => (
                <g
                  key={j}
                  transform={`translate(${center - 87 + (j % 5) * 37},${107 + Math.floor(j / 5) * 27})`}
                >
                  <rect
                    width={29}
                    height={21}
                    rx={event.kind === "type" ? 3 : 0}
                    fill={tint(color, 0.12)}
                    stroke={event.kind === "type" ? tint(color, 0.35) : "none"}
                    transform={
                      event.kind === "type"
                        ? `translate(0,${(1 - progress(frame, fps, 4 + j * 0.06, 1.1)) * -12})`
                        : undefined
                    }
                  />
                  <line x1={5} y1={7} x2={23} y2={7} stroke={color} />
                  <line x1={5} y1={13} x2={19} y2={13} stroke={color} />
                </g>
              ))}
            {(event.kind === "moon" || event.kind === "telescope") && (
              <g transform={`translate(${center},148)`}>
                <circle
                  r={35}
                  fill={tint(color, 0.12)}
                  stroke={color}
                  strokeWidth={2}
                />
                <ellipse
                  rx={91}
                  ry={27}
                  fill="none"
                  stroke={T.border}
                  strokeDasharray="4 6"
                  transform="rotate(-12)"
                />
                <g
                  transform={`translate(${74 * Math.cos((frame / fps) * 0.55 + i)},${24 * Math.sin((frame / fps) * 0.55 + i)}) rotate(-12)`}
                >
                  <rect
                    x={-13}
                    y={-8}
                    width={26}
                    height={16}
                    rx={4}
                    fill={color}
                  />
                  <path
                    d="M-13 -4 L-28 -11 L-29 7 L-13 5 M13 -4 L28 -11 L29 7 L13 5"
                    fill={tint(color, 0.3)}
                    stroke={color}
                  />
                </g>
              </g>
            )}
            <TeachingFocus id={`event-${i + 1}-detail`} operations={[`event-${i + 1}`]} x={center - 127} y={192} width={254} height={72} color={color}/>
            <Label x={center} y={219} size={21}>
              {event.label}
            </Label>
            <Label x={center} y={246} size={16} color={T.muted}>
              {event.evidence}
            </Label>
            <path
              d={`M${center} 274 L${yearX(event.year)} 293 L${yearX(event.year)} 311`}
              fill="none"
              stroke={color}
              strokeWidth={2}
            />
            <circle cx={yearX(event.year)} cy={320} r={9} fill={color} />
            <Badge
              x={yearX(event.year)}
              y={396}
              text={`${event.year} 年${event.approximate ? "（约）" : ""}`}
              color={color}
              width={172}
            />
          </g>
        );
      })}
      <Label x={494} y={157} size={19} color={T.muted}>
        相隔约 {config.events[1].year - config.events[0].year} 年
      </Label>
      <Arrow x1={371} y1={184} x2={603} y2={184} color={T.tertiary} />
      <Note>
        {stage === 2
          ? config.conclusion
          : `${config.caution}；年代轴按年份比例绘制`}
      </Note>
      <TeachingFocus id="historical-evidence" operations={["evidence"]} x={42} y={438} width={916} height={44}/>

    </Diagram>
  );
}

export type SyntaxConfig = {
  subject: string;
  verb: string;
  object: string;
  question: string;
  note: string;
};
export const SYNTAX_PRESETS: readonly SyntaxConfig[] = [
  {
    subject: "The curious student",
    verb: "opens",
    object: "the wooden door",
    question: "这个句子描写了谁，对什么，做了什么？",
    note: "主语和宾语都是名词短语；动作核心是 opens，修饰语增加细节",
  },
  {
    subject: "A young musician",
    verb: "plays",
    object: "the grand piano",
    question: "换一个情境，主语—谓语—宾语的骨架仍然成立",
    note: "主语和宾语都是名词短语；动作核心是 plays，young 与 grand 修饰名词",
  },
];
function LanguageSyntax({
  frame,
  fps,
  config,
}: SceneProps & { config: SyntaxConfig }) {
  const stage = stageOf(frame, fps),
    parsed = progress(frame, fps, 2, 3),
    verb = progress(frame, fps, 4.5, 2),
    joined = progress(frame, fps, 8, 2);
  const pieces = [
    {
      x: 235,
      y: 206,
      width: 215,
      text: config.subject,
      label: "主语 · 谁",
      color: T.accent,
    },
    {
      x: 490,
      y: 206,
      width: 185,
      text: config.verb,
      label: "谓语 · 做什么",
      color: T.cautionText,
    },
    {
      x: 735,
      y: 206,
      width: 245,
      text: config.object,
      label: "宾语 · 对什么",
      color: T.compareText,
    },
  ];
  return (
    <Diagram label="英语句子的主语、谓语与宾语结构">
      <Chapters
        stage={stage}
        labels={["读懂一句话", "找到动作核心", "扩展不改变骨架"]}
      />
      <Label x={500} y={104} size={20} color={T.muted}>
        {config.question}
      </Label>
      {pieces.map((piece, i) => (
        <g key={piece.label}>
          <TeachingFocus id={["subject", "predicate", "object"][i]} operations={i === 1 ? ["verb"] : i === 0 ? ["sentence"] : ["parse", "relation"]} x={piece.x - piece.width / 2 - 4} y={166} width={piece.width + 8} height={142} color={piece.color}/>
          <rect
            x={piece.x - piece.width / 2}
            y={170}
            width={piece.width}
            height={78}
            rx={16}
            fill={tint(piece.color, i === 1 ? 0.12 + verb * 0.08 : 0.09)}
            stroke={piece.color}
            strokeWidth={i === 1 ? 2 + verb * 2 : 2}
          />
          <Label
            x={piece.x}
            y={piece.y + 10}
            size={i === 1 ? 31 : 20}
            color={piece.color}
          >
            {piece.text}
          </Label>
          <line
            x1={piece.x - piece.width / 2 + 10}
            y1={263}
            x2={piece.x + piece.width / 2 - 10}
            y2={263}
            stroke={piece.color}
            strokeWidth={4}
            strokeDasharray={`${piece.width * parsed} ${piece.width}`}
          />
          <Label x={piece.x} y={302} size={20} color={piece.color}>
            {piece.label}
          </Label>
        </g>
      ))}
      <Arrow x1={369} y1={209} x2={382} y2={209} color={T.tertiary} />
      <Arrow x1={597} y1={209} x2={603} y2={209} color={T.tertiary} />
      <g opacity={joined}>
        <path
          d="M232 328 L232 348 L735 348 L735 328"
          fill="none"
          stroke={T.border}
          strokeWidth={2}
        />
        <Card
          x={351}
          y={366}
          width={298}
          height={60}
          label="形容词扩展名词短语"
          color={T.accent}
        />
      </g>
      <Note>{config.note}</Note>
    </Diagram>
  );
}
export type PerspectiveConfig = {
  object: "door" | "book";
  firstPerson: string;
  observer: string;
  note: string;
};
export const PERSPECTIVE_PRESETS: readonly PerspectiveConfig[] = [
  {
    object: "door",
    firstPerson: "“我怕吵醒他，轻轻推门。”",
    observer: "“他轻轻推开门，停了一下。”",
    note: "“害怕”属于内在体验，不能仅从推门动作直接断定",
  },
  {
    object: "book",
    firstPerson: "“我怀着期待，翻开了书。”",
    observer: "“他把书翻开，停了一下。”",
    note: "“期待”属于内在体验，不能仅从翻书动作直接断定",
  },
];
function LanguagePerspective({
  frame,
  fps,
  config,
}: SceneProps & { config: PerspectiveConfig }) {
  const stage = stageOf(frame, fps),
    action = progress(frame, fps, 1, 3.5),
    studentFocus = progress(frame, fps, 4, 2),
    narratorFocus = progress(frame, fps, 8, 2);
  const doorAngle = action * 0.74;
  return (
    <Diagram label="同一开门事件的第一人称和外部视角">
      <Chapters
        stage={stage}
        labels={["同一可见事件", "第一人称体验", "外部观察范围"]}
      />
      {config.object === "door" ? (
        <g>
          <rect
            x={396}
            y={116}
            width={176}
            height={263}
            rx={5}
            fill={T.inset}
            stroke={T.border}
            strokeWidth={3}
          />
          <polygon
            points={`396,116 ${572 - doorAngle * 121},${116 + doorAngle * 33} ${572 - doorAngle * 121},${379 - doorAngle * 26} 396,379`}
            fill={tint(T.caution, 0.23)}
            stroke={T.caution}
            strokeWidth={3}
          />
          <circle
            cx={555 - doorAngle * 114}
            cy={256}
            r={5}
            fill={T.cautionText}
          />
        </g>
      ) : (
        <g>
          <path
            d="M407 345 L615 345 M425 345 L425 383 M597 345 L597 383"
            stroke={T.tertiary}
            strokeWidth={7}
          />
          <path
            d="M505 274 Q544 250 590 263 L590 334 Q544 321 505 344Z"
            fill={T.surface}
            stroke={T.caution}
            strokeWidth={3}
          />
          <path
            d="M505 274 Q466 250 420 263 L420 334 Q466 321 505 344Z"
            fill={T.surface}
            stroke={T.caution}
            strokeWidth={3}
            opacity={action}
          />
          {[0, 1, 2, 3].map((i) => (
            <g key={i} opacity={action}>
              <path
                d={`M516 ${282 + i * 13} Q546 ${267 + i * 13} 576 ${276 + i * 13}`}
                fill="none"
                stroke={T.border}
                strokeWidth={2}
              />
              <path
                d={`M492 ${282 + i * 13} Q461 ${267 + i * 13} 434 ${276 + i * 13}`}
                fill="none"
                stroke={T.border}
                strokeWidth={2}
              />
            </g>
          ))}
          <path
            d={`M505 274 Q${lerp(559, 464, action)} ${228 - Math.sin(action * Math.PI) * 35} ${lerp(590, 420, action)} 261 L${lerp(590, 420, action)} 332 Q${lerp(559, 464, action)} 318 505 344Z`}
            fill={tint(T.caution, 0.13)}
            stroke={T.caution}
            strokeWidth={3}
          />
          <Label x={509} y={408} size={17} color={T.cautionText}>
            翻开的书
          </Label>
        </g>
      )}
      <g transform={`translate(${lerp(277, 345, action)},0)`}>
        <circle
          cx={0}
          cy={216}
          r={25}
          fill={T.surface}
          stroke={T.accent}
          strokeWidth={3}
        />
        <path
          d={`M0 242 L0 314 M0 265 L${config.object === "book" ? 72 : 45} ${config.object === "book" ? 272 : 249} M0 314 L-23 358 M0 314 L25 358`}
          fill="none"
          stroke={T.accent}
          strokeWidth={7}
          strokeLinecap="round"
        />
      </g>
      <Card
        x={47}
        y={86}
        width={255}
        height={99}
        label="我"
        sub="第一人称叙述者"
        opacity={0.4 + 0.6 * studentFocus}
      />
      <Label x={178} y={402} size={17} color={T.accentText}>
        {config.firstPerson}
      </Label>
      <g opacity={0.3 + 0.7 * narratorFocus}>
        <path
          d="M726 217 Q773 172 820 217 Q773 262 726 217Z"
          fill={T.surface}
          stroke={T.compare}
          strokeWidth={3}
        />
        <circle cx={773} cy={217} r={14} fill={T.compare} />
        <path
          d="M726 210 L602 164 M726 223 L601 305"
          fill="none"
          stroke={tint(T.compare, 0.32)}
          strokeWidth={2}
          strokeDasharray="5 7"
        />
      </g>
      <Card
        x={655}
        y={86}
        width={300}
        height={99}
        label="外部观察者"
        sub="只陈述可观察的信息"
        opacity={0.4 + 0.6 * narratorFocus}
      />
      <Label x={788} y={402} size={17} color={T.compareText}>
        {config.observer}
      </Label>
      <Note>同一事件，不同叙述范围；{config.note}</Note>
      <TeachingFocus id="event-detail" operations={["event"]} x={392} y={config.object === "door" ? 112 : 252} width={224} height={config.object === "door" ? 270 : 99}/>
      <TeachingFocus id="inner-account" operations={["first-person"]} x={38} y={378} width={285} height={42}/>
      <TeachingFocus id="external-account" operations={["observer"]} x={636} y={378} width={322} height={42} color={T.compare}/>

    </Diagram>
  );
}

export type SortingConfig = { values: readonly number[] };
export const SORTING_PRESETS: readonly SortingConfig[] = [
  { values: [7, 3, 6, 2, 5] },
  { values: [8, 4, 1, 7, 3] },
];
export type SortingStep = {
  values: number[];
  order: number[];
  swap: [number, number] | null;
};
/** Original indices preserve distinct identities even when values are equal. */
export const insertionSortSteps = materialTeachingSortTrace;

function Sorting({
  frame,
  fps,
  config,
}: SceneProps & { config: SortingConfig }) {
  const trace = insertionSortSteps(config.values),
    maxValue = Math.max(...config.values, 1),
    stepWidth = 720 / config.values.length;
  const stage = stageOf(frame, fps),
    cursor = clamp((frame / fps - 1) / 9) * (trace.length - 1);
  const index = Math.min(trace.length - 1, Math.floor(cursor)),
    next = Math.min(trace.length - 1, index + 1),
    tween = ease(cursor - index);
  const from = trace[index],
    to = trace[next],
    x = (index: number) => 140 + stepWidth * (index + 0.5);
  return (
    <Diagram label="插入排序中相邻元素交换的真实状态演化">
      <Chapters
        stage={stage}
        labels={["取出待插入元素", "向左比较与交换", "得到升序序列"]}
      />
      <Label x={500} y={99} size={20} color={T.muted}>
        插入排序：把当前元素移入左侧的有序位置
      </Label>
      <line
        x1={139}
        y1={362}
        x2={871}
        y2={362}
        stroke={T.border}
        strokeWidth={2}
      />
      {config.values.map((value, id) => {
        const a = from.order.indexOf(id),
          b = to.order.indexOf(id),
          active = a !== b;
        const pos = lerp(x(a), x(b), tween),
          lift = active ? Math.sin(Math.PI * tween) * (b < a ? 25 : -14) : 0,
          height = (value / maxValue) * 203;
        return (
          <g key={id} transform={`translate(${pos},${-lift})`}>
            <rect
              x={-stepWidth * 0.3}
              y={358 - height}
              width={stepWidth * 0.6}
              height={height}
              rx={10}
              fill={tint(active ? T.caution : T.accent, active ? 0.3 : 0.16)}
              stroke={active ? T.caution : T.accent}
              strokeWidth={3}
            />
            <Label
              x={0}
              y={340 - height}
              size={27}
              color={active ? T.cautionText : T.accentText}
            >
              {value}
            </Label>
          </g>
        );
      })}
      {config.values.map((_, i) => (
        <Label
          key={i}
          x={x(i)}
          y={391}
          size={16}
          color={T.muted}
        >{`[${i}]`}</Label>
      ))}
      <Badge
        x={500}
        y={420}
        text={
          index === trace.length - 1
            ? `完成：${trace[index].values.join(" ≤ ")}`
            : `已完成 ${index} / ${trace.length - 1} 次交换`
        }
        width={380}
      />
      <Note>柱子的身份与数值保持不变；每次只交换一对相邻逆序元素</Note>
    </Diagram>
  );
}

export type RecursionConfig = { operation: "product" | "sum"; start: number };
export const RECURSION_PRESETS: readonly RecursionConfig[] = [
  { operation: "product", start: 3 },
  { operation: "sum", start: 4 },
];
export type RecursiveStep = {
  stack: number[];
  returned: number | null;
  caption: string;
};
export const recursiveSteps = materialTeachingRecursionTrace;

export const FACTORIAL_STEPS = recursiveSteps(RECURSION_PRESETS[0]);
function Recursion({
  frame,
  fps,
  config,
  teachingSample,
}: SceneProps & { config: RecursionConfig; teachingSample?: MaterialTeachingSample }) {
  const trace = recursiveSteps(config),
    stage = stageOf(frame, fps),
    stepSeconds = 12 / trace.length;
  const index = Math.min(
      trace.length - 1,
      teachingSample ? Math.max(0, teachingSample.stepIndex) : Math.floor(Math.max(0, frame / fps) / stepSeconds),
    ),
    state = trace[index];
  const arrival = teachingSample ? ease(teachingSample.progress) : progress(frame, fps, index * stepSeconds, 0.65),
    name = config.operation === "product" ? "factorial" : "sum",
    operator = config.operation === "product" ? "×" : "+";
  const rowHeight = Math.min(92, 288 / config.start),
    baseY = config.start === 3 ? 310 : 325,
    compact = rowHeight < 72;
  return (
    <Diagram label="递归函数的调用栈压入与返回">
      <Chapters stage={stage} labels={["逐层调用", "到达基例", "逐层返回"]} />
      <Formula
        x={35}
        y={97}
        width={420}
        height={115}
        latex={
          config.operation === "product"
            ? "f(n)=\\begin{cases}1 & n=1\\\\n f(n-1) & n>1\\end{cases}"
            : "f(n)=\\begin{cases}1 & n=1\\\\n+f(n-1) & n>1\\end{cases}"
        }
        size={26}
      />
      <Label x={253} y={257} size={19} color={T.muted}>
        暂停的调用保留在栈中
      </Label>
      <Label x={253} y={290} size={19} color={T.muted}>
        最后压入，最先返回
      </Label>
      <path
        d="M485 88 L485 398 L837 398 L837 88"
        fill="none"
        stroke={T.border}
        strokeWidth={3}
      />
      {Array.from({ length: config.start }, (_, i) => config.start - i).map(
        (n, i) => {
          const active = state.stack.includes(n),
            top = state.stack[state.stack.length - 1] === n,
            topY = baseY - i * rowHeight;
          return (
            <g
              key={n}
              transform={`translate(0,${active && top && index < config.start ? (1 - arrival) * -24 : 0})`}
              opacity={active ? 1 : 0.14}
            >
              <rect
                x={505}
                y={topY}
                width={312}
                height={rowHeight - 14}
                rx={13}
                fill={top ? T.accentSoft : T.surface}
                stroke={top ? T.accent : T.border}
                strokeWidth={2}
              />
              <TeachingFocus id={`frame-${n}`} operations={[`call-${n}`, `return-${n}`]} x={502} y={topY - 3} width={318} height={rowHeight - 8}/>
              <Label x={661} y={topY + (compact ? 18 : 28)} size={compact ? 18 : 24}>{`${name}(${n})`}</Label>
              <Label x={661} y={topY + (compact ? 33 : 50)} size={compact ? 12 : 16} color={T.muted}>
                {n === 1 ? "基例 → 1" : `${n} ${operator} ${name}(${n - 1})`}
              </Label>
            </g>
          );
        },
      )}
      {state.returned !== null && (
        <g>
          <Arrow
            x1={850}
            y1={158 + (index - config.start) * 53}
            x2={913}
            y2={158 + (index - config.start) * 53}
            color={T.positive}
          />
          <Badge
            x={913}
            y={127 + (index - config.start) * 53}
            text={`${state.returned}`}
            color={T.positive}
            width={63}
          />
        </g>
      )}
      <Note>{state.caption}</Note>
    </Diagram>
  );
}

export function equilibrium(
  demandIntercept: number,
  supplyIntercept = 2,
  demandSlope = 0.1,
  supplySlope = demandSlope,
) {
  const quantity =
    (demandIntercept - supplyIntercept) / (demandSlope + supplySlope);
  return { quantity, price: supplyIntercept + supplySlope * quantity };
}
export type EquilibriumConfig = {
  demandIntercept: number;
  supplyIntercept: number;
  demandSlope: number;
  supplySlope: number;
  demandShift: number;
};
export const EQUILIBRIUM_PRESETS: readonly EquilibriumConfig[] = [
  {
    demandIntercept: 12,
    supplyIntercept: 2,
    demandSlope: 0.1,
    supplySlope: 0.1,
    demandShift: 2,
  },
  {
    demandIntercept: 14,
    supplyIntercept: 4,
    demandSlope: 0.15,
    supplySlope: 0.05,
    demandShift: 1.5,
  },
];
function Economics({
  frame,
  fps,
  config,
}: SceneProps & { config: EquilibriumConfig }) {
  const stage = stageOf(frame, fps),
    adjust = progress(frame, fps, 3, 3.5),
    shift = progress(frame, fps, 8, 2.5);
  const demand = config.demandIntercept + config.demandShift * shift,
    eq = equilibrium(
      demand,
      config.supplyIntercept,
      config.demandSlope,
      config.supplySlope,
    );
  const price = eq.price + 2 * (1 - adjust);
  const qd = (demand - price) / config.demandSlope,
    qs = (price - config.supplyIntercept) / config.supplySlope;
  const maxQuantity = 100,
    maxPrice = Math.max(
      config.demandIntercept + config.demandShift,
      config.supplyIntercept + config.supplySlope * maxQuantity,
    );
  const x = (q: number) => 116 + 6.2 * q,
    y = (p: number) => 390 - (p / maxPrice) * 280;
  const demandEndQ = Math.min(maxQuantity, demand / config.demandSlope);
  const originalEndQ = Math.min(
    maxQuantity,
    config.demandIntercept / config.demandSlope,
  );
  return (
    <Diagram label="供给需求曲线的均衡和需求增加">
      <Chapters
        stage={stage}
        labels={["高价造成过剩", "价格向均衡调整", "需求增加后的新均衡"]}
      />
      <Arrow x1={103} y1={390} x2={781} y2={390} color={T.tertiary} />
      <Arrow x1={116} y1={400} x2={116} y2={82} color={T.tertiary} />
      {[config.supplyIntercept, eq.price, maxPrice].map((p) => (
        <g key={p}>
          <line
            x1={116}
            y1={y(p)}
            x2={735}
            y2={y(p)}
            stroke={T.border}
            strokeDasharray="4 6"
          />
          <Label x={99} y={y(p) + 5} anchor="end" size={15} color={T.muted}>
            {Number(p.toFixed(1))}
          </Label>
        </g>
      ))}
      {[0, 50, 100].map((q) => (
        <Label key={q} x={x(q)} y={416} size={15} color={T.muted}>
          {q}
        </Label>
      ))}
      <Label x={86} y={89} size={18}>
        P
      </Label>
      <Label x={783} y={417} size={18}>
        Q
      </Label>
      <line
        x1={x(0)}
        y1={y(config.supplyIntercept)}
        x2={x(100)}
        y2={y(config.supplyIntercept + config.supplySlope * 100)}
        stroke={T.compare}
        strokeWidth={4}
      />
      <line
        x1={x(0)}
        y1={y(config.demandIntercept)}
        x2={x(originalEndQ)}
        y2={y(config.demandIntercept - originalEndQ * config.demandSlope)}
        stroke={tint(T.accent, 0.25)}
        strokeWidth={3}
        strokeDasharray="5 6"
      />
      <line
        x1={x(0)}
        y1={y(demand)}
        x2={x(demandEndQ)}
        y2={y(demand - demandEndQ * config.demandSlope)}
        stroke={T.accent}
        strokeWidth={4}
      />
      <Label
        x={765}
        y={y(config.supplyIntercept + config.supplySlope * 100) + 7}
        size={21}
        color={T.compareText}
      >
        S
      </Label>
      <Label
        x={764}
        y={y(Math.max(0, demand - config.demandSlope * 100)) + 7}
        size={21}
        color={T.accentText}
      >
        D
      </Label>
      <line
        x1={x(qd)}
        y1={y(price)}
        x2={x(qs)}
        y2={y(price)}
        stroke={T.caution}
        strokeWidth={8}
        opacity={1 - adjust}
      />
      <circle cx={x(qd)} cy={y(price)} r={7} fill={T.accent} />
      <circle cx={x(qs)} cy={y(price)} r={7} fill={T.compare} />
      <g opacity={adjust}>
        <line
          x1={x(eq.quantity)}
          y1={y(eq.price)}
          x2={x(eq.quantity)}
          y2={390}
          stroke={T.tertiary}
          strokeDasharray="5 6"
        />
        <circle
          cx={x(eq.quantity)}
          cy={y(eq.price)}
          r={12}
          fill={T.positive}
          stroke={T.surface}
          strokeWidth={4}
        />
      </g>
      <Card
        x={801}
        y={141}
        width={168}
        height={99}
        label={`P = ${price.toFixed(1)}`}
        sub="当前价格"
      />
      <Formula
        x={802}
        y={260}
        width={168}
        height={70}
        latex={`Q^*=${eq.quantity.toFixed(0)}`}
        size={27}
      />
      <Formula
        x={802}
        y={326}
        width={168}
        height={65}
        latex={`P^*=${eq.price.toFixed(1)}`}
        size={27}
      />
      <Note>
        {stage === 0
          ? `P = ${price.toFixed(1)} 时：需求 ${qd.toFixed(0)}，供给 ${qs.toFixed(0)}，过剩 ${(qs - qd).toFixed(0)}`
          : `线性示例：需求 P = ${demand.toFixed(1)} − ${config.demandSlope}Q；供给 P = ${config.supplyIntercept} + ${config.supplySlope}Q；交点满足供需相等`}
      </Note>
      <TeachingFocus id="supply-curve" operations={["curves"]} path={`M${x(0)} ${y(config.supplyIntercept)} L${x(100)} ${y(config.supplyIntercept + config.supplySlope * 100)}`} x={x(70) - 17} y={y(config.supplyIntercept + config.supplySlope * 70) - 17} width={34} height={34} radius={17} color={T.compare}/>
      <TeachingFocus id="demand-curve" operations={["curves"]} path={`M${x(0)} ${y(config.demandIntercept)} L${x(originalEndQ)} ${y(config.demandIntercept - originalEndQ * config.demandSlope)}`} x={x(originalEndQ * .45) - 17} y={y(config.demandIntercept - originalEndQ * .45 * config.demandSlope) - 17} width={34} height={34} radius={17}/>
      <TeachingFocus id="original-equilibrium" operations={["equilibrium"]} x={x(eq.quantity) - 20} y={y(eq.price) - 20} width={40} height={40} radius={20} color={T.positive}/>
      <TeachingFocus id="shifted-demand" path={`M${x(0)} ${y(demand)} L${x(demandEndQ)} ${y(demand - demandEndQ * config.demandSlope)}`} x={x(demandEndQ * .45) - 17} y={y(demand - demandEndQ * .45 * config.demandSlope) - 17} width={34} height={34} radius={17}/>
      <TeachingFocus id="new-equilibrium" operations={["shift"]} x={x(eq.quantity) - 20} y={y(eq.price) - 20} width={40} height={40} radius={20} color={T.positive}/>

    </Diagram>
  );
}

export type DisciplineSceneConfigs = {
  "chemistry-reaction": ReactionConfig;
  "chemistry-titration": TitrationConfig;
  "biology-mitosis": MitosisConfig;
  "biology-enzyme": EnzymeConfig;
  "geography-water": GeographicCycleConfig;
  "history-timeline": HistoryTimelineConfig;
  "language-syntax": SyntaxConfig;
  "language-perspective": PerspectiveConfig;
  "cs-sorting": SortingConfig;
  "cs-recursion": RecursionConfig;
  "economics-equilibrium": EquilibriumConfig;
};
export type DisciplineSceneId = keyof DisciplineSceneConfigs;
export type DisciplineConfig = DisciplineSceneConfigs[DisciplineSceneId];
const PRESETS: {
  [K in DisciplineSceneId]: readonly DisciplineSceneConfigs[K][];
} = {
  "chemistry-reaction": REACTION_PRESETS,
  "chemistry-titration": TITRATION_PRESETS,
  "biology-mitosis": MITOSIS_PRESETS,
  "biology-enzyme": ENZYME_PRESETS,
  "geography-water": GEOGRAPHIC_CYCLE_PRESETS,
  "history-timeline": HISTORY_PRESETS,
  "language-syntax": SYNTAX_PRESETS,
  "language-perspective": PERSPECTIVE_PRESETS,
  "cs-sorting": SORTING_PRESETS,
  "cs-recursion": RECURSION_PRESETS,
  "economics-equilibrium": EQUILIBRIUM_PRESETS,
};
export const DISCIPLINE_EXAMPLE_NAMES: {
  [K in DisciplineSceneId]: readonly [string, string];
} = {
  "chemistry-reaction": ["氢氧反应", "氢氯反应"],
  "chemistry-titration": ["0.100 M 盐酸", "0.050 M 盐酸"],
  "biology-mitosis": ["2n = 2 细胞", "2n = 4 细胞"],
  "biology-enzyme": ["乳糖水解", "蔗糖水解"],
  "geography-water": ["水循环", "岩石循环"],
  "history-timeline": ["印刷技术史料", "航天探索事件"],
  "language-syntax": ["学生开门", "音乐家演奏"],
  "language-perspective": ["推门的动机", "翻书的期待"],
  "cs-sorting": ["7, 3, 6, 2, 5", "8, 4, 1, 7, 3"],
  "cs-recursion": ["阶乘 3!", "累加 1 + … + 4"],
  "economics-equilibrium": ["对称供需斜率", "非对称供需斜率"],
};
export function getDisciplineExample<K extends DisciplineSceneId>(
  id: K,
  variant: number,
): DisciplineSceneConfigs[K];
export function getDisciplineExample(
  id: string,
  variant: number,
): DisciplineConfig | undefined;
export function getDisciplineExample(
  id: string,
  variant: number,
): DisciplineConfig | undefined {
  const presets = PRESETS[id as DisciplineSceneId];
  return presets?.[Math.abs(Math.floor(variant)) % presets.length];
}
export function DisciplineScene({
  id,
  frame,
  fps,
  variant = 0,
  config,
  teachingSample,
}: SceneProps & { id: string; variant?: number; config?: DisciplineConfig; teachingSample?: MaterialTeachingSample }) {
  const props = { frame, fps },
    example = config ?? getDisciplineExample(id, variant);
  switch (id) {
    case "chemistry-reaction":
      return <ChemicalReaction {...props} config={example as ReactionConfig} />;
    case "chemistry-titration":
      return <Titration {...props} config={example as TitrationConfig} />;
    case "biology-mitosis":
      return <Mitosis {...props} config={example as MitosisConfig} />;
    case "biology-enzyme":
      return <Enzyme {...props} config={example as EnzymeConfig} />;
    case "geography-water":
      return (
        <WaterCycle {...props} config={example as GeographicCycleConfig} teachingSample={teachingSample} />
      );
    case "history-timeline":
      return (
        <HistoryTimeline {...props} config={example as HistoryTimelineConfig} teachingSample={teachingSample} />
      );
    case "language-syntax":
      return <LanguageSyntax {...props} config={example as SyntaxConfig} />;
    case "language-perspective":
      return (
        <LanguagePerspective {...props} config={example as PerspectiveConfig} />
      );
    case "cs-sorting":
      return <Sorting {...props} config={example as SortingConfig} />;
    case "cs-recursion":
      return <Recursion {...props} config={example as RecursionConfig} teachingSample={teachingSample} />;
    case "economics-equilibrium":
      return <Economics {...props} config={example as EquilibriumConfig} />;
    default:
      return null;
  }
}
