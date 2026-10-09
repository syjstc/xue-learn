import { createHash, randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { ClaimModuleStructureDraftInput, ModuleStructureDraftProgress, ModuleStructureDraftRecord, ModuleStructureDraftRepository, ModuleStructureDraftStage, PatchModuleStructureDraftInput, UpsertModuleStructureDraftInput, } from "@xue-learn/core/source/libs/domain/src/persistence/module-structure-draft-port.ts";
import { MODULE_STRUCTURE_DRAFT_STAGES } from "@xue-learn/core/source/libs/domain/src/persistence/module-structure-draft-port.ts";
export const GOAL_MODULE_STRUCTURE_DRAFT_PREPARE_EVENT = "goal.module_structure.draft.prepare";
export const GOAL_MODULE_STRUCTURE_AUDIT_EVENT = "goal.module_structure.audit";
export const GOAL_CREATION_COORDINATE_EVENT = "goal.creation.coordinate";
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
function qualifiedTable(em: EntityManager, table: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${table.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
function asDate(value: unknown): Date | null {
    if (value instanceof Date)
        return value;
    if (typeof value === "string" || typeof value === "number") {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
}
function asStage(value: unknown): ModuleStructureDraftStage {
    return MODULE_STRUCTURE_DRAFT_STAGES.includes(value as ModuleStructureDraftStage)
        ? (value as ModuleStructureDraftStage)
        : "queued";
}
function record(row: ValueRow): ModuleStructureDraftRecord {
    return {
        moduleId: String(row.moduleId ?? row.moduleid ?? ""),
        sessionId: String(row.sessionId ?? row.sessionid ?? ""),
        goalId: String(row.goalId ?? row.goalid ?? ""),
        planHash: String(row.planHash ?? row.planhash ?? ""),
        candidateJson: String(row.candidateJson ?? row.candidatejson ?? "{}"),
        candidateHash: String(row.candidateHash ?? row.candidatehash ?? ""),
        status: asStage(row.status),
        attemptCount: Number(row.attemptCount ?? row.attemptcount ?? 0),
        issuesJson: String(row.issuesJson ?? row.issuesjson ?? "[]"),
        leaseToken: row.leaseToken == null && row.leasetoken == null
            ? null
            : String(row.leaseToken ?? row.leasetoken),
        leaseUntil: asDate(row.leaseUntil ?? row.leaseuntil),
        publishedAt: asDate(row.publishedAt ?? row.publishedat),
        createdAt: asDate(row.createdAt ?? row.createdat) ?? new Date(0),
        updatedAt: asDate(row.updatedAt ?? row.updatedat) ?? new Date(0),
    };
}
function parseIssues(raw: string): string[] {
    try {
        const parsed = JSON.parse(raw) as unknown;
        return Array.isArray(parsed)
            ? parsed.flatMap((item) => (typeof item === "string" ? [item] : []))
            : [];
    }
    catch {
        return [];
    }
}
export function moduleStructureAuditGeneration(drafts: readonly Pick<ModuleStructureDraftRecord, "moduleId" | "candidateHash">[]): string {
    return createHash("sha256")
        .update(drafts
        .map((draft) => `${draft.moduleId}:${draft.candidateHash}`)
        .sort()
        .join("\n"))
        .digest("hex");
}
export class MikroOrmModuleStructureDraftRepository implements ModuleStructureDraftRepository {
    constructor(private readonly em: EntityManager) { }
    async upsertMany(inputs: readonly UpsertModuleStructureDraftInput[]) {
        if (inputs.length === 0)
            return;
        await this.em.transactional(async (em) => {
            const table = qualifiedTable(em, "ModuleStructureDraft");
            const execute = (sql: string, params: unknown[] = []) => em
                .getConnection()
                .execute(sql, params, undefined, em.getTransactionContext());
            const now = new Date();
            for (const input of inputs) {
                {
                    await execute(`INSERT INTO ${table}
              ("moduleId","sessionId","goalId","planHash","status","createdAt","updatedAt")
             VALUES (?,?,?,?,?,?,?)
             ON CONFLICT ("moduleId") DO UPDATE SET
               "sessionId"=excluded."sessionId",
               "goalId"=excluded."goalId",
               "planHash"=excluded."planHash",
               "status"=CASE
                 WHEN "ModuleStructureDraft"."status" IN ('ready','publishing') THEN "ModuleStructureDraft"."status"
                 ELSE excluded."status"
               END,
               "updatedAt"=excluded."updatedAt"`, [
                        input.moduleId,
                        input.sessionId,
                        input.goalId,
                        input.planHash,
                        input.status ?? "queued",
                        now,
                        now,
                    ]);
                }
            }
        });
    }
    async claim(input: ClaimModuleStructureDraftInput) {
        return this.em.transactional(async (em) => {
            const table = qualifiedTable(em, "ModuleStructureDraft");
            const execute = (sql: string, params: unknown[] = []) => em
                .getConnection()
                .execute(sql, params, undefined, em.getTransactionContext());
            const lock = "";
            const rows = resultRows(await execute(`SELECT * FROM ${table} WHERE "moduleId"=?${lock}`, [
                input.moduleId,
            ]));
            const current = rows[0] ? record(rows[0]) : null;
            if (!current)
                return null;
            if (input.stopRequested)
                return null;
            const leaseActive = current.leaseUntil &&
                current.leaseUntil.getTime() > input.now.getTime() &&
                current.leaseToken;
            if (leaseActive)
                return null;
            if (current.status === "ready" || current.status === "publishing") {
                return null;
            }
            const leaseUntil = new Date(input.now.getTime() + input.leaseMs);
            const nextStatus = current.status === "failed" || current.status === "queued"
                ? "authoring"
                : current.status === "ready_for_audit"
                    ? current.status
                    : "authoring";
            await execute(`UPDATE ${table}
            SET "leaseToken"=?, "leaseUntil"=?, "status"=?, "updatedAt"=?
          WHERE "moduleId"=?`, [input.token, leaseUntil, nextStatus, input.now, input.moduleId]);
            return {
                ...current,
                leaseToken: input.token,
                leaseUntil,
                status: nextStatus as ModuleStructureDraftStage,
                updatedAt: input.now,
            };
        });
    }
    async patch(input: PatchModuleStructureDraftInput) {
        return this.em.transactional(async (em) => {
            const table = qualifiedTable(em, "ModuleStructureDraft");
            const assignments: string[] = ['"updatedAt" = ?'];
            const params: unknown[] = [new Date()];
            if (input.status) {
                assignments.push('"status" = ?');
                params.push(input.status);
            }
            if (input.candidateJson !== undefined) {
                assignments.push('"candidateJson" = ?');
                params.push(input.candidateJson);
            }
            if (input.candidateHash !== undefined) {
                assignments.push('"candidateHash" = ?');
                params.push(input.candidateHash);
            }
            if (input.issuesJson !== undefined) {
                assignments.push('"issuesJson" = ?');
                params.push(input.issuesJson);
            }
            if (input.attemptCount !== undefined) {
                assignments.push('"attemptCount" = ?');
                params.push(input.attemptCount);
            }
            if (input.publishedAt !== undefined) {
                assignments.push('"publishedAt" = ?');
                params.push(input.publishedAt);
            }
            if (input.clearLease) {
                assignments.push('"leaseToken" = NULL', '"leaseUntil" = NULL');
            }
            const where = ['"moduleId" = ?'];
            params.push(input.moduleId);
            if (input.expectedToken !== undefined) {
                where.push('"leaseToken" = ?');
                params.push(input.expectedToken);
            }
            const result = await em
                .getConnection()
                .execute(`UPDATE ${table} SET ${assignments.join(", ")} WHERE ${where.join(" AND ")}`, params, undefined, em.getTransactionContext());
            if (typeof result === "number")
                return result > 0;
            if (result && typeof result === "object" && "affectedRows" in result) {
                return Number((result as {
                    affectedRows?: unknown;
                }).affectedRows) > 0;
            }
            return true;
        });
    }
    async listByGoal(goalId: string) {
        const rows = resultRows(await this.em
            .getConnection()
            .execute(`SELECT d.* FROM ${qualifiedTable(this.em, "ModuleStructureDraft")} d
           JOIN ${qualifiedTable(this.em, "LearningModule")} m ON m."id" = d."moduleId" AND m."goalId" = d."goalId"
           WHERE d."goalId"=? ORDER BY m."orderIndex", d."moduleId"`, [goalId]));
        return rows.map(record);
    }
    async listModuleIdsForGoal(goalId: string) {
        const rows = resultRows(await this.em
            .getConnection()
            .execute(`SELECT "id" FROM ${qualifiedTable(this.em, "LearningModule")} WHERE "goalId"=? ORDER BY "orderIndex" ASC, "id" ASC`, [goalId]));
        return rows.map((row) => String(row.id ?? row.ID ?? ""));
    }
    async listBySession(sessionId: string) {
        const rows = resultRows(await this.em
            .getConnection()
            .execute(`SELECT * FROM ${qualifiedTable(this.em, "ModuleStructureDraft")} WHERE "sessionId"=? ORDER BY "moduleId"`, [sessionId]));
        return rows.map(record);
    }
    async progressForGoal(goalId: string): Promise<ModuleStructureDraftProgress> {
        const drafts = await this.listByGoal(goalId);
        return {
            preparedModuleCount: drafts.filter((draft) => ["ready_for_audit", "publishing", "ready"].includes(draft.status)).length,
            publishedModuleCount: drafts.filter((draft) => draft.status === "ready")
                .length,
            failedModuleCount: drafts.filter((draft) => draft.status === "failed")
                .length,
            modules: drafts.map((draft) => ({
                id: draft.moduleId,
                status: draft.status,
                attemptCount: draft.attemptCount,
                issues: parseIssues(draft.issuesJson),
            })),
        };
    }
    async deleteBySession(sessionId: string) {
        const result = await this.em
            .getConnection()
            .execute(`DELETE FROM ${qualifiedTable(this.em, "ModuleStructureDraft")} WHERE "sessionId"=?`, [sessionId]);
        if (typeof result === "number")
            return result;
        return 0;
    }
    async recoverStaleLeases(now: Date) {
        const result = await this.em.getConnection().execute(`UPDATE ${qualifiedTable(this.em, "ModuleStructureDraft")}
          SET "leaseToken"=NULL, "leaseUntil"=NULL, "status"='queued', "updatedAt"=?
        WHERE "leaseUntil" IS NOT NULL AND "leaseUntil" < ?
          AND "status" NOT IN ('ready','failed')`, [now, now]);
        if (typeof result === "number")
            return result;
        return 0;
    }
    async listGoalSessionsWithStatuses(statuses: readonly ModuleStructureDraftStage[]) {
        if (statuses.length === 0)
            return [];
        const placeholders = statuses.map(() => "?").join(", ");
        const rows = resultRows(await this.em
            .getConnection()
            .execute(`SELECT DISTINCT "goalId", "sessionId"
             FROM ${qualifiedTable(this.em, "ModuleStructureDraft")}
            WHERE "status" IN (${placeholders})`, [...statuses]));
        return rows.flatMap((row) => {
            const goalId = String(row.goalId ?? row.goalid ?? "");
            const sessionId = String(row.sessionId ?? row.sessionid ?? "");
            return goalId && sessionId ? [{ goalId, sessionId }] : [];
        });
    }
    private async upsertUnpublishedOutbox(input: {
        id: string;
        type: string;
        payload: string;
    }) {
        const table = qualifiedTable(this.em, "EventOutbox");
        const excluded = "excluded";
        await this.em
            .getConnection()
            .execute(`INSERT INTO ${table} ("id","type","payload") VALUES (?,?,?)
         ON CONFLICT ("id") DO UPDATE SET
           "payload" = ${excluded}."payload",
           "publishedAt" = NULL,
           "deadLetteredAt" = NULL,
           "lastError" = NULL,
           "attemptCount" = 0,
           "nextAttemptAt" = CURRENT_TIMESTAMP
         WHERE ${table}."publishedAt" IS NOT NULL
            OR ${table}."deadLetteredAt" IS NOT NULL`, [input.id, input.type, input.payload]);
    }
    async enqueuePrepareEvents(input: {
        goalId: string;
        sessionId: string;
        moduleIds: readonly string[];
        reason: string;
    }) {
        if (input.moduleIds.length === 0)
            return 0;
        await this.em.transactional(async (em) => {
            const table = qualifiedTable(em, "EventOutbox");
            const execute = (sql: string, params: unknown[] = []) => em
                .getConnection()
                .execute(sql, params, undefined, em.getTransactionContext());
            for (const moduleId of input.moduleIds) {
                await execute(`INSERT INTO ${table} ("id","type","payload") VALUES (?,?,?)`, [
                    randomUUID(),
                    GOAL_MODULE_STRUCTURE_DRAFT_PREPARE_EVENT,
                    JSON.stringify({
                        goalId: input.goalId,
                        sessionId: input.sessionId,
                        moduleId,
                        reason: input.reason,
                    }),
                ]);
            }
        });
        return input.moduleIds.length;
    }
    async enqueueAuditEvent(input: {
        goalId: string;
        sessionId: string;
    }) {
        const drafts = await this.listByGoal(input.goalId);
        const auditGeneration = moduleStructureAuditGeneration(drafts);
        await this.upsertUnpublishedOutbox({
            id: `goal-module-structure-audit:${input.goalId}:${auditGeneration}`,
            type: GOAL_MODULE_STRUCTURE_AUDIT_EVENT,
            payload: JSON.stringify({
                goalId: input.goalId,
                sessionId: input.sessionId,
                auditGeneration,
            }),
        });
    }
    async enqueueCoordinateEvent(input: {
        goalId: string;
        sessionId: string;
        reason: string;
        idempotencyKey?: string;
    }) {
        const payload = JSON.stringify({
            goalId: input.goalId,
            sessionId: input.sessionId,
            reason: input.reason,
        });
        if (input.idempotencyKey) {
            await this.upsertUnpublishedOutbox({
                id: input.idempotencyKey,
                type: GOAL_CREATION_COORDINATE_EVENT,
                payload,
            });
            return;
        }
        await this.em
            .getConnection()
            .execute(`INSERT INTO ${qualifiedTable(this.em, "EventOutbox")} ("id","type","payload") VALUES (?,?,?)`, [randomUUID(), GOAL_CREATION_COORDINATE_EVENT, payload]);
    }
    async requeueFailedWork(input: {
        goalId: string;
        sessionId: string;
    }) {
        const drafts = await this.listByGoal(input.goalId);
        const failed = drafts.filter((draft) => draft.status === "failed");
        if (failed.length > 0) {
            for (const draft of failed) {
                await this.patch({ moduleId: draft.moduleId, status: "queued" });
            }
            await this.enqueuePrepareEvents({
                goalId: input.goalId,
                sessionId: input.sessionId,
                moduleIds: failed.map((draft) => draft.moduleId),
                reason: "retry_failed",
            });
        }
        const awaitingAudit = drafts.length > 0 &&
            drafts.every((draft) => ["ready_for_audit", "ready"].includes(draft.status)) &&
            drafts.some((draft) => draft.status === "ready_for_audit");
        if (awaitingAudit) {
            await this.enqueueAuditEvent(input);
        }
        if (failed.length === 0 && !awaitingAudit) {
            await this.enqueueCoordinateEvent({
                ...input,
                reason: "retry",
            });
        }
        return { draftCount: failed.length, auditEnqueued: awaitingAudit };
    }
}
