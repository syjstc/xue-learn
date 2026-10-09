import type { EntityManager } from "@mikro-orm/core";
import type { LearningGoalSettingsRecord, LearningGoalSettingsRepository, UpdateOwnedLearningGoalSettingsInput, } from "@xue-learn/core/domain";
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
function stringValue(value: unknown): string {
    return typeof value === "string" ? value : "";
}
function qualifiedTable(em: EntityManager, table: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${table.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
/** Owner-scoped goal settings patch with no cognitive or agenda side effects. */
export class MikroOrmLearningGoalSettingsRepository implements LearningGoalSettingsRepository {
    constructor(private readonly em: EntityManager) { }
    async updateOwned(input: UpdateOwnedLearningGoalSettingsInput): Promise<LearningGoalSettingsRecord | null> {
        return this.em.transactional((tx) => this.updateInTransaction(tx, input));
    }
    private async updateInTransaction(em: EntityManager, input: UpdateOwnedLearningGoalSettingsInput): Promise<LearningGoalSettingsRecord | null> {
        const goalTable = qualifiedTable(em, "LearningGoal");
        const connection = em.getConnection();
        const execute = (sql: string, params: unknown[] = []) => connection.execute(sql, params, undefined, em.getTransactionContext());
        const goal = resultRows(await execute(`SELECT "id", "title", "contentLanguage", "generationOptions"
           FROM ${goalTable}
          WHERE "id" = ? AND "userId" = ?
          ${""}`, [input.goalId, input.userId]))[0];
        if (!goal)
            return null;
        const assignments: string[] = [];
        const params: unknown[] = [];
        if (input.patch.title !== undefined) {
            assignments.push('"title" = ?');
            params.push(input.patch.title);
        }
        if (input.patch.contentLanguage !== undefined) {
            assignments.push('"contentLanguage" = ?');
            params.push(input.patch.contentLanguage);
        }
        if (input.patch.generationOptions !== undefined) {
            assignments.push('"generationOptions" = ?');
            params.push(input.patch.generationOptions);
        }
        const updatedAt = new Date();
        assignments.push('"updatedAt" = ?');
        params.push(updatedAt, input.goalId, input.userId);
        await execute(`UPDATE ${goalTable}
          SET ${assignments.join(", ")}
        WHERE "id" = ? AND "userId" = ?`, params);
        return {
            goalId: input.goalId,
            title: input.patch.title ?? stringValue(rowValue(goal, "title")),
            contentLanguage: input.patch.contentLanguage ??
                stringValue(rowValue(goal, "contentLanguage")),
            generationOptions: input.patch.generationOptions ??
                stringValue(rowValue(goal, "generationOptions")),
        };
    }
}
