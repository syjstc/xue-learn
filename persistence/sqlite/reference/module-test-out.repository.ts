import type { EntityManager } from "@mikro-orm/core";
import type { CompleteModuleTestOutInput, ModuleTestOutRecord, ModuleTestOutRepository, } from "@xue-learn/core/source/libs/domain/src/index.ts";
type ValueRow = Readonly<Record<string, unknown>>;
function resultRows(result: unknown): readonly ValueRow[] {
    if (Array.isArray(result))
        return result as ValueRow[];
    if (result && typeof result === "object" && "rows" in result) {
        const rows = (result as {
            rows?: unknown;
        }).rows;
        return Array.isArray(rows) ? (rows as ValueRow[]) : [];
    }
    return [];
}
function rowValue(row: ValueRow, key: string): unknown {
    return row[key] ?? row[key[0]?.toLowerCase() + key.slice(1)];
}
function stringValue(value: unknown, fallback = ""): string {
    return typeof value === "string" ? value : fallback;
}
function qualifiedTable(em: EntityManager, table: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${table.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
/** Atomic owner-scoped module diagnostic/test-out transition. */
export class MikroOrmModuleTestOutRepository implements ModuleTestOutRepository {
    constructor(private readonly em: EntityManager) { }
    async completeOwned(input: CompleteModuleTestOutInput): Promise<ModuleTestOutRecord> {
        return this.em.transactional((tx) => this.completeInTransaction(tx, input));
    }
    private async completeInTransaction(em: EntityManager, input: CompleteModuleTestOutInput): Promise<ModuleTestOutRecord> {
        const moduleTable = qualifiedTable(em, "LearningModule");
        const unitTable = qualifiedTable(em, "LearningUnit");
        const goalTable = qualifiedTable(em, "LearningGoal");
        const eventTable = qualifiedTable(em, "EventOutbox");
        const connection = em.getConnection();
        const execute = (sql: string, params: unknown[] = []) => connection.execute(sql, params, undefined, em.getTransactionContext());
        const completedAt = input.completedAt ?? new Date();
        const moduleRows = resultRows(await execute(`SELECT m."id", m."goalId", m."orderIndex", m."unlockStatus", m."generationStatus"
           FROM ${moduleTable} m
           JOIN ${goalTable} g ON g."id" = m."goalId"
          WHERE m."id" = ? AND m."goalId" = ? AND g."userId" = ?
          ${""}`, [input.moduleId, input.goalId, input.userId]));
        const module = moduleRows[0];
        if (!module)
            throw new Error("Module not found");
        if (rowValue(module, "unlockStatus") === "completed") {
            return {
                moduleId: input.moduleId,
                completionMethod: "test_out",
                nextModuleId: await this.findNextModuleId(em, input.goalId, rowValue(module, "orderIndex"), execute),
            };
        }
        if (rowValue(module, "unlockStatus") !== "unlocked") {
            throw new Error("MODULE_LOCKED");
        }
        if (rowValue(module, "generationStatus") !== "ready") {
            throw new Error("MODULE_GENERATING");
        }
        await execute(`UPDATE ${unitTable}
          SET "status" = 'skipped',
              "skippedAt" = ?,
              "completionMethod" = 'module_test_out',
              "completionAttemptId" = ?
        WHERE "moduleId" = ? AND "status" IN ('available', 'in_progress')`, [completedAt, input.attemptId, input.moduleId]);
        await execute(`UPDATE ${moduleTable}
          SET "unlockStatus" = 'completed',
              "completionMethod" = 'test_out',
              "completionAttemptId" = ?,
              "completedAt" = ?
        WHERE "id" = ?`, [input.attemptId, completedAt, input.moduleId]);
        const nextRows = resultRows(await execute(`SELECT "id", "unlockStatus" FROM ${moduleTable}
          WHERE "goalId" = ? AND "orderIndex" > ?
          ORDER BY "orderIndex" ASC, "id" ASC
          LIMIT 1${""}`, [input.goalId, rowValue(module, "orderIndex")]));
        const next = nextRows[0];
        const nextModuleId = stringValue(rowValue(next ?? {}, "id")) || null;
        if (nextModuleId && rowValue(next, "unlockStatus") === "locked") {
            await execute(`UPDATE ${moduleTable}
            SET "unlockStatus" = 'unlocked',
                "generationStatus" = 'pending',
                "unlockedAt" = ?,
                "generationError" = ''
          WHERE "id" = ?`, [completedAt, nextModuleId]);
            await execute(`INSERT INTO ${eventTable}
          ("id", "type", "payload", "createdAt", "nextAttemptAt")
         VALUES (?, 'course.module.generate', ?, ?, ?)
         ON CONFLICT ("id") DO NOTHING`, [
                `module.generate:${nextModuleId}`,
                JSON.stringify({
                    goalId: input.goalId,
                    moduleId: nextModuleId,
                    reason: "previous_module_completed",
                }),
                completedAt,
                completedAt,
            ]);
        }
        return {
            moduleId: input.moduleId,
            completionMethod: "test_out",
            nextModuleId,
        };
    }
    private async findNextModuleId(em: EntityManager, goalId: string, orderIndex: unknown, execute: (sql: string, params?: unknown[]) => Promise<unknown>): Promise<string | null> {
        const rows = resultRows(await execute(`SELECT "id" FROM ${qualifiedTable(em, "LearningModule")}
          WHERE "goalId" = ? AND "orderIndex" > ?
          ORDER BY "orderIndex" ASC, "id" ASC
          LIMIT 1`, [goalId, orderIndex]));
        return stringValue(rowValue(rows[0] ?? {}, "id")) || null;
    }
}
