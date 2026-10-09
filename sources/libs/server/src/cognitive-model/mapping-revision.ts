import type { Persistence } from "../persistence/persistence-compat.js";
import { pruneSupersededCognitiveModelRevisions } from "./retention.js";
import { buildObjectiveSnapshot } from "./snapshot.js";
import { validateCognitiveModelSnapshot } from "./pure.js";

function inputJson(value: unknown): Persistence.InputJsonValue {
  return value as Persistence.InputJsonValue;
}

/**
 * Publish an objective snapshot after a server-owned curriculum/mapping-only
 * mutation. Entity definitions, claims and learner state are not regenerated.
 * The caller must already hold the goal cognitive-model write lock.
 */
export async function publishMappingOnlyRevision(
  tx: Persistence.TransactionClient,
  params: { goalId: string; reason: string },
): Promise<number> {
  const goal = await tx.learningGoal.findUnique({
    where: { id: params.goalId },
    select: {
      cognitiveModelInputHash: true,
      cognitiveModelVersion: true,
    },
  });
  if (!goal) throw new Error("Goal not found");
  const latest = await tx.cognitiveModelRevision.aggregate({
    where: { goalId: params.goalId },
    _max: { version: true },
  });
  const version =
    Math.max(goal.cognitiveModelVersion, latest._max.version ?? 0) + 1;
  const snapshot = await buildObjectiveSnapshot(
    tx,
    params.goalId,
    goal.cognitiveModelInputHash,
    {
      source: "mapping_only",
      reason: params.reason,
      preservesLearnerEvidence: true,
    },
  );
  validateCognitiveModelSnapshot(snapshot);
  await tx.cognitiveModelRevision.updateMany({
    where: { goalId: params.goalId, status: "published" },
    data: { status: "superseded" },
  });
  await tx.cognitiveModelRevision.create({
    data: {
      goalId: params.goalId,
      version,
      status: "published",
      scope: "full",
      inputHash: goal.cognitiveModelInputHash,
      snapshotSchemaVersion: snapshot.schemaVersion,
      isFullSnapshot: true,
      snapshotJson: inputJson(snapshot),
      auditJson: inputJson(snapshot.audit),
      publishedAt: new Date(),
    },
  });
  await tx.learningGoal.update({
    where: { id: params.goalId },
    data: {
      cognitiveModelVersion: version,
      cognitiveModelStatus: "ready",
      cognitiveModelError: "",
    },
  });
  await pruneSupersededCognitiveModelRevisions(tx, params.goalId);
  return version;
}
