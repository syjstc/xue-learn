import type { LearningTarget as SqLearningTarget } from "@xue-learn/core/source/src/shared/api/generated/sq-preview.ts";

/** Browser-safe helpers for the unit-local LearningTarget aliases in SQ. */
export type UnitLearningTarget = SqLearningTarget;

export type SqGuidingQuestion = {
  text: string;
  learningTargetIds?: string[];
};

export function sqQuestionTexts(
  questions: readonly SqGuidingQuestion[] | undefined | null,
): string[] {
  if (!questions?.length) return [];
  return questions
    .map((question) => question.text?.trim() ?? "")
    .filter(Boolean);
}

export function learningTargetLabels(
  targets: UnitLearningTarget[] | undefined | null,
): string[] {
  return (targets ?? []).map((target) => target.label).filter(Boolean);
}

export function resolveLearningTargetLabels(
  ids: string[] | undefined | null,
  targets: UnitLearningTarget[] | undefined | null,
): string[] {
  if (!ids?.length || !targets?.length) return [];
  const byId = new Map(targets.map((target) => [target.id, target.label]));
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const label = byId.get(id);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}
