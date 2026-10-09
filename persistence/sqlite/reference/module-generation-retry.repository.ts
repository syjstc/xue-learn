import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { ModuleGenerationRetryInput, ModuleGenerationRetryRecord, ModuleGenerationRetryRepository, } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { safeReferenceDateValue, sqlTimestampParameter } from "./date-value.ts";
type ValueRow = Readonly<Record<string, unknown>>;
const COURSE_MODULE_GENERATE_EVENT = "course.module.generate";
const COGNITIVE_MODEL_EXPAND_NEXT_EVENT = "cognitive.model.expand_next";
const UNIT_EXPANSION_LEASE_MS = 15 * 60 * 1000;
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
function timeValue(value: unknown): number {
    return safeReferenceDateValue(value)?.getTime() ?? 0;
}
function qualifiedTable(em: EntityManager, table: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${table.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
function timestampParameter(em: EntityManager, input: Date): Date | string {
    return sqlTimestampParameter(false, input);
}
function placeholders(count: number): string {
    return Array.from({ length: count }, () => "?").join(", ");
}
/** Atomic owner-scoped retry/recovery transition for sequential modules. */
export class MikroOrmModuleGenerationRetryRepository implements ModuleGenerationRetryRepository {
    constructor(private readonly em: EntityManager) { }
    async retryOwned(input: ModuleGenerationRetryInput): Promise<ModuleGenerationRetryRecord> {
        return this.em.transactional((tx) => this.retryInTransaction(tx, input));
    }
    private async retryInTransaction(em: EntityManager, input: ModuleGenerationRetryInput): Promise<ModuleGenerationRetryRecord> {
        const goalTable = qualifiedTable(em, "LearningGoal");
        const moduleTable = qualifiedTable(em, "LearningModule");
        const unitTable = qualifiedTable(em, "LearningUnit");
        const eventTable = qualifiedTable(em, "EventOutbox");
        const connection = em.getConnection();
        const execute = (sql: string, params: unknown[] = []) => connection.execute(sql, params, undefined, em.getTransactionContext());
        const now = new Date();
        const dueAt = timestampParameter(em, now);
        const moduleRows = resultRows(await execute(`SELECT m."id", m."goalId", m."unlockStatus", m."generationStatus",
                g."learningMode", g."cognitiveModelInputHash",
                g."cognitiveModelPublishedHash", g."cognitiveModelVersion"
           FROM ${moduleTable} m
           JOIN ${goalTable} g ON g."id" = m."goalId"
          WHERE m."id" = ? AND m."goalId" = ? AND g."userId" = ?
          ${""}`, [input.moduleId, input.goalId, input.userId]));
        const module = moduleRows[0];
        if (!module)
            throw new Error("Module not found");
        if (rowValue(module, "unlockStatus") === "locked") {
            throw new Error("MODULE_LOCKED");
        }
        const moduleStatus = stringValue(rowValue(module, "generationStatus"));
        if (moduleStatus === "failed") {
            await execute(`UPDATE ${moduleTable}
            SET "generationStatus" = 'pending',
                "generationBuildStartedAt" = NULL,
                "generationBuildToken" = NULL,
                "generationError" = '',
                "updatedAt" = ?
          WHERE "id" = ?`, [now, input.moduleId]);
            await execute(`INSERT INTO ${eventTable}
          ("id", "type", "payload", "createdAt", "nextAttemptAt")
         VALUES (?, ?, ?, ?, ?)`, [
                randomUUID(),
                COURSE_MODULE_GENERATE_EVENT,
                JSON.stringify({
                    goalId: input.goalId,
                    moduleId: input.moduleId,
                    reason: "manual_retry",
                }),
                dueAt,
                dueAt,
            ]);
            return { enqueued: true, status: "pending" };
        }
        const lessons = resultRows(await execute(`SELECT "id", "cognitiveModelStatus", "cognitiveModelBuildStartedAt"
           FROM ${unitTable}
          WHERE "moduleId" = ? AND "unitKind" = 'lesson'`, [input.moduleId]));
        if (lessons.length === 0) {
            return { enqueued: false, status: moduleStatus };
        }
        if (rowValue(module, "learningMode") === "exploration") {
            await execute(`UPDATE ${unitTable}
            SET "cognitiveModelStatus" = 'expanded',
                "cognitiveModelBuildStartedAt" = NULL,
                "cognitiveModelBuildToken" = NULL,
                "cognitiveModelBuildInputHash" = NULL
          WHERE "moduleId" = ? AND "unitKind" = 'lesson'`, [input.moduleId]);
            await execute(`UPDATE ${moduleTable}
            SET "generationStatus" = 'ready',
                "generationBuildStartedAt" = NULL,
                "generationBuildToken" = NULL,
                "generationError" = '',
                "updatedAt" = ?
          WHERE "id" = ?`, [now, input.moduleId]);
            return { enqueued: false, status: "ready" };
        }
        const rearmIds = lessons
            .filter((unit) => {
            const status = rowValue(unit, "cognitiveModelStatus");
            if (status === "failed")
                return true;
            if (status !== "building")
                return false;
            const startedAt = timeValue(rowValue(unit, "cognitiveModelBuildStartedAt"));
            return now.getTime() - startedAt >= UNIT_EXPANSION_LEASE_MS;
        })
            .map((unit) => stringValue(rowValue(unit, "id")))
            .filter((id) => id.length > 0);
        const incomplete = lessons.some((unit) => rowValue(unit, "cognitiveModelStatus") !== "expanded");
        if (!incomplete && rearmIds.length === 0) {
            return { enqueued: false, status: moduleStatus };
        }
        const activelyBuilding = lessons.some((unit) => {
            if (rowValue(unit, "cognitiveModelStatus") !== "building")
                return false;
            const startedAt = timeValue(rowValue(unit, "cognitiveModelBuildStartedAt"));
            return now.getTime() - startedAt < UNIT_EXPANSION_LEASE_MS;
        });
        const liveExpandRows = resultRows(await execute(`SELECT "id", "payload"
           FROM ${eventTable}
          WHERE "type" = ?
            AND "publishedAt" IS NULL
            AND "deadLetteredAt" IS NULL
            AND "payload" LIKE ?
          LIMIT 1`, [COGNITIVE_MODEL_EXPAND_NEXT_EVENT, `%"goalId":"${input.goalId}"%`]));
        // Structure is already published. Drop a leftover publication lease so
        // recovery is not swallowed for 15 minutes with no LLM work.
        await execute(`UPDATE ${moduleTable}
          SET "generationBuildToken" = NULL,
              "generationBuildStartedAt" = NULL,
              "updatedAt" = ?
        WHERE "id" = ?`, [now, input.moduleId]);
        // Re-arm failed/stale rows for UI, but do not stack another expand event
        // while a fresh unit expansion lease is still live.
        if (rearmIds.length > 0) {
            await execute(`UPDATE ${unitTable}
            SET "cognitiveModelStatus" = 'pending',
                "cognitiveModelBuildStartedAt" = NULL,
                "cognitiveModelBuildToken" = NULL,
                "cognitiveModelBuildInputHash" = NULL
          WHERE "id" IN (${placeholders(rearmIds.length)})`, rearmIds);
        }
        if (activelyBuilding) {
            return {
                enqueued: false,
                status: moduleStatus,
                rearmed: rearmIds.length > 0,
            };
        }
        const inputHash = stringValue(rowValue(module, "cognitiveModelInputHash"));
        const publishedHash = stringValue(rowValue(module, "cognitiveModelPublishedHash"));
        const baseModelVersion = Number(rowValue(module, "cognitiveModelVersion") ?? 0);
        const liveExpand = liveExpandRows[0];
        if (liveExpand) {
            let livePayload: {
                inputHash?: string;
                baseModelVersion?: number;
            } = {};
            try {
                const parsed = JSON.parse(stringValue(rowValue(liveExpand, "payload")));
                if (parsed && typeof parsed === "object") {
                    livePayload = parsed as {
                        inputHash?: string;
                        baseModelVersion?: number;
                    };
                }
            }
            catch {
                livePayload = {};
            }
            const stale = livePayload.inputHash !== inputHash ||
                livePayload.baseModelVersion !== baseModelVersion;
            const liveId = stringValue(rowValue(liveExpand, "id"));
            if (stale) {
                await execute(`UPDATE ${eventTable}
              SET "payload" = ?, "nextAttemptAt" = ?, "lastError" = NULL
            WHERE "id" = ? AND "publishedAt" IS NULL AND "deadLetteredAt" IS NULL`, [
                    JSON.stringify({
                        goalId: input.goalId,
                        inputHash,
                        baseModelVersion,
                        reason: "manual_module_unit_recovery",
                    }),
                    dueAt,
                    liveId,
                ]);
            }
            else {
                await execute(`UPDATE ${eventTable}
              SET "nextAttemptAt" = ?, "lastError" = NULL
            WHERE "id" = ? AND "publishedAt" IS NULL AND "deadLetteredAt" IS NULL`, [dueAt, liveId]);
            }
            return {
                enqueued: true,
                status: "pending",
                rearmed: rearmIds.length > 0,
                nudged: true,
            };
        }
        const cognitiveModelStatus = publishedHash === inputHash ? "building" : "needs_reconciliation";
        await execute(`UPDATE ${goalTable}
          SET "cognitiveModelStatus" = ?, "updatedAt" = ?
        WHERE "id" = ? AND "userId" = ?`, [cognitiveModelStatus, now, input.goalId, input.userId]);
        if (moduleStatus === "ready") {
            await execute(`UPDATE ${moduleTable}
            SET "generationStatus" = 'building',
                "generationError" = '',
                "updatedAt" = ?
          WHERE "id" = ?`, [now, input.moduleId]);
        }
        await execute(`INSERT INTO ${eventTable}
        ("id", "type", "payload", "createdAt", "nextAttemptAt")
       VALUES (?, ?, ?, ?, ?)`, [
            randomUUID(),
            COGNITIVE_MODEL_EXPAND_NEXT_EVENT,
            JSON.stringify({
                goalId: input.goalId,
                inputHash,
                baseModelVersion,
                reason: "manual_module_unit_recovery",
            }),
            dueAt,
            dueAt,
        ]);
        return { enqueued: true, status: "pending" };
    }
}
