import { parseJson } from "@xue-learn/core/source/src/shared/utils.ts";

type SqStored = {
  survey?: { outline?: unknown; learningTargetLabels?: unknown };
  learningTargets?: unknown;
  questions?: unknown;
};

function hasQuestionText(item: unknown): boolean {
  if (typeof item === "string") return item.trim().length > 0;
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  const obj = item as Record<string, unknown>;
  return (
    (typeof obj.text === "string" && obj.text.trim().length > 0) ||
    (typeof obj.question === "string" && obj.question.trim().length > 0)
  );
}

/** True when session JSON has a non-empty questions list. */
export function hasValidSqPreview(sq3rData: string | null | undefined): boolean {
  if (!sq3rData?.trim()) return false;
  const data = parseJson<SqStored>(sq3rData, {});
  const questions = data.questions;
  return (
    Boolean(data.survey) &&
    Array.isArray(questions) &&
    questions.some(hasQuestionText)
  );
}
