import { countVariant, useT } from "../../shared/i18n/index.js";
import { MusicDisplay } from "./music-display.js";
import { MusicTeachingDisplay } from "./music-teaching-display.js";
import { readMusicTeaching } from "../../../libs/domain/src/index.js";
import { readMaterialMusic } from "../../../libs/domain/src/index.js";
import { GuidedImageDisplay } from "./guided-image-display.js";
import type { GuidedImageDisplay as GuidedDisplay } from "../../../libs/domain/src/index.js";
import {
  isStructuredTextBoard,
  StructuredTextBoard,
} from "./structured-text-board.js";
import { useTextBoardFit } from "./use-text-board-fit.js";
import { useLayoutEffect, useRef, useState } from "react";
import { Code2, Image as ImageIcon } from "lucide-react";
import { cn } from "../../shared/utils.js";
import { withAigcImageVersion } from "../../shared/aigc.js";
import { fitSvgElementViewBox } from "../../shared/course-svg/fit-svg-element-view-box.js";
import {
  blockFigureId,
  codeBoardParts,
  type ClassroomCodeLineBox,
  type MaterialCodePart,
  classroomCodeLanguage,
  classroomCodeLanguageLabel,
  classroomCodeSource,
  computeClassroomCodeScrollOffset,
  CLASSROOM_CODE_MAX_VISIBLE_LINES,
  clampClassroomCodeVisibleLines,
  fitClassroomCode,
  fitCourseSvgViewBox,
  isClassroomTextBoardLanguage,
  materialCueCodeRegionLit,
  resolveCodeFigureSpans,
  normalizeCourseSvgTextPaint,
  type CourseDisplayBlock,
} from "../../../libs/domain/src/index.js";
import type { CourseDisplayScene } from "../../../libs/domain/src/index.js";
import { validatePresentationSvg as validateVideoSvg } from "../../../libs/common/src/presentation-svg.js";
import { HighlightedCode } from "../markdown/highlighted-code.js";
import { ProseMarkdown } from "../markdown/prose-markdown.js";

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

function isUnsafeVideoSvg(markup: string): boolean {
  return validateVideoSvg(markup).some(
    (issue) =>
      issue === "not_svg" ||
      issue.includes("<script") ||
      issue.includes("foreignobject") ||
      issue.includes("onload=") ||
      issue.includes("onclick=") ||
      issue.includes('href="http'),
  );
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

export function staticSvgMarkup(
  block: CourseDisplayBlock | undefined,
): string | null {
  if (!block) return null;
  const candidates = [block.svg, block.markup, block.body];
  for (const value of candidates) {
    if (typeof value !== "string" || !value.toLowerCase().includes("<svg")) {
      continue;
    }
    if (isUnsafeVideoSvg(value)) return null;
    return prepareStageSvgMarkup(
      normalizeCourseSvgTextPaint(fitCourseSvgViewBox(value)),
    );
  }
  return null;
}

export function staticIllustrationUrl(
  block: CourseDisplayBlock | undefined,
): string | null {
  if (!block) return null;
  const value = block.imageUrl;
  if (typeof value !== "string") return null;
  const url = value.trim();
  if (!url) return null;
  if (
    url.startsWith("/api/") ||
    url.startsWith("https://") ||
    url.startsWith("http://")
  ) {
    return url;
  }
  return null;
}

/** Let CSS own the 16:9 board; authored px width/height overflow the stage. */
export function prepareStageSvgMarkup(svg: string): string {
  return svg.replace(/^<svg\b([^>]*)>/u, (_full, attrs: string) => {
    let cleaned = String(attrs)
      .replace(/\s+\b(?:width|height)\s*=\s*(["'])[^"']*\1/giu, "")
      .replace(/\s+/gu, " ")
      .trim();
    if (!/\bpreserveAspectRatio\s*=/iu.test(cleaned)) {
      cleaned = `${cleaned} preserveAspectRatio="xMidYMid meet"`.trim();
    }
    return `<svg${cleaned ? ` ${cleaned}` : ""}>`;
  });
}

export function StageStaticSvg({
  markup,
  className,
  alt,
  stage = true,
}: {
  markup: string;
  className?: string;
  alt?: string;
  stage?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const themeClass = /\bcurrentColor\b/u.test(markup)
    ? "course-svg course-svg--stage"
    : "course-svg course-svg--legacy course-svg--stage";
  useLayoutEffect(() => {
    const root = containerRef.current?.querySelector("svg");
    if (root) fitSvgElementViewBox(root);
  }, [markup]);
  return (
    <div
      ref={containerRef}
      className={className ?? cn("lp-media-svg", stage && themeClass)}
      aria-label={alt}
      dangerouslySetInnerHTML={{ __html: markup }}
      role="img"
    />
  );
}

export function CourseBoardImage({
  src,
  alt,
  className,
  loading,
}: {
  src: string;
  alt: string;
  className?: string;
  loading?: "lazy" | "eager";
}) {
  return (
    <img
      src={withAigcImageVersion(src)}
      alt={alt}
      className={className}
      loading={loading}
    />
  );
}

export function StageCodeBoard({
  block,
  activeTargetIds = [],
  previousActiveTargetIds = [],
  clocked = false,
  beatEnter,
  contentSized = false,
}: {
  block: CourseDisplayBlock;
  activeTargetIds?: readonly string[];
  previousActiveTargetIds?: readonly string[];
  clocked?: boolean;
  beatEnter?: number;
  contentSized?: boolean;
}) {
  const t = useT();
  const boardRef = useRef<HTMLDivElement>(null);
  const [capacity, setCapacity] = useState(CLASSROOM_CODE_MAX_VISIBLE_LINES);
  const [layout, setLayout] = useState<MeasuredClassroomCodeLayout>();
  const source = classroomCodeSource(block);
  const language = classroomCodeLanguage(block);
  const isTextBoard = isClassroomTextBoardLanguage(language);
  useTextBoardFit(boardRef, isTextBoard, source);
  const regions = resolveCodeFigureSpans(block);
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
  const hasOverflow = measuredLayout
    ? maxScrollOffset > 0.5
    : !contentSized && fit.overflow;

  // In clocked mode (export / tick evaluation), interpolate deterministically
  // across the beat enter window. In interactive studio mode, use the measured
  // target offset directly and let CSS transitions ease smoothly.
  let currentScrollOffset = targetScrollOffset;
  if (clocked && measuredLayout && prevScrollOffset !== targetScrollOffset) {
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
  const boardParts = isTextBoard ? textBoardParts(block, source, regions) : [];

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
      const lineH = lines[0]?.offsetHeight ?? 0;
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
        contentSized
          ? Math.min(
              sourceElement.scrollHeight,
              pane.clientHeight - headerH - boardBorderH - 24,
            )
          : pane.clientHeight - headerH - boardBorderH,
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
      const canvasScale = scroll.offsetWidth
        ? scrollRect.width / scroll.offsetWidth
        : 1;
      const lineBoxes = lines.map((line) => {
        const rect = line.getBoundingClientRect();
        return {
          top: (rect.top - scrollRect.top) / (canvasScale || 1),
          height: line.offsetHeight,
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
  }, [source, fit.density, contentSized]);

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
        ...(contentSized
          ? { ["--lp-code-viewport-height" as string]: "auto" }
          : {}),
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
      data-content-sized={contentSized || undefined}
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
                {t(`display.code.lines.${countVariant(fit.totalLines)}`, {
                  count: fit.totalLines,
                })}
              </span>
            ) : (
              <span className="lp-code-range-pill">
                {t(`display.code.lines.${countVariant(fit.totalLines)}`, {
                  count: fit.totalLines,
                })}
              </span>
            )}
          </div>
        </div>
      )}
      <div
        className="lp-code-viewport"
        data-mask-top={hasOverflow && canScrollUp ? "true" : undefined}
        data-mask-bottom={hasOverflow && canScrollDown ? "true" : undefined}
      >
        <div
          className="lp-code-scroll"
          style={{
            transform: `translateY(calc(-1 * var(--lp-code-scroll-px, 0px)))`,
            ["--lp-code-scroll-px" as string]: `${contentSized && !measuredLayout ? 0 : currentScrollOffset}px`,
          }}
        >
          <div className="lp-code-source">
            {isTextBoard && isStructuredTextBoard(source) ? (
              <StructuredTextBoard
                parts={boardParts}
                hasCued={hasCued}
                isLit={(part) =>
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

export function CourseMediaScene(props: {
  scene: Pick<CourseDisplayScene, "slots">;
  mediaBlock?: CourseDisplayBlock;
  activeTargetIds?: readonly string[];
  previousActiveTargetIds?: readonly string[];
  clocked?: boolean;
  beatEnter?: number;
  /**
   * Nested stage panes already expose the figure's cue node on
   * `.lp-composed-figure`. A leftover `data-lp-target="media"` would be
   * treated as unlit and dim the focused picture.
   */
  nested?: boolean;
  interactive?: boolean;
}) {
  const t = useT();
  const music = readMaterialMusic(props.mediaBlock);
  const teachingMusic = readMusicTeaching(props.mediaBlock);
  if (teachingMusic)
    return (
      <MusicTeachingDisplay
        block={teachingMusic}
        activeTargetIds={props.activeTargetIds}
        interactive={props.interactive !== false}
      />
    );
  if (music)
    return (
      <MusicDisplay
        block={music}
        activeTargetIds={props.activeTargetIds}
        interactive={props.interactive !== false}
      />
    );
  const guidedImage =
    props.mediaBlock?.type === "illustration"
      ? (props.mediaBlock.guidedImage as GuidedDisplay | undefined)
      : undefined;
  const isCode = props.scene.slots.mediaKind === "code";
  const svgMarkup = staticSvgMarkup(props.mediaBlock);
  const imageUrl = svgMarkup ? null : staticIllustrationUrl(props.mediaBlock);
  const codeSource = isCode ? classroomCodeSource(props.mediaBlock) : "";
  const showCode = Boolean(codeSource);
  const isVisual = Boolean(guidedImage || svgMarkup || imageUrl || showCode);
  return (
    <div
      className={cn(
        "lp-media-scene",
        isVisual && "is-visual",
        showCode && "is-code",
      )}
      data-lp-target={
        showCode || guidedImage || props.nested ? undefined : "media"
      }
    >
      <div
        className={cn(
          "lp-media-cover",
          isVisual && "is-visual",
          imageUrl && "is-raster",
          showCode && "is-code",
        )}
      >
        {guidedImage ? (
          <GuidedImageDisplay
            display={guidedImage}
            activeTargetIds={props.activeTargetIds ?? []}
            previousActiveTargetIds={props.previousActiveTargetIds}
            clocked={props.clocked}
            beatEnter={props.beatEnter}
            interactive={props.interactive ?? false}
          />
        ) : svgMarkup ? (
          <StageStaticSvg markup={svgMarkup} />
        ) : imageUrl ? (
          <div className="lp-media-svg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <CourseBoardImage
              src={imageUrl}
              alt={String(
                props.mediaBlock?.alt ?? props.mediaBlock?.caption ?? "",
              )}
              className="lp-media-image"
            />
          </div>
        ) : showCode && props.mediaBlock ? (
          <StageCodeBoard
            block={props.mediaBlock}
            activeTargetIds={props.activeTargetIds}
            previousActiveTargetIds={props.previousActiveTargetIds}
            clocked={props.clocked}
            beatEnter={props.beatEnter}
          />
        ) : (
          <>
            {isCode ? (
              <Code2 aria-hidden="true" />
            ) : (
              <ImageIcon aria-hidden="true" />
            )}
            <span>
              {isCode
                ? t("display.ui.codeDemonstration")
                : t("display.ui.visualExplanation")}
            </span>
          </>
        )}
      </div>
      {isVisual ? null : <p>{props.scene.slots.caption}</p>}
    </div>
  );
}
