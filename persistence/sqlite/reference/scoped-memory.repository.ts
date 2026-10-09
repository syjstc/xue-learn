import type { EntityManager } from "@mikro-orm/core";
import type {
  DeleteOwnedGoalScopedMemoryInput,
  GoalScopedMemoryCleanupResult,
  ScopedMemoryPort,
} from "@xue-learn/core/source/libs/domain/src/index.ts";

type QueryResult = Readonly<{
  affectedRows?: unknown;
  rowCount?: unknown;
}>;

function qualifiedTable(em: EntityManager, table: string): string {
  const schema = em.schema ?? em.config?.getSchema();
  const quotedTable = `"${table.replaceAll('"', '""')}"`;
  return schema
    ? `"${schema.replaceAll('"', '""')}".${quotedTable}`
    : quotedTable;
}

function resultRows(result: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  }
  return [];
}

function affectedRows(result: unknown): number {
  if (typeof result === "number") return result;
  if (!result || typeof result !== "object") return 0;
  const queryResult = result as QueryResult;
  if (typeof queryResult.affectedRows === "number")
    return queryResult.affectedRows;
  if (typeof queryResult.rowCount === "number") return queryResult.rowCount;
  const driverResult = result as Record<string, unknown>;
  for (const key of [
    "numAffectedRows",
    "numInsertedOrUpdatedRows",
    "changes",
  ]) {
    const value = driverResult[key];
    if (typeof value === "number") return value;
    if (typeof value === "bigint") return Number(value);
  }
  return 0;
}

/**
 * Raw-SQL adapter for the goal-scoped memory cleanup trigger contract.
 *
 * The EntityManager is supplied by the caller, so this repository deliberately
 * does not start or commit a transaction. Goal ownership is checked before
 * either scoped-memory delete is issued; callers can therefore compose this
 * operation with the owning goal deletion in one transaction.
 */
export class MikroOrmScopedMemoryRepository implements ScopedMemoryPort {
  constructor(private readonly em: EntityManager) {}

  async deleteOwnedGoalScope(
    input: DeleteOwnedGoalScopedMemoryInput,
  ): Promise<GoalScopedMemoryCleanupResult> {
    const connection = this.em.getConnection();
    const goalTable = qualifiedTable(this.em, "LearningGoal");
    const candidateTable = qualifiedTable(this.em, "MemoryCandidate");
    const recordTable = qualifiedTable(this.em, "MemoryRecord");

    const ownedGoal = await connection.execute(
      `SELECT "id"
         FROM ${goalTable}
        WHERE "id" = ?
          AND "userId" = ?
        LIMIT 1`,
      [input.goalId, input.userId],
    );
    if (resultRows(ownedGoal).length === 0) {
      return { recordsDeleted: 0, candidatesDeleted: 0 };
    }

    // Keep the order of the hosted trigger: candidates may reference records
    // through existingRecordId, while record dependents cascade on deletion.
    const candidatesDeleted = await connection.execute(
      `DELETE FROM ${candidateTable}
        WHERE "scopeType" = 'goal'
          AND "scopeId" = ?
        RETURNING "id"`,
      [input.goalId],
    );
    const recordsDeleted = await connection.execute(
      `DELETE FROM ${recordTable}
        WHERE "scopeType" = 'goal'
          AND "scopeId" = ?
        RETURNING "id"`,
      [input.goalId],
    );
    return {
      recordsDeleted:
        resultRows(recordsDeleted).length || affectedRows(recordsDeleted),
      candidatesDeleted:
        resultRows(candidatesDeleted).length || affectedRows(candidatesDeleted),
    };
  }
}
