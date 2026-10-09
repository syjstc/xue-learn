import type { EntityManager } from "@mikro-orm/core";
import type { CommitUnitCompletionInput, UnitCompletionRecord, UnitCompletionRepository, } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { MikroOrmDomainEventOutboxRepository } from "./domain-event.repository.ts";
import { safeReferenceDateValue } from "./date-value.ts";
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
function dateValue(value: unknown, fallback = new Date()): Date {
    return safeReferenceDateValue(value) ?? fallback;
}
function qualifiedTable(em: EntityManager, table: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${table.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
function isCompletedStatus(value: unknown): boolean {
    return value === "completed" || value === "completed_needs_reinforcement";
}
async function rollupParentUnits(em: EntityManager, unitId: string, now: Date, execute: (sql: string, params?: unknown[]) => Promise<unknown>): Promise<void> {
    let childId = unitId;
    while (true) {
        const parentRows = resultRows(await execute(`SELECT "parentUnitId" FROM ${qualifiedTable(em, "LearningUnit")} WHERE "id" = ?`, [childId]));
        const parentId = stringValue(rowValue(parentRows[0] ?? {}, "parentUnitId")) || null;
        if (!parentId)
            return;
        const siblings = resultRows(await execute(`SELECT "status" FROM ${qualifiedTable(em, "LearningUnit")}
          WHERE "parentUnitId" = ? AND "unitKind" = 'lesson'`, [parentId]));
        if (siblings.length === 0 ||
            siblings.some((sibling) => !isCompletedStatus(rowValue(sibling, "status")))) {
            return;
        }
        const status = siblings.some((sibling) => rowValue(sibling, "status") === "completed_needs_reinforcement")
            ? "completed_needs_reinforcement"
            : "completed";
        await execute(`UPDATE ${qualifiedTable(em, "LearningUnit")}
          SET "status" = ?, "completedAt" = COALESCE("completedAt", ?)
        WHERE "id" = ?`, [status, now, parentId]);
        childId = parentId;
    }
}
async function completeReadyModuleIfNeeded(em: EntityManager, moduleId: string | null, now: Date, execute: (sql: string, params?: unknown[]) => Promise<unknown>): Promise<void> {
    if (!moduleId)
        return;
    const moduleTable = qualifiedTable(em, "LearningModule");
    const unitTable = qualifiedTable(em, "LearningUnit");
    const moduleRows = resultRows(await execute(`SELECT "id", "goalId", "orderIndex", "unlockStatus", "generationStatus"
         FROM ${moduleTable}
        WHERE "id" = ?
        ${""}`, [moduleId]));
    const module = moduleRows[0];
    if (!module ||
        rowValue(module, "unlockStatus") === "completed" ||
        rowValue(module, "generationStatus") !== "ready") {
        return;
    }
    const requiredUnits = resultRows(await execute(`SELECT "status" FROM ${unitTable}
        WHERE "moduleId" = ? AND "unitKind" = 'lesson'
          AND "requiredForModuleCompletion" = ${"1"}`, [moduleId]));
    if (requiredUnits.length === 0 ||
        requiredUnits.some((unit) => !isCompletedStatus(rowValue(unit, "status")))) {
        return;
    }
    await execute(`UPDATE ${moduleTable}
        SET "unlockStatus" = 'completed',
            "completionMethod" = 'units',
            "completedAt" = ?
      WHERE "id" = ?`, [now, moduleId]);
    const nextRows = resultRows(await execute(`SELECT "id", "unlockStatus" FROM ${moduleTable}
        WHERE "goalId" = ? AND "orderIndex" > ?
        ORDER BY "orderIndex" ASC, "id" ASC
        LIMIT 1`, [rowValue(module, "goalId"), rowValue(module, "orderIndex")]));
    const next = nextRows[0];
    if (!next || rowValue(next, "unlockStatus") !== "locked")
        return;
    const nextId = stringValue(rowValue(next, "id"));
    await execute(`UPDATE ${moduleTable}
        SET "unlockStatus" = 'unlocked',
            "generationStatus" = 'pending',
            "unlockedAt" = ?,
            "generationError" = ''
      WHERE "id" = ?`, [now, nextId]);
    await execute(`INSERT INTO ${qualifiedTable(em, "EventOutbox")}
      ("id", "type", "payload", "createdAt", "nextAttemptAt")
     VALUES (?, 'course.module.generate', ?, ?, ?)
     ON CONFLICT ("id") DO NOTHING`, [
        `module.generate:${nextId}`,
        JSON.stringify({
            goalId: rowValue(module, "goalId"),
            moduleId: nextId,
            reason: "previous_module_completed",
        }),
        now,
        now,
    ]);
}
/** Atomic unit/session/domain-event completion adapter. */
export class MikroOrmUnitCompletionRepository implements UnitCompletionRepository {
    constructor(private readonly em: EntityManager) { }
    async commitOwned(input: CommitUnitCompletionInput): Promise<UnitCompletionRecord> {
        return this.em.transactional((tx) => this.commitInTransaction(tx, input));
    }
    async healOwnedDemoted(userId: string, unitIds: readonly string[]): Promise<readonly string[]> {
        if (unitIds.length === 0)
            return [];
        return this.em.transactional(async (em) => {
            const placeholders = unitIds.map(() => "?").join(", ");
            const execute = (sql: string, params: unknown[] = []) => em
                .getConnection()
                .execute(sql, params, undefined, em.getTransactionContext());
            const found = resultRows(await execute(`SELECT u."id" FROM ${qualifiedTable(em, "LearningUnit")} u
             JOIN ${qualifiedTable(em, "LearningGoal")} g ON g."id" = u."goalId"
            WHERE g."userId" = ? AND u."id" IN (${placeholders})
              AND u."completedAt" IS NOT NULL
              AND u."completionMethod" IN ('learned', 'test_out')
              AND u."status" NOT IN ('completed', 'completed_needs_reinforcement')`, [userId, ...unitIds]));
            const healedIds = found.map((row) => stringValue(rowValue(row, "id")));
            if (healedIds.length === 0)
                return [];
            await execute(`UPDATE ${qualifiedTable(em, "LearningUnit")} SET "status" = 'completed'
          WHERE "id" IN (${healedIds.map(() => "?").join(", ")})`, healedIds);
            return healedIds;
        });
    }
    private async commitInTransaction(em: EntityManager, input: Parameters<UnitCompletionRepository["commitOwned"]>[0]): Promise<UnitCompletionRecord> {
        const unitTable = qualifiedTable(em, "LearningUnit");
        const goalTable = qualifiedTable(em, "LearningGoal");
        const sessionTable = qualifiedTable(em, "UnitSessionState");
        const connection = em.getConnection();
        const execute = (sql: string, params: unknown[] = []) => connection.execute(sql, params, undefined, em.getTransactionContext());
        const now = new Date();
        const ownerRows = resultRows(await execute(`SELECT u."status", u."completionMethod", u."completedAt", u."parentUnitId", u."moduleId", g."id" AS "goalId"
           FROM ${unitTable} u
           JOIN ${goalTable} g ON g."id" = u."goalId"
          WHERE u."id" = ? AND g."userId" = ?
          ${""}`, [input.unitId, input.userId]));
        const unit = ownerRows[0];
        if (!unit)
            throw new Error("Unit not found");
        const currentStatus = stringValue(rowValue(unit, "status"));
        const alreadyCompleted = rowValue(unit, "completedAt") != null &&
            (rowValue(unit, "completionMethod") === "learned" ||
                rowValue(unit, "completionMethod") === "test_out") &&
            (currentStatus === "completed" ||
                currentStatus === "completed_needs_reinforcement");
        await execute(`INSERT INTO ${sessionTable} ("id", "unitId", "updatedAt")
       VALUES (?, ?, ?)
       ON CONFLICT ("unitId") DO NOTHING`, [`session-${input.unitId}`, input.unitId, now]);
        if (!alreadyCompleted) {
            await execute(`UPDATE ${unitTable}
            SET "status" = ?,
                "completionMethod" = ?,
                "completionAttemptId" = ?,
                "completedAt" = ?
          WHERE "id" = ?`, [
                input.transition.status,
                input.transition.completionMethod,
                input.completionAttemptId ?? null,
                input.transition.completedAt,
                input.unitId,
            ]);
        }
        await execute(`UPDATE ${sessionTable}
          SET "currentStep" = 'complete', "updatedAt" = ?
        WHERE "unitId" = ?`, [now, input.unitId]);
        await rollupParentUnits(em, input.unitId, now, execute);
        await completeReadyModuleIfNeeded(em, stringValue(rowValue(unit, "moduleId")) || null, now, execute);
        await new MikroOrmDomainEventOutboxRepository(em).append({
            id: `event-${input.idempotencyKey}`,
            type: "unit.completed",
            schemaVersion: 1,
            idempotencyKey: input.idempotencyKey,
            userId: input.userId,
            goalId: stringValue(rowValue(unit, "goalId")),
            unitId: input.unitId,
            threadId: null,
            payload: JSON.stringify({
                completionMethod: input.transition.completionMethod,
                status: input.transition.status,
                completionQuality: input.transition.completionQuality,
            }),
            occurredAt: input.transition.completedAt,
        });
        return {
            transitioned: !alreadyCompleted,
            status: alreadyCompleted
                ? (currentStatus as UnitCompletionRecord["status"])
                : input.transition.status,
            completionQuality: input.transition.completionQuality,
            completedAt: alreadyCompleted
                ? dateValue(rowValue(unit, "completedAt"), input.transition.completedAt)
                : input.transition.completedAt,
        };
    }
}
