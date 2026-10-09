"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, GripVertical, RotateCcw } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { InteractiveBlock } from "@xue-learn/core/schemas";
import { ProseMarkdown } from "@xue-learn/core/components/markdown/prose-markdown";
import { Button } from "@xue-learn/core/ui/button";
import { GraphBlock } from "@xue-learn/core/components/wizard/graph-block";
import { cn } from "@xue-learn/core/utils";
import { MathSceneView } from "@/components/math/math-scene";
import { MechanicsSandboxBlock } from "@/components/lab/mechanics-sandbox";
import { CircuitSandboxBlock } from "@/components/lab/circuit-sandbox";
import { ChemistryLabBlock } from "@/components/lab/chemistry-lab";
import { MaterialVisualFrame } from "@xue-learn/core/components/wizard/interactive-material/material-visual-frame";
import { useT } from "@xue-learn/core/i18n";

const colors = [
  "var(--chart-1)",
  "var(--chart-6)",
  "var(--chart-2)",
  "var(--info)",
  "var(--warning)",
  "var(--chart-5)",
];

const tooltipContentStyle = {
  border: "1px solid var(--course-content-border)",
  borderRadius: "0.75rem",
  background: "var(--course-content-surface)",
  color: "var(--course-content)",
  boxShadow:
    "0 10px 30px color-mix(in srgb, var(--foreground) 10%, transparent)",
};

const tooltipLabelStyle = {
  color: "var(--course-content)",
  fontWeight: 600,
};

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-[var(--course-content-border-accent)] bg-[var(--course-content-surface-muted)] p-4">
      <h5 className="font-semibold">{title}</h5>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function CommonChart({
  block,
  compact,
}: {
  block: Extract<InteractiveBlock, { type: "chart" }>;
  compact?: boolean;
}) {
  const t = useT();
  const [isExpanded, setIsExpanded] = useState(false);
  const height = compact ? 220 : 300;
  const common = {
    data: block.data,
    margin: { top: 8, right: 12, bottom: 8, left: 40 },
  };
  const axes = (
    <>
      <CartesianGrid
        stroke="var(--course-content-border)"
        strokeDasharray="3 3"
        vertical={block.chartType !== "bar"}
      />
      <XAxis
        dataKey={block.categoryKey ?? block.xKey}
        name={block.xLabel}
        tick={{ fontSize: 12, fill: "var(--course-content-muted)" }}
        tickLine={{ stroke: "var(--course-content-border)" }}
        axisLine={{ stroke: "var(--course-content-border-accent)" }}
      />
      <YAxis
        name={block.yLabel}
        unit={block.unit}
        tick={{ fontSize: 12, fill: "var(--course-content-muted)" }}
        tickLine={{ stroke: "var(--course-content-border)" }}
        axisLine={{ stroke: "var(--course-content-border-accent)" }}
      />
      <Tooltip
        cursor={
          block.chartType === "bar"
            ? false
            : { stroke: "var(--course-content-border-accent)" }
        }
        contentStyle={tooltipContentStyle}
        labelStyle={tooltipLabelStyle}
      />
      {block.showLegend ? (
        <Legend wrapperStyle={{ color: "var(--course-content-muted)" }} />
      ) : null}
    </>
  );
  let chart: ReactNode;
  if (block.chartType === "bar") {
    chart = (
      <BarChart {...common}>
        {axes}
        {block.series.map((series, index) => (
          <Bar
            key={series.dataKey}
            dataKey={series.dataKey}
            name={series.name}
            unit={series.unit}
            fill={series.color ?? colors[index % colors.length]}
          />
        ))}
      </BarChart>
    );
  } else if (block.chartType === "area") {
    chart = (
      <AreaChart {...common}>
        {axes}
        {block.series.map((series, index) => (
          <Area
            key={series.dataKey}
            dataKey={series.dataKey}
            name={series.name}
            unit={series.unit}
            stroke={series.color ?? colors[index % colors.length]}
            fill={series.color ?? colors[index % colors.length]}
            fillOpacity={0.22}
          />
        ))}
      </AreaChart>
    );
  } else if (block.chartType === "pie") {
    const series = block.series[0]!;
    chart = (
      <PieChart>
        <Tooltip
          contentStyle={tooltipContentStyle}
          labelStyle={tooltipLabelStyle}
        />
        {block.showLegend ? (
          <Legend wrapperStyle={{ color: "var(--course-content-muted)" }} />
        ) : null}
        <Pie
          data={block.data}
          dataKey={series.dataKey}
          nameKey={block.categoryKey}
          name={series.name}
          innerRadius={block.donut ? "45%" : 0}
          outerRadius="78%"
          label={{ fill: "var(--course-content-muted)", fontSize: 12 }}
          labelLine={{ stroke: "var(--course-content-border-accent)" }}
        >
          {block.data.map((_, index) => (
            <Cell key={index} fill={colors[index % colors.length]} />
          ))}
        </Pie>
      </PieChart>
    );
  } else if (block.chartType === "scatter") {
    chart = (
      <ScatterChart margin={common.margin}>
        {axes}
        <Scatter
          data={block.data}
          dataKey={block.yKey}
          name={block.series[0]?.name}
          fill={block.series[0]?.color ?? colors[0]}
        />
      </ScatterChart>
    );
  } else {
    chart = (
      <LineChart {...common}>
        {axes}
        {block.series.map((series, index) => (
          <Line
            key={series.dataKey}
            type="monotone"
            dataKey={series.dataKey}
            name={series.name}
            unit={series.unit}
            stroke={series.color ?? colors[index % colors.length]}
            strokeWidth={2.5}
            dot={false}
          />
        ))}
      </LineChart>
    );
  }
  const chartContent = (expanded = false) => (
    <>
      <p className="sr-only">{block.summary}</p>
      {block.yLabel ? (
        <p className="mb-2 text-sm text-muted-foreground">
          {block.yLabel}
          {block.unit ? `（${block.unit}）` : null}
        </p>
      ) : null}
      <div
        role="img"
        aria-label={block.summary}
        className={cn("w-full", expanded && "min-h-0 flex-1")}
        style={{ height: expanded ? "100%" : height }}
      >
        <ResponsiveContainer width="100%" height="100%">
          {chart}
        </ResponsiveContainer>
      </div>
    </>
  );
  return (
    <MaterialVisualFrame
      title={block.title}
      caption={block.summary}
      compact={compact}
      expanded={isExpanded}
      expandedContent={
        <div className="flex min-h-0 flex-1 flex-col bg-[var(--course-content-surface-muted)]/45 p-3 sm:p-6">
          {chartContent(true)}
        </div>
      }
      fullscreenLabel={t("wizard.material.mathScene.fullscreen")}
      onExpandedChange={setIsExpanded}
      onOpenFullscreen={() => setIsExpanded(true)}
    >
      {chartContent()}
    </MaterialVisualFrame>
  );
}

function SortableStep({
  id,
  children,
  valid,
}: {
  id: string;
  children: ReactNode;
  valid?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex cursor-grab touch-none items-center gap-2 rounded-md border bg-[var(--course-content-surface)] p-3 active:cursor-grabbing",
        isDragging && "opacity-60",
        valid === true && "border-green-500",
        valid === false && "border-amber-500",
      )}
      aria-label="拖动步骤"
      {...attributes}
      {...listeners}
    >
      <span className="shrink-0 text-[var(--text-400)]" aria-hidden>
        <GripVertical className="h-4 w-4" />
      </span>
      <span className="flex-1">{children}</span>
      {valid === true ? <Check className="h-4 w-4 text-green-600" /> : null}
    </li>
  );
}

function StepSort({
  block,
}: {
  block: Extract<InteractiveBlock, { type: "step_sort" }>;
}) {
  const correct = useMemo(
    () => [...block.correct_sequence].sort((a, b) => a.order - b.order),
    [block],
  );
  const initial = useMemo(() => [...correct].reverse(), [correct]);
  const [steps, setSteps] = useState(initial);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    setSteps((items) =>
      arrayMove(
        items,
        items.findIndex((item) => item.id === active.id),
        items.findIndex((item) => item.id === over.id),
      ),
    );
  };
  const complete = steps.every((step, index) => step.id === correct[index]?.id);
  return (
    <Shell title={block.title}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={steps.map((item) => item.id)}
          strategy={verticalListSortingStrategy}
        >
          <ol className="space-y-2">
            {steps.map((step, index) => (
              <SortableStep
                key={step.id}
                id={step.id}
                valid={step.id === correct[index]?.id}
              >
                <ProseMarkdown content={step.content} variant="inline" />
              </SortableStep>
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      <p
        className={cn(
          "mt-3 text-sm",
          complete ? "text-green-700" : "text-amber-700",
        )}
      >
        {complete
          ? "顺序正确"
          : `该步骤的前置条件还未完成。${block.dependency_hint}`}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-2"
        onClick={() => setSteps(initial)}
      >
        <RotateCcw className="h-4 w-4" />
        重置
      </Button>
    </Shell>
  );
}

export function NewCourseInteractionBlock({
  block,
  compact,
}: {
  block: InteractiveBlock;
  compact?: boolean;
}) {
  switch (block.type) {
    case "step_sort":
      return <StepSort block={block} />;
    case "graph":
      return <GraphBlock block={block} compact={compact} />;
    case "chart":
      return <CommonChart block={block} compact={compact} />;
    case "math_scene":
      return (
        <MathSceneView
          scene={block as unknown as import("@xue-learn/core/domain").MathScene}
          compact={compact}
        />
      );
    case "mechanics_sandbox":
      return (
        <MechanicsSandboxBlock
          block={
            block as unknown as import("@xue-learn/core/domain").MechanicsSandbox
          }
          compact={compact}
        />
      );
    case "circuit_sandbox":
      return (
        <CircuitSandboxBlock
          block={
            block as unknown as import("@xue-learn/core/domain").CircuitSandbox
          }
          compact={compact}
        />
      );
    case "chemistry_lab":
      return (
        <ChemistryLabBlock
          block={
            block as unknown as import("@xue-learn/core/domain").ChemistryLabDefinition
          }
          compact={compact}
        />
      );
    default:
      return null;
  }
}
