"use client";

import { useId, useMemo, useState } from "react";
import {
  defaultPartLabel,
  initialCircuitOverrides,
  isSchematicWireLive,
  layoutCircuit,
  listSandboxParts,
  schematicWireCurrent,
  solveCircuit,
  type CircuitOverride,
  type CircuitPart,
  type CircuitPartKind,
  type CircuitSandbox,
  type CircuitSchematic,
  type CircuitSolution,
  type CircuitSolvedPart,
  type SchematicSymbol,
} from "@xue-learn/core/domain";
import { LabShell } from "./lab-shell.tsx";
import { Slider } from "@/components/ui/slider";
import { cn } from "@xue-learn/core/utils";

export function CircuitSandboxBlock({
  block,
  compact = false,
}: {
  block: CircuitSandbox;
  compact?: boolean;
}) {
  const [overrides, setOverrides] = useState<Record<string, CircuitOverride>>(
    () => initialCircuitOverrides(block),
  );

  const parts = useMemo(() => listSandboxParts(block), [block]);
  const solution = useMemo(
    () => solveCircuit(block, overrides),
    [block, overrides],
  );
  const schematic = useMemo(
    () => layoutCircuit(block, overrides),
    [block, overrides],
  );

  const toggleSwitch = (id: string) => {
    setOverrides((prev) => ({
      ...prev,
      [id]: { ...prev[id], closed: !(prev[id]?.closed ?? false) },
    }));
  };

  const setOhm = (id: string, ohm: number) => {
    setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], ohm } }));
  };

  const switches = parts.filter((p) => p.kind === "switch");
  const rheostats = parts.filter((p) => p.kind === "rheostat");

  const controlsUi = (
    <div className="flex flex-col">
      {switches.map((sw, index) => {
        const closed = overrides[sw.id]?.closed ?? sw.closed ?? false;
        return (
          <div
            key={sw.id}
            className={cn(
              "flex items-center justify-between gap-3 py-2.5",
              index > 0 && "border-t border-[var(--course-content-border)]",
            )}
          >
            <span className="text-xs font-medium text-[var(--course-content)]">
              {defaultPartLabel(sw)}
            </span>
            <button
              type="button"
              onClick={() => toggleSwitch(sw.id)}
              aria-pressed={closed}
              className={cn(
                "relative h-8 w-[4.75rem] shrink-0 rounded-full border transition",
                closed
                  ? "border-[color-mix(in_srgb,var(--color-success)_40%,var(--course-content-border))] bg-[var(--success-soft)]"
                  : "border-[var(--course-content-border)] bg-[var(--course-content-surface-muted)]",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 h-6 w-6 rounded-full shadow-sm transition-[left,background-color]",
                  closed
                    ? "left-[2.55rem] bg-[var(--color-success)]"
                    : "left-0.5 bg-[var(--course-content-muted)]",
                )}
              />
              <span className="sr-only">{closed ? "已闭合" : "已断开"}</span>
              <span
                className={cn(
                  "pointer-events-none absolute inset-y-0 flex items-center text-[10px] font-semibold",
                  closed
                    ? "left-2 text-[var(--success-700)]"
                    : "right-2 text-[var(--course-content-muted)]",
                )}
              >
                {closed ? "闭合" : "断开"}
              </span>
            </button>
          </div>
        );
      })}
      {rheostats.map((pot, index) => {
        const curVal = overrides[pot.id]?.ohm ?? pot.ohm ?? 40;
        const min = pot.min ?? 10;
        const max = pot.max ?? 200;
        return (
          <div
            key={pot.id}
            className={cn(
              "space-y-2 py-2.5",
              (switches.length > 0 || index > 0) &&
                "border-t border-[var(--course-content-border)]",
            )}
          >
            <div className="flex justify-between text-xs text-[var(--course-content)]">
              <span className="font-medium">{defaultPartLabel(pot)}</span>
              <span className="font-mono tabular-nums text-[var(--course-content-muted)]">
                {curVal} Ω
              </span>
            </div>
            <Slider
              value={[curVal]}
              min={min}
              max={max}
              step={1}
              onValueChange={([val]) => val !== undefined && setOhm(pot.id, val)}
            />
          </div>
        );
      })}
    </div>
  );

  const readoutsUi = (
    <div className="flex flex-col gap-2.5 text-xs">
      <div
        className={cn(
          "flex items-center justify-between rounded-md px-2.5 py-1.5",
          solution.isCompleteCircuit
            ? "bg-[var(--success-soft)] text-[var(--success-700)]"
            : "bg-[var(--course-content-surface-muted)] text-[var(--course-content-muted)]",
        )}
      >
        <span>回路状态</span>
        <span className="font-semibold tracking-wide">
          {solution.isCompleteCircuit ? "通路" : "断路"}
        </span>
      </div>
      <div className="overflow-hidden rounded-md border border-[var(--course-content-border)]">
        <div className="grid grid-cols-[minmax(0,1.4fr)_0.7fr_0.7fr] gap-2 bg-[var(--course-content-surface-muted)] px-2.5 py-1.5 font-medium text-[var(--course-content-muted)]">
          <span>元件</span>
          <span className="text-right">I</span>
          <span className="text-right">U / P</span>
        </div>
        {parts.map((part) => {
          const solved = solution.parts[part.id];
          if (!solved) return null;
          const { currentText, restText } = formatReadoutCells(part, solved);
          return (
            <div
              key={part.id}
              className="grid grid-cols-[minmax(0,1.4fr)_0.7fr_0.7fr] gap-2 border-t border-[var(--course-content-border)] px-2.5 py-1.5"
            >
              <span className="truncate text-[var(--course-content)]">
                {defaultPartLabel(part)}
              </span>
              <span className="text-right font-mono tabular-nums text-[var(--course-content)]">
                {currentText}
              </span>
              <span className="text-right font-mono tabular-nums text-[var(--course-content-muted)]">
                {restText}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <LabShell
      title={block.title}
      summary={block.summary}
      targetObservation={block.targetObservation}
      badge="电路仿真沙箱"
      compact={compact}
      onReset={() => setOverrides(initialCircuitOverrides(block))}
      controls={controlsUi}
      readouts={readoutsUi}
      canvasClassName="border-[var(--course-content-border)] bg-[color-mix(in_srgb,var(--course-content-surface)_88%,var(--course-content-muted)_12%)]"
    >
      <CircuitSchematicView
        schematic={schematic}
        solution={solution}
        overrides={overrides}
        onToggleSwitch={toggleSwitch}
      />
    </LabShell>
  );
}

function formatReadoutCells(
  part: CircuitPart,
  solved: { current: number; voltageDrop: number; power: number },
): { currentText: string; restText: string } {
  const i = `${Math.abs(solved.current).toFixed(3)}A`;
  const u = `${Math.abs(solved.voltageDrop).toFixed(2)}V`;
  if (part.kind === "ammeter") return { currentText: i, restText: "—" };
  if (part.kind === "voltmeter") return { currentText: "—", restText: u };
  if (part.kind === "bulb") {
    return { currentText: i, restText: `${solved.power.toFixed(2)}W` };
  }
  if (part.kind === "switch") return { currentText: i, restText: "—" };
  return { currentText: i, restText: u };
}

function CircuitSchematicView({
  schematic,
  solution,
  overrides,
  onToggleSwitch,
}: {
  schematic: CircuitSchematic;
  solution: CircuitSolution;
  overrides: Record<string, CircuitOverride>;
  onToggleSwitch: (id: string) => void;
}) {
  const rawId = useId().replace(/:/g, "");
  const gridId = `circuit-grid-${rawId}`;
  const glowId = `bulb-glow-${rawId}`;

  return (
    <div className="flex items-center justify-center px-2 py-4 md:px-4">
      <svg
        viewBox={`0 0 ${schematic.width} ${schematic.height}`}
        className="h-auto w-full max-h-[380px] select-none overflow-visible text-[var(--course-content)]"
      >
        <defs>
          <pattern
            id={gridId}
            width="16"
            height="16"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 16 0 L 0 0 0 16"
              fill="none"
              stroke="var(--course-content-border)"
              strokeWidth="0.6"
              opacity="0.7"
            />
          </pattern>
          <radialGradient id={glowId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fde68a" stopOpacity="0.9" />
            <stop offset="55%" stopColor="#f59e0b" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
          </radialGradient>
          <style>{`
            @keyframes circuitCurrent {
              from { stroke-dashoffset: 16; }
              to { stroke-dashoffset: 0; }
            }
            .circuit-current {
              animation: circuitCurrent 0.85s linear infinite;
            }
          `}</style>
        </defs>
        <rect
          x="0"
          y="0"
          width={schematic.width}
          height={schematic.height}
          fill={`url(#${gridId})`}
        />
        {schematic.wires.map((wire, i) => {
          const live = isSchematicWireLive(wire, solution);
          const current = schematicWireCurrent(wire, solution);
          const duration = live
            ? `${Math.max(0.35, 0.85 / Math.sqrt(Math.max(current, 0.01) * 6))}s`
            : undefined;
          return (
            <g key={`w-${i}`}>
              <line
                x1={wire.x1}
                y1={wire.y1}
                x2={wire.x2}
                y2={wire.y2}
                stroke="var(--course-content)"
                strokeWidth="2.4"
                strokeLinecap="round"
                opacity={live ? 0.82 : 0.38}
              />
              {live ? (
                <line
                  x1={wire.x1}
                  y1={wire.y1}
                  x2={wire.x2}
                  y2={wire.y2}
                  stroke="var(--color-primary)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeDasharray="4 10"
                  className="circuit-current"
                  opacity="0.95"
                  style={duration ? { animationDuration: duration } : undefined}
                />
              ) : null}
            </g>
          );
        })}
        {schematic.dots.map((dot, i) => (
          <circle
            key={`d-${i}`}
            cx={dot.x}
            cy={dot.y}
            r="3.4"
            fill="var(--course-content)"
            stroke="var(--course-content-surface)"
            strokeWidth="1.2"
          />
        ))}
        {schematic.symbols.map((symbol) => (
          <PartSymbol
            key={symbol.id}
            symbol={symbol}
            solution={solution}
            overrides={overrides}
            glowId={glowId}
            onToggleSwitch={onToggleSwitch}
          />
        ))}
      </svg>
    </div>
  );
}

function PartSymbol({
  symbol,
  solution,
  overrides,
  glowId,
  onToggleSwitch,
}: {
  symbol: SchematicSymbol;
  solution: CircuitSolution;
  overrides: Record<string, CircuitOverride>;
  glowId: string;
  onToggleSwitch: (id: string) => void;
}) {
  const solved = solution.parts[symbol.id];
  const closed = overrides[symbol.id]?.closed;
  const interactive = symbol.kind === "switch";
  const note = annotationText(symbol, solved, closed);
  return (
    <g
      transform={`translate(${symbol.x}, ${symbol.y})`}
      onClick={interactive ? () => onToggleSwitch(symbol.id) : undefined}
      className={interactive ? "cursor-pointer" : undefined}
    >
      <g transform={`rotate(${symbol.rotation})`}>
        <PartGlyph
          kind={symbol.kind}
          glow={solved?.brightnessRatio ?? 0}
          closed={closed}
          glowId={glowId}
        />
      </g>
      <text x="0" y="28" textAnchor="middle" fontSize="10">
        <tspan fill="var(--course-content)" fontWeight="600">
          {symbol.label}
        </tspan>
        {note ? (
          <tspan fill="var(--course-content-muted)" fontSize="9">
            {`  ${note}`}
          </tspan>
        ) : null}
      </text>
    </g>
  );
}

function annotationText(
  symbol: SchematicSymbol,
  solved?: CircuitSolvedPart,
  closed?: boolean,
): string | undefined {
  if (symbol.kind === "switch") {
    return closed ? "闭合" : "断开";
  }
  if (symbol.kind === "ammeter" && solved) {
    return `${Math.abs(solved.current).toFixed(2)}A`;
  }
  if (symbol.kind === "voltmeter" && solved) {
    return `${Math.abs(solved.voltageDrop).toFixed(2)}V`;
  }
  if (symbol.kind === "bulb") return undefined;
  const value = symbol.valueText;
  if (value && symbol.label.includes(value)) return undefined;
  return value;
}

function PartGlyph({
  kind,
  glow,
  closed,
  glowId,
}: {
  kind: CircuitPartKind;
  glow: number;
  closed?: boolean;
  glowId: string;
}) {
  const ink = "var(--course-content)";
  const surface = "var(--course-content-surface)";
  switch (kind) {
    case "battery":
      return (
        <>
          <line x1="-6" y1="-13" x2="-6" y2="13" stroke={ink} strokeWidth="2.4" />
          <line
            x1="2"
            y1="-7"
            x2="2"
            y2="7"
            stroke={ink}
            strokeWidth="5"
            strokeLinecap="round"
          />
          <text
            x="-12"
            y="-16"
            fill="var(--course-content-muted)"
            fontSize="9"
            fontWeight="700"
          >
            +
          </text>
        </>
      );
    case "resistor":
      return (
        <>
          <rect
            x="-20"
            y="-8"
            width="40"
            height="16"
            rx="1.5"
            fill={surface}
            stroke={ink}
            strokeWidth="2"
          />
          <polyline
            points="-14,0 -10,-5 -4,5 2,-5 8,5 14,0"
            fill="none"
            stroke={ink}
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </>
      );
    case "rheostat":
      return (
        <>
          <rect
            x="-20"
            y="-8"
            width="40"
            height="16"
            rx="1.5"
            fill={surface}
            stroke={ink}
            strokeWidth="2"
          />
          <polyline
            points="-14,0 -10,-5 -4,5 2,-5 8,5 14,0"
            fill="none"
            stroke={ink}
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <line
            x1="-12"
            y1="14"
            x2="16"
            y2="-14"
            stroke="var(--color-primary)"
            strokeWidth="1.8"
          />
          <polygon points="16,-14 10,-13 15,-8" fill="var(--color-primary)" />
        </>
      );
    case "switch": {
      const isClosed = closed ?? false;
      return (
        <>
          <circle cx="-12" cy="0" r="2.8" fill={surface} stroke={ink} strokeWidth="1.8" />
          <circle cx="12" cy="0" r="2.8" fill={surface} stroke={ink} strokeWidth="1.8" />
          <line
            x1="-12"
            y1="0"
            x2={isClosed ? 12 : 8}
            y2={isClosed ? 0 : -13}
            stroke={isClosed ? "var(--color-success)" : "var(--color-primary)"}
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </>
      );
    }
    case "bulb":
      return (
        <>
          {glow > 0.05 && (
            <circle
              cx="0"
              cy="0"
              r={18 + glow * 16}
              fill={`url(#${glowId})`}
              opacity={Math.min(1, glow)}
            />
          )}
          <circle
            cx="0"
            cy="0"
            r="13"
            fill={glow > 0.05 ? "#fef9c3" : surface}
            stroke={glow > 0.05 ? "#ca8a04" : ink}
            strokeWidth="2"
          />
          <line
            x1="-8"
            y1="-8"
            x2="8"
            y2="8"
            stroke={glow > 0.05 ? "#a16207" : ink}
            strokeWidth="1.6"
          />
          <line
            x1="-8"
            y1="8"
            x2="8"
            y2="-8"
            stroke={glow > 0.05 ? "#a16207" : ink}
            strokeWidth="1.6"
          />
        </>
      );
    case "ammeter":
    case "voltmeter":
      return (
        <>
          <circle
            cx="0"
            cy="0"
            r="13"
            fill={surface}
            stroke={ink}
            strokeWidth="2"
          />
          <text
            x="0"
            y="4"
            textAnchor="middle"
            fill={ink}
            fontSize="12"
            fontWeight="700"
          >
            {kind === "ammeter" ? "A" : "V"}
          </text>
        </>
      );
  }
}
