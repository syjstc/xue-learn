import type { EntityManager } from "@mikro-orm/core";
import type {
  ModuleSliceReconciliationRepository,
  ReconcileModuleSlicesInput,
  ReconcileModuleSlicesResult,
} from "@xue-learn/core/domain";

type Row = Readonly<Record<string, unknown>>;

function resultRows(result: unknown): readonly Row[] {
  if (Array.isArray(result)) return result as Row[];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    return Array.isArray(rows) ? (rows as Row[]) : [];
  }
  return [];
}

function affectedRows(result: unknown): number {
  if (typeof result === "number") return result;
  if (!result || typeof result !== "object") return 0;
  const row = result as Record<string, unknown>;
  for (const key of [
    "affectedRows",
    "rowCount",
    "changes",
    "numAffectedRows",
    "numInsertedOrUpdatedRows",
  ]) {
    const value = row[key];
    if (typeof value === "number") return value;
    if (typeof value === "bigint") return Number(value);
  }
  return 0;
}

function qualifiedTable(em: EntityManager, table: string): string {
  const schema = em.schema ?? em.config?.getSchema();
  const quoted = `"${table.replaceAll('"', '""')}"`;
  return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}

/**
 * Transaction-neutral curriculum reconciliation writer. The runtime adapter
 * supplies one transaction for the complete module set; no KACOM-derived read
 * or publication is hidden behind this boundary.
 */
export class MikroOrmModuleSliceReconciliationRepository implements ModuleSliceReconciliationRepository {
  constructor(private readonly em: EntityManager) {}

  async reconcile(
    input: ReconcileModuleSlicesInput,
  ): Promise<ReconcileModuleSlicesResult> {
    const connection = this.em.getConnection();
    const transactionContext = this.em.getTransactionContext();
    const execute = (sql: string, params: unknown[] = []) =>
      connection.execute(sql, params, undefined, transactionContext);
    const goalTable = qualifiedTable(this.em, "LearningGoal");
    const moduleTable = qualifiedTable(this.em, "LearningModule");
    const unitTable = qualifiedTable(this.em, "LearningUnit");

    const goal = resultRows(
      await execute(
        `SELECT "id"
           FROM ${goalTable}
          WHERE "id" = ?
            AND "userId" = ?
            AND "cognitiveModelInputHash" = ?`,
        [input.goalId, input.userId, input.goalInputHash],
      ),
    );
    if (goal.length === 0) {
      throw new Error("Goal ownership or cognitive-model input changed");
    }

    const reconciledModuleIds: string[] = [];
    for (const module of input.modules) {
      const updated = await execute(
        `UPDATE ${moduleTable}
            SET "generationInputHash" = ?,
                "generationStatus" = CASE
                  WHEN "generationStatus" = 'ready' THEN 'building'
                  ELSE "generationStatus"
                END,
                "generationError" = '',
                "updatedAt" = ?
          WHERE "id" = ?
            AND "goalId" = ?
            AND EXISTS (
              SELECT 1 FROM ${goalTable} g
               WHERE g."id" = ${moduleTable}."goalId"
                 AND g."userId" = ?
                 AND g."cognitiveModelInputHash" = ?
            )
            AND (
              "generationInputHash" = ?
              OR ("generationInputHash" IS NULL AND ? IS NULL)
            )
          RETURNING "id"`,
        [
          module.nextGenerationInputHash,
          input.updatedAt,
          module.moduleId,
          input.goalId,
          input.userId,
          input.goalInputHash,
          module.expectedGenerationInputHash,
          module.expectedGenerationInputHash,
        ],
      );
      if (resultRows(updated).length === 0 && affectedRows(updated) !== 1) {
        continue;
      }

      await execute(
        `UPDATE ${unitTable}
            SET "cognitiveModelStatus" = 'pending',
                "cognitiveModelBuildStartedAt" = NULL,
                "cognitiveModelBuildToken" = NULL,
                "cognitiveModelBuildInputHash" = NULL
          WHERE "goalId" = ?
            AND "moduleId" = ?
            AND "unitKind" = 'lesson'`,
        [input.goalId, module.moduleId],
      );
      reconciledModuleIds.push(module.moduleId);
    }

    return { reconciledModuleIds };
  }
}
