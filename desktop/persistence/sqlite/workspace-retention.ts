import type {EntityManager} from "@mikro-orm/core";
/** Count accepted queued/active work, including the interval before an AI-run is created. */
export async function workspaceBackgroundTaskCount(em:EntityManager):Promise<number> {
  const rows=await em.getConnection().execute(`SELECT
    (SELECT COUNT(*) FROM "AiGenerationRun" WHERE "status"='running') +
    (SELECT COUNT(*) FROM "LlmRequestLog" WHERE "status"='running') +
    (SELECT COUNT(*) FROM "EventOutbox" WHERE "publishedAt" IS NULL AND "deadLetteredAt" IS NULL) +
    (SELECT COUNT(*) FROM "DomainEventOutbox" WHERE "fanoutCompletedAt" IS NULL) +
    (SELECT COUNT(*) FROM "DomainEventDelivery" WHERE "status" IN ('pending','processing','retrying') AND "deadLetteredAt" IS NULL) +
    (SELECT COUNT(*) FROM "ModuleStructureDraft" WHERE "status" IN ('queued','generating','auditing','publishing')) +
    (SELECT COUNT(*) FROM "LearningModule" WHERE "generationStatus"='building' OR "entryFoundationStatus"='building') +
    (SELECT COUNT(*) FROM "UnitSection" WHERE "generationStatus"='building' OR "testGenerationStatus"='building') +
    (SELECT COUNT(*) FROM "GoalCreationSession" WHERE "status"='running' AND "currentRunId" IS NOT NULL) +
    (SELECT COUNT(*) FROM "DeepPlanningResearchLease" WHERE "status" IN ('queued','held','active') AND "releasedAt" IS NULL) +
    (SELECT COUNT(*) FROM "FormalDerivationRun" WHERE "status" IN ('running','validating')) +
    (SELECT COUNT(*) FROM "TeachingDerivationRun" WHERE "status" IN ('running','validating')) +
    (SELECT COUNT(*) FROM "LocalEmbeddingIndexState" WHERE "status" IN ('queued','building')) AS "count"`,[],undefined,em.getTransactionContext()) as Array<{count:number}>;
  return Number(rows[0]?.count??0);
}
