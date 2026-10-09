import type { EntityManager } from "@mikro-orm/core";
import type { LockedModuleReplanningRepository, ReplanOwnedLockedModulesInput, ReplanOwnedLockedModulesResult, } from "@xue-learn/core/domain";
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
function qualifiedTable(em: EntityManager, table: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${table.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
/** Transaction-neutral owner-scoped locked-module replanning adapter. */
export class MikroOrmLockedModuleReplanningRepository implements LockedModuleReplanningRepository {
    constructor(private readonly em: EntityManager) { }
    async replanOwned(input: ReplanOwnedLockedModulesInput): Promise<ReplanOwnedLockedModulesResult> {
        const moduleIds = Object.keys(input.replacements);
        if (moduleIds.length === 0)
            return { status: "replacement_required" };
        const connection = this.em.getConnection();
        const execute = (sql: string, params: unknown[] = []) => connection.execute(sql, params, undefined, this.em.getTransactionContext());
        const goalTable = qualifiedTable(this.em, "LearningGoal");
        const moduleTable = qualifiedTable(this.em, "LearningModule");
        const lock = "";
        const ownedGoal = resultRows(await execute(`SELECT "id"
           FROM ${goalTable}
          WHERE "id" = ? AND "userId" = ?${lock}`, [input.goalId, input.userId]));
        if (ownedGoal.length === 0)
            return { status: "goal_not_found" };
        const placeholders = moduleIds.map(() => "?").join(", ");
        const targetModules = resultRows(await execute(`SELECT "id", "unlockStatus"
           FROM ${moduleTable}
          WHERE "goalId" = ? AND "id" IN (${placeholders})${lock}`, [input.goalId, ...moduleIds]));
        const targetById = new Map(targetModules.map((module) => [String(rowValue(module, "id")), module]));
        for (const moduleId of moduleIds) {
            const module = targetById.get(moduleId);
            if (!module)
                return { status: "module_not_found", moduleId };
            if (rowValue(module, "unlockStatus") !== "locked") {
                return { status: "module_not_locked", moduleId };
            }
        }
        const now = new Date();
        for (const moduleId of moduleIds) {
            const replacement = input.replacements[moduleId];
            await execute(`UPDATE ${moduleTable}
            SET "title" = ?,
                "summary" = ?,
                "objective" = ?,
                "plannedOutcomes" = ?,
                "entryFoundationBriefs" = ?,
                "entryFoundationStatus" = ?,
                "entryFoundationError" = '',
                "entryFoundationBuildStartedAt" = NULL,
                "entryFoundationBuildToken" = NULL,
                "exitCapabilityBriefs" = ?,
                "unitPlanningBrief" = ?,
                "estimatedUnitCount" = ?,
                "generationInputHash" = '',
                "generationVersion" = "generationVersion" + 1,
                "updatedAt" = ?
          WHERE "id" = ? AND "goalId" = ? AND "unlockStatus" = 'locked'`, [
                replacement.title,
                replacement.summary,
                replacement.objective,
                JSON.stringify(replacement.plannedOutcomes),
                JSON.stringify(replacement.entryFoundationBriefs),
                replacement.entryFoundationBriefs.length > 0
                    ? "pending"
                    : "not_applicable",
                JSON.stringify(replacement.exitCapabilityBriefs),
                JSON.stringify(replacement.unitPlanningBrief),
                replacement.estimatedUnitCount,
                now,
                moduleId,
                input.goalId,
            ]);
        }
        await execute(`UPDATE ${goalTable}
          SET "mapPlanJson" = ?, "updatedAt" = ?
        WHERE "id" = ? AND "userId" = ?`, [input.mapPlanJson, now, input.goalId, input.userId]);
        return { status: "updated", moduleIds };
    }
}
