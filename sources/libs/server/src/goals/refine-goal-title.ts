import { sanitizeMicroCourseTitle } from "./sanitize-micro-course-title.js";

/** Max length for a goal card title before we ask the LLM to shorten it. */
export const GOAL_TITLE_MAX_CHARS = 40;

/** Whether the topic still needs an LLM-refined short title. */
export function goalTitleNeedsRefinement(
  topic: string,
  refinedTitle?: string | null,
): boolean {
  const raw = topic.trim();
  const refined = (refinedTitle ?? "").trim();
  if (!raw) return false;
  if (!refined) return true;
  if (refined === raw) return true;
  if (refined.length > GOAL_TITLE_MAX_CHARS) return true;
  if (
    raw.length > GOAL_TITLE_MAX_CHARS &&
    refined.length >= raw.length * 0.9
  ) {
    return true;
  }
  return false;
}

/** Normalize and decide whether to apply an LLM-suggested goal title. */
export function resolveRefinedGoalTitle(
  original: string,
  refined?: string | null
): { title: string; changed: boolean } {
  const orig = original.trim();
  const candidate = (refined ?? "").trim();
  if (!candidate) {
    return { title: orig, changed: false };
  }
  if (candidate === orig) {
    return { title: orig, changed: false };
  }
  if (
    orig.length > GOAL_TITLE_MAX_CHARS &&
    candidate.length <= GOAL_TITLE_MAX_CHARS
  ) {
    return { title: candidate, changed: true };
  }
  return { title: candidate, changed: true };
}

/** Resolve and sanitize a micro-course goal title. */
export function resolveMicroCourseGoalTitle(
  original: string,
  refined?: string | null,
): { title: string; changed: boolean } {
  const resolved = resolveRefinedGoalTitle(original, refined);
  const title = sanitizeMicroCourseTitle(resolved.title);
  return {
    title,
    changed: title !== original.trim(),
  };
}
