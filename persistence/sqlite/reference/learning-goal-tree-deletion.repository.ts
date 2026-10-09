import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { DeleteOwnedLearningGoalTreeInput, DeleteOwnedLearningGoalTreeResult, LearningGoalTreeDeletionRepository, } from "@xue-learn/core/domain";
const KACOM_DESTRUCTIVE_CASCADE_SETTING = "xuelearn.kacom_destructive_cascade";
const RAG_SCOPE_CLEANUP_EVENT = "rag.scope.cleanup";
type Row = Readonly<Record<string, unknown>>;
function resultRows(result: unknown): readonly Row[] {
    if (Array.isArray(result))
        return result as Row[];
    if (result && typeof result === "object" && "rows" in result) {
        const rows = (result as {
            rows?: unknown;
        }).rows;
        return Array.isArray(rows) ? (rows as Row[]) : [];
    }
    return [];
}
function qualifiedTable(em: EntityManager, table: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${table.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
/**
 * Transaction-neutral raw-SQL implementation of the whole goal-tree delete.
 * The runtime adapter supplies a MikroORM transaction; this class deliberately
 * never starts one so memory, outbox, and goal rows share the same context.
 */
export class MikroOrmLearningGoalTreeDeletionRepository implements LearningGoalTreeDeletionRepository {
    constructor(private readonly em: EntityManager) { }
    async deleteOwnedGoalTree(input: DeleteOwnedLearningGoalTreeInput): Promise<DeleteOwnedLearningGoalTreeResult> {
        const connection = this.em.getConnection();
        const transactionContext = this.em.getTransactionContext();
        const execute = (sql: string, params: unknown[] = []) => connection.execute(sql, params, undefined, transactionContext);
        const goalTable = qualifiedTable(this.em, "LearningGoal");
        const memoryCandidateTable = qualifiedTable(this.em, "MemoryCandidate");
        const memoryRecordTable = qualifiedTable(this.em, "MemoryRecord");
        const eventOutboxTable = qualifiedTable(this.em, "EventOutbox");
        const documentTable = qualifiedTable(this.em, "UploadedDocument");
        const spaceItemTable = qualifiedTable(this.em, "LearningSpaceItem");
        const spaceTable = qualifiedTable(this.em, "LearningSpace");
        const lock = "";
        const parentRows = resultRows(await execute(`SELECT "id"
           FROM ${goalTable}
          WHERE "id" = ? AND "userId" = ?${lock}`, [input.goalId, input.userId]));
        if (parentRows.length === 0) {
            return { deletedGoalIds: [], deletedResourceStorageKeys: [] };
        }
        const childRows = resultRows(await execute(`SELECT "id"
           FROM ${goalTable}
          WHERE "userId" = ?
            AND "parentGoalId" = ?
            AND "goalRelationType" = 'foundation_support'${lock}`, [input.userId, input.goalId]));
        const deletedGoalIds = [
            ...childRows.flatMap((row) => typeof row.id === "string" ? [row.id] : []),
            input.goalId,
        ];
        const resourceRows = resultRows(await execute(`SELECT DISTINCT "storageKey"
           FROM ${documentTable}
          WHERE "goalId" IN (${deletedGoalIds.map(() => "?").join(", ")})
            AND "storageKey" IS NOT NULL`, deletedGoalIds));
        const deletedResourceStorageKeys = resourceRows.flatMap((row) => typeof row.storageKey === "string" ? [row.storageKey] : []);
        // Activation reuses the planned-goal row in place. Detach that row before
        // deleting its goal so the FK cascade cannot erase the roadmap placeholder.
        // A non-empty plannedTitle is the durable marker that this goal item came
        // from a placeholder; ordinary goal memberships keep it empty.
        const restoredSpaceRows = resultRows(await execute(`SELECT i."spaceId" AS "spaceId"
           FROM ${spaceItemTable} i
           JOIN ${spaceTable} s ON s."id" = i."spaceId"
          WHERE i."goalId" IN (${deletedGoalIds.map(() => "?").join(", ")})
            AND i."itemType" = 'goal'
            AND length(trim(i."plannedTitle")) > 0
            AND s."userId" = ?${lock}`, [...deletedGoalIds, input.userId]));
        const restoredSpaceIds = [
            ...new Set(restoredSpaceRows.flatMap((row) => typeof row.spaceId === "string" ? [row.spaceId] : [])),
        ];
        if (restoredSpaceIds.length > 0) {
            await execute(`UPDATE ${spaceItemTable}
            SET "itemType" = 'planned_goal', "goalId" = NULL
          WHERE "goalId" IN (${deletedGoalIds.map(() => "?").join(", ")})
            AND "itemType" = 'goal'
            AND length(trim("plannedTitle")) > 0`, deletedGoalIds);
            const updatedAt = new Date();
            for (const spaceId of restoredSpaceIds) {
                await execute(`UPDATE ${spaceTable}
              SET "revision" = "revision" + 1, "updatedAt" = ?
            WHERE "id" = ? AND "userId" = ?`, [updatedAt, spaceId, input.userId]);
            }
        }
        for (const deletedGoalId of deletedGoalIds) {
            // Candidates reference records through existingRecordId, so preserve
            // the hosted trigger's candidate-before-record cleanup order.
            await execute(`DELETE FROM ${memoryCandidateTable}
          WHERE "scopeType" = 'goal' AND "scopeId" = ?`, [deletedGoalId]);
            await execute(`DELETE FROM ${memoryRecordTable}
          WHERE "scopeType" = 'goal' AND "scopeId" = ?`, [deletedGoalId]);
            const createdAt = new Date();
            await execute(`INSERT INTO ${eventOutboxTable}
          ("id", "type", "payload", "createdAt", "nextAttemptAt")
         VALUES (?, ?, ?, ?, ?)`, [
                randomUUID(),
                RAG_SCOPE_CLEANUP_EVENT,
                JSON.stringify({
                    scope: "web_knowledge",
                    scopeId: input.userId,
                    metadataFilter: { goalId: deletedGoalId },
                    reason: "goal_delete",
                }),
                createdAt,
                createdAt,
            ]);
        }
        // Delete children before the parent because the portable reference schema
        // uses SET NULL for the self-reference while hosted KACOM rows cascade.
        for (const deletedGoalId of deletedGoalIds) {
            await execute(`DELETE FROM ${goalTable}
          WHERE "id" = ? AND "userId" = ?`, [deletedGoalId, input.userId]);
        }
        return { deletedGoalIds, deletedResourceStorageKeys };
    }
}
