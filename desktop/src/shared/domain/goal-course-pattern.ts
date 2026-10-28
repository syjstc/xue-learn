export const GOAL_COURSE_PATTERN_HEADER = "Goal-level course pattern";

export function extractGoalCoursePattern(
  generationOptions?: string | null,
): string {
  const text = generationOptions?.trim() ?? "";
  const start = text.indexOf(`${GOAL_COURSE_PATTERN_HEADER}:`);
  if (start < 0) return "";
  const afterHeader = text.slice(start + GOAL_COURSE_PATTERN_HEADER.length + 1);
  const stop = afterHeader.search(
    /\n\n(?:Current cognitive map|User adjustment request)/,
  );
  return (stop >= 0 ? afterHeader.slice(0, stop) : afterHeader).trim();
}
