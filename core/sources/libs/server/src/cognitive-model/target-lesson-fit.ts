import {
  getPromptLanguageLabel,
  resolveGoalContentLanguage,
} from "../llm/content-language.js";

export type LessonFitLearningTarget = {
  title: string;
  explanation?: string;
  learningObjective?: string;
  assessmentCriteria?: ReadonlyArray<string | { text?: string }>;
};

function criterionText(
  criterion: string | { text?: string } | undefined,
): string {
  if (typeof criterion === "string") return criterion;
  return typeof criterion?.text === "string" ? criterion.text : "";
}

export function learningTargetUserFacingText(
  target: LessonFitLearningTarget,
): string {
  const criteria = (target.assessmentCriteria ?? [])
    .map(criterionText)
    .filter(Boolean);
  return [
    target.title,
    target.explanation,
    target.learningObjective,
    ...criteria,
  ]
    .filter(
      (part): part is string =>
        typeof part === "string" && Boolean(part.trim()),
    )
    .join("\n");
}

/**
 * Keep the LearningTarget contract structurally usable. Goal language is an
 * authoring context shared by LLM requests, not a publication validator:
 * technical terms, quoted source text, and multilingual lessons make
 * character-count language detection too brittle for fail-closed generation.
 */
export function learningTargetLessonFitIssues(
  targets: ReadonlyArray<LessonFitLearningTarget>,
  params: {
    contentLanguage?: string | null;
    unitTitle: string;
    contentSummary?: string | null;
  },
): Array<{ index: number; message: string }> {
  void params;
  const issues: Array<{ index: number; message: string }> = [];

  targets.forEach((target, index) => {
    const text = learningTargetUserFacingText(target);
    if (!text.trim()) {
      issues.push({
        index,
        message: `LearningTarget ${index + 1} is missing user-facing lesson text`,
      });
      return;
    }
  });

  return issues;
}

export function lessonFitRepairInstruction(params: {
  contentLanguage?: string | null;
  unitTitle: string;
  contentSummary?: string | null;
}): string {
  const expected = resolveGoalContentLanguage(
    params.contentLanguage,
    `${params.unitTitle} ${params.contentSummary ?? ""}`,
  );
  const label = getPromptLanguageLabel(expected);
  const scope = params.contentSummary?.trim() || params.unitTitle;
  return `Rewrite title, explanation, learningObjective, and assessmentCriteria in ${label} so they assess only this lesson ("${params.unitTitle}" / ${scope}). Never invent an unrelated subject. Keep enum tokens in English.`;
}
