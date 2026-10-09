import {
  classifyMaterialStageFigure,
  materialStageMotionEase,
  type MaterialStageLayoutPlan,
  type MaterialStageRect,
} from "../../../libs/domain/src/index.js";
import { normalizeLatexMathDelimiters } from "../../shared/markdown/normalize-latex-math.js";
import { CLASSROOM_EM } from "./classroom-geometry.js";

/** Ordinary lesson figures needed by deterministic stage text fitting. */
export type ClassroomCopyFigure = Readonly<{
  type?: string;
  title?: unknown;
  caption?: unknown;
  body?: unknown;
  summary?: unknown;
  alt?: unknown;
  svg?: unknown;
  imageUrl?: unknown;
  left?: unknown;
  right?: unknown;
  [key: string]: unknown;
}>;

/**
 * Deterministic type fitting for text panes on a composed classroom stage.
 *
 * A stage pane is an absolute box whose size follows the layout plan. The
 * projected copy inside it (callout / paragraph cards, nested compare sides)
 * must fill that box legibly instead of sitting as a small caption in one
 * corner, and it must grow with the pane when a cue promotes it. Nothing here
 * measures the DOM: the estimate is a fixed character-advance model so HTML
 * preview, hidden export windows, and the Canvas painter agree frame by frame.
 *
 * All sizes are 1920×1080 design pixels (`CLASSROOM_EM` = 18px).
 */

export const CLASSROOM_STAGE_TYPE_MIN = 0.86 * CLASSROOM_EM;
/**
 * Comfortable ceiling for body copy. The fit maximises size inside the pane,
 * so without this cap a two-line callout on a half-stage pane balloons into
 * poster type; ~1.3em keeps card copy clearly subordinate to the title row.
 */
export const CLASSROOM_STAGE_TYPE_MAX = 1.3 * CLASSROOM_EM;
/** A cued pane may run past the shared cap so its copy visibly gains weight. */
export const CLASSROOM_STAGE_TYPE_FOCUS_BONUS = 0.18 * CLASSROOM_EM;
/**
 * Body rows should hold at least this many CJK glyphs before wrapping, so a
 * wide pane with little copy does not turn into three enormous words per line.
 */
const MIN_GLYPHS_PER_ROW = 16;
/** Font size (px) used when a pane does not carry fitted copy (code, visuals). */
export const CLASSROOM_STAGE_TYPE_BASE = 0.9 * CLASSROOM_EM;

/** Card metrics as multiples of the fitted body font size. */
export const CLASSROOM_STAGE_CARD = Object.freeze({
  padX: 1.25,
  padY: 1.05,
  /** Icon chip column plus its gap in the header row. */
  headerLead: 2.55,
  titleScale: 1.22,
  titleLeading: 1.24,
  /** Accent rule plus the gaps above and below it. */
  ruleBlock: 0.95,
  /** Marker column plus gap before each body row when there are several rows. */
  rowLead: 1.15,
  bodyLeading: 1.52,
  rowGap: 0.36,
});

export type ClassroomStageCopy = Readonly<{
  title: string;
  lines: readonly string[];
}>;

const FULL_WIDTH_ADVANCE = 1;
const LATIN_ADVANCE = 0.56;
const SPACE_ADVANCE = 0.3;

function isFullWidth(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}

/** Strip inline math delimiters and TeX control words so `$\ker f$` counts like `ker f`. */
function visibleText(source: string): string {
  return source
    .replace(/\$\$?/g, "")
    .replace(/\\(?:left|right|,|;|!|quad|qquad)\b/g, "")
    .replace(/\\[a-zA-Z]+/g, (word) => word.slice(1))
    .replace(/[{}^_]/g, "")
    .replace(/\*\*|__|`/g, "");
}

/** Estimated advance of one line in em at font size 1. */
export function estimateLineAdvanceEm(text: string): number {
  let advance = 0;
  for (const char of visibleText(text)) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (char === " " || char === "\t") advance += SPACE_ADVANCE;
    else if (isFullWidth(codePoint)) advance += FULL_WIDTH_ADVANCE;
    else advance += LATIN_ADVANCE;
  }
  return advance;
}

function text(value: unknown): string {
  return typeof value === "string"
    ? classroomBoardDisplayText(value.replace(/\s+$/g, ""))
    : "";
}

/** Keep paired `$...$` for HTML KaTeX; drop a leftover closer after `$12$ ℃$`. */
export function classroomBoardDisplayText(text: string): string {
  return normalizeLatexMathDelimiters(text);
}

/** Canvas has no KaTeX pass, so unwrap delimiters after the same repair. */
export function classroomBoardPaintText(text: string): string {
  return classroomBoardDisplayText(text)
    .replace(/\$\$([\s\S]+?)\$\$/g, "$1")
    .replace(/\$([^\n$]+)\$/g, "$1")
    .replace(/([^\s$\\])\\?\$(?!\d)/g, "$1");
}

/** Split body copy into the rows the card paints (blank lines are dropped). */
export function classroomStageBodyLines(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((line) =>
      classroomBoardDisplayText(
        line.replace(/^\s*(?:[-*•·]|\d+[.)])\s+/, "").trim(),
      ),
    )
    .filter(Boolean);
}

/** Copy painted on a text pane, or `null` for visuals / code that fit themselves. */
export function classroomStageCopy(
  figure: ClassroomCopyFigure,
): ClassroomStageCopy | null {
  const kind = classifyMaterialStageFigure(figure);
  if (kind === "visual") return null;
  if (figure.type === "code" || figure.type === "conversation") return null;
  if (figure.type === "compare") {
    const sides = [figure.left, figure.right].filter(
      (side): side is { label?: string; points?: string[] } =>
        Boolean(side && typeof side === "object"),
    );
    if (sides.length === 0) return null;
    // Both sides share one column pair, so the fit is driven by the longer side.
    const longest = sides
      .map((side) => ({
        title: text(side.label),
        lines: Array.isArray(side.points)
          ? side.points.map((point) => text(point)).filter(Boolean)
          : [],
      }))
      .sort(
        (a, b) =>
          b.lines.reduce((sum, line) => sum + line.length, b.title.length) -
          a.lines.reduce((sum, line) => sum + line.length, a.title.length),
      )[0]!;
    return longest;
  }
  if (typeof figure.svg === "string" || typeof figure.imageUrl === "string") {
    return null;
  }
  const title = text(figure.title ?? figure.caption ?? "");
  const body = text(
    figure.body ?? figure.summary ?? figure.caption ?? figure.alt,
  );
  return { title, lines: classroomStageBodyLines(body) };
}

function wrappedRows(advanceEm: number, widthEm: number): number {
  if (widthEm <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(1, Math.ceil(advanceEm / widthEm));
}

/** Estimated painted height (px) of `copy` at font size `size` inside `width`. */
export function estimateClassroomStageCopyHeight(
  copy: ClassroomStageCopy,
  size: number,
  width: number,
  compareSide = false,
): number {
  const card = CLASSROOM_STAGE_CARD;
  const innerWidth = width - card.padX * 2 * size;
  let height = card.padY * 2 * size;
  if (copy.title) {
    const titleSize = size * card.titleScale;
    const titleWidth = innerWidth - (compareSide ? 0 : card.headerLead * size);
    const rows = wrappedRows(
      estimateLineAdvanceEm(copy.title) * titleSize,
      titleWidth,
    );
    height += Math.max(rows * titleSize * card.titleLeading, 2.3 * size);
    height += card.ruleBlock * size;
  }
  const multiRow = copy.lines.length > 1;
  const rowWidth = innerWidth - (multiRow ? card.rowLead * size : 0);
  copy.lines.forEach((line, index) => {
    const rows = wrappedRows(estimateLineAdvanceEm(line) * size, rowWidth);
    height += rows * size * card.bodyLeading;
    if (index > 0) height += card.rowGap * size;
  });
  return height;
}

/** Rows the title needs at `size` inside a card `width` px wide. */
function titleRows(
  copy: ClassroomStageCopy,
  size: number,
  width: number,
  compareSide: boolean,
): number {
  if (!copy.title) return 0;
  const card = CLASSROOM_STAGE_CARD;
  const innerWidth = width - card.padX * 2 * size;
  const titleWidth = innerWidth - (compareSide ? 0 : card.headerLead * size);
  return wrappedRows(
    estimateLineAdvanceEm(copy.title) * size * card.titleScale,
    titleWidth,
  );
}

/**
 * Shared binary search: the largest size in `[MIN, max]` whose copy fits the
 * card height, keeps a one-line title when the title can fit one line at all,
 * and keeps body rows at least `MIN_GLYPHS_PER_ROW` glyphs wide.
 * `widthAt(size)` lets compare boards shrink the side width with the em.
 */
function fitStageCopy(
  copy: ClassroomStageCopy,
  widthAt: (size: number) => number,
  height: number,
  options: Readonly<{ compareSide: boolean; max: number; fill: number }>,
): number {
  const min = CLASSROOM_STAGE_TYPE_MIN;
  const minWidth = widthAt(min);
  if (minWidth <= 0 || height <= 0) return min;
  const card = CLASSROOM_STAGE_CARD;
  const titleCanBeOneLine =
    titleRows(copy, min, minWidth, options.compareSide) <= 1;
  const glyphCap = (minWidth - card.padX * 2 * min) / MIN_GLYPHS_PER_ROW;
  const max = Math.max(min, Math.min(options.max, glyphCap));
  const fits = (size: number) => {
    const width = widthAt(size);
    if (width <= 0) return false;
    if (
      titleCanBeOneLine &&
      titleRows(copy, size, width, options.compareSide) > 1
    ) {
      return false;
    }
    return (
      estimateClassroomStageCopyHeight(
        copy,
        size,
        width,
        options.compareSide,
      ) <=
      height * options.fill
    );
  };
  if (!fits(min)) return min;
  if (fits(max)) return max;
  let low = min;
  let high = max;
  for (let step = 0; step < 14; step += 1) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle;
    else high = middle;
  }
  return Math.floor(low * 4) / 4;
}

/** Largest body font size (px) in `[min, max]` whose estimated copy fits `rect`. */
export function fitClassroomStageType(
  copy: ClassroomStageCopy,
  rect: MaterialStageRect,
  content: Readonly<{ width: number; height: number }>,
  options: Readonly<{
    compareSide?: boolean;
    slotPad?: number;
    max?: number;
  }> = {},
): number {
  const slotPad = options.slotPad ?? 0.32 * CLASSROOM_EM;
  const max = Math.max(
    CLASSROOM_STAGE_TYPE_MIN,
    options.max ?? CLASSROOM_STAGE_TYPE_MAX,
  );
  let width = rect.width * content.width - slotPad * 2;
  const height = rect.height * content.height - slotPad * 2;
  const compareSide = options.compareSide ?? false;
  if (compareSide) {
    // Two side cards share the pane width with a 0.55em gutter.
    width = (width - 0.55 * CLASSROOM_STAGE_TYPE_BASE) / 2;
  }
  return fitStageCopy(copy, () => width, height, {
    compareSide,
    max,
    fill: 0.94,
  });
}

/** Compile joins compare points with ` · `; paint them back as separate rows. */
export function classroomCompareSlotLines(slot: string | undefined): string[] {
  return (slot ?? "")
    .split(/\s·\s/)
    .map((point) => classroomBoardDisplayText(point.trim()))
    .filter(Boolean);
}

/** Geometry of the standalone `content.compare` board (mirrors the CSS grid). */
export const CLASSROOM_COMPARE_BOARD = Object.freeze({
  /** `min(100%, 61em)` at the 18px stage em. */
  maxWidth: 61 * CLASSROOM_EM,
  /** Centre pillar (3.8em) plus two 0.75em gaps, in em of the fitted size. */
  pillarEm: 3.8 + 0.75 * 2,
  /** Each side card keeps `min-height: 17em` of the fitted size. */
  minSideHeightEm: 17,
});

/**
 * Fitted body font size for a standalone compare board. The two side cards
 * share the 61em row, so the longer side drives the fit exactly like a
 * nested compare pane.
 */
export function fitClassroomCompareBoard(
  slots: Readonly<{
    leftLabel?: string;
    left?: string;
    rightLabel?: string;
    right?: string;
  }>,
  content: Readonly<{ width: number; height: number }>,
): number {
  const copy = classroomStageCopy({
    type: "compare",
    left: {
      label: slots.leftLabel ?? "",
      points: classroomCompareSlotLines(slots.left),
    },
    right: {
      label: slots.rightLabel ?? "",
      points: classroomCompareSlotLines(slots.right),
    },
  });
  if (!copy) return CLASSROOM_STAGE_TYPE_BASE;
  const boardWidth = Math.min(content.width, CLASSROOM_COMPARE_BOARD.maxWidth);
  return fitStageCopy(
    copy,
    (size) => (boardWidth - CLASSROOM_COMPARE_BOARD.pillarEm * size) / 2,
    content.height,
    { compareSide: true, max: CLASSROOM_STAGE_TYPE_MAX, fill: 0.9 },
  );
}

export type ClassroomStageTypography = readonly (number | null)[];

function settledTypography(
  plan: MaterialStageLayoutPlan,
  figures: readonly ClassroomCopyFigure[],
  content: Readonly<{ width: number; height: number }>,
): ClassroomStageTypography {
  const fitted = plan.items.map((item) => {
    const figure = figures[item.index];
    const copy = figure ? classroomStageCopy(figure) : null;
    if (!copy) return null;
    return fitClassroomStageType(copy, item.rect, content, {
      compareSide: figure!.type === "compare",
      max:
        CLASSROOM_STAGE_TYPE_MAX +
        (item.focused ? CLASSROOM_STAGE_TYPE_FOCUS_BONUS : 0),
    });
  });
  const shared = fitted.reduce<number | null>((min, size, index) => {
    if (size == null || plan.items[index]!.focused) return min;
    return min == null ? size : Math.min(min, size);
  }, null);
  return fitted.map((size, index) => {
    if (size == null) return null;
    const item = plan.items[index]!;
    // Context panes share one size so an overview reads as one board; a cued
    // pane is allowed its own fit so it visibly gains type with its area.
    if (item.focused || shared == null) return size;
    return Math.min(size, shared);
  });
}

/**
 * Per-pane body font size (design px) for the current frame. Both endpoints
 * are fitted on settled plans, then lerped on the shared classroom ease so a
 * word-wrap flip in the estimate cannot pop the type mid-transition.
 */
export function classroomStageTypography(params: {
  previousPlan: MaterialStageLayoutPlan;
  currentPlan: MaterialStageLayoutPlan;
  figures: readonly ClassroomCopyFigure[];
  content: Readonly<{ width: number; height: number }>;
  progress: number;
}): ClassroomStageTypography {
  const target = settledTypography(
    params.currentPlan,
    params.figures,
    params.content,
  );
  const amount = materialStageMotionEase(
    Number.isFinite(params.progress) ? params.progress : 1,
  );
  if (amount >= 1) return target;
  const source = settledTypography(
    params.previousPlan,
    params.figures,
    params.content,
  );
  return target.map((size, index) => {
    if (size == null) return null;
    const from = source[index] ?? size;
    return from + (size - from) * amount;
  });
}

/** CSS variable applied on a stage slot; `null` keeps the stylesheet default. */
export function classroomStageTypeStyle(
  size: number | null,
): Readonly<Record<string, string>> {
  if (size == null) return {};
  return {
    ["--lp-stage-type" as string]: `${(size / CLASSROOM_EM).toFixed(4)}em`,
  };
}

/** Presentation type follows the shared slots and stays fixed across cue changes.
 * Long historical copy keeps a readable floor; the reader can expand naturally. */
export function classroomPresentationTypography(params: {
  plan: MaterialStageLayoutPlan;
  figures: readonly ClassroomCopyFigure[];
  content: Readonly<{ width: number; height: number }>;
}): ClassroomStageTypography {
  const sizes = params.plan.items.map((item) => {
    const figure = params.figures[item.index];
    const copy = figure && classroomStageCopy(figure);
    if (!copy) return null;
    return Math.max(
      24,
      fitClassroomStageType(copy, item.rect, params.content, {
        slotPad: 8,
        max: 32,
        compareSide: figure.type === "compare",
      }),
    );
  });
  const shared = Math.min(
    32,
    ...sizes.filter((size): size is number => size !== null),
  );
  return sizes.map((size) => (size === null ? null : shared));
}

/** Finite visual labels share the classroom's fixed design coordinate system. */
export function classroomVisualTypography(content?: {
  width: number;
  height: number;
}): number {
  return Math.max(
    16,
    Math.min(32, (content?.width ?? 1500) / 38, (content?.height ?? 660) / 18),
  );
}
