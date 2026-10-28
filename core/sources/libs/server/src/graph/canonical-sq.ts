import type { SqPreview } from "../llm/schemas.js";
import { learningTargetLessonFitIssues } from "../cognitive-model/target-lesson-fit.js";

export type CanonicalSqlearningTarget = {
  id: string;
  localRef: string;
  title: string;
  description?: string;
  explanation?: string;
  learningObjective: string;
  assessmentCriteria: string[];
  requirements?: Array<{ entityId: string }>;
  importance: string;
  importanceWeight: number;
  difficulty: string;
  targetCognitiveLevel: string;
  rationale?: string;
  isEntry: boolean;
  isExit: boolean;
};

export function assertCanonicalLearningTargetsFitLesson(
  canonicalPoints: CanonicalSqlearningTarget[],
  params: {
    contentLanguage?: string | null;
    unitTitle: string;
    contentSummary?: string | null;
  },
): void {
  if (canonicalPoints.length === 0) return;
  const issues = learningTargetLessonFitIssues(
    canonicalPoints.map((point) => ({
      title: point.title,
      explanation: point.description ?? point.explanation,
      learningObjective: point.learningObjective,
      assessmentCriteria: point.assessmentCriteria,
    })),
    params,
  );
  if (issues.length > 0) {
    throw new Error(issues.map((issue) => issue.message).join("; "));
  }
}

export function normalizeSectionOutlineCheckpoints<
  T extends { checkpointAfter: boolean },
>(items: T[]): T[] {
  if (items.length === 0) return items;
  const groupSizes: number[] = [];
  let groupSize = 0;
  items.forEach((item, index) => {
    groupSize += 1;
    if (item.checkpointAfter || groupSize === 3 || index === items.length - 1) {
      groupSizes.push(groupSize);
      groupSize = 0;
    }
  });

  for (let index = 0; index < groupSizes.length; index += 1) {
    if (groupSizes[index] !== 1) continue;
    if (index > 0 && groupSizes[index - 1]! < 3) {
      groupSizes[index - 1]! += 1;
      groupSizes.splice(index, 1);
      index -= 1;
      continue;
    }
    if (index + 1 < groupSizes.length && groupSizes[index + 1]! < 3) {
      groupSizes[index + 1]! += 1;
      groupSizes.splice(index, 1);
      index -= 1;
    }
  }
  if (
    groupSizes.length >= 2 &&
    groupSizes.at(-1) === 1 &&
    groupSizes.at(-2) === 3
  ) {
    groupSizes[groupSizes.length - 2] = 2;
    groupSizes[groupSizes.length - 1] = 2;
  }
  if (groupSizes.length >= 2 && groupSizes[0] === 1 && groupSizes[1] === 3) {
    groupSizes[0] = 2;
    groupSizes[1] = 2;
  }

  const checkpointIndexes = new Set<number>();
  let endIndex = -1;
  for (const size of groupSizes) {
    endIndex += size;
    checkpointIndexes.add(endIndex);
  }
  return items.map((item, index) => ({
    ...item,
    checkpointAfter: checkpointIndexes.has(index),
  }));
}

function normalizeSectionOutline(
  sq: SqPreview,
  canonicalPoints: CanonicalSqlearningTarget[],
): NonNullable<SqPreview["survey"]["sectionOutline"]> {
  const canonicalRefs = new Set(canonicalPoints.map((point) => point.localRef));
  const source = (sq.survey.sectionOutline ?? []).slice(0, 8);
  const normalized = source.map((item) => ({
    title: item.title.trim(),
    scope: item.scope.trim() || item.title.trim(),
    learningTargetIds: [
      ...new Set(item.learningTargetIds.filter((id) => canonicalRefs.has(id))),
    ],
    checkpointAfter: item.checkpointAfter,
  }));
  if (normalized.length === 0) {
    normalized.push({
      title: sq.survey.outline[0]?.trim() || canonicalPoints[0]!.title,
      scope:
        sq.survey.outline[0]?.trim() ||
        canonicalPoints[0]!.description ||
        canonicalPoints[0]!.learningObjective,
      learningTargetIds: [],
      checkpointAfter: false,
    });
  }
  if (normalized.length === 1) {
    normalized.push({
      title: `${normalized[0]!.title}：应用与巩固`,
      scope: `通过例子、应用或辨析巩固${normalized[0]!.title}`,
      learningTargetIds: [],
      checkpointAfter: true,
    });
  }

  canonicalPoints.forEach((point, targetIndex) => {
    if (
      normalized.some((item) => item.learningTargetIds.includes(point.localRef))
    ) {
      return;
    }
    const sectionIndex = Math.min(
      normalized.length - 1,
      Math.floor((targetIndex * normalized.length) / canonicalPoints.length),
    );
    normalized[sectionIndex]!.learningTargetIds.push(point.localRef);
  });
  normalized.forEach((item, index) => {
    if (item.learningTargetIds.length > 0) return;
    const targetIndex = Math.min(
      canonicalPoints.length - 1,
      Math.floor((index * canonicalPoints.length) / normalized.length),
    );
    item.learningTargetIds.push(canonicalPoints[targetIndex]!.localRef);
  });
  return normalizeSectionOutlineCheckpoints(normalized);
}

/**
 * Overlay the durable learning-target spine on an SQ preview.
 *
 * The model may stream learning-target lines in a different order while it is composing the
 * survey. Learners must never observe that draft order: SQ owns the outline and
 * guiding questions, while the published model owns target identity, definition, and
 * order.
 */
export function applyCanonicalLearningTargetsToSq(
  sq: SqPreview,
  canonicalPoints: CanonicalSqlearningTarget[],
  lesson?: {
    contentLanguage?: string | null;
    unitTitle: string;
    contentSummary?: string | null;
  },
): SqPreview {
  if (canonicalPoints.length === 0) return sq;
  if (lesson) {
    assertCanonicalLearningTargetsFitLesson(canonicalPoints, lesson);
  }

  const canonicalRefs = new Set(canonicalPoints.map((point) => point.localRef));
  const controlledImportance = (value: string) => {
    if (value === "core" || value === "supporting" || value === "enrichment") {
      return value;
    }
    throw new Error(`Invalid LearningTarget importance: ${value}`);
  };
  const controlledDifficulty = (value: string) => {
    if (value === "easy" || value === "medium" || value === "hard")
      return value;
    throw new Error(`Invalid LearningTarget difficulty: ${value}`);
  };
  const controlledCognitiveLevel = (value: string | undefined) => {
    if (
      value === "remember" ||
      value === "understand" ||
      value === "apply" ||
      value === "analyze" ||
      value === "evaluate" ||
      value === "create"
    ) {
      return value;
    }
    throw new Error(
      `Invalid LearningTarget cognitive level: ${value ?? "missing"}`,
    );
  };
  const sectionOutline = sq.survey.sectionOutline
    ? normalizeSectionOutline(sq, canonicalPoints)
    : undefined;

  return {
    ...sq,
    survey: {
      ...sq.survey,
      ...(sectionOutline
        ? {
            outline: sectionOutline.map((item) => item.title),
            sectionOutline,
          }
        : {}),
      learningTargetLabels: canonicalPoints.map((point) => point.title),
    },
    learningTargets: canonicalPoints.map((point) => ({
      id: point.localRef,
      durableId: point.id,
      cognitiveEntityIds: point.requirements?.map(
        (requirement) => requirement.entityId,
      ),
      label: point.title,
      explanation: point.description ?? point.explanation,
      learningObjective: point.learningObjective,
      assessmentCriteria: point.assessmentCriteria,
      importance: controlledImportance(point.importance),
      importanceWeight: point.importanceWeight,
      difficulty: controlledDifficulty(point.difficulty),
      targetCognitiveLevel: controlledCognitiveLevel(
        point.targetCognitiveLevel,
      ),
      rationale: point.rationale ?? "",
      isEntry: point.isEntry,
      isExit: point.isExit,
    })),
    questions: sq.questions.map((question) => {
      const learningTargetIds = question.learningTargetIds;
      if (
        !Array.isArray(learningTargetIds) ||
        learningTargetIds.length === 0 ||
        learningTargetIds.some((id) => !canonicalRefs.has(id))
      ) {
        throw new Error("SQ question cites an undeclared LearningTarget");
      }
      return {
        ...question,
        learningTargetIds,
      };
    }),
  };
}
