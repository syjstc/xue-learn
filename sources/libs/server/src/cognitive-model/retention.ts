import type { Persistence, PersistenceClient } from "../persistence/persistence-compat.js";
import type { AnalyticsMaintenanceRepository } from "../../../domain/src/index.js";

export const COGNITIVE_MODEL_SUPERSEDED_VERSIONS_TO_KEEP = 1;
export const COGNITIVE_MODEL_STALE_CANDIDATE_DAYS = 7;

type RawSqlClient = Pick<Persistence.TransactionClient, "$executeRawUnsafe">;

export type CognitiveModelRevisionRetentionResult = {
  deletedSuperseded: number;
  deletedStaleCandidates: number;
  compactedFailed: number;
};

/** Keep only the newest rollback snapshot for one goal. */
export async function pruneSupersededCognitiveModelRevisions(
  client: RawSqlClient,
  goalId: string,
): Promise<number> {
  return client.$executeRawUnsafe(
    `WITH ranked AS (
       SELECT id,
              ROW_NUMBER() OVER (ORDER BY version DESC) AS retention_rank
       FROM "CognitiveModelRevision"
       WHERE "goalId" = $1 AND status = 'superseded'
     )
     DELETE FROM "CognitiveModelRevision" AS revision
     USING ranked
     WHERE revision.id = ranked.id
       AND ranked.retention_rank > $2`,
    goalId,
    COGNITIVE_MODEL_SUPERSEDED_VERSIONS_TO_KEEP,
  );
}

/**
 * Bound revision storage across all goals. The current published snapshot and
 * a candidate belonging to an active build are never selected for deletion.
 */
export async function runCognitiveModelRevisionRetention(
  repository: AnalyticsMaintenanceRepository,
  now = new Date(),
): Promise<CognitiveModelRevisionRetentionResult> {
  const staleCandidateCutoff = new Date(
    now.getTime() - COGNITIVE_MODEL_STALE_CANDIDATE_DAYS * 24 * 60 * 60 * 1000,
  );

  return repository.retainCognitiveModelRevisions({
    staleCandidateCutoff,
    supersededToKeep: COGNITIVE_MODEL_SUPERSEDED_VERSIONS_TO_KEEP,
  });
}
