import { sanitizeMicroCourseTitle } from "../../goals/sanitize-micro-course-title.js";

/**
 * Resolve the title shown on the confirmation card without starting another
 * model call during the persistence step.
 */
export function resolveConfirmedGoalTitle(input: {
  topic: string;
  refinedTitle: string;
  isSmallCourse: boolean;
}): string {
  const title = input.refinedTitle.trim() || input.topic.trim();
  return input.isSmallCourse ? sanitizeMicroCourseTitle(title) : title;
}
