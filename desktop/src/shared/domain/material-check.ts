export type MaterialCheckQuestionType = "mcq" | "mcq_multi" | "true_false";

/**
 * Resolve the learner-facing check interaction mode.
 * Prefer an explicit questionType; when omitted (legacy / partial payloads),
 * infer from the answer fields so select-all checks are not treated as single-choice.
 */
export function resolveMaterialCheckQuestionType(
  block: Record<string, unknown>,
): MaterialCheckQuestionType {
  const raw = block.questionType;
  if (raw === "true_false" || raw === "mcq_multi" || raw === "mcq") {
    // Explicit mcq with a multi answer key is almost always a label mistake —
    // trust the answer shape so "select all" stays multi-select in the UI.
    if (
      raw === "mcq" &&
      Array.isArray(block.correctIndices) &&
      block.correctIndices.filter((item): item is number => typeof item === "number")
        .length >= 2
    ) {
      return "mcq_multi";
    }
    return raw;
  }
  if (typeof block.correctAnswer === "boolean") return "true_false";
  if (
    Array.isArray(block.correctIndices) &&
    block.correctIndices.filter((item): item is number => typeof item === "number")
      .length >= 2
  ) {
    return "mcq_multi";
  }
  return "mcq";
}
