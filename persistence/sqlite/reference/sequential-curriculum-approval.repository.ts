import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { PersistOwnedSequentialCurriculumInput, PersistOwnedSequentialCurriculumResult, SequentialCurriculumApprovalRepository, } from "@xue-learn/core/source/libs/domain/src/index.ts";
type ValueRow = Readonly<Record<string, unknown>>;
const COURSE_MODULE_GENERATE_EVENT = "course.module.generate";
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
/** Transaction-neutral owner-scoped sequential curriculum approval adapter. */
export class MikroOrmSequentialCurriculumApprovalRepository implements SequentialCurriculumApprovalRepository {
    constructor(private readonly em: EntityManager) { }
    async persistOwned(input: PersistOwnedSequentialCurriculumInput): Promise<PersistOwnedSequentialCurriculumResult> {
        if (input.modules.length === 0) {
            throw new Error("Sequential curriculum plan is missing module contracts");
        }
        const connection = this.em.getConnection();
        const execute = (sql: string, params: unknown[] = []) => connection.execute(sql, params, undefined, this.em.getTransactionContext());
        const goalTable = qualifiedTable(this.em, "LearningGoal");
        const moduleTable = qualifiedTable(this.em, "LearningModule");
        const eventTable = qualifiedTable(this.em, "EventOutbox");
        const lock = "";
        const goal = resultRows(await execute(`SELECT "id", "learningMode"
           FROM ${goalTable}
          WHERE "id" = ? AND "userId" = ?${lock}`, [input.goalId, input.userId]))[0];
        if (!goal)
            return { status: "not_found" };
        const existing = resultRows(await execute(`SELECT "id"
           FROM ${moduleTable}
          WHERE "goalId" = ?
          ORDER BY "orderIndex" ASC, "id" ASC`, [input.goalId]));
        if (existing.length > 0) {
            const firstModuleId = rowValue(existing[0], "id");
            return {
                status: "existing",
                firstModuleId: typeof firstModuleId === "string" ? firstModuleId : null,
            };
        }
        const now = new Date();
        const exploration = stringValue(rowValue(goal, "learningMode")) === "exploration";
        let firstModuleId: string | null = null;
        for (const [index, modulePlan] of input.modules.entries()) {
            const moduleId = randomUUID();
            if (index === 0)
                firstModuleId = moduleId;
            await execute(`INSERT INTO ${moduleTable}
          ("id", "curriculumKey", "goalId", "planRef", "orderIndex",
           "title", "summary", "objective", "plannedOutcomes",
           "entryFoundationBriefs", "entryFoundationStatus",
           "exitCapabilityBriefs", "estimatedUnitCount", "unitPlanningBrief",
           "unlockStatus", "generationStatus", "unlockedAt")
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`, [
                moduleId,
                randomUUID(),
                input.goalId,
                `m_${index + 1}`,
                index,
                modulePlan.title,
                modulePlan.summary,
                modulePlan.objective,
                JSON.stringify(modulePlan.plannedOutcomes),
                JSON.stringify(modulePlan.entryFoundationBriefs),
                modulePlan.entryFoundationBriefs.length > 0
                    ? "pending"
                    : "not_applicable",
                JSON.stringify(modulePlan.exitCapabilityBriefs),
                modulePlan.estimatedUnitCount,
                JSON.stringify(modulePlan.unitPlanningBrief),
                exploration || index === 0 ? "unlocked" : "locked",
                exploration || index === 0 ? now : null,
            ]);
        }
        await execute(`UPDATE ${goalTable}
          SET "curriculumVersion" = 2,
              "mapPlanStatus" = 'approved',
              "detailedPlanStatus" = 'ready',
              "updatedAt" = ?
        WHERE "id" = ? AND "userId" = ?`, [now, input.goalId, input.userId]);
        if (firstModuleId && input.enqueueFirst !== false) {
            await execute(`INSERT INTO ${eventTable} ("id", "type", "payload")
         VALUES (?, ?, ?)`, [
                randomUUID(),
                COURSE_MODULE_GENERATE_EVENT,
                JSON.stringify({
                    goalId: input.goalId,
                    moduleId: firstModuleId,
                    reason: "plan_approved",
                }),
            ]);
        }
        return { status: "created", firstModuleId };
    }
}
