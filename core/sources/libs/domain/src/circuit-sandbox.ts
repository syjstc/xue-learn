/**
 * DC circuit lab: LLM authors a nested series/parallel tree; the engine
 * compiles a netlist, solves it with MNA, and lays out a schematic.
 *
 * Example (series + parallel):
 * {
 *   type: "circuit_sandbox",
 *   title: "并联分流",
 *   summary: "…",
 *   circuit: {
 *     series: [
 *       { id: "bat", kind: "battery", v: 6 },
 *       { id: "sw", kind: "switch", closed: true },
 *       { parallel: [
 *         { id: "l1", kind: "bulb" },
 *         { id: "r1", kind: "resistor", ohm: 20 }
 *       ]}
 *     ]
 *   }
 * }
 */

export const CIRCUIT_PART_KINDS = [
  "battery",
  "resistor",
  "rheostat",
  "switch",
  "bulb",
  "ammeter",
  "voltmeter",
] as const;

export type CircuitPartKind = (typeof CIRCUIT_PART_KINDS)[number];

export type CircuitPart = {
  id: string;
  kind: CircuitPartKind;
  label?: string;
  /** Battery voltage (V). */
  v?: number;
  /** Resistance (Ω) for resistor / rheostat. */
  ohm?: number;
  min?: number;
  max?: number;
  /** Switch closed = conducting. */
  closed?: boolean;
  /** Bulb rated voltage (V). */
  ratedV?: number;
  /** Bulb rated power (W). */
  ratedW?: number;
};

export type CircuitSeries = { series: CircuitNode[] };
export type CircuitParallel = { parallel: CircuitNode[] };
export type CircuitNode = CircuitPart | CircuitSeries | CircuitParallel;

/** @deprecated Stored lessons may still use a node-id netlist. */
export type CircuitComponentKind =
  | "voltage_source"
  | "resistor"
  | "potentiometer"
  | "switch"
  | "lightbulb"
  | "voltmeter"
  | "ammeter"
  | CircuitPartKind;

/** @deprecated Prefer `circuit` tree. */
export type CircuitComponent = {
  id: string;
  kind: CircuitComponentKind;
  label?: string;
  nodeA: string;
  nodeB: string;
  value?: number;
  minValue?: number;
  maxValue?: number;
  closed?: boolean;
  ratedVoltage?: number;
  ratedPower?: number;
  position?: [number, number];
};

/** @deprecated Prefer tree layout; kept for stored lessons. */
export type CircuitWire = {
  id: string;
  from: string;
  to: string;
  points?: [number, number][];
};

export type CircuitSandbox = {
  type: "circuit_sandbox";
  title: string;
  summary: string;
  /** Nested series/parallel composition. Preferred authoring form. */
  circuit?: CircuitNode;
  targetObservation?: string;
  /** Legacy netlist. Used only when `circuit` is absent. */
  components?: CircuitComponent[];
  wires?: CircuitWire[];
  groundNode?: string;
};

export type CircuitOverride = { ohm?: number; closed?: boolean; v?: number };

export type CircuitSolvedPart = {
  id: string;
  kind: CircuitPartKind;
  label?: string;
  voltageDrop: number;
  current: number;
  power: number;
  brightnessRatio?: number;
};

export type CircuitSolution = {
  nodeVoltages: Record<string, number>;
  parts: Record<string, CircuitSolvedPart>;
  /** @deprecated Use `parts`. */
  components: Record<string, CircuitSolvedPart>;
  isCompleteCircuit: boolean;
};

export type SchematicSymbol = {
  id: string;
  kind: CircuitPartKind;
  x: number;
  y: number;
  rotation: 0 | 90;
  label: string;
  valueText?: string;
};

export type SchematicWire = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Solved current is taken from this part when present. */
  partId?: string;
};

export type CircuitSchematic = {
  width: number;
  height: number;
  symbols: SchematicSymbol[];
  wires: SchematicWire[];
  dots: Array<{ x: number; y: number }>;
};

const LIVE_CURRENT = 1e-4;

/** Current used to animate a schematic wire. Missing part tags are treated as no current. */
export function schematicWireCurrent(
  wire: SchematicWire,
  solution: CircuitSolution,
): number {
  if (!wire.partId) return 0;
  return Math.abs(solution.parts[wire.partId]?.current ?? 0);
}

export function isSchematicWireLive(
  wire: SchematicWire,
  solution: CircuitSolution,
): boolean {
  return schematicWireCurrent(wire, solution) > LIVE_CURRENT;
}

const KIND_ALIASES: Record<string, CircuitPartKind> = {
  battery: "battery",
  voltage_source: "battery",
  source: "battery",
  dc: "battery",
  vsource: "battery",
  resistor: "resistor",
  r: "resistor",
  rheostat: "rheostat",
  potentiometer: "rheostat",
  pot: "rheostat",
  variable_resistor: "rheostat",
  switch: "switch",
  bulb: "bulb",
  lightbulb: "bulb",
  lamp: "bulb",
  led: "bulb",
  ammeter: "ammeter",
  amp: "ammeter",
  voltmeter: "voltmeter",
  volt: "voltmeter",
};

export function normalizeCircuitKind(kind: string): CircuitPartKind | null {
  return KIND_ALIASES[kind.trim().toLowerCase()] ?? null;
}

export function isCircuitPart(node: CircuitNode): node is CircuitPart {
  return (
    typeof node === "object" &&
    node !== null &&
    "kind" in node &&
    typeof (node as CircuitPart).kind === "string"
  );
}

export function isCircuitSeries(node: CircuitNode): node is CircuitSeries {
  return (
    typeof node === "object" &&
    node !== null &&
    "series" in node &&
    Array.isArray((node as CircuitSeries).series)
  );
}

export function isCircuitParallel(node: CircuitNode): node is CircuitParallel {
  return (
    typeof node === "object" &&
    node !== null &&
    "parallel" in node &&
    Array.isArray((node as CircuitParallel).parallel)
  );
}

/**
 * Unwraps trivial groups (`parallel`/`series` of 0–1 items) and maps kind
 * aliases so LLM JSON does not fail closed on provider-omitted minItems.
 */
export function normalizeCircuitTree(node: unknown): unknown {
  if (node == null || typeof node !== "object" || Array.isArray(node)) {
    return node;
  }
  const rec = node as Record<string, unknown>;
  if (typeof rec.kind === "string") {
    const kind = normalizeCircuitKind(rec.kind);
    return kind && kind !== rec.kind ? { ...rec, kind } : rec;
  }
  if (Array.isArray(rec.series)) {
    const series = rec.series
      .map((child) => normalizeCircuitTree(child))
      .filter((child) => child != null);
    if (series.length === 0) return undefined;
    if (series.length === 1) return series[0];
    return { series };
  }
  if (Array.isArray(rec.parallel)) {
    const parallel = rec.parallel
      .map((child) => normalizeCircuitTree(child))
      .filter((child) => child != null);
    if (parallel.length === 0) return undefined;
    if (parallel.length === 1) return parallel[0];
    return { parallel };
  }
  return rec;
}

export function normalizeCircuitSandboxPayload(value: unknown): unknown {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const component = value as Record<string, unknown>;
  if (component.circuit == null) return value;
  const circuit = normalizeCircuitTree(component.circuit);
  if (circuit === undefined) {
    const next = { ...component };
    delete next.circuit;
    return next;
  }
  return { ...component, circuit };
}

export function collectCircuitParts(node: CircuitNode | undefined): CircuitPart[] {
  if (!node) return [];
  if (isCircuitPart(node)) return [node];
  if (isCircuitSeries(node)) return node.series.flatMap(collectCircuitParts);
  if (isCircuitParallel(node)) return node.parallel.flatMap(collectCircuitParts);
  return [];
}

export function listSandboxParts(sandbox: CircuitSandbox): CircuitPart[] {
  if (sandbox.circuit) return collectCircuitParts(sandbox.circuit);
  return (sandbox.components ?? []).map(legacyComponentToPart);
}

function legacyComponentToPart(c: CircuitComponent): CircuitPart {
  const kind = normalizeCircuitKind(c.kind) ?? "resistor";
  return {
    id: c.id,
    kind,
    label: c.label,
    v: kind === "battery" ? c.value : undefined,
    ohm:
      kind === "resistor" || kind === "rheostat"
        ? c.value
        : undefined,
    min: c.minValue,
    max: c.maxValue,
    closed: c.closed,
    ratedV: c.ratedVoltage,
    ratedW: c.ratedPower,
  };
}

type CompiledBranch = {
  id: string;
  kind: CircuitPartKind;
  label?: string;
  nodeA: string;
  nodeB: string;
  part: CircuitPart;
};

function freshNode(counter: { n: number }): string {
  counter.n += 1;
  return `n${counter.n}`;
}

function compileNode(
  node: CircuitNode,
  a: string,
  b: string,
  branches: CompiledBranch[],
  counter: { n: number },
  ids: { n: number },
): void {
  if (isCircuitPart(node)) {
    const id = node.id?.trim() || `p${++ids.n}`;
    const kind = normalizeCircuitKind(node.kind) ?? node.kind;
    branches.push({
      id,
      kind,
      label: node.label,
      nodeA: a,
      nodeB: b,
      part: { ...node, id, kind },
    });
    return;
  }
  if (isCircuitSeries(node)) {
    const items = node.series.filter(Boolean);
    if (items.length === 0) return;
    if (items.length === 1) {
      compileNode(items[0]!, a, b, branches, counter, ids);
      return;
    }
    let prev = a;
    items.forEach((item, index) => {
      const next = index === items.length - 1 ? b : freshNode(counter);
      compileNode(item, prev, next, branches, counter, ids);
      prev = next;
    });
    return;
  }
  if (isCircuitParallel(node)) {
    const items = node.parallel.filter(Boolean);
    if (items.length === 0) return;
    if (items.length === 1) {
      compileNode(items[0]!, a, b, branches, counter, ids);
      return;
    }
    for (const item of items) {
      compileNode(item, a, b, branches, counter, ids);
    }
  }
}

/**
 * Top-level `series` is a closed loop (battery negative = ground).
 * Nested series/parallel are two-terminal networks.
 */
export function compileCircuit(sandbox: CircuitSandbox): CompiledBranch[] {
  if (sandbox.circuit) {
    const branches: CompiledBranch[] = [];
    const counter = { n: 0 };
    const ids = { n: 0 };
    const root = sandbox.circuit;
    if (isCircuitSeries(root)) {
      const items = root.series.filter(Boolean);
      if (items.length === 0) return [];
      const nodes = items.map((_, i) => (i === 0 ? "0" : freshNode(counter)));
      items.forEach((item, i) => {
        const na = nodes[i]!;
        const nb = nodes[(i + 1) % items.length]!;
        if (isCircuitPart(item) && normalizeCircuitKind(item.kind) === "battery") {
          compileNode(item, nb, na, branches, counter, ids);
        } else {
          compileNode(item, na, nb, branches, counter, ids);
        }
      });
      return branches;
    }
    compileNode(root, "1", "0", branches, counter, ids);
    return branches;
  }

  return (sandbox.components ?? []).map((c) => {
    const part = legacyComponentToPart(c);
    return {
      id: part.id,
      kind: part.kind,
      label: part.label,
      nodeA: c.nodeA,
      nodeB: c.nodeB,
      part,
    };
  });
}

function partResistance(
  part: CircuitPart,
  override?: CircuitOverride,
): number {
  switch (part.kind) {
    case "resistor":
      return Math.max(1e-6, override?.ohm ?? part.ohm ?? 10);
    case "rheostat":
      return Math.max(1e-6, override?.ohm ?? part.ohm ?? 40);
    case "bulb": {
      const v = part.ratedV ?? 6;
      const p = part.ratedW ?? 3;
      return (v * v) / Math.max(0.01, p);
    }
    case "switch": {
      const closed = override?.closed ?? part.closed ?? false;
      return closed ? 0.001 : 1e8;
    }
    case "voltmeter":
      return 1e7;
    case "ammeter":
      return 0.001;
    case "battery":
      return Number.POSITIVE_INFINITY;
  }
}

function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  if (n === 0) return [];
  const M: number[][] = A.map((row, i) => [...row, b[i] ?? 0]);

  for (let i = 0; i < n; i++) {
    let maxRow = i;
    let maxVal = Math.abs(M[i]![i]!);
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(M[k]![i]!) > maxVal) {
        maxVal = Math.abs(M[k]![i]!);
        maxRow = k;
      }
    }
    if (maxVal < 1e-12) continue;
    if (maxRow !== i) {
      const temp = M[i]!;
      M[i] = M[maxRow]!;
      M[maxRow] = temp;
    }
    for (let k = i + 1; k < n; k++) {
      const factor = M[k]![i]! / M[i]![i]!;
      for (let j = i; j <= n; j++) {
        M[k]![j] -= factor * M[i]![j]!;
      }
    }
  }

  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = M[i]![n]!;
    for (let j = i + 1; j < n; j++) {
      sum -= M[i]![j]! * x[j]!;
    }
    const diag = M[i]![i]!;
    x[i] = Math.abs(diag) > 1e-12 ? sum / diag : 0;
  }
  return x;
}

export function solveCircuit(
  sandbox: CircuitSandbox,
  overrides?: Record<string, CircuitOverride>,
): CircuitSolution {
  const branches = compileCircuit(sandbox);
  const groundNode = sandbox.circuit ? "0" : (sandbox.groundNode ?? "0");

  const nodeSet = new Set<string>();
  for (const c of branches) {
    nodeSet.add(c.nodeA);
    nodeSet.add(c.nodeB);
  }
  nodeSet.delete(groundNode);
  const nonGroundNodes = Array.from(nodeSet);
  const nodeIndex = new Map<string, number>();
  nonGroundNodes.forEach((node, i) => nodeIndex.set(node, i));

  const N = nonGroundNodes.length;
  const voltageSources = branches.filter((c) => c.kind === "battery");
  const M = voltageSources.length;
  const totalVars = N + M;

  const empty = (): CircuitSolution => ({
    nodeVoltages: { [groundNode]: 0 },
    parts: {},
    components: {},
    isCompleteCircuit: false,
  });

  if (totalVars === 0) return empty();

  const A: number[][] = Array.from({ length: totalVars }, () =>
    new Array<number>(totalVars).fill(0),
  );
  const RHS: number[] = new Array<number>(totalVars).fill(0);

  const stampConductance = (nodeA: string, nodeB: string, g: number) => {
    const i = nodeIndex.get(nodeA);
    const j = nodeIndex.get(nodeB);
    if (i !== undefined) A[i]![i]! += g;
    if (j !== undefined) A[j]![j]! += g;
    if (i !== undefined && j !== undefined) {
      A[i]![j]! -= g;
      A[j]![i]! -= g;
    }
  };

  for (const c of branches) {
    if (c.kind === "battery") continue;
    const r = partResistance(c.part, overrides?.[c.id]);
    stampConductance(c.nodeA, c.nodeB, 1 / Math.max(1e-6, r));
  }

  voltageSources.forEach((src, srcIndex) => {
    const vIndex = N + srcIndex;
    RHS[vIndex] = overrides?.[src.id]?.v ?? src.part.v ?? 6;
    const i = nodeIndex.get(src.nodeA);
    const j = nodeIndex.get(src.nodeB);
    if (i !== undefined) {
      A[i]![vIndex]! += 1;
      A[vIndex]![i]! += 1;
    }
    if (j !== undefined) {
      A[j]![vIndex]! -= 1;
      A[vIndex]![j]! -= 1;
    }
  });

  const sol = solveLinearSystem(A, RHS);
  const rawVoltages: Record<string, number> = { [groundNode]: 0 };
  const nodeVoltages: Record<string, number> = { [groundNode]: 0 };
  if (sol) {
    nonGroundNodes.forEach((node, idx) => {
      const v = sol[idx] ?? 0;
      rawVoltages[node] = v;
      nodeVoltages[node] = Math.round(v * 1000) / 1000;
    });
  }

  const parts: Record<string, CircuitSolvedPart> = {};
  let totalCurrentFlow = 0;

  for (const c of branches) {
    const vA = rawVoltages[c.nodeA] ?? 0;
    const vB = rawVoltages[c.nodeB] ?? 0;
    const vDropRaw = vA - vB;
    const vDrop = Math.round(vDropRaw * 1000) / 1000;
    let current = 0;
    let power = 0;
    let brightnessRatio: number | undefined;

    if (c.kind === "battery") {
      const srcIdx = voltageSources.findIndex((v) => v.id === c.id);
      if (sol && srcIdx >= 0) {
        current = Math.abs(Math.round((sol[N + srcIdx] ?? 0) * 10000) / 10000);
        power = Math.round(current * Math.abs(vDropRaw) * 1000) / 1000;
        totalCurrentFlow += current;
      }
    } else {
      const r = partResistance(c.part, overrides?.[c.id]);
      current = vDropRaw / Math.max(1e-6, r);
      power = Math.round(Math.abs(vDropRaw * current) * 1000) / 1000;
      if (c.kind === "bulb") {
        const ratedP = c.part.ratedW ?? 3;
        brightnessRatio =
          Math.round(Math.min(1.5, power / Math.max(0.01, ratedP)) * 100) / 100;
      }
    }

    parts[c.id] = {
      id: c.id,
      kind: c.kind,
      label: c.label ?? c.part.label,
      voltageDrop: vDrop,
      current: Math.abs(Math.round(current * 10000) / 10000),
      power,
      ...(brightnessRatio !== undefined ? { brightnessRatio } : {}),
    };
  }

  return {
    nodeVoltages,
    parts,
    components: parts,
    isCompleteCircuit: totalCurrentFlow > 1e-4,
  };
}

export function initialCircuitOverrides(
  sandbox: CircuitSandbox,
): Record<string, CircuitOverride> {
  const initial: Record<string, CircuitOverride> = {};
  for (const part of listSandboxParts(sandbox)) {
    if (part.kind === "switch") {
      initial[part.id] = { closed: part.closed ?? false };
    } else if (part.kind === "rheostat") {
      initial[part.id] = { ohm: part.ohm ?? part.min ?? 40 };
    }
  }
  return initial;
}

export function partDisplayValue(
  part: CircuitPart,
  override?: CircuitOverride,
): string {
  switch (part.kind) {
    case "battery":
      return `${override?.v ?? part.v ?? 6}V`;
    case "resistor":
      return `${override?.ohm ?? part.ohm ?? 10}Ω`;
    case "rheostat":
      return `${override?.ohm ?? part.ohm ?? 40}Ω`;
    case "switch": {
      const closed = override?.closed ?? part.closed ?? false;
      return closed ? "闭合" : "断开";
    }
    case "bulb":
      return part.label ?? "灯泡";
    case "ammeter":
      return "A";
    case "voltmeter":
      return "V";
  }
}

export function defaultPartLabel(part: CircuitPart): string {
  if (part.label) return part.label;
  switch (part.kind) {
    case "battery":
      return "电源";
    case "resistor":
      return "电阻";
    case "rheostat":
      return "变阻器";
    case "switch":
      return "开关";
    case "bulb":
      return "灯泡";
    case "ammeter":
      return "电流表";
    case "voltmeter":
      return "电压表";
  }
}

type LayoutBox = {
  w: number;
  h: number;
  left: { x: number; y: number };
  right: { x: number; y: number };
  symbols: SchematicSymbol[];
  wires: SchematicWire[];
  dots: Array<{ x: number; y: number }>;
};

const PART_W = 84;
const PART_H = 64;
const SERIES_GAP = 28;
const BRANCH_GAP = 36;
const BUS_PAD = 18;

/** Distance from the symbol center to where layout leads meet the glyph body. */
export function schematicBodyHalf(kind: CircuitPartKind): {
  left: number;
  right: number;
} {
  switch (kind) {
    case "battery":
      return { left: 6, right: 5 };
    case "resistor":
    case "rheostat":
      return { left: 20, right: 20 };
    case "switch":
      return { left: 12, right: 12 };
    case "bulb":
    case "ammeter":
    case "voltmeter":
      return { left: 13, right: 13 };
  }
}

function translateBox(box: LayoutBox, dx: number, dy: number): LayoutBox {
  const t = <T extends { x: number; y: number }>(p: T): T => ({
    ...p,
    x: p.x + dx,
    y: p.y + dy,
  });
  return {
    w: box.w,
    h: box.h,
    left: t(box.left),
    right: t(box.right),
    symbols: box.symbols.map((s) => ({ ...s, x: s.x + dx, y: s.y + dy })),
    wires: box.wires.map((w) => ({
      ...w,
      x1: w.x1 + dx,
      y1: w.y1 + dy,
      x2: w.x2 + dx,
      y2: w.y2 + dy,
    })),
    dots: box.dots.map((d) => ({ x: d.x + dx, y: d.y + dy })),
  };
}

function layoutPart(
  part: CircuitPart,
  override?: CircuitOverride,
): LayoutBox {
  const kind = normalizeCircuitKind(part.kind) ?? part.kind;
  const cx = PART_W / 2;
  const cy = PART_H / 2;
  const { left, right } = schematicBodyHalf(kind);
  const overlap = 1.5;
  return {
    w: PART_W,
    h: PART_H,
    left: { x: 0, y: cy },
    right: { x: PART_W, y: cy },
    symbols: [
      {
        id: part.id,
        kind,
        x: cx,
        y: cy,
        rotation: 0,
        label: defaultPartLabel(part),
        valueText: partDisplayValue({ ...part, kind }, override),
      },
    ],
    wires: [
      {
        x1: 0,
        y1: cy,
        x2: cx - left + overlap,
        y2: cy,
        partId: part.id,
      },
      {
        x1: cx + right - overlap,
        y1: cy,
        x2: PART_W,
        y2: cy,
        partId: part.id,
      },
    ],
    dots: [],
  };
}

function layoutOpenSeries(
  items: CircuitNode[],
  overrides?: Record<string, CircuitOverride>,
): LayoutBox {
  const boxes = items.map((item) => layoutNode(item, overrides));
  const h = Math.max(...boxes.map((b) => b.h), PART_H);
  let x = 0;
  const placed: LayoutBox[] = [];
  const wires: SchematicWire[] = [];
  boxes.forEach((box, i) => {
    const y = (h - box.h) / 2;
    const moved = translateBox(box, x, y);
    if (i > 0) {
      const prev = placed[i - 1]!;
      wires.push({
        x1: prev.right.x,
        y1: prev.right.y,
        x2: moved.left.x,
        y2: moved.left.y,
        partId: seriesConnectionPartId(items[i - 1]!, items[i]!),
      });
    }
    placed.push(moved);
    x += box.w + (i === boxes.length - 1 ? 0 : SERIES_GAP);
  });
  const first = placed[0]!;
  const last = placed[placed.length - 1]!;
  return {
    w: x,
    h,
    left: { ...first.left },
    right: { ...last.right },
    symbols: placed.flatMap((b) => b.symbols),
    wires: [...placed.flatMap((b) => b.wires), ...wires],
    dots: placed.flatMap((b) => b.dots),
  };
}

function firstPartId(node: CircuitNode): string | undefined {
  const parts = collectCircuitParts(node);
  return parts[0]?.id;
}

/**
 * Series wires that attach to a parallel block carry the port (main-line) current,
 * not the current of the first part inside a possibly open branch.
 */
function seriesConnectionPartId(
  prev: CircuitNode,
  next: CircuitNode,
): string | undefined {
  if (isCircuitParallel(next) && !isCircuitParallel(prev)) {
    return firstPartId(prev);
  }
  if (isCircuitParallel(prev) && !isCircuitParallel(next)) {
    return firstPartId(next);
  }
  return firstPartId(prev) ?? firstPartId(next);
}

function layoutParallelGroup(
  items: CircuitNode[],
  overrides?: Record<string, CircuitOverride>,
): LayoutBox {
  const boxes = items.map((item) => layoutNode(item, overrides));
  const innerW = Math.max(...boxes.map((b) => b.w), PART_W);
  const contentH =
    boxes.reduce((sum, b) => sum + b.h, 0) + BRANCH_GAP * (boxes.length - 1);
  const w = BUS_PAD + innerW + BUS_PAD;
  const h = Math.max(contentH, PART_H);
  let y = 0;
  const placed: LayoutBox[] = [];
  const wires: SchematicWire[] = [];
  const dots: Array<{ x: number; y: number }> = [];
  const leftX = 0;
  const rightX = w;

  boxes.forEach((box, i) => {
    const x = BUS_PAD + (innerW - box.w) / 2;
    const moved = translateBox(box, x, y);
    placed.push(moved);
    const pid = firstPartId(items[i]!);
    wires.push({
      x1: leftX,
      y1: moved.left.y,
      x2: moved.left.x,
      y2: moved.left.y,
      partId: pid,
    });
    wires.push({
      x1: moved.right.x,
      y1: moved.right.y,
      x2: rightX,
      y2: moved.right.y,
      partId: pid,
    });
    dots.push({ x: leftX, y: moved.left.y });
    dots.push({ x: rightX, y: moved.right.y });
    y += box.h + BRANCH_GAP;
  });

  const midY = h / 2;
  placed.forEach((moved, i) => {
    const pid = firstPartId(items[i]!);
    if (Math.abs(moved.left.y - midY) <= 1) return;
    wires.push({
      x1: leftX,
      y1: midY,
      x2: leftX,
      y2: moved.left.y,
      partId: pid,
    });
    wires.push({
      x1: rightX,
      y1: midY,
      x2: rightX,
      y2: moved.right.y,
      partId: pid,
    });
  });
  dots.push({ x: leftX, y: midY }, { x: rightX, y: midY });

  return {
    w,
    h,
    left: { x: leftX, y: midY },
    right: { x: rightX, y: midY },
    symbols: placed.flatMap((b) => b.symbols),
    wires: [...placed.flatMap((b) => b.wires), ...wires],
    dots: [...placed.flatMap((b) => b.dots), ...dots],
  };
}

function layoutNode(
  node: CircuitNode,
  overrides?: Record<string, CircuitOverride>,
): LayoutBox {
  if (isCircuitPart(node)) {
    return layoutPart(node, overrides?.[node.id]);
  }
  if (isCircuitSeries(node)) {
    const items = node.series.filter(Boolean);
    if (items.length === 1) return layoutNode(items[0]!, overrides);
    return layoutOpenSeries(items, overrides);
  }
  if (isCircuitParallel(node)) {
    const items = node.parallel.filter(Boolean);
    if (items.length === 1) return layoutNode(items[0]!, overrides);
    return layoutParallelGroup(items, overrides);
  }
  return layoutPart({ id: "empty", kind: "resistor", ohm: 1 });
}

function closeLoop(box: LayoutBox): LayoutBox {
  const returnY = box.h + 40;
  const leftX = box.left.x;
  const rightX = box.right.x;
  const returnPartId =
    box.symbols.find((s) => s.kind === "battery")?.id ?? box.symbols[0]?.id;
  const wires: SchematicWire[] = [
    ...box.wires,
    {
      x1: box.right.x,
      y1: box.right.y,
      x2: rightX,
      y2: returnY,
      partId: returnPartId,
    },
    {
      x1: rightX,
      y1: returnY,
      x2: leftX,
      y2: returnY,
      partId: returnPartId,
    },
    {
      x1: leftX,
      y1: returnY,
      x2: box.left.x,
      y2: box.left.y,
      partId: returnPartId,
    },
  ];
  return {
    ...box,
    h: returnY + 8,
    wires,
  };
}

function layoutLegacyNetlist(sandbox: CircuitSandbox): CircuitSchematic {
  const comps = sandbox.components ?? [];
  if (comps.length === 0) {
    return { width: 200, height: 120, symbols: [], wires: [], dots: [] };
  }
  const nodeIds = Array.from(
    new Set(comps.flatMap((c) => [c.nodeA, c.nodeB])),
  );
  const nodePos = new Map<string, { x: number; y: number }>();
  const cx = 280;
  const cy = 160;
  const radius = 110;
  nodeIds.forEach((id, i) => {
    const angle = (Math.PI * 2 * i) / Math.max(1, nodeIds.length) - Math.PI / 2;
    nodePos.set(id, {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  });
  const symbols: SchematicSymbol[] = [];
  const wires: SchematicWire[] = [];
  const dots = nodeIds.map((id) => nodePos.get(id)!);

  for (const c of comps) {
    const part = legacyComponentToPart(c);
    const pa = nodePos.get(c.nodeA) ?? { x: 80, y: 80 };
    const pb = nodePos.get(c.nodeB) ?? { x: 200, y: 80 };
    const mx = (pa.x + pb.x) / 2;
    const my = (pa.y + pb.y) / 2;
    symbols.push({
      id: part.id,
      kind: part.kind,
      x: mx,
      y: my,
      rotation: Math.abs(pb.x - pa.x) < Math.abs(pb.y - pa.y) ? 90 : 0,
      label: defaultPartLabel(part),
      valueText: partDisplayValue(part),
    });
    wires.push({ x1: pa.x, y1: pa.y, x2: mx, y2: my, partId: part.id });
    wires.push({ x1: mx, y1: my, x2: pb.x, y2: pb.y, partId: part.id });
  }

  return { width: 560, height: 320, symbols, wires, dots };
}

export function layoutCircuit(
  sandbox: CircuitSandbox,
  overrides?: Record<string, CircuitOverride>,
): CircuitSchematic {
  if (!sandbox.circuit) return layoutLegacyNetlist(sandbox);

  const root = sandbox.circuit;
  const inner = isCircuitSeries(root)
    ? closeLoop(layoutOpenSeries(root.series.filter(Boolean), overrides))
    : closeLoop(layoutNode(root, overrides));

  const pad = 36;
  const shifted = translateBox(inner, pad, pad);
  return {
    width: inner.w + pad * 2,
    height: inner.h + pad * 2,
    symbols: shifted.symbols,
    wires: shifted.wires,
    dots: shifted.dots,
  };
}
