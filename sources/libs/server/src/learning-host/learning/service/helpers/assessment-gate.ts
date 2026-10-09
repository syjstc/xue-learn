import { BadRequestException, NotFoundException } from "@nestjs/common";
import { tBackend } from "../../../../../../common/src/index.js";
import type {
  CognitiveModelPresentationReadRepository,
  CognitiveModelGenerationRunRepository,
  CognitiveModelPublicationFinalizationRepository,
  LearnerStateMemoryInvalidationRepository,
} from "../../../../../../domain/src/index.js";
import {
  deriveLearningAccess,
  getUnitLearningTargetsV2,
  type LearningAccess,
} from "../../../../cognitive-model/index.js";
import { parseJson } from "../../../../utils.js";

export async function getUnitLearningAccess(
  unit: {
    id: string;
    goalId?: string;
    userId?: string;
    cognitiveModelStatus: string;
    cognitiveModelBuildInputHash: string | null;
    goal: {
      goalKind: string;
      learningMode: string;
      cognitiveModelStatus: string;
      cognitiveModelInputHash: string;
      cognitiveModelPublishedHash: string | null;
    };
    module?: {
      unlockStatus: string | null;
      generationStatus: string | null;
    } | null;
    canonicalTargetCount: number;
    hasCanonicalContent: boolean;
  },
  generationRun?: CognitiveModelGenerationRunRepository,
  publicationFinalization?: CognitiveModelPublicationFinalizationRepository,
  learnerStateMemoryInvalidation?: LearnerStateMemoryInvalidationRepository,
  presentationRead?: CognitiveModelPresentationReadRepository,
): Promise<LearningAccess> {
  if (!generationRun || !presentationRead) {
    throw new Error("Assessment-gate persistence is not configured");
  }
  if (
    unit.goal.goalKind === "micro" ||
    unit.goal.learningMode === "exploration"
  ) {
    return deriveLearningAccess({
      goalKind: unit.goal.goalKind,
      learningMode: unit.goal.learningMode,
      unitStatus: unit.cognitiveModelStatus,
      hasCanonicalContent: unit.hasCanonicalContent,
    });
  }

  let { learningTargets: publishedTargets } = await getUnitLearningTargetsV2(
    undefined,
    unit.id,
    { presentationRead },
  );
  if (
    publishedTargets.length === 0 &&
    unit.cognitiveModelStatus === "expanded" &&
    unit.cognitiveModelBuildInputHash === unit.goal.cognitiveModelInputHash &&
    unit.goal.cognitiveModelPublishedHash ===
      unit.goal.cognitiveModelInputHash &&
    unit.canonicalTargetCount > 0
  ) {
    // Deployments may encounter units expanded under the former goal-wide
    // publication barrier. This is generation-free for an expanded unit and
    // atomically promotes its persisted slice before access is evaluated.
    if (!publicationFinalization || !unit.goalId) {
      throw new Error("Cognitive-model publication finalization is not configured");
    }
    const promoted = await publicationFinalization.promoteExisting({
      goalId: unit.goalId,
      unitId: unit.id,
      inputHash: unit.goal.cognitiveModelInputHash,
    });
    if (promoted?.published && unit.userId && learnerStateMemoryInvalidation) {
      await learnerStateMemoryInvalidation.invalidate({
        userId: unit.userId,
        reason: "cognitive_model_published",
      });
    }
    ({ learningTargets: publishedTargets } = await getUnitLearningTargetsV2(
      undefined,
      unit.id,
      { presentationRead },
    ));
  }
  const run = await generationRun.findLatest({
    unitId: unit.id,
    statuses: ["running"],
  });
  const eventPayload = run
    ? (
        await generationRun.readLatestEvent({
          runId: run.id,
          type: "learning_access",
        })
      )?.payloadJson
    : undefined;
  const event = eventPayload
    ? parseJson<{ access?: { modelPhase?: string; prefixHash?: string } }>(
        eventPayload,
        {},
      )
    : null;

  return deriveLearningAccess({
    goalKind: unit.goal.goalKind,
    learningMode: unit.goal.learningMode,
    unitStatus: unit.cognitiveModelStatus,
    goalStatus: unit.goal.cognitiveModelStatus,
    goalInputHash: unit.goal.cognitiveModelInputHash,
    goalPublishedHash: unit.goal.cognitiveModelPublishedHash,
    buildInputHash: unit.cognitiveModelBuildInputHash,
    hasCanonicalTargets: publishedTargets.length > 0,
    hasCanonicalTargetsFallback: unit.canonicalTargetCount > 0,
    hasCanonicalContent: unit.hasCanonicalContent,
    targetsReady: event?.access?.modelPhase === "targets_ready",
    activeRunId: run?.id,
    prefixHash: event?.access?.prefixHash,
    unitModuleUnlockStatus: unit.module?.unlockStatus ?? null,
    unitModuleGenerationStatus: unit.module?.generationStatus ?? null,
  });
}

export async function assertUnitAssessmentReady(
  unitId: string,
  generationRun?: CognitiveModelGenerationRunRepository,
  publicationFinalization?: CognitiveModelPublicationFinalizationRepository,
  learnerStateMemoryInvalidation?: LearnerStateMemoryInvalidationRepository,
  presentationRead?: CognitiveModelPresentationReadRepository,
): Promise<void> {
  if (!presentationRead) {
    throw new Error("Assessment-gate presentation read is not configured");
  }
  const unit = await presentationRead.findUnit({ unitId });
  if (!unit) throw new NotFoundException(tBackend("error.goal.unitNotFound"));
  const access = await getUnitLearningAccess(
    {
      id: unitId,
      goalId: unit.goalId,
      cognitiveModelStatus: unit.cognitiveModelStatus,
      cognitiveModelBuildInputHash: unit.cognitiveModelBuildInputHash,
      goal: {
        goalKind: unit.goalKind,
        learningMode: unit.learningMode,
        cognitiveModelStatus: unit.goalCognitiveModelStatus,
        cognitiveModelInputHash: unit.goalCognitiveModelInputHash,
        cognitiveModelPublishedHash: unit.goalCognitiveModelPublishedHash,
      },
      module: {
        unlockStatus: unit.moduleUnlockStatus,
        generationStatus: unit.moduleGenerationStatus,
      },
      canonicalTargetCount: unit.canonicalTargetCount,
      hasCanonicalContent: false,
    },
    generationRun,
    publicationFinalization,
    learnerStateMemoryInvalidation,
    presentationRead,
  );
  if (access.assessmentMode !== "ready") {
    throw new BadRequestException(
      access.lockReason === "model_failed"
        ? tBackend("error.learning.cognitiveModelFailed")
        : tBackend("status.learning.cognitiveModelBuilding"),
    );
  }
}
