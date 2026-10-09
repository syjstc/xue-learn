import type { EntityManager } from "@mikro-orm/core";
import type { AppendTeachingDerivationStepInput, CreateTeachingDerivationRunInput, TeachingDerivationEventRecord, TeachingDerivationRepository, TeachingDerivationRunRecord, TeachingDerivationRunStatus, TeachingDerivationStepRecord, UpdateTeachingDerivationRunInput, } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { nullableReferenceDateValue, referenceDateValue, sqlTimestampParameter, } from "./date-value.ts";
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
function timestamp(em: EntityManager, input: Date): Date | string {
    return sqlTimestampParameter(false, input);
}
function parseEventsJson(raw: string): TeachingDerivationEventRecord[] {
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed))
            return [];
        return parsed.flatMap((item) => {
            if (!item || typeof item !== "object")
                return [];
            const record = item as {
                sequence?: unknown;
                eventJson?: unknown;
            };
            if (typeof record.sequence !== "number" || typeof record.eventJson !== "string") {
                return [];
            }
            return [{ sequence: record.sequence, eventJson: record.eventJson }];
        });
    }
    catch {
        return [];
    }
}
function runRecord(row: Row): TeachingDerivationRunRecord {
    return {
        id: String(value(row, "id")),
        title: String(value(row, "title")),
        locale: String(value(row, "locale")),
        schemaVersion: Number(value(row, "schemaVersion")) || 1,
        promptVersion: String(value(row, "promptVersion")),
        requirementJson: String(value(row, "requirementJson") ?? "{}"),
        documentJson: String(value(row, "documentJson") ?? "{}"),
        derivedJson: String(value(row, "derivedJson") ?? "{}"),
        eventsJson: String(value(row, "eventsJson") ?? "[]"),
        nextEventSequence: Number(value(row, "nextEventSequence")) || 0,
        parserVersion: String(value(row, "parserVersion") ?? ""),
        analyzerVersion: String(value(row, "analyzerVersion") ?? ""),
        matcherVersion: String(value(row, "matcherVersion") ?? ""),
        compilerVersion: String(value(row, "compilerVersion") ?? ""),
        status: String(value(row, "status")) as TeachingDerivationRunStatus,
        revision: Number(value(row, "revision")) || 0,
        repairAttempts: Number(value(row, "repairAttempts")) || 0,
        generationToken: value(row, "generationToken") == null
            ? null
            : String(value(row, "generationToken")),
        operation: String(value(row, "operation")),
        routedProvider: value(row, "routedProvider") == null
            ? null
            : String(value(row, "routedProvider")),
        routedModel: value(row, "routedModel") == null ? null : String(value(row, "routedModel")),
        validationSummaryJson: value(row, "validationSummaryJson") == null
            ? null
            : String(value(row, "validationSummaryJson")),
        tokenSummaryJson: value(row, "tokenSummaryJson") == null
            ? null
            : String(value(row, "tokenSummaryJson")),
        ownerUserId: value(row, "ownerUserId") == null ? null : String(value(row, "ownerUserId")),
        unitId: value(row, "unitId") == null ? null : String(value(row, "unitId")),
        sectionId: value(row, "sectionId") == null ? null : String(value(row, "sectionId")),
        createdAt: referenceDateValue(value(row, "createdAt")),
        updatedAt: referenceDateValue(value(row, "updatedAt")),
        completedAt: nullableReferenceDateValue(value(row, "completedAt")),
    };
}
function stepRecord(row: Row): TeachingDerivationStepRecord {
    return {
        id: String(value(row, "id")),
        runId: String(value(row, "runId")),
        ordinal: Number(value(row, "ordinal")),
        stepJson: String(value(row, "stepJson") ?? "{}"),
        derivedJson: String(value(row, "derivedJson") ?? "{}"),
        createdAt: referenceDateValue(value(row, "createdAt")),
    };
}
export class MikroOrmTeachingDerivationRepository implements TeachingDerivationRepository {
    constructor(private readonly em: EntityManager) { }
    private execute(em: EntityManager, sql: string, params: unknown[] = []) {
        return em
            .getConnection()
            .execute(sql, params, undefined, em.getTransactionContext());
    }
    async createRun(input: CreateTeachingDerivationRunInput): Promise<void> {
        const run = table(this.em, "TeachingDerivationRun");
        const now = timestamp(this.em, input.now);
        await this.execute(this.em, `INSERT INTO ${run} (
        "id", "title", "locale", "schemaVersion", "promptVersion",
        "requirementJson", "documentJson", "derivedJson", "eventsJson",
        "nextEventSequence", "parserVersion", "analyzerVersion",
        "matcherVersion", "compilerVersion", "status", "revision",
        "repairAttempts", "generationToken", "operation", "ownerUserId",
        "unitId", "sectionId", "createdAt", "updatedAt"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', 0, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?)`, [
            input.id,
            input.title,
            input.locale,
            input.schemaVersion,
            input.promptVersion,
            input.requirementJson,
            input.documentJson,
            input.derivedJson ?? "{}",
            input.parserVersion,
            input.analyzerVersion,
            input.matcherVersion,
            input.compilerVersion,
            input.status ?? "draft",
            input.generationToken ?? null,
            input.operation,
            input.ownerUserId ?? null,
            input.unitId ?? null,
            input.sectionId ?? null,
            now,
            now,
        ]);
    }
    async getRun(id: string): Promise<TeachingDerivationRunRecord | null> {
        const row = rows(await this.execute(this.em, `SELECT * FROM ${table(this.em, "TeachingDerivationRun")} WHERE "id" = ? LIMIT 1`, [id]))[0];
        return row ? runRecord(row) : null;
    }
    async listRunsBySection(sectionId: string, limit = 20): Promise<readonly TeachingDerivationRunRecord[]> {
        return rows(await this.execute(this.em, `SELECT * FROM ${table(this.em, "TeachingDerivationRun")}
          WHERE "sectionId" = ? ORDER BY "updatedAt" DESC LIMIT ?`, [sectionId, limit])).map(runRecord);
    }
    async updateRun(input: UpdateTeachingDerivationRunInput): Promise<boolean> {
        const assignments: string[] = [`"updatedAt" = ?`];
        const params: unknown[] = [timestamp(this.em, input.now)];
        const set = (column: string, value: unknown) => {
            assignments.push(`"${column}" = ?`);
            params.push(value);
        };
        if (input.status !== undefined)
            set("status", input.status);
        if (input.revision !== undefined)
            set("revision", input.revision);
        if (input.repairAttempts !== undefined)
            set("repairAttempts", input.repairAttempts);
        if (input.documentJson !== undefined)
            set("documentJson", input.documentJson);
        if (input.derivedJson !== undefined)
            set("derivedJson", input.derivedJson);
        if (input.generationToken !== undefined)
            set("generationToken", input.generationToken);
        if (input.validationSummaryJson !== undefined) {
            set("validationSummaryJson", input.validationSummaryJson);
        }
        if (input.tokenSummaryJson !== undefined) {
            set("tokenSummaryJson", input.tokenSummaryJson);
        }
        if (input.routedProvider !== undefined)
            set("routedProvider", input.routedProvider);
        if (input.routedModel !== undefined)
            set("routedModel", input.routedModel);
        if (input.completedAt !== undefined) {
            set("completedAt", input.completedAt ? timestamp(this.em, input.completedAt) : null);
        }
        params.push(input.id);
        const result = await this.execute(this.em, `UPDATE ${table(this.em, "TeachingDerivationRun")} SET ${assignments.join(", ")} WHERE "id" = ?`, params);
        const affected = typeof result === "object" && result && "affectedRows" in result
            ? Number((result as {
                affectedRows?: unknown;
            }).affectedRows)
            : 1;
        return affected > 0;
    }
    async appendStep(input: AppendTeachingDerivationStepInput): Promise<boolean> {
        return this.em.transactional(async (em) => {
            const runTable = table(em, "TeachingDerivationRun");
            const owned = rows(await this.execute(em, `SELECT "revision" FROM ${runTable} WHERE "id" = ? LIMIT 1`, [input.runId]))[0];
            if (!owned || Number(value(owned, "revision")) !== input.expectedRevision) {
                return false;
            }
            const now = timestamp(em, input.now);
            await this.execute(em, `INSERT INTO ${table(em, "TeachingDerivationStep")}
          ("id", "runId", "ordinal", "stepJson", "derivedJson", "createdAt")
         VALUES (?, ?, ?, ?, ?, ?)`, [
                input.step.id,
                input.runId,
                input.step.ordinal,
                input.step.stepJson,
                input.step.derivedJson,
                now,
            ]);
            await this.execute(em, `UPDATE ${runTable}
            SET "documentJson" = ?, "derivedJson" = ?, "revision" = ?,
                "repairAttempts" = ?, "updatedAt" = ?
          WHERE "id" = ?`, [
                input.documentJson,
                input.derivedJson,
                input.revision,
                input.repairAttempts,
                now,
                input.runId,
            ]);
            return true;
        });
    }
    async getStepByOrdinal(runId: string, ordinal: number): Promise<TeachingDerivationStepRecord | null> {
        const row = rows(await this.execute(this.em, `SELECT * FROM ${table(this.em, "TeachingDerivationStep")}
          WHERE "runId" = ? AND "ordinal" = ? LIMIT 1`, [runId, ordinal]))[0];
        return row ? stepRecord(row) : null;
    }
    async listSteps(runId: string): Promise<readonly TeachingDerivationStepRecord[]> {
        return rows(await this.execute(this.em, `SELECT * FROM ${table(this.em, "TeachingDerivationStep")}
          WHERE "runId" = ? ORDER BY "ordinal" ASC`, [runId])).map(stepRecord);
    }
    async appendEvent(input: {
        runId: string;
        eventJson: string;
        now: Date;
    }): Promise<TeachingDerivationEventRecord> {
        return this.em.transactional(async (em) => {
            const runTable = table(em, "TeachingDerivationRun");
            const current = rows(await this.execute(em, `SELECT "eventsJson", "nextEventSequence" FROM ${runTable} WHERE "id" = ? LIMIT 1`, [input.runId]))[0];
            const sequence = Number(value(current ?? {}, "nextEventSequence")) || 0;
            const events = parseEventsJson(String(value(current ?? {}, "eventsJson") ?? "[]"));
            const next: TeachingDerivationEventRecord = {
                sequence,
                eventJson: input.eventJson,
            };
            events.push(next);
            await this.execute(em, `UPDATE ${runTable}
            SET "eventsJson" = ?, "nextEventSequence" = ?, "updatedAt" = ?
          WHERE "id" = ?`, [
                JSON.stringify(events),
                sequence + 1,
                timestamp(em, input.now),
                input.runId,
            ]);
            return next;
        });
    }
}
