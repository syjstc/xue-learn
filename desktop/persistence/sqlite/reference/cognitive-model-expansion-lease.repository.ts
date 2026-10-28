import type { EntityManager } from "@mikro-orm/core";
import { randomUUID } from "node:crypto";
import type { ClaimCognitiveModelExpansionInput, ClaimCognitiveModelExpansionResult, CognitiveModelExpansionLeaseRepository, } from "@xue-learn/core/domain";
import { safeReferenceDateValue, sqlTimestampParameter } from "./date-value.ts";
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
function rowValue(row: Row, key: string): unknown {
    return row[key] ?? row[key[0]?.toLowerCase() + key.slice(1)];
}
function stringValue(value: unknown, fallback = ""): string {
    return typeof value === "string" ? value : fallback;
}
function dateValue(value: unknown): Date | null {
    return safeReferenceDateValue(value);
}
function affectedRows(result: unknown): number {
    if (typeof result === "number")
        return result;
    if (!result || typeof result !== "object")
        return 0;
    const row = result as Record<string, unknown>;
    for (const key of [
        "affectedRows",
        "rowCount",
        "changes",
        "numAffectedRows",
        "numInsertedOrUpdatedRows",
    ]) {
        const value = row[key];
        if (typeof value === "number")
            return value;
        if (typeof value === "bigint")
            return Number(value);
    }
    return 0;
}
function qualifiedTable(em: EntityManager, table: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${table.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
/** Transaction-neutral goal/unit lease adapter; the runtime owns the unit of work. */
export class MikroOrmCognitiveModelExpansionLeaseRepository implements CognitiveModelExpansionLeaseRepository {
    constructor(private readonly em: EntityManager) { }
    async claim(input: ClaimCognitiveModelExpansionInput): Promise<ClaimCognitiveModelExpansionResult> {
        const connection = this.em.getConnection();
        const transactionContext = this.em.getTransactionContext();
        const execute = (sql: string, params: unknown[] = []) => connection.execute(sql, params, undefined, transactionContext);
        const goalTable = qualifiedTable(this.em, "LearningGoal");
        const unitTable = qualifiedTable(this.em, "LearningUnit");
        const lock = "";
        const goal = resultRows(await execute(`SELECT "id", "cognitiveModelInputHash", "cognitiveModelPublishedHash"
           FROM ${goalTable}
          WHERE "id" = ? AND "userId" = ?${lock}`, [input.goalId, input.userId]))[0];
        if (!goal)
            throw new Error("Goal not found");
        if (stringValue(rowValue(goal, "cognitiveModelInputHash")) !== input.inputHash) {
            throw new Error("Course map changed during cognitive-model preparation");
        }
        const unit = resultRows(await execute(`SELECT "id", "unitKind", "cognitiveModelStatus",
                "cognitiveModelBuildStartedAt", "cognitiveModelBuildInputHash"
           FROM ${unitTable}
          WHERE "id" = ? AND "goalId" = ?${lock}`, [input.unitId, input.goalId]))[0];
        if (!unit ||
            stringValue(rowValue(unit, "unitKind"), "lesson") !== "lesson") {
            throw new Error("Unit not found");
        }
        const status = stringValue(rowValue(unit, "cognitiveModelStatus"), "pending");
        if (status === "expanded" &&
            input.hasLearningTargets &&
            stringValue(rowValue(unit, "cognitiveModelBuildInputHash")) ===
                input.inputHash) {
            return { status: "complete" };
        }
        const buildStartedAt = dateValue(rowValue(unit, "cognitiveModelBuildStartedAt"));
        if (status === "building" &&
            buildStartedAt !== null &&
            buildStartedAt.getTime() > input.staleBefore.getTime()) {
            return { status: "join" };
        }
        const updated = await execute(`UPDATE ${unitTable}
          SET "cognitiveModelStatus" = 'building',
              "cognitiveModelBuildStartedAt" = ?,
              "cognitiveModelBuildToken" = ?,
              "cognitiveModelBuildInputHash" = ?
        WHERE "id" = ? AND "goalId" = ? AND "unitKind" = 'lesson'
          AND (
            "cognitiveModelStatus" <> 'building'
            OR "cognitiveModelBuildStartedAt" IS NULL
            OR "cognitiveModelBuildStartedAt" <= ?
          )
        RETURNING "id"`, [
            input.startedAt,
            input.token,
            input.inputHash,
            input.unitId,
            input.goalId,
            input.staleBefore,
        ]);
        if (resultRows(updated).length === 0 && affectedRows(updated) !== 1) {
            return { status: "join" };
        }
        const goalUpdated = await execute(`UPDATE ${goalTable}
          SET "cognitiveModelStatus" = CASE
                WHEN "cognitiveModelPublishedHash" = ? THEN 'building'
                ELSE 'needs_reconciliation'
              END,
              "updatedAt" = ?
        WHERE "id" = ? AND "userId" = ?
          AND "cognitiveModelInputHash" = ?
        RETURNING "id"`, [
            input.inputHash,
            input.startedAt,
            input.goalId,
            input.userId,
            input.inputHash,
        ]);
        if (resultRows(goalUpdated).length === 0 &&
            affectedRows(goalUpdated) !== 1) {
            throw new Error("Cognitive-model goal lease was superseded");
        }
        return { status: "claimed" };
    }
    async readState(input: {
        goalId: string;
        unitId: string;
    }) {
        const row = resultRows(await this.em.getConnection().execute(`SELECT u."cognitiveModelStatus", u."cognitiveModelBuildInputHash",
                g."cognitiveModelVersion", g."cognitiveModelInputHash",
                g."cognitiveModelPublishedHash", g."cognitiveModelStatus" AS "goalStatus"
           FROM ${qualifiedTable(this.em, "LearningUnit")} u
           JOIN ${qualifiedTable(this.em, "LearningGoal")} g ON g."id" = u."goalId"
          WHERE u."id" = ? AND u."goalId" = ? LIMIT 1`, [input.unitId, input.goalId], undefined, this.em.getTransactionContext()))[0];
        return row
            ? {
                unitStatus: stringValue(rowValue(row, "cognitiveModelStatus")),
                unitInputHash: rowValue(row, "cognitiveModelBuildInputHash") == null
                    ? null
                    : stringValue(rowValue(row, "cognitiveModelBuildInputHash")),
                goalVersion: Number(rowValue(row, "cognitiveModelVersion")) || 0,
                goalInputHash: stringValue(rowValue(row, "cognitiveModelInputHash")),
                goalPublishedHash: stringValue(rowValue(row, "cognitiveModelPublishedHash")),
                goalStatus: stringValue(rowValue(row, "goalStatus")),
            }
            : null;
    }
    async fail(input: {
        goalId: string;
        unitId: string;
        inputHash: string;
        token: string;
        message: string;
        planningCoverageGap?: Readonly<{
            affectedUnitIds: readonly string[];
        }>;
    }): Promise<void> {
        const connection = this.em.getConnection();
        const context = this.em.getTransactionContext();
        const execute = (sql: string, params: unknown[] = []) => connection.execute(sql, params, undefined, context);
        const unitTable = qualifiedTable(this.em, "LearningUnit");
        const goalTable = qualifiedTable(this.em, "LearningGoal");
        const revisionTable = qualifiedTable(this.em, "CognitiveModelRevision");
        const outboxTable = qualifiedTable(this.em, "EventOutbox");
        const now = new Date();
        const gap = input.planningCoverageGap;
        if (!gap) {
            await execute(`UPDATE ${unitTable}
            SET "cognitiveModelStatus" = 'failed',
                "cognitiveModelBuildStartedAt" = NULL,
                "cognitiveModelBuildToken" = NULL
          WHERE "id" = ? AND "goalId" = ? AND "cognitiveModelBuildToken" = ?`, [input.unitId, input.goalId, input.token]);
        }
        else if (gap.affectedUnitIds.length > 0) {
            await execute(`UPDATE ${unitTable}
            SET "cognitiveModelStatus" = 'pending',
                "cognitiveModelBuildStartedAt" = NULL,
                "cognitiveModelBuildToken" = NULL,
                "cognitiveModelBuildInputHash" = NULL
          WHERE "goalId" = ? AND "id" IN (${gap.affectedUnitIds.map(() => "?").join(", ")})`, [input.goalId, ...gap.affectedUnitIds]);
            const goal = resultRows(await execute(`SELECT "cognitiveModelInputHash", "cognitiveModelVersion"
             FROM ${goalTable} WHERE "id" = ? LIMIT 1`, [input.goalId]))[0];
            if (goal) {
                await execute(`UPDATE ${goalTable}
              SET "cognitiveModelStatus" = CASE
                    WHEN "cognitiveModelPublishedHash" = "cognitiveModelInputHash"
                    THEN 'building' ELSE 'needs_reconciliation' END,
                  "updatedAt" = ? WHERE "id" = ?`, [now, input.goalId]);
                const dueAt = sqlTimestampParameter(false, now);
                await execute(`INSERT INTO ${outboxTable}
            ("id", "type", "payload", "createdAt", "nextAttemptAt")
           VALUES (?, 'cognitive.model.expand_next', ?, ?, ?)`, [
                    randomUUID(),
                    JSON.stringify({
                        goalId: input.goalId,
                        inputHash: stringValue(rowValue(goal, "cognitiveModelInputHash")),
                        baseModelVersion: Number(rowValue(goal, "cognitiveModelVersion")) || 0,
                        reason: "planning_coverage_gap",
                        affectedUnitIds: gap.affectedUnitIds,
                    }),
                    dueAt,
                    dueAt,
                ]);
            }
        }
        const jsonType = "";
        const planningCoverage = gap
            ? {
                mode: "failed",
                message: input.message,
                affectedUnitIds: gap.affectedUnitIds,
            }
            : undefined;
        await execute(`UPDATE ${revisionTable}
          SET "status" = 'failed', "snapshotJson" = '{}'${jsonType},
              "auditJson" = ?${jsonType}, "errorJson" = ?${jsonType},
              "updatedAt" = ?
        WHERE "id" = (
          SELECT "id" FROM ${revisionTable}
           WHERE "goalId" = ? AND "inputHash" = ? AND "status" = 'candidate'
           ORDER BY "version" DESC LIMIT 1
        )`, [
            JSON.stringify(planningCoverage ? { planningCoverage } : {}),
            JSON.stringify({
                message: input.message,
                unitId: input.unitId,
                ...(planningCoverage ? { planningCoverage } : {}),
            }),
            now,
            input.goalId,
            input.inputHash,
        ]);
    }
}
