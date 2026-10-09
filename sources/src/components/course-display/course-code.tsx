import { isStructuredTextBoard, StructuredTextBoard } from "./structured-text-board.js";
import { useTextBoardFit } from "./use-text-board-fit.js";
import type { CodeBlockShell } from "../markdown/code-block-shell.js";
import { HighlightedCode } from "../markdown/highlighted-code.js";
import { ProseMarkdown } from "../markdown/prose-markdown.js";
import type { InteractiveBlock } from "../../shared/llm/schemas.js";
import { cn } from "../../shared/utils.js";
import {
  CLASSROOM_CODE_MAX_VISIBLE_LINES,
  blockFigureId,
  clampClassroomCodeVisibleLines,
  classroomCodeLanguage,
  classroomCodeLanguageLabel,
  classroomCodeSource,
  codeBoardParts,
  computeClassroomCodeScrollOffset,
  concatCodeParts,
  fitClassroomCode,
  isClassroomTextBoardLanguage,
  materialCueCodeRegionLit,
  resolveCodeFigureSpans,
  resolveCodePartSpans,
  type ClassroomCodeLineBox,
  type CourseDisplayBlock,
  type MaterialCodePart,
} from "../../../libs/domain/src/index.js";
import {
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";

export type ClassroomCodeScrollSample = Readonly<{
  layout: MeasuredClassroomCodeLayout;
  focus?: Readonly<{startLine: number; endLine: number}>;
  previousFocus?: Readonly<{startLine: number; endLine: number}>;
}>;

export type CourseCodeDisplayProps =
  | {
      surface: "classroom";
      block: CourseDisplayBlock;
      activeTargetIds?: readonly string[];
      previousActiveTargetIds?: readonly string[];
      clocked?: boolean;
      beatEnter?: number;
      /** Host-proven source partition; bypass authoring caps only when exact. */
      sourceParts?: readonly MaterialCodePart[];
      sampleClockedScroll?: (sample: ClassroomCodeScrollSample) => number;
    }
  | {
      surface: "responsive";
      block: Extract<InteractiveBlock, { type: "code" }>;
      activeTargetIds?: readonly string[];
      renderCode: (props: ComponentProps<typeof CodeBlockShell>) => ReactNode;
    };

/** Both surfaces consume the same code identity and cue targets, without a player dependency. */
export function CourseCodeDisplay(props: CourseCodeDisplayProps) {
  if (props.surface === "classroom") return <ClockedCodeBoard {...props} />;
  return props.renderCode({
    code: props.block.code,
    language: props.block.language,
    parts: props.block.parts,
    figureId: props.block.id,
    activeTargetIds: props.activeTargetIds,
  });
}

type MeasuredClassroomCodeLayout = Readonly<{
  viewportHeight: number;
  contentHeight: number;
  rowHeight: number;
  lineBoxes: readonly ClassroomCodeLineBox[];
}>;

function classroomCodeVisibleRange(
  layout: MeasuredClassroomCodeLayout,
  scrollOffset: number,
  totalLines: number,
): { startLine: number; endLine: number } {
  if (totalLines === 0 || layout.lineBoxes.length === 0) {
    return { startLine: 1, endLine: 0 };
  }
  const viewportTop = scrollOffset;
  const viewportBottom = scrollOffset + layout.viewportHeight;
  let startIndex = layout.lineBoxes.findIndex(
    (box) => box.top + box.height > viewportTop + 0.5,
  );
  if (startIndex < 0) startIndex = layout.lineBoxes.length - 1;
  let endIndex = layout.lineBoxes.length - 1;
  for (let index = startIndex; index < layout.lineBoxes.length; index += 1) {
    if (layout.lineBoxes[index].top >= viewportBottom - 0.5) {
      endIndex = Math.max(startIndex, index - 1);
      break;
    }
  }
  return {
    startLine: Math.min(totalLines, startIndex + 1),
    endLine: Math.min(totalLines, endIndex + 1),
  };
}

const TEXT_BOARD_CJK_OR_PUNCT = /[\u4e00-\u9fff：:，。；、！？]/u;

function normalizeClassroomLimitInner(inner: string): string {
  return inner.trim().replace(/\s*(?:→|->)\s*/gu, " \\to ");
}

/** `(num)/den` and `[num]/den` become `\frac` so markdown cannot steal `[...]`. */
function asciiQuotientToFrac(expr: string): string {
  const denRe = /\/\s*([A-Za-zΔ][A-Za-z0-9]*)/gu;
  let out = "";
  let last = 0;
  for (const match of expr.matchAll(denRe)) {
    const den = match[1]!;
    const slashAt = match.index ?? 0;
    let closeAt = slashAt - 1;
    while (closeAt >= last && expr[closeAt] === " ") closeAt -= 1;
    const close = closeAt >= last ? expr[closeAt] : "";
    if (close !== ")" && close !== "]") continue;
    const openCh = close === ")" ? "(" : "[";
    let depth = 0;
    let openAt = -1;
    for (let index = closeAt; index >= last; index -= 1) {
      const ch = expr[index];
      if (ch === close) depth += 1;
      else if (ch === openCh) {
        depth -= 1;
        if (depth === 0) {
          openAt = index;
          break;
        }
      }
    }
    if (openAt < 0) continue;
    out += expr.slice(last, openAt);
    out += `\\frac{${expr.slice(openAt + 1, closeAt).trim()}}{${den}}`;
    last = slashAt + match[0].length;
  }
  return out + expr.slice(last);
}

function repairAsciiClassroomMath(expr: string): string {
  let latex = expr
    .replace(
      /\blim\s*_\s*\{([^}]*)\}/gu,
      (_, inner: string) => `\\lim_{${normalizeClassroomLimitInner(inner)}}`,
    )
    .replace(
      /\blim\s*\[([^\]\n]*)\]/gu,
      (_, inner: string) => `\\lim_{${normalizeClassroomLimitInner(inner)}}`,
    );
  latex = asciiQuotientToFrac(latex);
  if (/\\lim|\\frac/.test(latex) && !latex.includes("\\displaystyle")) {
    latex = `\\displaystyle ${latex}`;
  }
  return latex;
}

function looksLikeClassroomMath(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.includes("$")) return false;
  if (/\blim\b/u.test(trimmed)) return true;
  if (/^\s*=/.test(trimmed) && /[A-Za-z0-9]/.test(trimmed)) return true;
  return /[=^]/.test(trimmed) && /[A-Za-z]/.test(trimmed);
}

function wrapClassroomMath(expr: string): string {
  return `$${repairAsciiClassroomMath(expr.trim())}$`;
}

function repairTextBoardLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed || trimmed.includes("$")) return line;
  if (!TEXT_BOARD_CJK_OR_PUNCT.test(trimmed)) {
    return looksLikeClassroomMath(trimmed) ? wrapClassroomMath(trimmed) : line;
  }
  return trimmed
    .split(/([\u4e00-\u9fff：:，。；、！？]+)/u)
    .map((part) => {
      if (!part || TEXT_BOARD_CJK_OR_PUNCT.test(part)) return part;
      if (!looksLikeClassroomMath(part)) return part;
      const inner = part.trim();
      return part.replace(inner, wrapClassroomMath(inner));
    })
    .join("");
}

/**
 * Text boards are authored as small, independently addressable source parts.
 * Keep the source untouched at the React boundary, but give the markdown
 * renderer a trimmed display copy so partition newlines do not become empty
 * paragraphs or shift the visual spacing between parts.
 */
export function textBoardDisplaySource(sourceText: string): string {
  const normalized = sourceText.replace(/\r\n/gu, "\n").trim();
  if (!normalized) return "";

  return normalized.split("\n").map(repairTextBoardLine).join("\n");
}

function textBoardParts(
  block: CourseDisplayBlock,
  source: string,
  regions: ReadonlyArray<ReturnType<typeof resolveCodeFigureSpans>[number]>,
): MaterialCodePart[] {
  const parts = codeBoardParts(block);
  if (parts.some((part) => part.id) || regions.length === 0) return parts;

  // Preserve legacy `regions[].match` cues when an old board has no authored
  // parts. New boards use their explicit part ids and never need this split.
  const resolved: MaterialCodePart[] = [];
  let offset = 0;
  for (const region of [...regions].sort((a, b) => a.start - b.start)) {
    const start = Math.max(offset, Math.min(source.length, region.start));
    const end = Math.max(start, Math.min(source.length, region.end));
    if (start > offset) resolved.push({ text: source.slice(offset, start) });
    if (end > start)
      resolved.push({ id: region.id, text: source.slice(start, end) });
    offset = end;
  }
  if (offset < source.length) resolved.push({ text: source.slice(offset) });
  return resolved.length > 0 ? resolved : parts;
}

function TextBoardPart({
  part,
  isLit,
  hasCued,
}: {
  part: MaterialCodePart;
  isLit: boolean;
  hasCued: boolean;
}) {
  const displaySource = textBoardDisplaySource(part.text);
  if (!displaySource) return null;

  return (
    <div
      className={cn(
        "lp-text-board-part",
        isLit && "is-cued",
        hasCued && !isLit && "is-dimmed",
      )}
      data-lp-lit={isLit ? "true" : undefined}
      data-lp-part-id={part.id}
      data-lp-source-text={part.text}
    >
      <ProseMarkdown
        content={displaySource}
        variant="board"
        className="lp-text-board-markdown"
      />
    </div>
  );
}

function ClockedCodeBoard({
  block,
  activeTargetIds = [],
  previousActiveTargetIds = [],
  clocked = false,
  beatEnter,
  sourceParts,
  sampleClockedScroll,
}: {
  block: CourseDisplayBlock;
  activeTargetIds?: readonly string[];
  previousActiveTargetIds?: readonly string[];
  clocked?: boolean;
  beatEnter?: number;
  sourceParts?: readonly MaterialCodePart[];
  sampleClockedScroll?: (sample: ClassroomCodeScrollSample) => number;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const [capacity, setCapacity] = useState(CLASSROOM_CODE_MAX_VISIBLE_LINES);
  const [layout, setLayout] = useState<MeasuredClassroomCodeLayout>();
  const source = classroomCodeSource(block);
  const language = classroomCodeLanguage(block);
  const isTextBoard = isClassroomTextBoardLanguage(language);
  useTextBoardFit(boardRef, isTextBoard, source);
  const canonicalParts = sourceParts && concatCodeParts(sourceParts) === source ? sourceParts : undefined;
  const regions = canonicalParts ? resolveCodePartSpans(canonicalParts) : resolveCodeFigureSpans(block);
  const figureId = blockFigureId(block);
  const lineCueEnabled = !isTextBoard || !activeTargetIds.includes("whole");
  const previousLineCueEnabled =
    !isTextBoard || !previousActiveTargetIds.includes("whole");

  const litRegions = regions.filter((region) =>
    materialCueCodeRegionLit(activeTargetIds, region.id, figureId),
  );
  const prevLitRegions = regions.filter((region) =>
    materialCueCodeRegionLit(previousActiveTargetIds, region.id, figureId),
  );

  // A part commonly ends with one or more newlines. Those newlines belong to
  // the source partition, not to the thing being taught. Keeping them in the
  // range makes a text board paint a stray marker on an empty row and makes a
  // window appear one line away from the spoken content.
  const sourceLines = source
    .replace(/\r\n/gu, "\n")
    .replace(/\n$/u, "")
    .split("\n");
  const contentRanges = (candidateRegions: typeof regions) =>
    candidateRegions.flatMap((region) => {
      const start = Math.max(0, Math.min(source.length, region.start));
      const end = Math.max(start, Math.min(source.length, region.end));
      const matched = source.slice(start, end);
      const firstContent = matched.search(/\S/u);
      if (firstContent < 0) return [];
      let lastContent = matched.length - 1;
      while (lastContent > firstContent && /\s/u.test(matched[lastContent]!)) {
        lastContent -= 1;
      }
      const contentStart = start + firstContent;
      const contentEnd = start + lastContent;
      return [
        {
          startLine: source.slice(0, contentStart).split("\n").length,
          endLine: source.slice(0, contentEnd).split("\n").length,
        },
      ];
    });
  const litRanges = contentRanges(litRegions);
  const previousLitRanges = contentRanges(prevLitRegions);

  const focus =
    lineCueEnabled && litRanges.length > 0
      ? {
          startLine: Math.min(...litRanges.map((item) => item.startLine)),
          endLine: Math.max(...litRanges.map((item) => item.endLine)),
        }
      : undefined;

  const prevFocus =
    previousLineCueEnabled && previousLitRanges.length > 0
      ? {
          startLine: Math.min(
            ...previousLitRanges.map((item) => item.startLine),
          ),
          endLine: Math.max(...previousLitRanges.map((item) => item.endLine)),
        }
      : undefined;

  const fit = fitClassroomCode(source, focus, capacity);
  const measuredLayout =
    layout?.lineBoxes.length === fit.totalLines ? layout : undefined;
  const targetScrollOffset = measuredLayout
    ? computeClassroomCodeScrollOffset(
        measuredLayout.lineBoxes,
        focus,
        measuredLayout.viewportHeight,
        measuredLayout.contentHeight,
      )
    : 0;
  const prevScrollOffset = measuredLayout
    ? computeClassroomCodeScrollOffset(
        measuredLayout.lineBoxes,
        prevFocus,
        measuredLayout.viewportHeight,
        measuredLayout.contentHeight,
      )
    : 0;
  const maxScrollOffset = measuredLayout
    ? Math.max(0, measuredLayout.contentHeight - measuredLayout.viewportHeight)
    : 0;
  const hasOverflow = measuredLayout ? maxScrollOffset > 0.5 : fit.overflow;

  // In clocked mode (export / tick evaluation), interpolate deterministically
  // across the beat enter window. In interactive studio mode, use the measured
  // target offset directly and let CSS transitions ease smoothly.
  let currentScrollOffset = targetScrollOffset;
  if (clocked && measuredLayout && sampleClockedScroll) {
    currentScrollOffset = Math.max(0, Math.min(maxScrollOffset, sampleClockedScroll({layout: measuredLayout, focus, previousFocus: prevFocus})));
  } else if (clocked && measuredLayout && prevScrollOffset !== targetScrollOffset) {
    const enterRatio = Math.max(0, Math.min(1, beatEnter ?? 1));
    currentScrollOffset =
      prevScrollOffset + (targetScrollOffset - prevScrollOffset) * enterRatio;
  }

  const visibleRange = measuredLayout
    ? classroomCodeVisibleRange(
        measuredLayout,
        currentScrollOffset,
        fit.totalLines,
      )
    : {
        startLine: Math.min(fit.totalLines, Math.round(fit.scrollLines) + 1),
        endLine: Math.min(
          fit.totalLines,
          Math.round(fit.scrollLines) + fit.visibleLineCount,
        ),
      };

  const canScrollUp = currentScrollOffset > 0.5;
  const canScrollDown = currentScrollOffset < maxScrollOffset - 0.5;
  const hasCued = lineCueEnabled && litRanges.length > 0;
  const boardParts = isTextBoard ? canonicalParts ?? textBoardParts(block, source, regions) : [];

  const isLineLit = (lineNo: number) => {
    return (
      lineCueEnabled &&
      Boolean(sourceLines[lineNo - 1]?.trim()) &&
      litRanges.some(
        (region) => lineNo >= region.startLine && lineNo <= region.endLine,
      )
    );
  };

  // Mini-map calculations
  const thumbHeightPercent = hasOverflow
    ? Math.max(
        16,
        measuredLayout
          ? (measuredLayout.viewportHeight / measuredLayout.contentHeight) * 100
          : (fit.visibleLineCount / fit.totalLines) * 100,
      )
    : 100;
  const maxThumbTravel = 100 - thumbHeightPercent;
  const thumbTopPercent =
    maxScrollOffset > 0
      ? (Math.min(maxScrollOffset, currentScrollOffset) / maxScrollOffset) *
        maxThumbTravel
      : 0;

  useLayoutEffect(() => {
    const board = boardRef.current;
    const pane = board?.closest(".lp-stage-content");
    if (!board || !(pane instanceof HTMLElement)) return;

    const measure = () => {
      const header = board.querySelector(".lp-code-header");
      const viewport = board.querySelector(".lp-code-viewport");
      const scroll = board.querySelector(".lp-code-scroll");
      const sourceElement = board.querySelector(".lp-code-source");
      const lines = Array.from(
        board.querySelectorAll<HTMLElement>(".lp-code-line"),
      );
      // Use layout dimensions rather than the scaled visual rectangle: this is
      // the same coordinate space as the fixed 1920×1080 design canvas.
      const headerH = header instanceof HTMLElement ? header.offsetHeight : 0;
      // A wrapped first source line spans several glyph rows. Its complete
      // box must not become the minimum height of every other source line.
      const lineH = lines[0] ? Number.parseFloat(getComputedStyle(lines[0]).minHeight) || lines[0].offsetHeight : 0;
      if (
        !(viewport instanceof HTMLElement) ||
        !(scroll instanceof HTMLElement) ||
        !(sourceElement instanceof HTMLElement) ||
        lines.length === 0 ||
        lineH < 8 ||
        pane.clientHeight < 32
      ) {
        return;
      }
      const boardBorderH = Math.max(0, board.offsetHeight - board.clientHeight);
      const viewportH = Math.max(
        32,
        pane.clientHeight - headerH - boardBorderH,
      );
      const sourceStyle = getComputedStyle(sourceElement);
      const sourcePaddingH =
        Number.parseFloat(sourceStyle.paddingTop) +
        Number.parseFloat(sourceStyle.paddingBottom);
      const sourcePaddingBottom = Number.parseFloat(sourceStyle.paddingBottom);
      setCapacity(
        clampClassroomCodeVisibleLines(
          Math.floor((viewportH - sourcePaddingH) / lineH),
        ),
      );
      const scrollRect = scroll.getBoundingClientRect();
      const scaleY = pane.offsetHeight > 0 ? pane.getBoundingClientRect().height / pane.offsetHeight : 1;
      const lineBoxes = lines.map((line) => {
        const rect = line.getBoundingClientRect();
        return {
          top: (rect.top - scrollRect.top) / (scaleY || 1),
          height: rect.height / (scaleY || 1),
        };
      });
      const lastBox = lineBoxes[lineBoxes.length - 1];
      const lineContentBottom = lastBox
        ? lastBox.top + lastBox.height + sourcePaddingBottom
        : 0;
      // Some flex layouts stretch the scroll element to the viewport height,
      // so include the measured last line explicitly instead of trusting only
      // scrollHeight for overflow detection.
      const contentHeight = Math.max(
        scroll.offsetHeight,
        scroll.scrollHeight,
        lineContentBottom,
      );
      setLayout((current) => {
        const sameBoxes =
          current?.lineBoxes.length === lineBoxes.length &&
          current.lineBoxes.every(
            (box, index) =>
              Math.abs(box.top - lineBoxes[index].top) < 0.5 &&
              Math.abs(box.height - lineBoxes[index].height) < 0.5,
          );
        if (
          current &&
          Math.abs(current.viewportHeight - viewportH) < 0.5 &&
          Math.abs(current.contentHeight - contentHeight) < 0.5 &&
          Math.abs(current.rowHeight - lineH) < 0.5 &&
          sameBoxes
        ) {
          return current;
        }
        return {
          viewportHeight: viewportH,
          contentHeight,
          rowHeight: lineH,
          lineBoxes,
        };
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(pane);
    return () => observer.disconnect();
  }, [source, fit.density, capacity]);

  return (
    <div
      ref={boardRef}
      className={cn(
        "lp-code-board",
        isTextBoard && "is-text-board",
        `is-${fit.density}`,
        hasOverflow ? "is-fill" : "is-fitted",
      )}
      style={{
        ...(measuredLayout
          ? {
              ["--lp-code-row-height" as string]: `${measuredLayout.rowHeight}px`,
              ["--lp-code-viewport-height" as string]: `${measuredLayout.viewportHeight}px`,
            }
          : {}),
      }}
      data-lp-target="code"
      data-lp-lit="true"
      data-board-kind={isTextBoard ? "text" : "code"}
      data-has-cued={hasCued ? "true" : undefined}
    >
      {isTextBoard ? (
        <span className="lp-text-board-label" aria-hidden="true">
          {classroomCodeLanguageLabel(language)}
        </span>
      ) : (
        <div className="lp-code-header">
          <div className="lp-code-header-left">
            <div className="lp-code-dots" aria-hidden="true">
              <span className="lp-code-dot lp-code-dot--red" />
              <span className="lp-code-dot lp-code-dot--yellow" />
              <span className="lp-code-dot lp-code-dot--green" />
            </div>
            <span className="lp-code-lang-badge">
              {classroomCodeLanguageLabel(language)}
            </span>
          </div>
          <div className="lp-code-header-right">
            {hasOverflow ? (
              <span className="lp-code-range-pill">
                {visibleRange.startLine}–{visibleRange.endLine} /{" "}
                {fit.totalLines} 行
              </span>
            ) : (
              <span className="lp-code-range-pill">{fit.totalLines} 行</span>
            )}
          </div>
        </div>
      )}
      <div
        className="lp-code-viewport"
        data-mask-top={canScrollUp ? "true" : undefined}
        data-mask-bottom={canScrollDown ? "true" : undefined}
      >
        <div
          className="lp-code-scroll"
          style={{
            transform: `translateY(calc(-1 * var(--lp-code-scroll-px, 0px)))`,
            ["--lp-code-scroll-px" as string]: `${currentScrollOffset}px`,
          }}
        >
          <div className="lp-code-source">
            {isTextBoard && isStructuredTextBoard(source) ? (
              <StructuredTextBoard
                parts={boardParts}
                hasCued={hasCued}
                isLit={(part) => lineCueEnabled && Boolean(part.id && materialCueCodeRegionLit(activeTargetIds, part.id, figureId))}
              />
            ) : isTextBoard ? (
              <div className="lp-text-board-parts">
                {boardParts.map((part, index) => (
                  <TextBoardPart
                    key={`${part.id ?? "part"}:${index}`}
                    part={part}
                    isLit={
                      lineCueEnabled &&
                      Boolean(
                        part.id &&
                        materialCueCodeRegionLit(
                          activeTargetIds,
                          part.id,
                          figureId,
                        ),
                      )
                    }
                    hasCued={hasCued}
                  />
                ))}
              </div>
            ) : (
              <div className="lp-code-hljs" role="code">
                {fit.allLines.map((line, index) => {
                  const lineNo = index + 1;
                  const lit = isLineLit(lineNo);
                  return (
                    <div
                      key={`${lineNo}:${line}`}
                      className={cn(
                        "lp-code-row",
                        fit.totalLines > 1 && "has-gutter",
                      )}
                    >
                      {fit.totalLines > 1 ? (
                        <div
                          className={cn(
                            "lp-code-gutter-line",
                            lit && "is-cued",
                          )}
                          aria-hidden="true"
                        >
                          <span>{lineNo}</span>
                        </div>
                      ) : null}
                      <div
                        className={cn(
                          "lp-code-line",
                          lit && "is-cued",
                          hasCued && !lit && "is-dimmed",
                        )}
                        data-lp-source-line={lineNo}
                        data-lp-lit={lit ? "true" : undefined}
                      >
                        <HighlightedCode
                          as="span"
                          className="lp-code-tokens"
                          code={line || " "}
                          language={language}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        {!isTextBoard && hasOverflow ? (
          <div className="lp-code-minimap" aria-hidden="true">
            <div
              className="lp-code-minimap-thumb"
              style={{
                height: `${thumbHeightPercent}%`,
                top: `${thumbTopPercent}%`,
              }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
