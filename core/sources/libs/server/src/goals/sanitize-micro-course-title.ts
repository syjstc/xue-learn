export const MICRO_COURSE_TITLE_PROMPT_RULE =
  "Titles must name the topic only—no duration, time limits, or marketing hooks (for example, \"finish in 30 minutes\", \"learn in half an hour\", or \"X-minute crash course\").";

const TIME_TITLE_SEGMENTS: RegExp[] = [
  /^\d+\s*分钟\s*(内)?\s*(搞定|学会|入门|掌握|速通|速成|了解|通关)?\s*/u,
  /^\d+\s*min(?:ute)?s?\s*(to\s+learn\s+|crash\s+course\s+)?/iu,
  /^半[个小]?时[钟]?\s*(内)?\s*(搞定|学会|入门|掌握)?\s*/u,
  /^一[个小]?时[钟]?\s*(内)?\s*(搞定|学会|入门|掌握)?\s*/u,
  /\s*\d+\s*分钟\s*/gu,
  /\s*\d+\s*min(?:ute)?s?\s*/giu,
  /\s*半[个小]?时[钟]?\s*/gu,
  /\s*[·•｜|]\s*\d+\s*分钟\s*$/u,
  /\s*[（(]\s*\d+\s*分钟\s*[)）]\s*$/u,
  /\s*[（(]\s*约\s*\d+\s*分钟\s*[)）]\s*$/u,
];

/** Strip duration/time marketing from micro-course goal or unit titles. */
export function sanitizeMicroCourseTitle(title: string): string {
  const original = title.trim();
  if (!original) return original;

  let result = original;
  for (const pattern of TIME_TITLE_SEGMENTS) {
    result = result.replace(pattern, "");
  }

  result = result
    .replace(/^[\s·•｜|：:]+/, "")
    .replace(/[\s·•｜|：:]+$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return result || original;
}
