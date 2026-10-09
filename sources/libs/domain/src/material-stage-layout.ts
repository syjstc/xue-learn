import {
  classroomStageTargetId,
  isMaterialStageLayout,
  layoutSlots,
  type MaterialStageLayout,
} from "./material-cue.js";

export type MaterialStageSurface =
  "reading-wide" | "reading-narrow" | "classroom";
export type MaterialStagePresentation = "overview" | "focus";
export type MaterialStageFigureKind = "visual" | "dense" | "card";
export type MaterialStageDensity = "compact" | "full";

export type MaterialStageFigureDescriptor = Readonly<{
  id?: string;
  type?: string;
  aspectRatio?: string;
}>;

export type MaterialStageRect = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type MaterialStageLayoutItem = Readonly<{
  index: number;
  rect: MaterialStageRect;
  kind: MaterialStageFigureKind;
  density: MaterialStageDensity;
  focused: boolean;
  emphasis: number;
  scale: number;
  zIndex: number;
}>;

export type MaterialStageLayoutPlan = Readonly<{
  layout: MaterialStageLayout;
  presentation: MaterialStagePresentation;
  surface: MaterialStageSurface;
  items: readonly MaterialStageLayoutItem[];
  order: readonly number[];
  focusedIndexes: readonly number[];
  /**
   * Continuous focus strength of the whole stage: `1` when some (not all)
   * panes are cued, `0` in overview, eased in between while a focus change is
   * still entering. Renderers dim/desaturate context panes by
   * `focus × (1 − emphasis)` so both directions of a cue change stay smooth.
   */
  focus: number;
}>;

const MAX_STAGE_FIGURES = 4;
const VISUAL_TYPES = new Set([
  "visual",
  "music",
  "illustration",
  "svg",
  "svg_slot",
  "chart",
  "graph",
  "math_scene",
  "interactive_html",
]);
const DENSE_TYPES = new Set(["code", "conversation", "compare"]);

/** Portrait artwork benefits from a side note; landscape diagrams need width. */
export function materialStagePicturePlacement(
  figure: MaterialStageFigureDescriptor,
  containerAspectRatio: number,
): "stack" | "rail" {
  const parts = String(figure.aspectRatio ?? "")
    .split(/[:/]/)
    .map(Number);
  const ratio =
    parts.length === 2 && parts[0]! > 0 && parts[1]! > 0
      ? parts[0]! / parts[1]!
      : 1.6;
  return containerAspectRatio >= Math.max(1.2, ratio * 1.2) ? "rail" : "stack";
}

export function classifyMaterialStageFigure(
  figure: MaterialStageFigureDescriptor,
): MaterialStageFigureKind {
  const type = String(figure.type ?? "")
    .trim()
    .toLowerCase();
  if (DENSE_TYPES.has(type)) return "dense";
  if (VISUAL_TYPES.has(type)) return "visual";
  return "card";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function rect(
  x: number,
  y: number,
  width: number,
  height: number,
): MaterialStageRect {
  return {
    x: clamp(x, 0, 1),
    y: clamp(y, 0, 1),
    width: clamp(width, 0, 1),
    height: clamp(height, 0, 1),
  };
}

function columnRects(count: number): MaterialStageRect[] {
  const height = 1 / count;
  return Array.from({ length: count }, (_, index) =>
    rect(0, index * height, 1, height),
  );
}

function bezierUnit(t: number, c1: number, c2: number): number {
  const rest = 1 - t;
  return 3 * rest * rest * t * c1 + 3 * rest * t * t * c2 + t * t * t;
}

function bezierUnitDerivative(t: number, c1: number, c2: number): number {
  const rest = 1 - t;
  return 3 * rest * rest * c1 + 6 * rest * t * (c2 - c1) + 3 * t * t * (1 - c2);
}

/**
 * Match the classroom CSS curve `cubic-bezier(0.22, 1, 0.36, 1)`. Exported so
 * surface-specific values derived from two settled plans (classroom type
 * size, Canvas paint) can travel on exactly the same curve as the rects.
 */
export function materialStageMotionEase(progress: number): number {
  const x = clamp(progress, 0, 1);
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let t = x;
  for (let step = 0; step < 8; step += 1) {
    const current = bezierUnit(t, 0.22, 0.36) - x;
    const slope = bezierUnitDerivative(t, 0.22, 0.36);
    if (Math.abs(current) < 1e-6 || Math.abs(slope) < 1e-6) break;
    t = clamp(t - current / slope, 0, 1);
  }
  return bezierUnit(t, 1, 1);
}

function distribute(
  weights: readonly number[],
  span: number,
  gap: number,
): number[] {
  const count = weights.length;
  if (count <= 0) return [];
  const inner = Math.max(0, span - gap * Math.max(0, count - 1));
  const total = weights.reduce((sum, weight) => sum + weight, 0) || count;
  return weights.map((weight) => (weight / total) * inner);
}

function originsAlong(
  start: number,
  sizes: readonly number[],
  gap: number,
): number[] {
  const origins: number[] = [];
  let cursor = start;
  for (const size of sizes) {
    origins.push(cursor);
    cursor += size + gap;
  }
  return origins;
}

function axisWeights(count: number, focused: ReadonlySet<number>): number[] {
  const boost = focused.size > 1 ? 0.4 : 0.78;
  return Array.from({ length: count }, (_, index) =>
    focused.has(index) ? 1 + boost : 1,
  );
}

function packedRow(
  count: number,
  padX: number,
  padY: number,
  gap: number,
  focused: ReadonlySet<number> = new Set(),
): MaterialStageRect[] {
  const widths = distribute(axisWeights(count, focused), 1 - padX * 2, gap);
  const xs = originsAlong(padX, widths, gap);
  const height = 1 - padY * 2;
  return widths.map((width, index) => rect(xs[index]!, padY, width, height));
}

function packedColumn(
  count: number,
  padX: number,
  padY: number,
  gap: number,
  focused: ReadonlySet<number> = new Set(),
): MaterialStageRect[] {
  const heights = distribute(axisWeights(count, focused), 1 - padY * 2, gap);
  const ys = originsAlong(padY, heights, gap);
  const width = 1 - padX * 2;
  return heights.map((height, index) => rect(padX, ys[index]!, width, height));
}

function packedGrid(
  count: number,
  padX: number,
  padY: number,
  gap: number,
  focused: ReadonlySet<number> = new Set(),
): MaterialStageRect[] {
  if (count <= 1) return packedRow(1, padX, padY, gap, focused);
  const columns = 2;
  const rows = Math.ceil(count / columns);
  const columnWeights = [0, 1].map((column) =>
    Array.from({ length: count }, (_, index) => index).some(
      (index) => index % columns === column && focused.has(index),
    )
      ? 1.42
      : 1,
  );
  const rowWeights = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: count }, (_, index) => index).some(
      (index) => Math.floor(index / columns) === row && focused.has(index),
    )
      ? 1.42
      : 1,
  );
  const widths = distribute(columnWeights, 1 - padX * 2, gap);
  const heights = distribute(rowWeights, 1 - padY * 2, gap);
  const xs = originsAlong(padX, widths, gap);
  const ys = originsAlong(padY, heights, gap);
  return Array.from({ length: count }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const leftover = count % columns === 1 && row === rows - 1;
    const width = leftover ? widths[0]! : widths[column]!;
    const x = leftover ? (1 - width) / 2 : xs[column]!;
    return rect(x, ys[row]!, width, heights[row]!);
  });
}

function mosaicTwoPlusOne(
  padX: number,
  padY: number,
  gap: number,
  focused: ReadonlySet<number> = new Set(),
): MaterialStageRect[] {
  const innerHeight = 1 - padY * 2 - gap;
  const topWeights = [
    focused.has(0) && !focused.has(1) ? 1.55 : 1,
    focused.has(1) && !focused.has(0) ? 1.55 : 1,
  ];
  let topShare = 0.54;
  if ((focused.has(0) || focused.has(1)) && !focused.has(2)) topShare = 0.64;
  if (focused.has(2) && !focused.has(0) && !focused.has(1)) topShare = 0.38;
  const topHeight = innerHeight * topShare;
  const bottomHeight = innerHeight - topHeight;
  const widths = distribute(topWeights, 1 - padX * 2, gap);
  const xs = originsAlong(padX, widths, gap);
  return [
    rect(xs[0]!, padY, widths[0]!, topHeight),
    rect(xs[1]!, padY, widths[1]!, topHeight),
    rect(padX, padY + topHeight + gap, 1 - padX * 2, bottomHeight),
  ];
}

function mosaicOnePlusTwo(
  padX: number,
  padY: number,
  gap: number,
  focused: ReadonlySet<number> = new Set(),
): MaterialStageRect[] {
  const innerHeight = 1 - padY * 2 - gap;
  const bottomWeights = [
    focused.has(1) && !focused.has(2) ? 1.55 : 1,
    focused.has(2) && !focused.has(1) ? 1.55 : 1,
  ];
  let topShare = 0.48;
  if (focused.has(0) && !focused.has(1) && !focused.has(2)) topShare = 0.62;
  if ((focused.has(1) || focused.has(2)) && !focused.has(0)) topShare = 0.36;
  const topHeight = innerHeight * topShare;
  const bottomHeight = innerHeight - topHeight;
  const widths = distribute(bottomWeights, 1 - padX * 2, gap);
  const xs = originsAlong(padX, widths, gap);
  return [
    rect(padX, padY, 1 - padX * 2, topHeight),
    rect(xs[0]!, padY + topHeight + gap, widths[0]!, bottomHeight),
    rect(xs[1]!, padY + topHeight + gap, widths[1]!, bottomHeight),
  ];
}

function packedMainRail(
  count: number,
  padX: number,
  padY: number,
  gap: number,
  focused: ReadonlySet<number> = new Set(),
): MaterialStageRect[] {
  if (count <= 1) return packedRow(1, padX, padY, gap, focused);
  const focusMain = focused.has(0);
  const focusRail = [...focused].some((index) => index > 0);
  let mainWidth = 0.62;
  if (focusMain && !focusRail) mainWidth = 0.7;
  if (focusRail && !focusMain) mainWidth = 0.5;
  const railX = padX + mainWidth + gap;
  const railWidth = 1 - padX - railX;
  const railCount = count - 1;
  const railFocused = new Set(
    [...focused].map((index) => index - 1).filter((index) => index >= 0),
  );
  const heights = distribute(
    axisWeights(railCount, railFocused),
    1 - padY * 2,
    gap,
  );
  const ys = originsAlong(padY, heights, gap);
  return [
    rect(padX, padY, mainWidth, 1 - padY * 2),
    ...heights.map((height, index) =>
      rect(railX, ys[index]!, railWidth, height),
    ),
  ];
}

function packedBoardRects(
  count: number,
  layout: MaterialStageLayout,
  figures: readonly MaterialStageFigureDescriptor[],
  focusedIndexes: readonly number[],
  surface: MaterialStageSurface,
  containerAspectRatio?: number,
): MaterialStageRect[] {
  const focused = new Set(focusedIndexes);
  const kinds = figures.map(classifyMaterialStageFigure);
  const cardHeavy =
    kinds.filter((kind) => kind === "card").length >= Math.ceil(count / 2);
  const padX = 0.02;
  const padY = cardHeavy ? 0.046 : 0.022;
  const gap = 0.022;
  // A picture beside a short note wastes most of a tall pane. Give the
  // picture full width and the note a shallow row, retaining source identity.
  const pictureIndex = figures.findIndex((figure) =>
    ["illustration", "svg", "svg_slot"].includes(figure.type ?? ""),
  );
  if (
    count === 2 &&
    pictureIndex >= 0 &&
    kinds[1 - pictureIndex] === "card" &&
    containerAspectRatio != null &&
    materialStagePicturePlacement(
      figures[pictureIndex]!,
      containerAspectRatio,
    ) === "stack"
  ) {
    const pictureShare = focused.has(1 - pictureIndex) ? 0.58 : 0.72;
    const heights = distribute(
      figures.map((_, index) =>
        index === pictureIndex ? pictureShare : 1 - pictureShare,
      ),
      1 - padY * 2,
      gap,
    );
    const ys = originsAlong(padY, heights, gap);
    return heights.map((height, index) =>
      rect(padX, ys[index]!, 1 - padX * 2, height),
    );
  }
  if (count <= 1) {
    return cardHeavy
      ? [rect(0.1, 0.1, 0.8, 0.8)]
      : [rect(0.04, 0.04, 0.92, 0.92)];
  }
  // A compare contains two columns of its own. On the fixed classroom
  // canvas, a horizontal track of compares (or a compare beside a card)
  // nests four columns and starves each side. Keep source order and give
  // every figure full width so two compares read as a 2×2 of A/B cards.
  if (
    surface === "classroom" &&
    count >= 2 &&
    figures.every((figure) => figure.type === "compare")
  ) {
    return packedColumn(count, padX, padY, gap, focused);
  }
  const compareIndex = figures.findIndex((figure) => figure.type === "compare");
  if (
    surface === "classroom" &&
    count === 2 &&
    compareIndex >= 0 &&
    kinds[1 - compareIndex] === "card"
  ) {
    const compareShare = focused.has(1 - compareIndex)
      ? 0.6
      : focused.has(compareIndex)
        ? 0.74
        : 0.68;
    const heights = distribute(
      figures.map((_, index) =>
        index === compareIndex ? compareShare : 1 - compareShare,
      ),
      1 - padY * 2,
      gap,
    );
    const ys = originsAlong(padY, heights, gap);
    return heights.map((height, index) =>
      rect(padX, ys[index]!, 1 - padX * 2, height),
    );
  }
  if (layout === "stack") {
    return packedColumn(count, padX, padY, gap, focused);
  }
  if (layout === "split-v") {
    if (count === 2) return packedColumn(2, padX, padY, gap, focused);
    if (count === 3) return mosaicOnePlusTwo(padX, padY, gap, focused);
    return packedGrid(count, padX, padY, gap, focused);
  }
  if (layout === "main+rail" || hasUniquePrimary(figures, layout)) {
    // An inferred primary belongs to the dense/visual figure, not always
    // figure zero. Rects stay indexed by source identity for cue targeting.
    const primary =
      layout === "main+rail"
        ? 0
        : kinds.findIndex(
            (kind) =>
              kind === "dense" ||
              (kind === "visual" && !kinds.includes("dense")),
          );
    const order = [
      primary,
      ...figures.map((_, index) => index).filter((index) => index !== primary),
    ];
    const orderedFocus = new Set(
      order.flatMap((index, position) =>
        focused.has(index) ? [position] : [],
      ),
    );
    const packed = packedMainRail(count, padX, padY, gap, orderedFocus);
    return figures.map((_, index) => packed[order.indexOf(index)]!);
  }
  if (count === 2) return packedRow(2, padX, padY, gap, focused);
  if (count === 3) return mosaicTwoPlusOne(padX, padY, gap, focused);
  return packedGrid(count, padX, padY, gap, focused);
}

function focusedRects(
  count: number,
  focusedIndexes: readonly number[],
  surface: MaterialStageSurface,
): MaterialStageRect[] {
  const focused = [...focusedIndexes];
  const context = Array.from({ length: count }, (_, index) => index).filter(
    (index) => !focused.includes(index),
  );
  if (focused.length === 0 || focused.length === count) return [];

  if (surface === "reading-narrow") {
    const focusedWeight = 1.25;
    const unit = 1 / (focused.length * focusedWeight + context.length);
    let y = 0;
    return [
      ...focused.map(() => {
        const height = focusedWeight * unit;
        const value = rect(0, y, 1, height);
        y += height;
        return value;
      }),
      ...context.map(() => {
        const value = rect(0, y, 1, unit);
        y += unit;
        return value;
      }),
    ];
  }

  const contextX = 0.75;
  const mainWidth = 0.72;
  const mainCount = focused.length;
  let focusedRectsForMain: MaterialStageRect[];
  if (mainCount === 1) {
    focusedRectsForMain = [rect(0, 0, mainWidth, 1)];
  } else if (mainCount === 2) {
    focusedRectsForMain = [
      rect(0, 0, mainWidth / 2 - 0.01, 1),
      rect(mainWidth / 2 + 0.01, 0, mainWidth / 2 - 0.01, 1),
    ];
  } else {
    focusedRectsForMain = [
      rect(0, 0, mainWidth / 2 - 0.01, 0.49),
      rect(mainWidth / 2 + 0.01, 0, mainWidth / 2 - 0.01, 0.49),
      rect(0, 0.51, mainWidth, 0.49),
    ];
  }
  const contextHeight = 1 / context.length;
  return [
    ...focusedRectsForMain,
    ...context.map((_, index) =>
      rect(contextX, index * contextHeight, 1 - contextX, contextHeight),
    ),
  ];
}

function hasUniquePrimary(
  figures: readonly MaterialStageFigureDescriptor[],
  layout: MaterialStageLayout,
): boolean {
  if (layout === "main+rail" || layout === "split-v" || layout === "stack") {
    return layout === "main+rail";
  }
  const kinds = figures.map(classifyMaterialStageFigure);
  const dense = kinds.filter((kind) => kind === "dense").length;
  const visual = kinds.filter((kind) => kind === "visual").length;
  return (
    dense === 1 || (visual === 1 && kinds.every((kind) => kind !== "dense"))
  );
}

function overviewRects(
  count: number,
  layout: MaterialStageLayout,
  figures: readonly MaterialStageFigureDescriptor[],
  surface: MaterialStageSurface,
  focusedIndexes: readonly number[] = [],
  containerAspectRatio?: number,
): MaterialStageRect[] {
  if (surface === "reading-narrow") return columnRects(count);
  return packedBoardRects(
    count,
    layout,
    figures,
    focusedIndexes,
    surface,
    containerAspectRatio,
  );
}

function normalizeFocusedIndexes(
  count: number,
  focusedIndexes: readonly number[] | undefined,
): number[] {
  if (!focusedIndexes?.length) return [];
  return [...new Set(focusedIndexes)]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < count)
    .sort((a, b) => a - b);
}

/**
 * Resolve the stable parent stage panes addressed by material cue ids.
 * Nested compare/code ids are intentionally promoted to their containing pane.
 */
export function materialStageFocusIndexes(params: {
  layout: MaterialStageLayout | string | undefined;
  figures: readonly MaterialStageFigureDescriptor[];
  targetIds?: readonly string[];
}): number[] {
  const figures = params.figures.slice(0, MAX_STAGE_FIGURES);
  const layout = isMaterialStageLayout(String(params.layout ?? ""))
    ? (params.layout as MaterialStageLayout)
    : "stack";
  const slots = layoutSlots(layout, figures.length);
  const targetIds = params.targetIds ?? [];
  if (
    targetIds.some((targetId) => targetId === "whole" || targetId === "display")
  ) {
    return [];
  }
  const indexes = new Set<number>();
  for (const targetId of targetIds) {
    const directIndex = figures.findIndex(
      (figure, index) =>
        Boolean(figure.id && figure.id === targetId) ||
        targetId === classroomStageTargetId(layout, index) ||
        targetId === slots[index] ||
        targetId === `item-${index}` ||
        (figure.id ? targetId.startsWith(`fig:${figure.id}:`) : false),
    );
    if (directIndex >= 0) indexes.add(directIndex);
  }
  return [...indexes].sort((a, b) => a - b);
}

/** Resolve one deterministic layout for reading or the fixed classroom canvas. */
export function resolveMaterialStageLayout(params: {
  containerAspectRatio?: number;
  layout?: MaterialStageLayout | string;
  figures: readonly MaterialStageFigureDescriptor[];
  surface: MaterialStageSurface;
  focusedIndexes?: readonly number[];
  /** Presentation cues change emphasis, never the authored slots or reading order. */
  stableComposition?: boolean;
}): MaterialStageLayoutPlan {
  const figures = params.figures.slice(0, MAX_STAGE_FIGURES);
  const count = figures.length;
  const layout = isMaterialStageLayout(String(params.layout ?? ""))
    ? (params.layout as MaterialStageLayout)
    : "stack";
  const focusedIndexes = normalizeFocusedIndexes(count, params.focusedIndexes);
  const hasFocus = focusedIndexes.length > 0 && focusedIndexes.length < count;
  const presentation: MaterialStagePresentation = hasFocus
    ? "focus"
    : "overview";
  const narrowFocus =
    hasFocus &&
    params.surface === "reading-narrow" &&
    !params.stableComposition;
  const rects = params.stableComposition
    ? params.surface === "reading-narrow"
      ? columnRects(count)
      : layout === "main+rail"
        ? packedMainRail(count, 0.02, 0.022, 0.022)
        : layout === "split-h"
          ? packedRow(count, 0.02, 0.022, 0.022)
          : packedColumn(count, 0.02, 0.022, 0.022)
    : narrowFocus
      ? focusedRects(count, focusedIndexes, params.surface)
      : overviewRects(
          count,
          layout,
          figures,
          params.surface,
          hasFocus ? focusedIndexes : [],
          params.containerAspectRatio,
        );
  const byIndex = new Map<number, MaterialStageRect>();
  if (narrowFocus) {
    focusedIndexes.forEach((index, position) =>
      byIndex.set(index, rects[position]!),
    );
    const contextIndexes = Array.from(
      { length: count },
      (_, index) => index,
    ).filter((index) => !focusedIndexes.includes(index));
    contextIndexes.forEach((index, position) =>
      byIndex.set(index, rects[focusedIndexes.length + position]!),
    );
  } else {
    rects.forEach((value, index) => byIndex.set(index, value));
  }
  const identityOrder = Array.from({ length: count }, (_, index) => index);
  const order = narrowFocus
    ? [
        ...focusedIndexes,
        ...identityOrder.filter((index) => !focusedIndexes.includes(index)),
      ]
    : identityOrder;
  const classroom = params.surface === "classroom";
  return {
    layout,
    presentation,
    surface: params.surface,
    focusedIndexes,
    order,
    focus: hasFocus ? 1 : 0,
    items: figures.map((figure, index) => {
      const focused = focusedIndexes.includes(index);
      const emphasis = focused ? 1 : 0;
      return {
        index,
        rect: byIndex.get(index) ?? rect(0, 0, 1, 1),
        kind: classifyMaterialStageFigure(figure),
        density: classroom && !focused ? "compact" : "full",
        focused,
        emphasis,
        scale: 1,
        zIndex: focused ? 3 : 1,
      };
    }),
  };
}

/** Interpolate two settled plans using an explicit, deterministic progress value. */
export function interpolateMaterialStageLayout(
  from: MaterialStageLayoutPlan,
  to: MaterialStageLayoutPlan,
  progress: number,
): MaterialStageLayoutPlan {
  const amount = materialStageMotionEase(
    clamp(Number.isFinite(progress) ? progress : 1, 0, 1),
  );
  const focus = from.focus + (to.focus - from.focus) * amount;
  const items = to.items.map((item, index) => {
    const previous = from.items[index] ?? item;
    const emphasis =
      previous.emphasis + (item.emphasis - previous.emphasis) * amount;
    return {
      ...item,
      emphasis,
      scale: 1,
      focused: emphasis >= 0.45,
      zIndex: emphasis >= 0.45 ? 3 : 1,
      rect: rect(
        previous.rect.x + (item.rect.x - previous.rect.x) * amount,
        previous.rect.y + (item.rect.y - previous.rect.y) * amount,
        previous.rect.width + (item.rect.width - previous.rect.width) * amount,
        previous.rect.height +
          (item.rect.height - previous.rect.height) * amount,
      ),
    };
  });
  return { ...to, focus, items };
}

/** Stage-level CSS variables shared by every pane of one composed stage. */
export function materialStagePlanStyle(
  plan: MaterialStageLayoutPlan,
): Readonly<Record<string, string>> {
  return {
    ["--lp-stage-focus" as string]: String(clamp(plan.focus, 0, 1)),
  };
}

export function materialStageRectStyle(
  rectangle: MaterialStageRect,
): Readonly<Record<string, string>> {
  return {
    left: `${rectangle.x * 100}%`,
    top: `${rectangle.y * 100}%`,
    width: `${rectangle.width * 100}%`,
    height: `${rectangle.height * 100}%`,
  };
}

/** Absolute pane box. Focus grows by reweighting siblings, never by overflow scale. */
export function materialStageItemStyle(
  item: MaterialStageLayoutItem,
): Readonly<Record<string, string>> {
  return {
    ...materialStageRectStyle(item.rect),
    zIndex: String(item.zIndex),
    ["--lp-stage-emphasis" as string]: String(item.emphasis),
  };
}

/** Keep a view's layout box fixed; fit that canvas into the animated slot.
 * Uniform scaling preserves glyph proportions, line breaks and nested media.
 * Only a changed overview (content/viewport) may change the canvas dimensions. */
export function materialStageCanvasStyle(
  item: MaterialStageLayoutItem,
  canvas: MaterialStageLayoutItem,
  reducedMotion = false,
): Readonly<Record<string, string>> {
  const { x, y, scale } = materialStageCanvasTransform(item, canvas, reducedMotion);
  return {
    ...materialStageItemStyle({ ...item, rect: canvas.rect }),
    left: `${x * 100}%`,
    top: `${y * 100}%`,
    transform: `scale(${scale})`,
    transformOrigin: "top left",
  };
}

/** Shared by HTML transforms and the experimental Canvas group's transform. */
export function materialStageCanvasTransform(
  item: MaterialStageLayoutItem,
  canvas: MaterialStageLayoutItem,
  reducedMotion = false,
): Readonly<{ x: number; y: number; scale: number }> {
  const target = reducedMotion ? canvas.rect : item.rect;
  const fit = Math.min(
    target.width / Math.max(0.000001, canvas.rect.width),
    target.height / Math.max(0.000001, canvas.rect.height),
  );
  // Leave a little breathing room in overview; the active view comes forward.
  const scale = reducedMotion ? 1 : fit * (0.96 + item.emphasis * 0.04);
  return {
    x: target.x + (target.width - canvas.rect.width * scale) / 2,
    y: target.y + (target.height - canvas.rect.height * scale) / 2,
    scale,
  };
}
