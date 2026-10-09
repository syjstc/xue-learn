import {
  MaterialReplacementStaleRevisionError,
  type AssessmentTargetRecord,
  type LearnerStateMemoryInvalidationRepository,
  type MaterialCheckCompletionRepository,
  type MaterialReplacementRepository,
  type SectionMaterialReplacementRepository,
  type UnitLearningProgressReset,
} from "../../../domain/src/index.js";
import { buildMaterialCheckTaskDeclarations } from "../assessment/activities.js";
import { refreshUnitLearningProgressReset } from "../domain/reset-unit-learning.js";
import { parseSessionGraphState } from "./review-mode.js";
import {
  sanitizeLearningMaterialText,
  serializeLearningMaterialBlocks,
  serializeLearningMaterialKeyTakeaways,
} from "./unit-session.js";
import type { MaterialJitItem } from "../llm/jit-structured-items.js";
import type { LearningMaterialContent } from "../llm/schemas.js";
import { recordBackendError } from "../observability/index.js";

/**
 * Remove state derived from the previous material while retaining unrelated
 * activity/time bookkeeping. The transaction-owned repository performs the
 * durable reset and publication; this is only the session-graph projection.
 */
export function graphStateForMaterialReplacement(
  state: ReturnType<typeof parseSessionGraphState>,
  materialSourceItems: readonly MaterialJitItem[],
) {
  const {
    reviewMode: _reviewMode,
    quiz: _quiz,
    quizSetId: _quizSetId,
    quizAttemptId: _quizAttemptId,
    score: _score,
    weakTags: _weakTags,
    weakLearningTargetIds: _weakLearningTargetIds,
    quizResults: _quizResults,
    feynmanFeedback: _feynmanFeedback,
    socraticQuestion: _socraticQuestion,
    socraticThreads: _socraticThreads,
    activeSocraticThreadId: _activeSocraticThreadId,
    drills: _drills,
    materialPresentation: _materialPresentation,
    sqQuestionAnswers: _sqQuestionAnswers,
    materialDslText: _materialDslText,
    materialDslParseError: _materialDslParseError,
    materialSourceItems: _previousMaterialSourceItems,
    ...retained
  } = state;
  return { ...retained, materialSourceItems: [...materialSourceItems] };
}

export type CommitLearningMaterialReplacementParams = {
  materialReplacement: MaterialReplacementRepository;
  assessmentTargets?: readonly AssessmentTargetRecord[];
  learnerStateMemoryInvalidation?: LearnerStateMemoryInvalidationRepository;
  userId: string;
  goalId: string;
  unitId: string;
  material: LearningMaterialContent;
  materialSourceItems: readonly MaterialJitItem[];
  contextSourcesJson?: string;
  sq3rData?: string;
  publishChecks?: boolean;
  resetProgress?: boolean;
  clearDownstream?: boolean;
  deleteFollowUpThreadId?: string;
  expectedContentRevision?: number;
};

export type CommitLearningMaterialReplacementResult = {
  contentRevision: number;
  reset: UnitLearningProgressReset;
};

export type CommitUnitSectionMaterialReplacementParams = {
  sectionMaterialReplacement: SectionMaterialReplacementRepository;
  assessmentTargets?: readonly AssessmentTargetRecord[];
  learnerStateMemoryInvalidation?: LearnerStateMemoryInvalidationRepository;
  userId: string;
  goalId: string;
  unitId: string;
  sectionId: string;
  sectionMaterial: LearningMaterialContent;
  aggregatedMaterial: LearningMaterialContent;
  sectionSourceItems: readonly MaterialJitItem[];
  aggregatedSourceItems: readonly MaterialJitItem[];
  contextSourcesJson: string;
  deleteFollowUpThreadId: string;
  expectedContentRevision: number;
  expectedSectionContentRevision: number;
};

async function invalidateAfterCommit(
  result: UnitLearningProgressReset,
  invalidation: LearnerStateMemoryInvalidationRepository | undefined,
  unitId: string,
): Promise<void> {
  try {
    await refreshUnitLearningProgressReset(result, invalidation);
  } catch (error) {
    console.error(
      `[learning] post-commit learner-memory invalidation failed unit=${unitId}`,
      error instanceof Error ? error.message : error,
    );
    void recordBackendError({
      source: "internal",
      service: "learning-service",
      error,
      operation: "post-commit-learner-memory-invalidation",
    });
  }
}

/** Commit a follow-up rewrite into one first-class section. */
export async function commitUnitSectionMaterialReplacement(
  params: CommitUnitSectionMaterialReplacementParams,
): Promise<CommitLearningMaterialReplacementResult> {
  const materialCheckTasks = await buildMaterialCheckTaskDeclarations({
    userId: params.userId,
    goalId: params.goalId,
    unitId: params.unitId,
    material: params.aggregatedMaterial,
    targets: params.assessmentTargets,
  });
  try {
    const result = await params.sectionMaterialReplacement.replaceSection({
      userId: params.userId,
      goalId: params.goalId,
      unitId: params.unitId,
      sectionId: params.sectionId,
      sectionMaterial: {
        introduction: sanitizeLearningMaterialText(
          params.sectionMaterial.introduction,
        ),
        sections: serializeLearningMaterialBlocks(params.sectionMaterial),
        keyTakeaways: serializeLearningMaterialKeyTakeaways(
          params.sectionMaterial.keyTakeaways,
        ),
        contextSources: params.contextSourcesJson,
        sourceItemsJson: JSON.stringify(params.sectionSourceItems),
      },
      aggregatedMaterial: {
        introduction: sanitizeLearningMaterialText(
          params.aggregatedMaterial.introduction,
        ),
        sections: serializeLearningMaterialBlocks(params.aggregatedMaterial),
        keyTakeaways: serializeLearningMaterialKeyTakeaways(
          params.aggregatedMaterial.keyTakeaways,
        ),
        contextSources: params.contextSourcesJson,
        sourceItemsJson: JSON.stringify(params.aggregatedSourceItems),
      },
      publishChecks: true,
      materialCheckTasks,
      resetProgress: true,
      clearDownstream: true,
      deleteFollowUpThreadId: params.deleteFollowUpThreadId,
      expectedContentRevision: params.expectedContentRevision,
      expectedSectionContentRevision: params.expectedSectionContentRevision,
    });
    await invalidateAfterCommit(
      result.reset,
      params.learnerStateMemoryInvalidation,
      params.unitId,
    );
    return result;
  } catch (error) {
    if (error instanceof MaterialReplacementStaleRevisionError) {
      throw new StaleMaterialRevisionError(
        error.expectedContentRevision,
        error.currentContentRevision,
      );
    }
    throw error;
  }
}

/** Commit a fully validated replacement and all authoritative side effects. */
export async function commitLearningMaterialReplacement(
  params: CommitLearningMaterialReplacementParams,
): Promise<CommitLearningMaterialReplacementResult> {
  const materialCheckTasks =
    params.publishChecks !== false
      ? await buildMaterialCheckTaskDeclarations({
          userId: params.userId,
          goalId: params.goalId,
          unitId: params.unitId,
          material: params.material,
          targets: params.assessmentTargets,
        })
      : [];
  try {
    const result = await params.materialReplacement.replace({
      userId: params.userId,
      goalId: params.goalId,
      unitId: params.unitId,
      material: {
        introduction: sanitizeLearningMaterialText(
          params.material.introduction,
        ),
        sections: serializeLearningMaterialBlocks(params.material),
        keyTakeaways: serializeLearningMaterialKeyTakeaways(
          params.material.keyTakeaways,
        ),
        contextSources: params.contextSourcesJson ?? "[]",
        sourceItemsJson: JSON.stringify(params.materialSourceItems),
      },
      sq3rData: params.sq3rData,
      publishChecks: params.publishChecks !== false,
      materialCheckTasks,
      resetProgress: params.resetProgress !== false,
      clearDownstream: params.clearDownstream !== false,
      deleteFollowUpThreadId: params.deleteFollowUpThreadId,
      expectedContentRevision: params.expectedContentRevision,
    });
    await invalidateAfterCommit(
      result.reset,
      params.learnerStateMemoryInvalidation,
      params.unitId,
    );
    return result;
  } catch (error) {
    if (error instanceof MaterialReplacementStaleRevisionError) {
      throw new StaleMaterialRevisionError(
        error.expectedContentRevision,
        error.currentContentRevision,
      );
    }
    throw error;
  }
}

/** Publish deferred checks only while the authored material remains current. */
export async function publishMaterialChecksForCurrentGeneration(params: {
  materialCheckCompletion: MaterialCheckCompletionRepository;
  assessmentTargets?: readonly AssessmentTargetRecord[];
  userId: string;
  goalId: string;
  unitId: string;
  expectedMaterial: LearningMaterialContent;
}): Promise<boolean> {
  const tasks = await buildMaterialCheckTaskDeclarations({
    userId: params.userId,
    goalId: params.goalId,
    unitId: params.unitId,
    material: params.expectedMaterial,
    targets: params.assessmentTargets,
  });
  return params.materialCheckCompletion.publishTasksIfMaterialMatches({
    userId: params.userId,
    goalId: params.goalId,
    unitId: params.unitId,
    expectedMaterial: {
      introduction: sanitizeLearningMaterialText(
        params.expectedMaterial.introduction,
      ),
      sections: serializeLearningMaterialBlocks(params.expectedMaterial),
      keyTakeaways: serializeLearningMaterialKeyTakeaways(
        params.expectedMaterial.keyTakeaways,
      ),
    },
    tasks,
  });
}

export class StaleMaterialRevisionError extends Error {
  constructor(
    readonly expectedContentRevision?: number,
    readonly currentContentRevision?: number,
  ) {
    super("正文已更新，请重新发起本次操作");
    this.name = "StaleMaterialRevisionError";
  }
}
