import {TeachingFocus} from "../teaching-focus.js";
import React from "react";
import {
  Arrow,
  Diagram,
  Formula,
  Label,
  T,
  clamp,
  progress,
  tint,
  type SceneProps,
} from "./primitives.js";

export type GeometryAreaConfig = { a: number; b: number };
export type GeometryPose = { x: number; y: number; rotation?: number };
export type GeometryPolygon = {
  id: string;
  points: [number, number][];
  from: GeometryPose;
  to: GeometryPose;
  color: "accent" | "compare" | "caution" | "positive";
  opacity?: [number, number];
  label?: string;
};
export type GeometryTransformConfig = {
  title: string;
  polygons: GeometryPolygon[];
  labels: {
    id: string;
    x: number;
    y: number;
    text: string;
    opacity?: [number, number];
  }[];
  relations: string[];
  conclusion: string;
};
export type FunctionChangeConfig = {
  coefficient: number;
  power: 2 | 3;
  at: number;
  startDx: number;
  xmax: number;
};
export type AccumulationConfig = {
  coefficient: number;
  power: 1 | 2;
  end: number;
};
export type ConditionalSetConfig = {
  total: number;
  condition: number;
  intersection: number;
  outsideTarget: number;
  conditionName: string;
  targetName: string;
};
export type ForceMotionConfig = {
  mass: number;
  drive: number;
  resistance: number;
  duration: number;
};
export type WaveSuperpositionConfig = {
  amplitude1: number;
  amplitude2: number;
  cycles1: number;
  cycles2: number;
  phase2: number;
};
export type CircuitQuantityConfig = {
  voltage: number;
  resistance1: number;
  resistance2: number;
  topology: "series" | "parallel";
};
export type MathPhysicsConfig =
  | GeometryTransformConfig
  | GeometryAreaConfig
  | FunctionChangeConfig
  | AccumulationConfig
  | ConditionalSetConfig
  | ForceMotionConfig
  | WaveSuperpositionConfig
  | CircuitQuantityConfig;

// Presets are teaching examples. Family components below accept their own data;
// their equations, geometry and motion always derive from the same parameters.
export const geometryAreaPresets: readonly GeometryAreaConfig[] = [
  { a: 3, b: 4 },
  { a: 5, b: 12 },
];
const geometryUnit = 300 / 7;
const geometryTriangle: [number, number][] = [
  [0, 0],
  [4 * geometryUnit, 0],
  [0, 3 * geometryUnit],
];
const geometryRect = (width: number, height: number): [number, number][] => [
  [0, 0],
  [width, 0],
  [width, height],
  [0, height],
];
export const geometryTransformPresets: readonly GeometryTransformConfig[] = [
  {
    title: "四个全等三角形，重新排列",
    polygons: [
      {
        id: "outer-square",
        points: geometryRect(300, 300),
        from: { x: 168, y: 93 },
        to: { x: 168, y: 93 },
        color: "positive",
        opacity: [0.1, 0.1],
      },
      {
        id: "square-a",
        points: geometryRect(3 * geometryUnit, 3 * geometryUnit),
        from: { x: 168, y: 93 },
        to: { x: 168, y: 93 },
        color: "compare",
        opacity: [0, 0.19],
      },
      {
        id: "square-b",
        points: geometryRect(4 * geometryUnit, 4 * geometryUnit),
        from: { x: 168 + 3 * geometryUnit, y: 93 + 3 * geometryUnit },
        to: { x: 168 + 3 * geometryUnit, y: 93 + 3 * geometryUnit },
        color: "accent",
        opacity: [0, 0.17],
      },
      {
        id: "triangle-1",
        points: geometryTriangle,
        from: { x: 168, y: 93 },
        to: { x: 168 + 3 * geometryUnit, y: 93 },
        color: "accent",
      },
      {
        id: "triangle-2",
        points: geometryTriangle,
        from: { x: 468, y: 93, rotation: 90 },
        to: { x: 468, y: 93 + 3 * geometryUnit, rotation: 180 },
        color: "compare",
      },
      {
        id: "triangle-3",
        points: geometryTriangle,
        from: { x: 468, y: 393, rotation: 180 },
        to: {
          x: 168 + 3 * geometryUnit,
          y: 93 + 3 * geometryUnit,
          rotation: 90,
        },
        color: "caution",
      },
      {
        id: "triangle-4",
        points: geometryTriangle,
        from: { x: 168, y: 393, rotation: 270 },
        to: { x: 168, y: 393, rotation: 270 },
        color: "positive",
      },
    ],
    labels: [
      {
        id: "hypotenuse-area",
        x: 318,
        y: 252,
        text: "c² = 25",
        opacity: [1, 0],
      },
      {
        id: "leg-a-area",
        x: 168 + 1.5 * geometryUnit,
        y: 101 + 1.5 * geometryUnit,
        text: "a² = 9",
        opacity: [0, 1],
      },
      {
        id: "leg-b-area",
        x: 168 + 5 * geometryUnit,
        y: 101 + 5 * geometryUnit,
        text: "b² = 16",
        opacity: [0, 1],
      },
      { id: "outer-length", x: 318, y: 427, text: "外框边长 a + b = 7" },
    ],
    relations: [
      "S_{\\mathrm{outer}}=7^2=49",
      "4S_{\\triangle}=4\\cdot\\frac{3\\cdot4}{2}=24",
      "c^2=a^2+b^2=25",
    ],
    conclusion: "平移、旋转不改变面积；相同外框减去相同三角形，剩余面积相等。",
  },
  {
    title: "两份全等三角形，拼成矩形",
    polygons: [
      {
        id: "rectangle",
        points: geometryRect(280, 160),
        from: { x: 155, y: 138 },
        to: { x: 155, y: 138 },
        color: "positive",
        opacity: [0, 0.12],
      },
      {
        id: "triangle-original",
        points: [
          [0, 0],
          [280, 0],
          [0, 160],
        ],
        from: { x: 80, y: 83 },
        to: { x: 155, y: 138 },
        color: "accent",
        label: "S",
      },
      {
        id: "triangle-copy",
        points: [
          [0, 0],
          [280, 0],
          [0, 160],
        ],
        from: { x: 525, y: 386, rotation: 180 },
        to: { x: 435, y: 298, rotation: 180 },
        color: "compare",
        label: "S",
      },
    ],
    labels: [
      { id: "base", x: 295, y: 350, text: "底 b = 7", opacity: [0, 1] },
      { id: "height", x: 500, y: 232, text: "高 h = 4", opacity: [0, 1] },
    ],
    relations: ["2S=bh", "S=\\frac{1}{2}bh", "S=\\frac{1}{2}\\cdot7\\cdot4=14"],
    conclusion:
      "第二个三角形经过刚体变换，与第一个完整拼成矩形：每份面积是矩形的一半。",
  },
];
export const functionChangePresets: readonly FunctionChangeConfig[] = [
  { coefficient: 1, power: 2, at: 1.5, startDx: 1.7, xmax: 3.6 },
  { coefficient: 0.25, power: 3, at: 2, startDx: 1.4, xmax: 3.8 },
];
export const accumulationPresets: readonly AccumulationConfig[] = [
  { coefficient: 1, power: 2, end: 3 },
  { coefficient: 2, power: 1, end: 4 },
];
export const conditionalSetPresets: readonly ConditionalSetConfig[] = [
  {
    total: 20,
    condition: 12,
    intersection: 8,
    outsideTarget: 2,
    conditionName: "选音乐课",
    targetName: "会弹钢琴",
  },
  {
    total: 24,
    condition: 16,
    intersection: 6,
    outsideTarget: 2,
    conditionName: "来自甲组",
    targetName: "检测合格",
  },
];
export const forceMotionPresets: readonly ForceMotionConfig[] = [
  { mass: 3, drive: 12, resistance: 6, duration: 4 },
  { mass: 5, drive: 15, resistance: 10, duration: 4 },
];
export const waveSuperpositionPresets: readonly WaveSuperpositionConfig[] = [
  { amplitude1: 1, amplitude2: 0.7, cycles1: 2, cycles2: 2, phase2: 0 },
  {
    amplitude1: 1,
    amplitude2: 0.6,
    cycles1: 2,
    cycles2: 4,
    phase2: Math.PI / 2,
  },
];
export const circuitQuantityPresets: readonly CircuitQuantityConfig[] = [
  { voltage: 12, resistance1: 4, resistance2: 8, topology: "series" },
  { voltage: 9, resistance1: 6, resistance2: 3, topology: "parallel" },
];

const number = (value: number, digits = 2) =>
  Number(value.toFixed(digits)).toString();
const mix = (from: number, to: number, amount: number) =>
  from + (to - from) * amount;
const stroke = {
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};
const colors = [T.accent, T.compare, T.caution, T.positive];
function Panel({
  x = 650,
  y = 65,
  width = 310,
  height = 335,
  children,
}: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  children?: React.ReactNode;
}) {
  return (
    <g>
      <rect
        x={x + 3}
        y={y + 7}
        width={width}
        height={height}
        rx="22"
        fill={tint(T.ink, 0.035)}
      />
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx="22"
        fill={T.surface}
        stroke={T.border}
      />
      {children}
    </g>
  );
}
function Footer({
  children,
  color = T.accent,
}: {
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <g>
      <rect
        x="45"
        y="451"
        width="910"
        height="39"
        rx="12"
        fill={tint(color, 0.08)}
      />
      <Label x={500} y={477} size={18} color={T.ink} weight={500}>
        {children}
      </Label>
    </g>
  );
}
function Dot({
  x,
  y,
  color = T.accent,
  radius = 6,
}: {
  x: number;
  y: number;
  color?: string;
  radius?: number;
}) {
  return (
    <g>
      <circle cx={x} cy={y} r={radius + 5} fill={tint(color, 0.13)} />
      <circle
        cx={x}
        cy={y}
        r={radius}
        fill={color}
        stroke={T.surface}
        strokeWidth="2"
      />
    </g>
  );
}
function polygon(points: number[][]) {
  return points.map(([x, y]) => `${x},${y}`).join(" ");
}

/** Bounded polygon/rigid-pose contract suitable for one-shot agent authoring. */
export function sampleGeometryTransform(
  data: GeometryTransformConfig,
  amount: number,
) {
  if (data.polygons.length < 1 || data.polygons.length > 24)
    throw new Error("Geometry requires 1–24 polygons");
  const ids = new Set<string>(),
    t = Math.max(0, Math.min(1, amount));
  return data.polygons.map((object) => {
    if (!object.id || ids.has(object.id))
      throw new Error("Geometry polygon IDs must be stable and unique");
    ids.add(object.id);
    if (object.points.length < 3 || object.points.length > 24)
      throw new Error("Geometry polygons require 3–24 vertices");
    const values = [
      ...object.points.flat(),
      object.from.x,
      object.from.y,
      object.to.x,
      object.to.y,
      object.from.rotation ?? 0,
      object.to.rotation ?? 0,
    ];
    if (
      values.some((value) => !Number.isFinite(value) || Math.abs(value) > 2000)
    )
      throw new Error("Geometry values must be finite and bounded");
    const angle =
      (mix(object.from.rotation ?? 0, object.to.rotation ?? 0, t) * Math.PI) /
      180;
    const x = mix(object.from.x, object.to.x, t),
      y = mix(object.from.y, object.to.y, t);
    const points = object.points.map(
      ([px, py]) =>
        [
          x + px * Math.cos(angle) - py * Math.sin(angle),
          y + px * Math.sin(angle) + py * Math.cos(angle),
        ] as [number, number],
    );
    const area =
      Math.abs(
        points.reduce((sum, p, i) => {
          const next = points[(i + 1) % points.length];
          return sum + p[0] * next[1] - p[1] * next[0];
        }, 0),
      ) / 2;
    return {
      ...object,
      points,
      area,
      opacity: object.opacity
        ? mix(object.opacity[0], object.opacity[1], t)
        : 0.34,
      center: {
        x: points.reduce((sum, p) => sum + p[0], 0) / points.length,
        y: points.reduce((sum, p) => sum + p[1], 0) / points.length,
      },
    };
  });
}

export function GeometryTransformScene({
  frame,
  fps,
  data = geometryTransformPresets[0],
}: SceneProps & { data?: GeometryTransformConfig }) {
  const move = progress(frame, fps, 3.8, 3),
    objects = sampleGeometryTransform(data, move);
  return (
    <Diagram label={data.title}>
      <Label x={315} y={42} size={22}>
        {data.title}
      </Label>
      {objects.map((object) => (
        <g key={object.id}>
          <polygon
            points={polygon(object.points)}
            fill={tint(T[object.color], object.opacity)}
            stroke={tint(T[object.color], Math.min(1, object.opacity * 2.8))}
            strokeWidth={object.opacity > 0.2 ? 2.5 : 1.5}
            strokeLinejoin="round"
          />
          {object.label && (
            <Label
              x={object.center.x}
              y={object.center.y + 9}
              size={28}
              color={T.ink}
            >
              {object.label}
            </Label>
          )}
        </g>
      ))}
      {data.labels.map((label) => (
        <g
          key={label.id}
          opacity={
            label.opacity ? mix(label.opacity[0], label.opacity[1], move) : 1
          }
        >
          <Label x={label.x} y={label.y} size={19}>
            {label.text}
          </Label>
        </g>
      ))}
      <Panel>
        <Label x={805} y={111} size={21}>
          形状保持，关系显现
        </Label>
        <Label x={805} y={148} size={16} color={T.muted}>
          同一组顶点 · 只平移与旋转
        </Label>
        {data.relations.map((latex, index) => (
          <Formula
            key={latex}
            x={663}
            y={171 + index * 71}
            width={285}
            height={67}
            latex={latex}
            size={index === 1 ? 24 : 27}
          />
        ))}
      </Panel>
      <Footer>{data.conclusion}</Footer>
    </Diagram>
  );
}

export function sampleGeometryArea(data: GeometryAreaConfig) {
  const { a, b } = data;
  return {
    a,
    b,
    c: Math.hypot(a, b),
    areaA: a * a,
    areaB: b * b,
    areaC: a * a + b * b,
    triangleArea: (a * b) / 2,
  };
}

/** Rigid rearrangement of four congruent right triangles; no morphing areas. */
export function GeometryAreaScene({
  frame,
  fps,
  data = geometryAreaPresets[0],
}: SceneProps & { data?: GeometryAreaConfig }) {
  const { a, b, c, areaA, areaB, areaC } = sampleGeometryArea(data);
  const scale = Math.min(350 / (a + 2 * b), 390 / (2 * a + b));
  const ax = 80 + a * scale,
    ay = 60 + (a + b) * scale;
  const A = [ax, ay],
    B = [ax + b * scale, ay],
    C = [ax, ay - a * scale];
  const squareC = [
    B,
    C,
    [C[0] + a * scale, C[1] - b * scale],
    [B[0] + a * scale, B[1] - b * scale],
  ];
  const reveal = progress(frame, fps, 0.4, 2),
    move = progress(frame, fps, 4, 3.3);
  const u = 275 / (a + b),
    n = a + b;
  const triangles = [
    { x: mix(0, a, move), y: 0, angle: 0 },
    { x: n, y: mix(0, a, move), angle: mix(90, 180, move) },
    { x: mix(n, a, move), y: mix(n, a, move), angle: mix(180, 90, move) },
    { x: 0, y: n, angle: 270 },
  ];
  return (
    <Diagram label={`直角三角形两直角边 ${a}、${b} 的面积分解`}>
      <g opacity={0.25 + 0.75 * reveal}>
        <rect
          x={ax - a * scale}
          y={ay - a * scale}
          width={a * scale}
          height={a * scale}
          fill={tint(T.compare, 0.15)}
          stroke={T.compare}
          strokeWidth="2"
        />
        <rect
          x={ax}
          y={ay}
          width={b * scale}
          height={b * scale}
          fill={tint(T.accent, 0.12)}
          stroke={T.accent}
          strokeWidth="2"
        />
        <polygon
          points={polygon(squareC)}
          fill={tint(T.positive, 0.12)}
          stroke={T.positive}
          strokeWidth="2"
        />
        {Array.from({ length: Math.max(0, Math.ceil(b) - 1) }, (_, i) => (
          <g key={i} stroke={tint(T.accent, 0.15)}>
            <line
              x1={ax + (i + 1) * scale}
              y1={ay}
              x2={ax + (i + 1) * scale}
              y2={ay + b * scale}
            />
            <line
              x1={ax}
              y1={ay + (i + 1) * scale}
              x2={ax + b * scale}
              y2={ay + (i + 1) * scale}
            />
          </g>
        ))}
        <Label
          x={ax - (a * scale) / 2}
          y={ay - (a * scale) / 2 + 8}
          color={T.compareText}
          size={24}
        >
          {number(areaA)}
        </Label>
        <Label
          x={ax + (b * scale) / 2}
          y={ay + (b * scale) / 2 + 8}
          color={T.accentText}
          size={28}
        >
          {number(areaB)}
        </Label>
        <Label
          x={ax + ((a + b) * scale) / 2}
          y={ay - ((a + b) * scale) / 2 + 8}
          color={T.positive}
          size={30}
        >
          {number(areaC)}
        </Label>
      </g>
      <polygon
        points={polygon([A, B, C])}
        fill={T.surface}
        stroke={T.ink}
        strokeWidth="3"
      />
      <path
        d={`M${ax + 13},${ay} v-13 h-13`}
        fill="none"
        stroke={T.muted}
        strokeWidth="2"
      />
      <Label x={ax + (b * scale) / 2} y={ay - 10} size={18}>
        {number(b)}
      </Label>
      <Label x={ax + 15} y={ay - (a * scale) / 2 + 5} size={18}>
        {number(a)}
      </Label>
      <Label
        x={ax + (b * scale) / 2 + 15}
        y={ay - (a * scale) / 2 - 11}
        size={17}
      >
        {number(c)}
      </Label>
      <Arrow x1={480} y1={222} x2={567} y2={222} color={T.tertiary} />
      <Label x={523} y={259} size={16} color={T.muted}>
        移动，不变形
      </Label>
      <Label x={780} y={38} size={20}>
        四个三角形 · 面积始终相同
      </Label>
      <g transform="translate(635 65)">
        <rect
          width="275"
          height="275"
          rx="3"
          fill={tint(T.positive, 0.12)}
          stroke={T.border}
          strokeWidth="2"
        />
        <g opacity={move}>
          <rect width={a * u} height={a * u} fill={tint(T.compare, 0.19)} />
          <rect
            x={a * u}
            y={a * u}
            width={b * u}
            height={b * u}
            fill={tint(T.accent, 0.16)}
          />
        </g>
        {triangles.map((triangle, i) => (
          <g
            key={i}
            transform={`translate(${triangle.x * u} ${triangle.y * u}) rotate(${triangle.angle})`}
          >
            <polygon
              points={`0,0 ${b * u},0 0,${a * u}`}
              fill={tint(colors[i], 0.36)}
              stroke={T.surface}
              strokeWidth="2"
            />
            <path d="M9,0 v9 h-9" fill="none" stroke={tint(T.ink, 0.3)} />
          </g>
        ))}
        <g opacity={move}>
          <Label x={(a * u) / 2} y={(a * u) / 2 + 6} size={19}>
            {number(areaA)}
          </Label>
          <Label x={(a + b / 2) * u} y={(a + b / 2) * u + 7} size={24}>
            {number(areaB)}
          </Label>
        </g>
        <Label x={137.5} y={144} size={24} color={T.positive}>
          {move < 0.12 ? number(areaC) : ""}
        </Label>
      </g>
      <Formula
        x={607}
        y={358}
        width={335}
        height={66}
        latex={`${a}^{2}+${b}^{2}=${number(c)}^{2}`}
        size={29}
      />
      <Footer>同一个外框，移走同样的四个三角形：剩余面积相等。</Footer>
      <TeachingFocus id="triangle" operations={["rearrange"]} x={ax - 3} y={ay - a * scale - 3} width={b * scale + 6} height={a * scale + 6}/>
      <TeachingFocus id="square-a" operations={["areas"]} x={ax - a * scale - 3} y={ay - a * scale - 3} width={a * scale + 6} height={a * scale + 6} color={T.compare}/>
      <TeachingFocus id="square-b" operations={["areas"]} x={ax - 3} y={ay - 3} width={b * scale + 6} height={b * scale + 6}/>
      <TeachingFocus id="square-c" operations={["areas"]} x={ax + ((a + b) * scale) / 2 - 33} y={ay - ((a + b) * scale) / 2 - 30} width={66} height={56} color={T.positive}/>
      <TeachingFocus id="area-identity" operations={["identity"]} x={605} y={353} width={350} height={83}/>

    </Diagram>
  );
}

export function sampleFunctionChange(data: FunctionChangeConfig, dx: number) {
  const f = (x: number) => data.coefficient * x ** data.power;
  const deltaY = f(data.at + dx) - f(data.at);
  return {
    x: data.at,
    y: f(data.at),
    qx: data.at + dx,
    qy: f(data.at + dx),
    dx,
    deltaY,
    secant:
      dx === 0
        ? data.coefficient * data.power * data.at ** (data.power - 1)
        : deltaY / dx,
    derivative: data.coefficient * data.power * data.at ** (data.power - 1),
  };
}

export function FunctionChangeScene({
  frame,
  fps,
  data = functionChangePresets[0],
}: SceneProps & { data?: FunctionChangeConfig }) {
  const dx = data.startDx * (1 - progress(frame, fps, 3, 5));
  const point = sampleFunctionChange(data, dx),
    ymax = data.coefficient * data.xmax ** data.power;
  const X = (x: number) => 75 + (x / data.xmax) * 500,
    Y = (y: number) => 403 - (y / ymax) * 335;
  const path = Array.from({ length: 121 }, (_, i) => {
    const x = (i / 120) * data.xmax;
    return `${i ? "L" : "M"}${X(x)},${Y(data.coefficient * x ** data.power)}`;
  }).join(" ");
  const tangent = progress(frame, fps, 7, 2),
    line = point.secant;
  const intercept = point.y - line * point.x,
    endX = Math.min(data.xmax, (ymax - intercept) / line);
  const labelFunction = `${data.coefficient === 1 ? "" : number(data.coefficient)}x^{${data.power}}`;
  return (
    <Diagram label="函数图像上的割线连续逼近切线">
      <Arrow x1={75} y1={403} x2={598} y2={403} color={T.tertiary} width={2} />
      <Arrow x1={75} y1={403} x2={75} y2={48} color={T.tertiary} width={2} />
      {[1, 2, 3]
        .filter((x) => x < data.xmax)
        .map((x) => (
          <g key={x}>
            <line
              x1={X(x)}
              x2={X(x)}
              y1={68}
              y2={403}
              stroke={T.border}
              strokeDasharray="3 7"
            />
            <Label x={X(x)} y={429} size={16} color={T.muted}>
              {x}
            </Label>
          </g>
        ))}
      <Label x={600} y={427} size={17}>
        x
      </Label>
      <Label x={55} y={54} size={17}>
        y
      </Label>
      <path
        d={path}
        fill="none"
        stroke={T.accent}
        strokeWidth="4"
        {...stroke}
      />
      <line
        x1={X(Math.max(0, -intercept / line))}
        y1={Y(Math.max(0, intercept))}
        x2={X(endX)}
        y2={Y(line * endX + intercept)}
        stroke={T.caution}
        strokeWidth="3"
      />
      <g opacity={1 - tangent}>
        <path
          d={`M${X(point.x)},${Y(point.y)} H${X(point.qx)} V${Y(point.qy)}`}
          fill={tint(T.compare, 0.12)}
          stroke={T.compare}
          strokeWidth="2"
          strokeDasharray="5 5"
        />
        <Dot x={X(point.qx)} y={Y(point.qy)} color={T.compare} />
      </g>
      <Dot x={X(point.x)} y={Y(point.y)} color={T.accent} />
      <Label x={X(point.x) - 15} y={Y(point.y) - 20} size={18} anchor="end">
        P
      </Label>
      {dx > 0.35 && (
        <Label
          x={X(point.qx) + 16}
          y={Y(point.qy) - 13}
          size={18}
          color={T.compareText}
        >
          Q
        </Label>
      )}
      <Formula
        x={114}
        y={64}
        width={240}
        height={65}
        latex={`f(x)=${labelFunction}`}
        size={27}
      />
      <Panel>
        <Label x={805} y={108} size={20}>
          让两点逐渐靠近
        </Label>
        <Label x={681} y={153} size={17} color={T.muted} anchor="start">
          横向变化 Δx
        </Label>
        <Label x={926} y={153} size={24} anchor="end" color={T.compareText}>
          {number(point.dx, 3)}
        </Label>
        <Label x={681} y={196} size={17} color={T.muted} anchor="start">
          纵向变化 Δy
        </Label>
        <Label x={926} y={196} size={24} anchor="end" color={T.compareText}>
          {number(point.deltaY, 3)}
        </Label>
        <line x1="677" x2="933" y1="218" y2="218" stroke={T.border} />
        <Formula
          x={670}
          y={231}
          width={270}
          height={80}
          latex={`\\frac{\\Delta y}{\\Delta x}${dx === 0 ? "\\;\\to\\;" : "="}${number(point.secant, 3)}`}
          size={28}
        />
        <Formula
          x={670}
          y={321}
          width={270}
          height={65}
          latex={`f'(${data.at})=${number(point.derivative)}`}
          size={27}
        />
      </Panel>
      <Footer color={T.caution}>
        割线斜率趋近确定值；当 Δx → 0，它就是这一点的瞬时变化率。
      </Footer>
      <TeachingFocus id="point-a" operations={["secant"]} x={X(point.x) - 16} y={Y(point.y) - 16} width={32} height={32} radius={16}/>
      <TeachingFocus id="point-b" operations={["approach"]} x={X(point.x + dx) - 16} y={Y(data.coefficient * (point.x + dx) ** data.power) - 16} width={32} height={32} radius={16} color={T.compare}/>
      <TeachingFocus id="secant-line" path={`M${X(Math.max(0, -intercept / line))} ${Y(Math.max(0, intercept))} L${X(endX)} ${Y(line * endX + intercept)}`} x={X(point.x) - 11} y={Y(point.y) - 11} width={22} height={22} radius={11} color={T.compare}/>
      <TeachingFocus id="tangent-line" operations={["tangent"]} path={`M${X(Math.max(0, -intercept / line))} ${Y(Math.max(0, intercept))} L${X(endX)} ${Y(line * endX + intercept)}`} x={X(point.x) - 19} y={Y(point.y) - 19} width={38} height={38} radius={19}/>
      <TeachingFocus id="slope" x={670} y={228} width={269} height={168}/>

    </Diagram>
  );
}

export function sampleAccumulation(data: AccumulationConfig, count: number) {
  const n = Math.max(1, Math.floor(count)),
    dx = data.end / n;
  const rectangles = Array.from({ length: n }, (_, i) => ({
    left: i * dx,
    right: (i + 1) * dx,
    lower: data.coefficient * (i * dx) ** data.power,
    upper: data.coefficient * ((i + 1) * dx) ** data.power,
  }));
  return {
    n,
    dx,
    rectangles,
    lower: rectangles.reduce((sum, r) => sum + r.lower * dx, 0),
    upper: rectangles.reduce((sum, r) => sum + r.upper * dx, 0),
    exact: (data.coefficient * data.end ** (data.power + 1)) / (data.power + 1),
  };
}

export function AccumulationScene({
  frame,
  fps,
  data = accumulationPresets[0],
}: SceneProps & { data?: AccumulationConfig }) {
  const n = Math.round(
    3 + 9 * progress(frame, fps, 1.5, 3) + 36 * progress(frame, fps, 5, 4),
  );
  const sample = sampleAccumulation(data, n),
    ymax = data.coefficient * data.end ** data.power;
  const X = (x: number) => 75 + (x / data.end) * 490,
    Y = (y: number) => 400 - (y / ymax) * 310;
  const curve = Array.from(
    { length: 101 },
    (_, i) =>
      `${i ? "L" : "M"}${X((data.end * i) / 100)},${Y(ymax * (i / 100) ** data.power)}`,
  ).join(" ");
  const f = `${data.coefficient === 1 ? "" : data.coefficient}x${data.power === 1 ? "" : `^{${data.power}}`}`;
  return (
    <Diagram label="上下矩形和夹逼函数曲线下的累积面积">
      {sample.rectangles.map((r, i) => (
        <g key={i}>
          <rect
            x={X(r.left)}
            y={Y(r.upper)}
            width={490 / n}
            height={Y(r.lower) - Y(r.upper)}
            fill={tint(T.caution, 0.22)}
            stroke={tint(T.caution, 0.5)}
            strokeWidth=".7"
          />
          <rect
            x={X(r.left)}
            y={Y(r.lower)}
            width={490 / n}
            height={400 - Y(r.lower)}
            fill={tint(T.accent, 0.22)}
            stroke={tint(T.accent, 0.62)}
            strokeWidth=".7"
          />
        </g>
      ))}
      <Arrow x1={75} y1={400} x2={596} y2={400} color={T.tertiary} width={2} />
      <Arrow x1={75} y1={400} x2={75} y2={66} color={T.tertiary} width={2} />
      <path
        d={curve}
        fill="none"
        stroke={T.accent}
        strokeWidth="4"
        {...stroke}
      />
      <Label x={75} y={430} size={17}>
        0
      </Label>
      <Label x={565} y={430} size={17}>
        {data.end}
      </Label>
      <Label x={596} y={430} size={17}>
        x
      </Label>
      <Formula
        x={104}
        y={61}
        width={245}
        height={72}
        latex={`f(x)=${f}`}
        size={27}
      />
      <Panel>
        <Label x={805} y={106} size={20}>
          用小矩形测量面积
        </Label>
        <Label x={680} y={153} anchor="start" size={18} color={T.muted}>
          切分数量
        </Label>
        <Label x={926} y={153} anchor="end" size={30}>
          {n}
        </Label>
        <Label x={680} y={204} anchor="start" size={18} color={T.accentText}>
          下矩形和
        </Label>
        <Label x={926} y={204} anchor="end" size={25} color={T.accentText}>
          {number(sample.lower, 3)}
        </Label>
        <Label x={680} y={247} anchor="start" size={18} color={T.cautionText}>
          上矩形和
        </Label>
        <Label x={926} y={247} anchor="end" size={25} color={T.cautionText}>
          {number(sample.upper, 3)}
        </Label>
        <line x1="678" x2="932" y1="270" y2="270" stroke={T.border} />
        <Formula
          x={669}
          y={292}
          width={272}
          height={86}
          latex={`\\int_0^{${data.end}}${f}\\,dx=${number(sample.exact)}`}
          size={26}
        />
      </Panel>
      <Footer>下矩形和 ≤ 真实面积 ≤ 上矩形和；分得越细，夹逼误差越小。</Footer>
      <TeachingFocus id="interval-axis" operations={["interval"]} x={71} y={389} width={510} height={48}/>
      <TeachingFocus id="rectangles" operations={["partition", "refine"]} x={78} y={82} width={492} height={317}/>
      <TeachingFocus id="lower-sum" x={672} y={177} width={268} height={41}/>
      <TeachingFocus id="upper-sum" x={672} y={222} width={268} height={40} color={T.caution}/>
      <TeachingFocus id="exact-area" operations={["integral"]} x={670} y={279} width={271} height={117}/>

    </Diagram>
  );
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}
export function sampleConditionalSet(data: ConditionalSetConfig) {
  const divisor = gcd(data.intersection, data.condition);
  return {
    conditional: data.intersection / data.condition,
    overall: (data.intersection + data.outsideTarget) / data.total,
    numerator: data.intersection / divisor,
    denominator: data.condition / divisor,
  };
}
export function ConditionalSetScene({
  frame,
  fps,
  data = conditionalSetPresets[0],
}: SceneProps & { data?: ConditionalSetConfig }) {
  const sample = sampleConditionalSet(data),
    focus = progress(frame, fps, 3, 3.5);
  const columns = data.total <= 20 ? 5 : 6,
    selectedColumns = 4;
  return (
    <Diagram
      label={`以“${data.conditionName}”为条件重新计算“${data.targetName}”的比例`}
    >
      <rect
        x="48"
        y="83"
        width="510"
        height="316"
        rx="23"
        fill={T.surface}
        stroke={tint(T.compare, 0.5)}
        strokeWidth="2"
      />
      <Label x={302} y={53} size={21}>
        {focus < 0.5
          ? `完整样本空间 · ${data.total} 人`
          : `当前分母 · ${data.condition} 人`}
      </Label>
      {Array.from({ length: data.total }, (_, i) => {
        const selected = i < data.condition,
          target =
            i < data.intersection ||
            (i >= data.condition && i < data.condition + data.outsideTarget);
        const initialX = 95 + (i % columns) * (410 / (columns - 1)),
          initialY = 132 + Math.floor(i / columns) * 75;
        const finalX = selected
          ? 110 + (i % selectedColumns) * 125
          : 70 +
            (i - data.condition) *
              (465 / Math.max(1, data.total - data.condition - 1));
        const rows = Math.ceil(data.condition / selectedColumns),
          finalY = selected
            ? 139 +
              Math.floor(i / selectedColumns) * (205 / Math.max(1, rows - 1))
            : 425;
        const x = mix(initialX, finalX, focus),
          y = mix(initialY, finalY, focus);
        return (
          <g
            key={i}
            opacity={selected ? 1 : 1 - focus * 0.76}
            transform={`translate(${x} ${y}) scale(${selected ? 1 : 1 - 0.53 * focus})`}
          >
            <TeachingFocus id="samples" operations={["inventory"]} x={-29} y={-29} width={58} height={58} radius={29}/>
            {selected && <TeachingFocus id="selected-samples" x={-29} y={-29} width={58} height={58} radius={29} color={T.compare}/>}
            <circle
              r="25"
              fill={target ? tint(T.accent, 0.16) : T.inset}
              stroke={selected ? T.compare : T.border}
              strokeWidth={selected ? 3 : 2}
            />
            {target ? (
              <path
                d="M-10,-8 v17 M0,-8 v17 M10,-8 v17"
                stroke={T.accent}
                strokeWidth="4"
                strokeLinecap="round"
              />
            ) : (
              <circle r="4" fill={T.tertiary} />
            )}
          </g>
        );
      })}
      <Panel x={604} width={354} height={354}>
        <Label x={781} y={108} size={21}>
          条件改变了分母
        </Label>
        <circle
          cx="636"
          cy="149"
          r="8"
          fill="none"
          stroke={T.compare}
          strokeWidth="3"
        />
        <Label x={657} y={155} size={18} anchor="start">
          B：{data.conditionName}
        </Label>
        <path
          d="M630,179 v14 M637,179 v14 M644,179 v14"
          stroke={T.accent}
          strokeWidth="3"
        />
        <Label x={657} y={193} size={18} anchor="start">
          A：{data.targetName}
        </Label>
        <Formula
          x={620}
          y={225}
          width={323}
          height={89}
          latex={`P(A\\mid B)=\\frac{${data.intersection}}{${data.condition}}=\\frac{${sample.numerator}}{${sample.denominator}}`}
          size={27}
        />
        <Label x={781} y={344} size={17} color={T.muted}>
          只有满足 B 的对象进入分母
        </Label>
        <Label x={781} y={381} size={17} color={T.accentText}>
          其中满足 A：{data.intersection} 人
        </Label>
      </Panel>
      <Footer color={T.compare}>
        先限定条件集合，再数交集；移出的 {data.total - data.condition}{" "}
        人不参与这次比例计算。
      </Footer>
      <TeachingFocus id="conditional-total" operations={["condition"]} x={160} y={29} width={284} height={36} color={T.compare}/>
      <TeachingFocus id="intersection" x={635} y={357} width={292} height={39}/>
      <TeachingFocus id="probability" operations={["ratio"]} x={633} y={216} width={300} height={113}/>

    </Diagram>
  );
}

export function sampleForceMotion(data: ForceMotionConfig, time: number) {
  const t = Math.max(0, Math.min(data.duration, time)),
    netForce = data.drive - data.resistance,
    acceleration = netForce / data.mass;
  return {
    time: t,
    netForce,
    acceleration,
    velocity: acceleration * t,
    displacement: 0.5 * acceleration * t * t,
    normal: data.mass * 9.8,
  };
}
export function ForceMotionScene({
  frame,
  fps,
  data = forceMotionPresets[0],
}: SceneProps & { data?: ForceMotionConfig }) {
  // Uniform physical time, not an easing curve: distances and speed obey F = ma.
  const physicalTime = clamp((frame / fps - 3) / 5) * data.duration;
  const state = sampleForceMotion(data, physicalTime),
    end = sampleForceMotion(data, data.duration);
  const distanceScale = Math.min(
      18,
      290 / Math.max(1, Math.abs(end.displacement)),
    ),
    x = 126 + state.displacement * distanceScale;
  const forceScale = 110 / Math.max(data.drive, data.resistance),
    showMotion = progress(frame, fps, 2.5, 1);
  return (
    <Diagram label="由受力分析推导加速度、速度与位移">
      <line
        x1="48"
        x2="605"
        y1="318"
        y2="318"
        stroke={T.tertiary}
        strokeWidth="3"
      />
      {Array.from({ length: 24 }, (_, i) => (
        <line
          key={i}
          x1={50 + i * 24}
          y1={318}
          x2={38 + i * 24}
          y2={332}
          stroke={T.border}
          strokeWidth="2"
        />
      ))}
      {[0, 1, 2, 3, 4]
        .filter((t) => t <= physicalTime)
        .map((t) => (
          <g key={t} opacity={0.3 * showMotion}>
            <rect
              x={
                126 +
                sampleForceMotion(data, t).displacement * distanceScale -
                40
              }
              y={238}
              width="80"
              height="80"
              rx="13"
              fill={tint(T.accent, 0.06)}
              stroke={T.accent}
              strokeDasharray="4 5"
            />
          </g>
        ))}
      <g>
        <rect
          x={x - 41}
          y={237}
          width="82"
          height="80"
          rx="13"
          fill={T.surface}
          stroke={T.accent}
          strokeWidth="3"
        />
        <rect
          x={x - 35}
          y={243}
          width="70"
          height="9"
          rx="4"
          fill={tint(T.accent, 0.12)}
        />
        <Label x={x} y={286} size={21}>
          {data.mass} kg
        </Label>
      </g>
      <Arrow
        x1={x + 42}
        y1={272}
        x2={x + 42 + data.drive * forceScale}
        y2={272}
        color={T.accent}
      />
      <Label
        x={x + 42 + (data.drive * forceScale) / 2}
        y={251}
        color={T.accentText}
        size={18}
      >
        {data.drive} N
      </Label>
      <Arrow
        x1={x - 42}
        y1={284}
        x2={x - 42 - data.resistance * forceScale}
        y2={284}
        color={T.caution}
      />
      <Label
        x={x - 42 - (data.resistance * forceScale) / 2}
        y={265}
        color={T.cautionText}
        size={17}
      >
        {data.resistance} N
      </Label>
      <Arrow x1={x} y1={235} x2={x} y2={153} color={T.compare} />
      <Label x={x} y={134} color={T.compareText} size={18}>
        N = {number(state.normal)} N
      </Label>
      <Arrow x1={x} y1={319} x2={x} y2={401} color={T.compare} />
      <Label x={x + 18} y={399} anchor="start" color={T.compareText} size={17}>
        mg
      </Label>
      <Label x={302} y={52} size={21}>
        先看合力，再看运动怎样变化
      </Label>
      <Label x={302} y={91} size={17} color={T.muted}>
        地面水平 · 从静止开始 · 恒定受力
      </Label>
      <line
        x1="126"
        x2={x}
        y1="429"
        y2="429"
        stroke={T.accent}
        strokeWidth="3"
        opacity={showMotion}
      />
      <circle cx="126" cy="429" r="4" fill={T.accent} />
      <circle cx={x} cy="429" r="4" fill={T.accent} />
      <Panel>
        <Formula
          x={666}
          y={80}
          width={280}
          height={74}
          latex={`F_{\\mathrm{net}}=${data.drive}-${data.resistance}=${state.netForce}\\,\\mathrm N`}
          size={23}
        />
        <Formula
          x={666}
          y={157}
          width={280}
          height={85}
          latex={`a=\\frac{${state.netForce}}{${data.mass}}=${number(state.acceleration)}\\,\\mathrm{m/s^2}`}
          size={27}
        />
        <line x1="678" x2="932" y1="246" y2="246" stroke={T.border} />
        <Label x={680} y={283} anchor="start" size={17} color={T.muted}>
          时间 t
        </Label>
        <Label x={929} y={283} anchor="end" size={22}>
          {number(state.time)} s
        </Label>
        <Label x={680} y={329} anchor="start" size={17} color={T.muted}>
          速度 v = at
        </Label>
        <Label x={929} y={329} anchor="end" size={22}>
          {number(state.velocity)} m/s
        </Label>
        <Label x={680} y={374} anchor="start" size={17} color={T.muted}>
          位移 s = ½at²
        </Label>
        <Label x={929} y={374} anchor="end" size={22}>
          {number(state.displacement)} m
        </Label>
      </Panel>
      <Footer>竖直力平衡，水平合力不为零；相等时间内的位移逐渐增大。</Footer>
      <TeachingFocus id="mass" operations={["forces"]} x={x - 38} y={257} width={76} height={42}/>
      <TeachingFocus id="applied-force" x={x + 37} y={228} width={data.drive * forceScale + 18} height={55}/>
      <TeachingFocus id="friction" x={x - 49 - data.resistance * forceScale} y={242} width={data.resistance * forceScale + 17} height={55} color={T.caution}/>
      <TeachingFocus id="normal-force" x={x - 64} y={113} width={128} height={114} color={T.compare}/>
      <TeachingFocus id="weight" x={x - 10} y={323} width={61} height={89} color={T.compare}/>
      <TeachingFocus id="net-force" operations={["resultant"]} x={669} y={80} width={272} height={70}/>
      <TeachingFocus id="acceleration" operations={["quantities"]} x={669} y={157} width={272} height={82}/>
      <TeachingFocus id="velocity" operations={["motion"]} x={671} y={303} width={270} height={39}/>
      <TeachingFocus id="displacement" x={671} y={348} width={270} height={40}/>

    </Diagram>
  );
}

export function sampleWaveSuperposition(
  data: WaveSuperpositionConfig,
  x: number,
  time: number,
) {
  const y1 =
    data.amplitude1 * Math.sin(Math.PI * 2 * (data.cycles1 * x - 0.45 * time));
  const y2 =
    data.amplitude2 *
    Math.sin(
      Math.PI *
        2 *
        (data.cycles2 * x - ((0.45 * data.cycles2) / data.cycles1) * time) +
        data.phase2,
    );
  return { y1, y2, sum: y1 + y2 };
}
export function WaveSuperpositionScene({
  frame,
  fps,
  data = waveSuperpositionPresets[0],
}: SceneProps & { data?: WaveSuperpositionConfig }) {
  const time = frame / fps,
    amplitudeScale = 53 / (data.amplitude1 + data.amplitude2),
    probe = 0.61;
  const value = sampleWaveSuperposition(data, probe, time),
    reveal = 0.18 + 0.82 * progress(frame, fps, 3.5, 2);
  const lanes = [
    { key: "y1" as const, y: 112, color: T.accent, label: "波 1" },
    { key: "y2" as const, y: 237, color: T.compare, label: "波 2" },
    { key: "sum" as const, y: 368, color: T.positive, label: "合成波" },
  ];
  return (
    <Diagram label="同一位置的两列波位移逐点相加">
      {lanes.map((lane) => (
        <g key={lane.key} opacity={lane.key === "sum" ? reveal : 1}>
          <rect
            x="44"
            y={lane.y - 63}
            width="559"
            height="119"
            rx="18"
            fill={T.surface}
            stroke={T.border}
          />
          <line
            x1="109"
            y1={lane.y}
            x2="580"
            y2={lane.y}
            stroke={T.border}
            strokeDasharray="4 5"
          />
          <Label
            x={79}
            y={lane.y + 6}
            size={lane.key === "sum" ? 16 : 18}
            color={lane.color}
          >
            {lane.label}
          </Label>
          <path
            d={Array.from({ length: 201 }, (_, i) => {
              const x = i / 200;
              return `${i ? "L" : "M"}${110 + 465 * x},${lane.y - amplitudeScale * sampleWaveSuperposition(data, x, time)[lane.key]}`;
            }).join(" ")}
            fill="none"
            stroke={lane.color}
            strokeWidth="3.5"
            {...stroke}
          />
          <line
            x1={110 + 465 * probe}
            x2={110 + 465 * probe}
            y1={lane.y}
            y2={lane.y - amplitudeScale * value[lane.key]}
            stroke={lane.color}
            strokeWidth="4"
          />
          <Dot
            x={110 + 465 * probe}
            y={lane.y - amplitudeScale * value[lane.key]}
            color={lane.color}
            radius={5}
          />
        </g>
      ))}
      <line
        x1={110 + 465 * probe}
        x2={110 + 465 * probe}
        y1="43"
        y2="426"
        stroke={tint(T.ink, 0.25)}
        strokeWidth="1.5"
        strokeDasharray="5 6"
      />
      <Panel>
        <Label x={805} y={106} size={20}>
          锁定同一个位置
        </Label>
        <Formula
          x={668}
          y={131}
          width={272}
          height={75}
          latex="y=y_1+y_2"
          size={34}
        />
        <Label x={680} y={232} anchor="start" size={19} color={T.accentText}>
          y₁
        </Label>
        <Label x={928} y={232} anchor="end" size={26} color={T.accentText}>
          {number(value.y1, 3)}
        </Label>
        <Label x={680} y={279} anchor="start" size={19} color={T.compareText}>
          y₂
        </Label>
        <Label x={928} y={279} anchor="end" size={26} color={T.compareText}>
          {number(value.y2, 3)}
        </Label>
        <line x1="678" x2="932" y1="299" y2="299" stroke={T.border} />
        <Label x={680} y={341} anchor="start" size={19} color={T.positive}>
          y₁ + y₂
        </Label>
        <Label x={928} y={341} anchor="end" size={29} color={T.positive}>
          {number(value.sum, 3)}
        </Label>
        <Label x={805} y={379} size={16} color={T.muted}>
          {data.cycles1 === data.cycles2
            ? "同频同相：位移相互加强"
            : `空间频率之比 ${data.cycles1} : ${data.cycles2}`}
        </Label>
      </Panel>
      <Footer color={T.positive}>
        叠加的是每个位置的有符号位移；波峰、波谷都遵守同一条相加规则。
      </Footer>
      <TeachingFocus id="wave-1" operations={["components"]} x={45} y={50} width={557} height={118}/>
      <TeachingFocus id="wave-2" operations={["components"]} x={45} y={175} width={557} height={118} color={T.compare}/>
      <TeachingFocus id="combined-wave" operations={["superpose", "propagate"]} x={45} y={306} width={557} height={118} color={T.positive}/>
      <TeachingFocus id="phase" operations={["compare"]} x={670} y={357} width={269} height={34}/>

    </Diagram>
  );
}

export function sampleCircuitQuantity(data: CircuitQuantityConfig) {
  const parallel = data.topology === "parallel";
  const resistance = parallel
    ? 1 / (1 / data.resistance1 + 1 / data.resistance2)
    : data.resistance1 + data.resistance2;
  const current = data.voltage / resistance;
  const current1 = parallel ? data.voltage / data.resistance1 : current,
    current2 = parallel ? data.voltage / data.resistance2 : current;
  return {
    resistance,
    current,
    current1,
    current2,
    voltage1: current1 * data.resistance1,
    voltage2: current2 * data.resistance2,
  };
}
function CurrentDots({
  points,
  current,
  time,
  opacity = 1,
}: {
  points: number[][];
  current: number;
  time: number;
  opacity?: number;
}) {
  const lengths = points
    .slice(1)
    .map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const count = Math.max(3, Math.round(total / 92));
  return (
    <g opacity={opacity}>
      {Array.from({ length: count }, (_, i) => {
        let distance = ((i / count) * total + time * current * 35) % total;
        let index = 0;
        while (index < lengths.length - 1 && distance > lengths[index]) {
          distance -= lengths[index];
          index++;
        }
        const ratio = distance / lengths[index],
          x = mix(points[index][0], points[index + 1][0], ratio),
          y = mix(points[index][1], points[index + 1][1], ratio);
        return <circle key={i} cx={x} cy={y} r="4" fill={T.accent} />;
      })}
    </g>
  );
}
function Resistor({
  x,
  y,
  width = 100,
  label,
  voltage,
  color = T.compare,
}: {
  x: number;
  y: number;
  width?: number;
  label: string;
  voltage: string;
  color?: string;
}) {
  return (
    <g>
      <rect
        x={x}
        y={y - 17}
        width={width}
        height="34"
        rx="5"
        fill={T.surface}
        stroke={color}
        strokeWidth="3"
      />
      <path
        d={`M${x + 12},${y} h${width - 24}`}
        stroke={tint(color, 0.2)}
        strokeWidth="9"
        strokeLinecap="round"
      />
      <Label x={x + width / 2} y={y - 34} size={19} color={color}>
        {label}
      </Label>
      <Label x={x + width / 2} y={y + 51} size={18} color={T.muted}>
        {voltage}
      </Label>
    </g>
  );
}
export function CircuitQuantityScene({
  frame,
  fps,
  data = circuitQuantityPresets[0],
}: SceneProps & { data?: CircuitQuantityConfig }) {
  const value = sampleCircuitQuantity(data),
    parallel = data.topology === "parallel";
  const active = progress(frame, fps, 1, 1),
    time = Math.max(0, frame / fps - 1),
    wire = { fill: "none", stroke: T.tertiary, strokeWidth: 3, ...stroke };
  return (
    <Diagram
      label={
        parallel
          ? "并联回路中的电压、电流和等效电阻"
          : "串联回路中的电压、电流和等效电阻"
      }
    >
      <Label x={307} y={47} size={21}>
        {parallel
          ? "并联：两支路连接相同的两个节点"
          : "串联：电流沿唯一闭合路径流动"}
      </Label>
      <path
        d={
          parallel
            ? "M105,231 V148 H585 V377 H105 V266"
            : "M105,231 V151 H586 V377 H105 V266"
        }
        {...wire}
      />
      <line x1="80" x2="130" y1="240" y2="240" stroke={T.ink} strokeWidth="4" />
      <line x1="91" x2="119" y1="256" y2="256" stroke={T.ink} strokeWidth="4" />
      <line
        x1="105"
        x2="105"
        y1="231"
        y2="240"
        stroke={T.tertiary}
        strokeWidth="3"
      />
      <line
        x1="105"
        x2="105"
        y1="256"
        y2="266"
        stroke={T.tertiary}
        strokeWidth="3"
      />
      <Label x={71} y={217} size={17} color={T.muted}>
        +
      </Label>
      <Label x={71} y={287} size={17} color={T.muted}>
        −
      </Label>
      <Label x={157} y={260} size={22} anchor="start">
        {data.voltage} V
      </Label>
      {parallel ? (
        <g>
          <path d="M237,148 V293 H585" {...wire} />
          <circle cx="237" cy="148" r="5" fill={T.ink} />
          <circle cx="585" cy="293" r="5" fill={T.ink} />
          <CurrentDots
            points={[
              [105, 240],
              [105, 148],
              [237, 148],
            ]}
            current={value.current}
            time={time}
            opacity={active}
          />
          <CurrentDots
            points={[
              [237, 148],
              [585, 148],
              [585, 293],
            ]}
            current={value.current1}
            time={time}
            opacity={active}
          />
          <CurrentDots
            points={[
              [237, 148],
              [237, 293],
              [585, 293],
            ]}
            current={value.current2}
            time={time}
            opacity={active}
          />
          <CurrentDots
            points={[
              [585, 293],
              [585, 377],
              [105, 377],
              [105, 256],
            ]}
            current={value.current}
            time={time}
            opacity={active}
          />
          <Resistor
            x={335}
            y={148}
            label={`R₁ = ${data.resistance1} Ω`}
            voltage={`U₁ = ${number(value.voltage1)} V`}
          />
          <Resistor
            x={335}
            y={293}
            label={`R₂ = ${data.resistance2} Ω`}
            voltage={`U₂ = ${number(value.voltage2)} V`}
            color={T.caution}
          />
          <Label x={515} y={119} size={18} color={T.accentText}>
            {number(value.current1)} A
          </Label>
          <Label x={515} y={272} size={18} color={T.accentText}>
            {number(value.current2)} A
          </Label>
        </g>
      ) : (
        <g>
          <CurrentDots
            points={[
              [105, 240],
              [105, 151],
              [586, 151],
              [586, 377],
              [105, 377],
              [105, 256],
            ]}
            current={value.current}
            time={time}
            opacity={active}
          />
          <Resistor
            x={230}
            y={151}
            label={`R₁ = ${data.resistance1} Ω`}
            voltage={`U₁ = ${number(value.voltage1)} V`}
          />
          <Resistor
            x={435}
            y={151}
            label={`R₂ = ${data.resistance2} Ω`}
            voltage={`U₂ = ${number(value.voltage2)} V`}
            color={T.caution}
          />
          <Formula
            x={225}
            y={231}
            width={340}
            height={80}
            latex={`${number(value.voltage1)}+${number(value.voltage2)}=${data.voltage}\\,\\mathrm V`}
            size={29}
          />
        </g>
      )}
      <Arrow x1={420} y1={377} x2={305} y2={377} color={T.accent} width={3} />
      <Label x={362} y={420} size={19} color={T.accentText}>
        总电流 I = {number(value.current)} A
      </Label>
      <Panel>
        <Label x={805} y={108} size={20}>
          同一回路，一套守恒关系
        </Label>
        <Formula
          x={666}
          y={139}
          width={281}
          height={80}
          latex={
            parallel
              ? `R_{\\mathrm{eq}}=\\frac{${data.resistance1}\\times${data.resistance2}}{${data.resistance1}+${data.resistance2}}=${number(value.resistance)}\\,\\Omega`
              : `R_{\\mathrm{eq}}=${data.resistance1}+${data.resistance2}=${number(value.resistance)}\\,\\Omega`
          }
          size={24}
        />
        <Formula
          x={668}
          y={240}
          width={274}
          height={82}
          latex={`I=\\frac{U}{R_{\\mathrm{eq}}}=\\frac{${data.voltage}}{${number(value.resistance)}}=${number(value.current)}\\,\\mathrm A`}
          size={24}
        />
        <Label x={805} y={356} size={18} color={T.accentText}>
          {parallel
            ? `${number(value.current1)} A + ${number(value.current2)} A = ${number(value.current)} A`
            : "每个元件流过的电流相同"}
        </Label>
        <Label x={805} y={385} size={15} color={T.muted}>
          亮点表示约定电流方向
        </Label>
      </Panel>
      <Footer>
        {parallel
          ? "每条支路电压相同；节点处流入电流等于流出电流。"
          : "电源提供的电压，等于各串联电阻上的电压之和。"}
      </Footer>
      <TeachingFocus id="source" operations={["circuit"]} x={73} y={211} width={153} height={83}/>
      <TeachingFocus id="resistor-1" x={parallel ? 326 : 221} y={105} width={135} height={100}/>
      <TeachingFocus id="resistor-2" x={parallel ? 326 : 426} y={parallel ? 248 : 108} width={135} height={100} color={T.caution}/>
      <TeachingFocus id="current-flow" operations={["current"]} x={299} y={364} width={132} height={28}/>
      <TeachingFocus id="equivalent-resistance" operations={["quantities"]} x={666} y={137} width={281} height={84}/>
      <TeachingFocus id="total-current" x={666} y={238} width={281} height={86}/>

    </Diagram>
  );
}

export function MathPhysicsScene({
  id,
  frame,
  fps,
  variant = 0,
  config,
}: SceneProps & { id: string; variant?: number; config?: MathPhysicsConfig }) {
  const index = Math.abs(Math.floor(variant)) % 2,
    timing = { frame, fps };
  switch (id) {
    case "math-pythagoras":
      return config && "a" in config ? (
        <GeometryAreaScene {...timing} data={config} />
      ) : (
        <GeometryTransformScene
          {...timing}
          data={
            (config as GeometryTransformConfig | undefined) ??
            geometryTransformPresets[index]
          }
        />
      );
    case "math-tangent":
      return (
        <FunctionChangeScene
          {...timing}
          data={
            (config as FunctionChangeConfig | undefined) ??
            functionChangePresets[index]
          }
        />
      );
    case "math-integral":
      return (
        <AccumulationScene
          {...timing}
          data={
            (config as AccumulationConfig | undefined) ??
            accumulationPresets[index]
          }
        />
      );
    case "math-probability":
      return (
        <ConditionalSetScene
          {...timing}
          data={
            (config as ConditionalSetConfig | undefined) ??
            conditionalSetPresets[index]
          }
        />
      );
    case "physics-forces":
      return (
        <ForceMotionScene
          {...timing}
          data={
            (config as ForceMotionConfig | undefined) ??
            forceMotionPresets[index]
          }
        />
      );
    case "physics-waves":
      return (
        <WaveSuperpositionScene
          {...timing}
          data={
            (config as WaveSuperpositionConfig | undefined) ??
            waveSuperpositionPresets[index]
          }
        />
      );
    case "physics-circuit":
      return (
        <CircuitQuantityScene
          {...timing}
          data={
            (config as CircuitQuantityConfig | undefined) ??
            circuitQuantityPresets[index]
          }
        />
      );
    default:
      return null;
  }
}
