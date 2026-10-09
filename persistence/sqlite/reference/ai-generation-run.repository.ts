import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { AiGenerationRunEventRecord, AiGenerationRunRecord, AiGenerationRunRepository, } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { referenceDateValue } from "./date-value.ts";
type Row = Readonly<Record<string, unknown>>;
function rows(result: unknown): readonly Row[] {
    if (Array.isArray(result))
        return result as Row[];
    if (result && typeof result === "object" && "rows" in result) {
        const value = (result as {
            rows?: unknown;
        }).rows;
        return Array.isArray(value) ? (value as Row[]) : [];
    }
    return [];
}
function value(row: Row, key: string): unknown {
    return row[key] ?? row[key[0]!.toLowerCase() + key.slice(1)];
}
function table(em: EntityManager, name: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${name.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
function date(raw: unknown): Date {
    return referenceDateValue(raw);
}
function runRecord(row: Row): AiGenerationRunRecord {
    return {
        id: String(value(row, "id")),
        userId: value(row, "userId") == null ? null : String(value(row, "userId")),
        scope: String(value(row, "scope")),
        scopeId: String(value(row, "scopeId")),
        operation: String(value(row, "operation")),
        status: String(value(row, "status")),
        eventsJson: String(value(row, "eventsJson") ?? "[]"),
        tokenPreview: String(value(row, "tokenPreview") ?? ""),
        statusMessage: String(value(row, "statusMessage") ?? ""),
        resultJson: String(value(row, "resultJson") ?? "{}"),
        errorMessage: value(row, "errorMessage") == null
            ? null
            : String(value(row, "errorMessage")),
        nextEventSequence: Number(value(row, "nextEventSequence")) || 0,
        createdAt: date(value(row, "createdAt")),
        updatedAt: date(value(row, "updatedAt")),
    };
}
function eventRecord(row: Row): AiGenerationRunEventRecord {
    return {
        sequence: Number(value(row, "sequence")),
        type: String(value(row, "type")),
        payload: String(value(row, "payload")),
        snapshotKey: value(row, "snapshotKey") == null
            ? null
            : String(value(row, "snapshotKey")),
    };
}
export class MikroOrmAiGenerationRunRepository implements AiGenerationRunRepository {
    constructor(private readonly em: EntityManager) { }
    private execute(em: EntityManager, sql: string, params: unknown[] = []) {
        return em
            .getConnection()
            .execute(sql, params, undefined, em.getTransactionContext());
    }
    async appendContentVerificationAudit(input: Parameters<AiGenerationRunRepository["appendContentVerificationAudit"]>[0]): Promise<void> {
        await this.execute(this.em, `INSERT INTO ${table(this.em, "ContentVerificationAudit")}
        ("id", "runId", "artifactKind", "mode", "status", "provider", "model",
         "blockCount", "repairedCount", "issuesJson", "createdAt")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
            randomUUID(), input.runId, input.artifactKind, input.mode, input.status,
            input.provider, input.model, input.blockCount, input.repairedCount,
            input.issuesJson, input.createdAt,
        ]);
    }
    async create(input: {
        id: string;
        userId: string | null;
        scope: string;
        scopeId: string;
        operation: string;
        now: Date;
    }): Promise<void> {
        await this.execute(this.em, `INSERT INTO ${table(this.em, "AiGenerationRun")}
        ("id", "userId", "scope", "scopeId", "operation", "status", "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, ?, 'running', ?, ?)`, [
            input.id,
            input.userId,
            input.scope,
            input.scopeId,
            input.operation,
            input.now,
            input.now,
        ]);
    }
    async find(runId: string): Promise<AiGenerationRunRecord | null> {
        const found = rows(await this.execute(this.em, `SELECT * FROM ${table(this.em, "AiGenerationRun")} WHERE "id" = ? LIMIT 1`, [runId]))[0];
        return found ? runRecord(found) : null;
    }
    async updateScopeId(runId: string, scopeId: string): Promise<void> {
        await this.execute(this.em, `UPDATE ${table(this.em, "AiGenerationRun")} SET "scopeId" = ?, "updatedAt" = ? WHERE "id" = ?`, [scopeId, new Date(), runId]);
    }
    async listRunning(input: {
        scope: string;
        scopeId: string;
        operation?: string;
        userId?: string;
    }): Promise<readonly AiGenerationRunRecord[]> {
        const result = await this.execute(this.em, `SELECT * FROM ${table(this.em, "AiGenerationRun")}
        WHERE "scope" = ? AND "scopeId" = ? AND "status" = 'running'
          ${input.operation ? 'AND "operation" = ?' : ""}
          ${input.userId ? 'AND "userId" = ?' : ""}
        ORDER BY "createdAt" DESC`, [
            input.scope,
            input.scopeId,
            ...(input.operation ? [input.operation] : []),
            ...(input.userId ? [input.userId] : []),
        ]);
        return rows(result).map(runRecord);
    }
    async listEventsAfter(runId: string, sequence: number) {
        return rows(await this.execute(this.em, `SELECT "sequence", "type", "payload", "snapshotKey"
           FROM ${table(this.em, "AiGenerationRunEvent")}
          WHERE "runId" = ? AND "sequence" > ? ORDER BY "sequence" ASC`, [runId, sequence])).map(eventRecord);
    }
    async touchRunning(runId: string, now: Date): Promise<boolean> {
        return (rows(await this.execute(this.em, `UPDATE ${table(this.em, "AiGenerationRun")} SET "updatedAt" = ?
            WHERE "id" = ? AND "status" = 'running' RETURNING "id"`, [now, runId])).length === 1);
    }
    async appendEvent(input: {
        runId: string;
        type: string;
        payload: string;
        snapshotKey?: string;
        tokenDelta?: string;
        statusMessage?: string;
        now: Date;
    }): Promise<AiGenerationRunEventRecord | null> {
        return this.em.transactional(async (em) => {
            const runTable = table(em, "AiGenerationRun");
            const eventTable = table(em, "AiGenerationRunEvent");
            const current = rows(await this.execute(em, `SELECT "status", "tokenPreview", "nextEventSequence" FROM ${runTable}
            WHERE "id" = ?${""}`, [input.runId]))[0];
            if (!current || value(current, "status") !== "running")
                return null;
            const sequence = Number(value(current, "nextEventSequence")) + 1;
            const tokenPreview = input.tokenDelta
                ? `${String(value(current, "tokenPreview") ?? "")}${input.tokenDelta}`.slice(-8000)
                : undefined;
            await this.execute(em, `UPDATE ${runTable} SET "nextEventSequence" = ?,
          "tokenPreview" = COALESCE(?, "tokenPreview"),
          "statusMessage" = COALESCE(?, "statusMessage"), "updatedAt" = ?
          WHERE "id" = ?`, [
                sequence,
                tokenPreview ?? null,
                input.statusMessage ?? null,
                input.now,
                input.runId,
            ]);
            if (input.snapshotKey) {
                await this.execute(em, `INSERT INTO ${eventTable}
            ("id", "runId", "sequence", "type", "payload", "snapshotKey", "createdAt")
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT ("runId", "snapshotKey") DO UPDATE SET
             "sequence" = excluded."sequence", "type" = excluded."type",
             "payload" = excluded."payload", "createdAt" = excluded."createdAt"`, [
                    randomUUID(),
                    input.runId,
                    sequence,
                    input.type,
                    input.payload,
                    input.snapshotKey,
                    input.now,
                ]);
            }
            else {
                await this.execute(em, `INSERT INTO ${eventTable}
            ("id", "runId", "sequence", "type", "payload", "createdAt")
           VALUES (?, ?, ?, ?, ?, ?)`, [
                    randomUUID(),
                    input.runId,
                    sequence,
                    input.type,
                    input.payload,
                    input.now,
                ]);
            }
            return {
                sequence,
                type: input.type,
                payload: input.payload,
                snapshotKey: input.snapshotKey ?? null,
            };
        });
    }
    async transition(input: {
        runId: string;
        status: "completed" | "cancelled" | "error";
        type: string;
        payload: string;
        statusMessage?: string;
        errorMessage?: string;
        resultJson?: string;
        staleBefore?: Date;
        now: Date;
    }): Promise<AiGenerationRunEventRecord | null> {
        return this.em.transactional(async (em) => {
            const runTable = table(em, "AiGenerationRun");
            const updated = rows(await this.execute(em, `UPDATE ${runTable}
              SET "nextEventSequence" = "nextEventSequence" + 1,
                  "status" = ?, "statusMessage" = COALESCE(?, "statusMessage"),
                  "errorMessage" = COALESCE(?, "errorMessage"),
                  "resultJson" = COALESCE(?, "resultJson"), "updatedAt" = ?
            WHERE "id" = ? AND "status" = 'running'
              ${input.staleBefore ? 'AND "updatedAt" < ?' : ""}
            RETURNING "nextEventSequence"`, [
                input.status,
                input.statusMessage ?? null,
                input.errorMessage ?? null,
                input.resultJson ?? null,
                input.now,
                input.runId,
                ...(input.staleBefore ? [input.staleBefore] : []),
            ]))[0];
            if (!updated)
                return null;
            const sequence = Number(value(updated, "nextEventSequence"));
            await this.execute(em, `INSERT INTO ${table(em, "AiGenerationRunEvent")}
          ("id", "runId", "sequence", "type", "payload", "createdAt")
         VALUES (?, ?, ?, ?, ?, ?)`, [
                randomUUID(),
                input.runId,
                sequence,
                input.type,
                input.payload,
                input.now,
            ]);
            return {
                sequence,
                type: input.type,
                payload: input.payload,
                snapshotKey: null,
            };
        });
    }
    async failRunningLlmRequests(runId: string, message: string): Promise<void> {
        await this.execute(this.em, `UPDATE ${table(this.em, "LlmRequestLog")}
          SET "status" = 'error', "error" = ?,
              "structuredFailureCategory" = 'interrupted'
        WHERE "traceId" = ? AND "status" = 'running'`, [message, runId]);
    }
    async recoverInterrupted(message: string, eventPayload: string) {
        return this.em.transactional(async (em) => {
            const active = rows(await this.execute(em, `SELECT "id" FROM ${table(em, "AiGenerationRun")} WHERE "status" = 'running'`));
            let tracedLogs = 0;
            for (const row of active) {
                const runId = String(value(row, "id"));
                const updated = rows(await this.execute(em, `UPDATE ${table(em, "AiGenerationRun")} SET "nextEventSequence" = "nextEventSequence" + 1, "status" = 'error', "statusMessage" = '', "errorMessage" = ?, "updatedAt" = ? WHERE "id" = ? AND "status" = 'running' RETURNING "nextEventSequence"`, [message, new Date(), runId]))[0];
                if (!updated)
                    continue;
                await this.execute(em, `INSERT INTO ${table(em, "AiGenerationRunEvent")} ("id","runId","sequence","type","payload","createdAt") VALUES (?, ?, ?, 'error', ?, ?)`, [randomUUID(), runId, Number(value(updated, "nextEventSequence")), eventPayload, new Date()]);
                const logResult = await this.execute(em, `UPDATE ${table(em, "LlmRequestLog")} SET "status"='error',"error"=?,"structuredFailureCategory"='interrupted' WHERE "traceId"=? AND "status"='running'`, [message, runId]);
                tracedLogs +=
                    typeof logResult === "number"
                        ? logResult
                        : Number((logResult as {
                            affectedRows?: number;
                        }).affectedRows ??
                            (logResult as {
                                rowCount?: number;
                            }).rowCount ??
                            0);
            }
            const requestResult = await this.execute(em, `UPDATE ${table(em, "LlmRequestLog")} SET "status"='error',"error"=?,"structuredFailureCategory"='interrupted' WHERE "status"='running' AND "requestId" IS NOT NULL`, [message]);
            const requestLogs = typeof requestResult === "number"
                ? requestResult
                : Number((requestResult as {
                    affectedRows?: number;
                }).affectedRows ??
                    (requestResult as {
                        rowCount?: number;
                    }).rowCount ??
                    0);
            return { runs: active.length, llmLogs: tracedLogs + requestLogs };
        });
    }
}
