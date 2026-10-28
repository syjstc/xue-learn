import { FEATURE_COURSE_PATTERN } from "../features.js";
import { stripLearnerProfilePromptBlock } from "../persona/learner-profile.js";

export const SMALL_COURSE_GENERATION_OPTIONS =
  "Course size: micro-course. Generate one learning unit only; do not expand a learning map or detailed plan. Focus on core points.";

export const INSTANT_MICRO_GENERATION_OPTIONS =
  "Course mode: instant micro-course. Create without questions; infer level and prerequisites from the learner profile. For broad topics, still teach core concepts with definitions, examples, and a short exercise rather than producing only an outline.";

export const GOAL_COURSE_PATTERN_HEADER = "Goal-level course pattern";
export function hasGoalCoursePattern(
  generationOptions: string | null | undefined,
): boolean {
  return (generationOptions ?? "").includes(`${GOAL_COURSE_PATTERN_HEADER}:`);
}

export function stripGoalCoursePattern(
  generationOptions: string | null | undefined,
): string {
  const text = generationOptions?.trim() ?? "";
  const start = text.indexOf(`${GOAL_COURSE_PATTERN_HEADER}:`);
  if (start < 0) return text;

  const before = text.slice(0, start).trimEnd();
  const afterHeader = text.slice(start + GOAL_COURSE_PATTERN_HEADER.length + 1);
  const nextSection = afterHeader.search(
    /\n\n(?:Current cognitive map|User adjustment request)/,
  );
  const after =
    nextSection >= 0 ? afterHeader.slice(nextSection).trimStart() : "";
  return [before, after].filter(Boolean).join("\n\n").trim();
}

/** Merge user notes with structured flags (e.g. small course) for persistence and prompts. */
export function resolveGoalGenerationOptions(
  generationOptions: string | null | undefined,
  isSmallCourse?: boolean,
): string {
  const parts = [stripGoalCoursePattern(generationOptions)].filter(
    Boolean,
  ) as string[];
  if (isSmallCourse) {
    parts.push(SMALL_COURSE_GENERATION_OPTIONS);
  }
  return parts.join("\n");
}

export function extractGoalCoursePattern(
  generationOptions: string | null | undefined,
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

export function appendGoalCoursePattern(
  generationOptions: string | null | undefined,
  coursePattern: string | null | undefined,
): string {
  const base = generationOptions?.trim() ?? "";
  const pattern = coursePattern?.trim() ?? "";
  if (!pattern || hasGoalCoursePattern(base)) return base;
  return [base, `${GOAL_COURSE_PATTERN_HEADER}:\n${pattern}`]
    .filter(Boolean)
    .join("\n\n");
}

export function replaceGoalCoursePattern(
  generationOptions: string | null | undefined,
  coursePattern: string | null | undefined,
): string {
  const base = stripGoalCoursePattern(generationOptions);
  const pattern = coursePattern?.trim() ?? "";
  if (!pattern) return base;
  return appendGoalCoursePattern(base, pattern);
}

/** Merge base generation options with a one-off user adjustment for regeneration flows. */
export function mergeRegenerationAdjustment(
  generationOptions: string | null | undefined,
  adjustment: string | null | undefined,
  label: string,
): string {
  const parts = [generationOptions?.trim()].filter(Boolean) as string[];
  const trimmed = adjustment?.trim();
  if (trimmed) {
    parts.push(`${label}:\n${trimmed}`);
  }
  return parts.join("\n\n");
}

/** Options for full cognitive map regeneration (current map + user instructions). */
export function mergeMapRegenerationOptions(
  generationOptions: string | null | undefined,
  params: { currentMap?: string; adjustment?: string },
): string {
  const parts = [generationOptions?.trim()].filter(Boolean) as string[];
  const currentMap = params.currentMap?.trim();
  if (currentMap) {
    parts.push(
      `Current cognitive map (regenerate a revised map; preserve what works unless user instructions say otherwise):\n${currentMap}`,
    );
  }
  const adjustment = params.adjustment?.trim();
  if (adjustment) {
    parts.push(`User adjustment request for map regeneration:\n${adjustment}`);
  }
  return parts.join("\n\n");
}

/** Prompt block from user-provided goal generation preferences. */
export function getGenerationOptionsPromptBlock(
  options: string | null | undefined,
): string {
  const withoutLearnerProfile = stripLearnerProfilePromptBlock(options);
  const trimmed =
    (FEATURE_COURSE_PATTERN
      ? withoutLearnerProfile
      : stripGoalCoursePattern(withoutLearnerProfile)
    )?.trim() ?? "";
  if (!trimmed) return "";
  const coursePatternHint = FEATURE_COURSE_PATTERN
    ? `If this contains a "${GOAL_COURSE_PATTERN_HEADER}", treat it as the goal's global structure plus context reuse policy: keep similar units consistent in block usage, sequence, examples, and practice shape, and follow its Context reuse rules so shared background (author biography, era, grammar family, shared technique, etc.) is introduced once—not reteached in every unit. Later units should only briefly reference shared context when needed and focus on the current unit's unique learning task. Do not treat it as a style preference; user-selected style controls tone separately.
Repeated background should not be retaught in every unit unless the current unit genuinely needs a new angle on that background.
`
    : "";
  return `User content preferences (follow closely unless they conflict with factual accuracy or fixed JSON structure):
${trimmed}
${coursePatternHint}Apply to map scope, unit breakdown, depth, coverage boundaries, lesson structure, examples, and tone where relevant. Do not violate hard system rules or invent false facts to satisfy preferences.`;
}
