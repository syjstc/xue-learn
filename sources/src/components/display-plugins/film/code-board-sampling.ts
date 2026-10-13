import {wrapStoryCodeLine} from './text-layout.js';
import { computeClassroomCodeScrollOffset, type MaterialCodePart } from "../../../../libs/domain/src/index.js";
import type {CourseDisplayBlock as LessonPerformanceSnapshotBlock} from "../../../../libs/domain/src/index.js";
import type {ClassroomCodeScrollSample} from '../../course-display/course-code.js';
import type {RemotionCodeComponent} from "./types.js";

export const CODE_BOARD_COLUMNS = 68;
export const CODE_BOARD_VISIBLE_ROWS = 13;
export const CODE_BOARD_ROW_HEIGHT = 41;

export type CodeBoardRow = Readonly<{number: number; text: string; continuation: boolean}>;
export type CodeBoardHighlight = Readonly<{id: string; label: string; startLine: number; endLine: number}>;

/** Partition the exact accepted source, including repeated lines and gaps.
 * Overlapping legacy ranges share host-derived atoms while their public IDs
 * remain the narration targets. No substring search can select the wrong copy. */
export function classroomCodeBoardAdapter(props: RemotionCodeComponent['props']) {
  const starts = [0];
  for (let index = 0; index < props.code.length; index++) if (props.code[index] === '\n') starts.push(index + 1);
  const ranges = props.highlights.map(highlight => ({...highlight, start: starts[highlight.startLine - 1] ?? props.code.length,
    end: highlight.endLine < starts.length ? starts[highlight.endLine] - 1 : props.code.length}));
  const boundaries = [...new Set([0, props.code.length, ...ranges.flatMap(range => [range.start, range.end])])].sort((a, b) => a - b);
  const targets = new Map(props.highlights.map(highlight => [highlight.id, [] as string[]]));
  const reserved = new Set(props.highlights.map(highlight => highlight.id));
  const parts: MaterialCodePart[] = [];
  for (let index = 0; index < boundaries.length - 1; index++) {
    const start = boundaries[index], end = boundaries[index + 1];
    if (end <= start) continue;
    const owners = ranges.filter(range => start >= range.start && end <= range.end);
    let id: string | undefined;
    if (owners.length === 1 && start === owners[0].start && end === owners[0].end) id = owners[0].id;
    else if (owners.length) {
      id = `remotion_part_${index + 1}`;
      while (reserved.has(id)) id += '_';
      reserved.add(id);
    }
    parts.push({...(id ? {id} : {}), text: props.code.slice(start, end)});
    if (id) owners.forEach(owner => targets.get(owner.id)!.push(id!));
  }
  const block: LessonPerformanceSnapshotBlock = {type: 'code', id: 'remotion_code', language: props.language, code: props.code, parts};
  return {block, parts, targets: (ids: readonly string[]) => ids.flatMap(id => targets.get(id) ?? (id === 'whole' ? ['whole'] : []))};
}

/** Reuse the classroom's measured source rows and centered short-range fit.
 * A range taller than the viewport is traversed within its accepted narration,
 * with inspection holds at both ends. Every output is a function of the tick. */
export function sampleClassroomCodeViewport(sample: ClassroomCodeScrollSample, elapsedTicks: number, durationTicks: number): number {
  const {layout, focus, previousFocus} = sample;
  const bounds = (range: typeof focus) => {
    const center = computeClassroomCodeScrollOffset(layout.lineBoxes, range, layout.viewportHeight, layout.contentHeight);
    if (!range || !layout.lineBoxes.length) return {start: 0, end: 0};
    const first = layout.lineBoxes[Math.max(0, Math.min(layout.lineBoxes.length - 1, range.startLine - 1))];
    const last = layout.lineBoxes[Math.max(0, Math.min(layout.lineBoxes.length - 1, range.endLine - 1))];
    if (last.top + last.height - first.top <= layout.viewportHeight) return {start: center, end: center};
    const max = Math.max(0, layout.contentHeight - layout.viewportHeight);
    return {start: Math.max(0, Math.min(max, first.top)), end: Math.max(0, Math.min(max, last.top + last.height - layout.viewportHeight))};
  };
  const current = bounds(focus), previous = bounds(previousFocus);
  // Chromium lays out in 1/64 design pixels. Normalize tiny transformed-DOM
  // measurement noise before it can change composited glyph rasterization.
  const designPixel = (value: number) => Math.round(value * 64) / 64;
  if (focus && previousFocus && focus.startLine === previousFocus.startLine && focus.endLine === previousFocus.endLine) return designPixel(current.end);
  const fraction = Math.max(0, Math.min(1, elapsedTicks / Math.max(1, durationTicks)));
  const smooth = (value: number) => {const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t);};
  const traverse = smooth((fraction - .14) / .72);
  const enter = smooth(elapsedTicks / Math.max(1, Math.min(43_200, durationTicks * .14)));
  const offset = current.start + (current.end - current.start) * traverse;
  return designPixel(previous.end + (offset - previous.end) * enter);
}

/** Source-only layout: cues never change glyphs, wrapping, or row heights. */
export function layoutCodeBoardRows(code: string): readonly CodeBoardRow[] {
  return code.split('\n').flatMap((line, index) => wrapStoryCodeLine(line, CODE_BOARD_COLUMNS)
    .map((text, part) => ({number: index + 1, text, continuation: part > 0})));
}

/** Align the actual first wrapped row, then traverse an oversized range within its beat. */
export function sampleCodeBoardViewport(
  rows: readonly CodeBoardRow[],
  highlight: CodeBoardHighlight | undefined,
  elapsedTicks: number,
  durationTicks: number,
  visibleRows = CODE_BOARD_VISIBLE_ROWS,
) {
  const firstRow = highlight ? Math.max(0, rows.findIndex(row => row.number === highlight.startLine)) : 0;
  const lastRow = highlight
    ? rows.reduce((last, row, index) => row.number <= highlight.endLine ? index : last, firstRow)
    : Math.max(0, rows.length - 1);
  const distance = highlight ? Math.max(0, lastRow - firstRow + 1 - visibleRows) : 0;
  const fraction = Math.max(0, Math.min(1, elapsedTicks / Math.max(1, durationTicks)));
  // Hold the beginning and end long enough to read them; middle motion is sampled, never timed by DOM state.
  const t = Math.max(0, Math.min(1, (fraction - .14) / .72));
  const progress = t * t * (3 - 2 * t);
  const scrollRow = firstRow + distance * progress;
  const visibleStart = Math.min(rows.length - 1, Math.floor(scrollRow));
  const visibleEnd = Math.min(rows.length - 1, Math.ceil(scrollRow + visibleRows) - 1);
  return {firstRow, lastRow, scrollRow, offsetY: -scrollRow * CODE_BOARD_ROW_HEIGHT,
    firstSourceLine: rows[visibleStart]?.number ?? 1, lastSourceLine: rows[visibleEnd]?.number ?? 1};
}
