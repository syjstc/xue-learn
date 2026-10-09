import type { EntityManager } from "@mikro-orm/core";
import type { AnalyticsMaintenanceRepository } from "@xue-learn/core/source/libs/domain/src/index.ts";
type Row = Record<string, unknown>;
const rows = (result: unknown): Row[] => Array.isArray(result) ? result as Row[] : result && typeof result === "object" && "rows" in result && Array.isArray((result as {
    rows?: unknown;
}).rows) ? (result as {
    rows: Row[];
}).rows : [];
const affected = (result: unknown) => typeof result === "number" ? result : result && typeof result === "object" ? Number((result as {
    affectedRows?: unknown;
    rowCount?: unknown;
}).affectedRows ?? (result as {
    rowCount?: unknown;
}).rowCount ?? 0) : 0;
const table = (em: EntityManager, name: string) => { const schema = em.schema ?? em.config?.getSchema(); const quoted = `"${name.replaceAll('"', '""')}"`; return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted; };
export class MikroOrmAnalyticsMaintenanceRepository implements AnalyticsMaintenanceRepository {
    constructor(private readonly em: EntityManager) { }
    private execute(em: EntityManager, sql: string, params: unknown[] = []) { return em.getConnection().execute(sql, params, undefined, em.getTransactionContext()); }
    async deleteGenerationEvents(cutoff: Date) { return affected(await this.execute(this.em, `DELETE FROM ${table(this.em, "AiGenerationRunEvent")} WHERE "type" NOT IN ('done','error','cancelled') AND "runId" IN (SELECT "id" FROM ${table(this.em, "AiGenerationRun")} WHERE "status"<>'running' AND "updatedAt"<?)`, [cutoff])); }
    async retainCognitiveModelRevisions(input: {
        staleCandidateCutoff: Date;
        supersededToKeep: number;
    }) { return this.em.transactional(async (em) => { const revision = table(em, "CognitiveModelRevision"); const deletedSuperseded = affected(await this.execute(em, `WITH ranked AS (SELECT "id",ROW_NUMBER() OVER (PARTITION BY "goalId" ORDER BY "version" DESC) AS rank FROM ${revision} WHERE "status"='superseded') DELETE FROM ${revision} WHERE "id" IN (SELECT "id" FROM ranked WHERE rank>?)`, [input.supersededToKeep])); const deletedStaleCandidates = affected(await this.execute(em, `DELETE FROM ${revision} AS r WHERE r."status"='candidate' AND r."updatedAt"<? AND EXISTS (SELECT 1 FROM ${table(em, "LearningGoal")} g WHERE g."id"=r."goalId" AND (r."inputHash"<>g."cognitiveModelInputHash" OR g."cognitiveModelStatus" NOT IN ('building','needs_reconciliation')))`, [input.staleCandidateCutoff])); const empty = `'{}'`; const compactedFailed = affected(await this.execute(em, `UPDATE ${revision} SET "snapshotJson"=${empty},"auditJson"=${empty} WHERE "status"='failed' AND ("snapshotJson"<>${empty} OR "auditJson"<>${empty})`)); return { deletedSuperseded, deletedStaleCandidates, compactedFailed }; }); }
    async pruneObservability(input: {
        apiCutoff: Date;
        llmCutoff: Date;
        backendErrorCutoff: Date;
        maxBackendErrorGroups: number;
    }) { const [api, llm, errors] = await Promise.all([this.execute(this.em, `DELETE FROM ${table(this.em, "ApiRequestLog")} WHERE "createdAt"<?`, [input.apiCutoff]), this.execute(this.em, `DELETE FROM ${table(this.em, "LlmRequestLog")} WHERE "createdAt"<?`, [input.llmCutoff]), this.execute(this.em, `DELETE FROM ${table(this.em, "BackendErrorGroup")} WHERE "lastSeenAt"<?`, [input.backendErrorCutoff])]); const ordered = rows(await this.execute(this.em, `SELECT "id" FROM ${table(this.em, "BackendErrorGroup")} ORDER BY "lastSeenAt" DESC,"id" DESC`)); const excess = ordered.slice(input.maxBackendErrorGroups).map(row => String(row.id)); const pruned = excess.length ? affected(await this.execute(this.em, `DELETE FROM ${table(this.em, "BackendErrorGroup")} WHERE "id" IN (${excess.map(() => "?").join(",")})`, excess)) : 0; return { deletedApiLogs: affected(api), deletedLlmLogs: affected(llm), deletedBackendErrorGroups: affected(errors), prunedBackendErrorGroups: pruned }; }
}
