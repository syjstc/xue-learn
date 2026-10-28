import { FEATURE_FEYNMAN } from "./features.js";

export type PostQuizStep = "feynman" | "socratic" | "complete";

/** Next step after quiz grading; skips Feynman when that feature is off. */
export function postQuizNextStep(
  score: number,
  practiceAfterCompletion = false,
): PostQuizStep {
  if (score < 0.7) return "socratic";
  if (!FEATURE_FEYNMAN) return practiceAfterCompletion ? "socratic" : "complete";
  return "feynman";
}
