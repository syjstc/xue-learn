import {
  learningTargetLabels,
  normalizeSqGuidingQuestions,
  normalizeUnitLearningTargets,
  type SqGuidingQuestion,
} from "../domain/learning-targets.js";
import { optionalSectionContentKind } from "../survey/authoring.js";
import { expandSq3rCompact } from "./compact-json.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) =>
    typeof item === "string" && item.trim() ? [item.trim()] : [],
  );
}

function validQuestions(
  value: unknown,
  validTargetRefs: ReadonlySet<string>,
): SqGuidingQuestion[] {
  const seen = new Set<string>();
  return normalizeSqGuidingQuestions(value)
    .flatMap((question) => {
      const learningTargetIds = question.learningTargetIds.filter((id) =>
        validTargetRefs.has(id),
      );
      if (learningTargetIds.length === 0 || seen.has(question.text)) return [];
      seen.add(question.text);
      return [{ ...question, learningTargetIds }];
    })
    .slice(0, 8);
}

function validSectionOutline(
  value: unknown,
  validTargetRefs: ReadonlySet<string>,
) {
  if (!Array.isArray(value)) return undefined;
  const items = value.slice(0, 8).flatMap((entry) => {
    const item = asRecord(entry);
    const title = typeof item?.title === "string" ? item.title.trim() : "";
    const scope = typeof item?.scope === "string" ? item.scope.trim() : "";
    const learningTargetIds = Array.isArray(item?.learningTargetIds)
      ? [
          ...new Set(
            item.learningTargetIds.filter(
              (id): id is string =>
                typeof id === "string" && validTargetRefs.has(id),
            ),
          ),
        ]
      : [];
    if (!title || !scope || learningTargetIds.length === 0) return [];
    return [
      {
        title,
        scope,
        learningTargetIds,
        checkpointAfter: item?.checkpointAfter === true,
        ...optionalSectionContentKind(item?.contentKind),
      },
    ];
  });
  return items.length >= 2 ? items : undefined;
}

function validSectionPlan(value: unknown, outlineLength: number) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) {
    return undefined;
  }
  let expectedOutlineIndex = 0;
  const sections = value.flatMap((entry) => {
    const item = asRecord(entry);
    const title = typeof item?.title === "string" ? item.title.trim() : "";
    const scope = typeof item?.scope === "string" ? item.scope.trim() : "";
    const outlineIndexes = Array.isArray(item?.outlineIndexes)
      ? item.outlineIndexes
      : [];
    if (!title || !scope || outlineIndexes.length === 0) return [];
    for (const outlineIndex of outlineIndexes) {
      if (
        !Number.isInteger(outlineIndex) ||
        outlineIndex !== expectedOutlineIndex
      ) {
        return [];
      }
      expectedOutlineIndex += 1;
    }
    return [
      {
        title,
        scope,
        outlineIndexes: outlineIndexes as number[],
        ...optionalSectionContentKind(item?.contentKind),
      },
    ];
  });
  return sections.length === value.length &&
    expectedOutlineIndex === outlineLength
    ? sections
    : undefined;
}

/**
 * Normalize only the current SQ contract. Published LearningTargets are
 * mandatory: this layer never invents a target, silently rebinds a question,
 * or infers section bindings from outline text.
 */
export function normalizeSq3rPayload(data: unknown): Record<string, unknown> {
  const root = asRecord(expandSq3rCompact(data)) ?? {};
  const survey = asRecord(root.survey) ?? {};
  const learningTargets = normalizeUnitLearningTargets(root.learningTargets);
  const validTargetRefs = new Set(learningTargets.map((target) => target.id));
  const sectionOutline = validSectionOutline(
    survey.sectionOutline,
    validTargetRefs,
  );
  const outline = sectionOutline
    ? sectionOutline.map((item) => item.title)
    : asStringArray(survey.outline);
  const sectionPlan = sectionOutline
    ? undefined
    : validSectionPlan(survey.sectionPlan, outline.length);

  return {
    survey: {
      outline,
      ...optionalSectionContentKind(survey.contentKind),
      ...(sectionOutline ? { sectionOutline } : {}),
      ...(sectionPlan ? { sectionPlan } : {}),
      learningTargetLabels: learningTargetLabels(learningTargets),
    },
    learningTargets,
    questions: validQuestions(root.questions, validTargetRefs),
    readHighlights: asStringArray(root.readHighlights),
    recitePrompts: asStringArray(root.recitePrompts),
    reviewSummary:
      typeof root.reviewSummary === "string" ? root.reviewSummary.trim() : "",
  };
}
