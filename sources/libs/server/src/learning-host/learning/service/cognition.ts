import { NotFoundException } from "@nestjs/common";
import { tBackend } from "../../../../../common/src/index.js";
import type {
  CognitiveEntityEvidenceReadRepository,
  LearnerStateProjectionReadRepository,
} from "../../../../../domain/src/index.js";
import { getLearnerEntityState } from "../../../cognition/index.js";

export async function getCognitiveEntityState(
  userId: string,
  entityId: string,
  stateRead: LearnerStateProjectionReadRepository,
) {
  try {
    return await getLearnerEntityState(undefined, userId, entityId, stateRead);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "not_found"
    ) {
      throw new NotFoundException(
        tBackend("error.learning.cognitiveEntityNotFound"),
      );
    }
    throw error;
  }
}

export async function getCognitiveEntityEvidence(
  userId: string,
  entityId: string,
  evidenceRead: CognitiveEntityEvidenceReadRepository,
) {
  const evidence = await evidenceRead.findForEntity({
    userId,
    cognitiveEntityId: entityId,
  });
  if (!evidence) {
    throw new NotFoundException(
      tBackend("error.learning.cognitiveEntityNotFound"),
    );
  }
  return evidence;
}
