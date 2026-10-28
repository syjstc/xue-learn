import { isPlainCodeLanguage } from "./material-cue.js";
export type CourseCodeBlock = Readonly<{type: string; [key: string]: unknown}>;

/** Fallback visible-line cap when the lecture pane has not been measured. */
export const CLASSROOM_CODE_MAX_VISIBLE_LINES = 16;
export const CLASSROOM_CODE_MIN_VISIBLE_LINES = 6;
export const CLASSROOM_CODE_MAX_CAPACITY = 22;
const CLASSROOM_CODE_COMFORTABLE_LINE_CHARS = 72;

export type ClassroomCodeDensity = "comfortable" | "compact";

/**
 * Non-executable code blocks are classroom writing rather than source code.
 * Keep this separate from `isPlainCodeLanguage`: markdown still benefits from
 * being rendered as escaped, source-like text in a lesson-performance board.
 */
export function isClassroomTextBoardLanguage(language?: string): boolean {
  const normalized = language?.trim().toLowerCase() ?? "";
  return (
    isPlainCodeLanguage(language) ||
    normalized === "markdown" ||
    normalized === "md"
  );
}

export type ClassroomCodeLineBox = Readonly<{
  top: number;
  height: number;
}>;

export type ClassroomCodeFit = Readonly<{
  visibleCode: string;
  fullCode: string;
  allLines: readonly string[];
  startLine: number;
  endLine: number;
  totalLines: number;
  overflow: boolean;
  density: ClassroomCodeDensity;
  scrollLines: number;
  maxScrollLines: number;
  visibleLineCount: number;
}>;

const LANGUAGE_LABELS: Record<string, string> = {
  bash: "Bash",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  css: "CSS",
  dockerfile: "Dockerfile",
  go: "Go",
  haskell: "Haskell",
  java: "Java",
  javascript: "JavaScript",
  json: "JSON",
  kotlin: "Kotlin",
  markdown: "Markdown",
  python: "Python",
  rust: "Rust",
  sql: "SQL",
  swift: "Swift",
  typescript: "TypeScript",
  xml: "HTML",
  yaml: "YAML",
};

export function classroomCodeSource(
  block: CourseCodeBlock | undefined,
): string {
  if (!block) return "";
  for (const value of [block.code, block.body, block.text]) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

export function classroomCodeLanguage(
  block: CourseCodeBlock | undefined,
): string | undefined {
  if (!block) return undefined;
  for (const value of [block.language, block.lang]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function classroomCodeLanguageLabel(language?: string): string {
  const normalized = language?.trim().toLowerCase() ?? "";
  if (isPlainCodeLanguage(language)) return "Text";
  if (!normalized) return "Code";
  const aliases: Record<string, string> = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    py: "python",
    hs: "haskell",
    md: "markdown",
    "c++": "cpp",
    "c#": "csharp",
    html: "xml",
    yml: "yaml",
  };
  const resolved = aliases[normalized] ?? normalized;
  return LANGUAGE_LABELS[resolved] ?? resolved.toUpperCase();
}

export function clampClassroomCodeVisibleLines(value: number): number {
  if (!Number.isFinite(value)) return CLASSROOM_CODE_MAX_VISIBLE_LINES;
  return Math.min(
    CLASSROOM_CODE_MAX_CAPACITY,
    Math.max(CLASSROOM_CODE_MIN_VISIBLE_LINES, Math.trunc(value)),
  );
}

export function computeClassroomCodeScrollLines(
  totalLines: number,
  focus?: Readonly<{ startLine: number; endLine?: number }>,
  maxVisibleLines = CLASSROOM_CODE_MAX_VISIBLE_LINES,
): number {
  if (totalLines <= maxVisibleLines) return 0;
  const maxScroll = totalLines - maxVisibleLines;
  if (!focus) return 0;
  const start = Math.max(1, Math.trunc(focus.startLine));
  const end = Math.max(start, Math.trunc(focus.endLine ?? focus.startLine));
  const focusCenter = (start + end) / 2;
  const desiredScroll = Math.round(focusCenter - maxVisibleLines / 2);
  return Math.max(0, Math.min(maxScroll, desiredScroll));
}

/**
 * Center an authored focus range using the browser's measured line boxes.
 * Unlike line-count scrolling, this also works when a long source line wraps
 * into multiple visual rows.
 */
export function computeClassroomCodeScrollOffset(
  lineBoxes: readonly ClassroomCodeLineBox[],
  focus: Readonly<{ startLine: number; endLine?: number }> | undefined,
  viewportHeight: number,
  contentHeight: number,
): number {
  if (!focus || lineBoxes.length === 0 || viewportHeight <= 0) return 0;

  const startIndex = Math.min(
    lineBoxes.length - 1,
    Math.max(0, Math.trunc(focus.startLine) - 1),
  );
  const endIndex = Math.min(
    lineBoxes.length - 1,
    Math.max(startIndex, Math.trunc(focus.endLine ?? focus.startLine) - 1),
  );
  const startBox = lineBoxes[startIndex];
  const endBox = lineBoxes[endIndex];
  if (!startBox || !endBox) return 0;

  const focusCenter = (startBox.top + endBox.top + endBox.height) / 2;
  const maxScroll = Math.max(0, contentHeight - viewportHeight);
  return Math.max(0, Math.min(maxScroll, focusCenter - viewportHeight / 2));
}

export function fitClassroomCode(
  code: string,
  focus?: Readonly<{ startLine: number; endLine: number }>,
  maxVisibleLines = CLASSROOM_CODE_MAX_VISIBLE_LINES,
): ClassroomCodeFit {
  const visibleCap = clampClassroomCodeVisibleLines(maxVisibleLines);
  const normalized = code.replace(/\r\n/g, "\n").replace(/\n$/u, "");
  if (!normalized.trim()) {
    return {
      visibleCode: "",
      fullCode: "",
      allLines: [],
      startLine: 1,
      endLine: 0,
      totalLines: 0,
      overflow: false,
      density: "comfortable",
      scrollLines: 0,
      maxScrollLines: 0,
      visibleLineCount: 0,
    };
  }
  const lines = normalized.split("\n");
  const totalLines = lines.length;
  const overflow = totalLines > visibleCap;
  const visibleLineCount = overflow ? visibleCap : totalLines;
  let startLine = 1;
  if (overflow && focus) {
    startLine = Math.min(totalLines, Math.max(1, Math.trunc(focus.startLine)));
  }
  const sliceStart = startLine - 1;
  const visibleLines = overflow
    ? lines.slice(sliceStart, sliceStart + visibleCap)
    : lines;
  const longLine = lines.some(
    (line) => line.length > CLASSROOM_CODE_COMFORTABLE_LINE_CHARS,
  );
  const maxScrollLines = Math.max(0, totalLines - visibleCap);
  const scrollLines = computeClassroomCodeScrollLines(
    totalLines,
    focus,
    visibleCap,
  );
  return {
    visibleCode: visibleLines.join("\n"),
    fullCode: normalized,
    allLines: lines,
    startLine,
    endLine: startLine + visibleLines.length - 1,
    totalLines,
    overflow,
    density: longLine ? "compact" : "comfortable",
    scrollLines,
    maxScrollLines,
    visibleLineCount,
  };
}
