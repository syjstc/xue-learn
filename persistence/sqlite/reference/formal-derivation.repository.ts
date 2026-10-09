import type { EntityManager } from "@mikro-orm/core";
import type { AppendFormalDerivationStepInput, CreateFormalDerivationRunInput, FormalDerivationCheckpointRecord, FormalDerivationEventRecord, FormalDerivationRepository, FormalDerivationRunRecord, FormalDerivationRunStatus, FormalDerivationStepRecord, ReplaceFormalDerivationStepsInput, UpdateFormalDerivationRunInput, } from "@xue-learn/core/source/libs/domain/src/index.ts";
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
function runRecord(row: Row): FormalDerivationRunRecord {
    return {
        id: String(value(row, "id")),
        title: String(value(row, "title")),
        locale: String(value(row, "locale")),
        schemaVersion: Number(value(row, "schemaVersion")) || 1,
        promptVersion: String(value(row, "promptVersion")),
        requirementJson: String(value(row, "requirementJson") ?? "{}"),
        documentJson: String(value(row, "documentJson") ?? "{}"),
        eventsJson: String(value(row, "eventsJson") ?? "[]"),
        nextEventSequence: Number(value(row, "nextEventSequence")) || 0,
        status: String(value(row, "status")) as FormalDerivationRunStatus,
        revision: Number(value(row, "revision")) || 0,
        operation: String(value(row, "operation")),
        routedProvider: value(row, "routedProvider") == null
            ? null
            : String(value(row, "routedProvider")),
        routedModel: value(row, "routedModel") == null
            ? null
            : String(value(row, "routedModel")),
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
function stepRecord(row: Row): FormalDerivationStepRecord {
    return {
        id: String(value(row, "id")),
        runId: String(value(row, "runId")),
        ordinal: Number(value(row, "ordinal")),
        baseRevision: Number(value(row, "baseRevision")),
        afterRevision: Number(value(row, "afterRevision")),
        kind: String(value(row, "kind")),
        actionsJson: String(value(row, "actionsJson") ?? "[]"),
        presentationJson: String(value(row, "presentationJson") ?? "{}"),
        metadataJson: String(value(row, "metadataJson") ?? "{}"),
        createdAt: referenceDateValue(value(row, "createdAt")),
    };
}
function checkpointRecord(row: Row): FormalDerivationCheckpointRecord {
    return {
        id: String(value(row, "id")),
        runId: String(value(row, "runId")),
        stepOrdinal: Number(value(row, "stepOrdinal")),
        revision: Number(value(row, "revision")),
        stateJson: String(value(row, "stateJson") ?? "{}"),
        createdAt: referenceDateValue(value(row, "createdAt")),
    };
}
function parseEventsJson(raw: string): FormalDerivationEventRecord[] {
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
export class MikroOrmFormalDerivationRepository implements FormalDerivationRepository {
    constructor(private readonly em: EntityManager) { }
    private execute(em: EntityManager, sql: string, params: unknown[] = []) {
        return em
            .getConnection()
            .execute(sql, params, undefined, em.getTransactionContext());
    }
    async createRun(input: CreateFormalDerivationRunInput): Promise<void> {
        const run = table(this.em, "FormalDerivationRun");
        const now = timestamp(this.em, input.now);
        await this.execute(this.em, `INSERT INTO ${run} (
        "id", "title", "locale", "schemaVersion", "promptVersion",
        "requirementJson", "documentJson", "eventsJson", "nextEventSequence",
        "status", "revision", "operation", "ownerUserId", "unitId", "sectionId",
        "createdAt", "updatedAt"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 0, ?, 0, ?, ?, ?, ?, ?, ?)`, [
            input.id,
            input.title,
            input.locale,
            input.schemaVersion,
            input.promptVersion,
            input.requirementJson,
            input.documentJson,
            input.status ?? "draft",
            input.operation,
            input.ownerUserId ?? null,
            input.unitId ?? null,
            input.sectionId ?? null,
            now,
            now,
        ]);
    }
    async getRun(id: string): Promise<FormalDerivationRunRecord | null> {
        const run = table(this.em, "FormalDerivationRun");
        const row = rows(await this.execute(this.em, `SELECT * FROM ${run} WHERE "id" = ? LIMIT 1`, [id]))[0];
        return row ? runRecord(row) : null;
    }
    async listRuns(limit = 50): Promise<readonly FormalDerivationRunRecord[]> {
        const run = table(this.em, "FormalDerivationRun");
        const bounded = Math.min(Math.max(limit, 1), 200);
        return rows(await this.execute(this.em, `SELECT * FROM ${run} ORDER BY "updatedAt" DESC LIMIT ${bounded}`)).map(runRecord);
    }
    async listRunsBySection(sectionId: string, limit = 20): Promise<readonly FormalDerivationRunRecord[]> {
        const run = table(this.em, "FormalDerivationRun");
        const bounded = Math.min(Math.max(limit, 1), 50);
        return rows(await this.execute(this.em, `SELECT * FROM ${run} WHERE "sectionId" = ? ORDER BY "updatedAt" DESC LIMIT ${bounded}`, [sectionId])).map(runRecord);
    }
    async updateRun(input: UpdateFormalDerivationRunInput): Promise<boolean> {
        const assignments: string[] = ['"updatedAt" = ?'];
        const params: unknown[] = [timestamp(this.em, input.now)];
        if (input.status !== undefined) {
            assignments.push('"status" = ?');
            params.push(input.status);
        }
        if (input.revision !== undefined) {
            assignments.push('"revision" = ?');
            params.push(input.revision);
        }
        if (input.documentJson !== undefined) {
            assignments.push('"documentJson" = ?');
            params.push(input.documentJson);
        }
        if (input.validationSummaryJson !== undefined) {
            assignments.push('"validationSummaryJson" = ?');
            params.push(input.validationSummaryJson);
        }
        if (input.tokenSummaryJson !== undefined) {
            assignments.push('"tokenSummaryJson" = ?');
            params.push(input.tokenSummaryJson);
        }
        if (input.routedProvider !== undefined) {
            assignments.push('"routedProvider" = ?');
            params.push(input.routedProvider);
        }
        if (input.routedModel !== undefined) {
            assignments.push('"routedModel" = ?');
            params.push(input.routedModel);
        }
        if (input.completedAt !== undefined) {
            assignments.push('"completedAt" = ?');
            params.push(input.completedAt ? timestamp(this.em, input.completedAt) : null);
        }
        params.push(input.id);
        const result = await this.execute(this.em, `UPDATE ${table(this.em, "FormalDerivationRun")} SET ${assignments.join(", ")} WHERE "id" = ?`, params);
        const affected = typeof result === "object" && result && "affectedRows" in result
            ? Number((result as {
                affectedRows?: unknown;
            }).affectedRows)
            : typeof result === "number"
                ? result
                : 1;
        return affected > 0;
    }
    async appendStep(input: AppendFormalDerivationStepInput): Promise<boolean> {
        return this.em.transactional(async (em) => {
            const runTable = table(em, "FormalDerivationRun");
            const current = rows(await this.execute(em, `SELECT "revision" FROM ${runTable} WHERE "id" = ? LIMIT 1`, [input.runId]))[0];
            if (!current)
                return false;
            if (Number(value(current, "revision")) !== input.expectedRevision) {
                return false;
            }
            const now = timestamp(em, input.now);
            await this.execute(em, `INSERT INTO ${table(em, "FormalDerivationStep")} (
          "id", "runId", "ordinal", "baseRevision", "afterRevision", "kind",
          "actionsJson", "presentationJson", "metadataJson", "createdAt"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                input.step.id,
                input.step.runId,
                input.step.ordinal,
                input.step.baseRevision,
                input.step.afterRevision,
                input.step.kind,
                input.step.actionsJson,
                input.step.presentationJson,
                input.step.metadataJson,
                now,
            ]);
            if (input.checkpoint) {
                await this.execute(em, `INSERT INTO ${table(em, "FormalDerivationCheckpoint")} (
            "id", "runId", "stepOrdinal", "revision", "stateJson", "createdAt"
          ) VALUES (?, ?, ?, ?, ?, ?)`, [
                    input.checkpoint.id,
                    input.checkpoint.runId,
                    input.checkpoint.stepOrdinal,
                    input.checkpoint.revision,
                    input.checkpoint.stateJson,
                    now,
                ]);
            }
            await this.execute(em, `UPDATE ${runTable}
         SET "documentJson" = ?, "revision" = ?, "updatedAt" = ?
         WHERE "id" = ?`, [input.documentJson, input.revision, now, input.runId]);
            return true;
        });
    }
    async replaceSteps(input: ReplaceFormalDerivationStepsInput): Promise<boolean> {
        return this.em.transactional(async (em) => {
            const runTable = table(em, "FormalDerivationRun");
            const current = rows(await this.execute(em, `SELECT "revision" FROM ${runTable} WHERE "id" = ? LIMIT 1`, [input.runId]))[0];
            if (!current)
                return false;
            if (Number(value(current, "revision")) !== input.expectedRevision) {
                return false;
            }
            const now = timestamp(em, input.now);
            await this.execute(em, `DELETE FROM ${table(em, "FormalDerivationCheckpoint")} WHERE "runId" = ?`, [input.runId]);
            await this.execute(em, `DELETE FROM ${table(em, "FormalDerivationStep")} WHERE "runId" = ?`, [input.runId]);
            for (const step of input.steps) {
                await this.execute(em, `INSERT INTO ${table(em, "FormalDerivationStep")} (
            "id", "runId", "ordinal", "baseRevision", "afterRevision", "kind",
            "actionsJson", "presentationJson", "metadataJson", "createdAt"
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                    step.id,
                    step.runId,
                    step.ordinal,
                    step.baseRevision,
                    step.afterRevision,
                    step.kind,
                    step.actionsJson,
                    step.presentationJson,
                    step.metadataJson,
                    now,
                ]);
            }
            await this.execute(em, `UPDATE ${runTable}
         SET "documentJson" = ?, "revision" = ?, "updatedAt" = ?
         WHERE "id" = ?`, [input.documentJson, input.revision, now, input.runId]);
            return true;
        });
    }
    async listSteps(runId: string): Promise<readonly FormalDerivationStepRecord[]> {
        return rows(await this.execute(this.em, `SELECT * FROM ${table(this.em, "FormalDerivationStep")}
         WHERE "runId" = ? ORDER BY "ordinal" ASC`, [runId])).map(stepRecord);
    }
    async listCheckpoints(runId: string): Promise<readonly FormalDerivationCheckpointRecord[]> {
        return rows(await this.execute(this.em, `SELECT * FROM ${table(this.em, "FormalDerivationCheckpoint")}
         WHERE "runId" = ? ORDER BY "stepOrdinal" ASC`, [runId])).map(checkpointRecord);
    }
    async appendEvent(input: {
        runId: string;
        eventJson: string;
        now: Date;
    }): Promise<FormalDerivationEventRecord> {
        return this.em.transactional(async (em) => {
            const runTable = table(em, "FormalDerivationRun");
            const row = rows(await this.execute(em, `SELECT "eventsJson", "nextEventSequence" FROM ${runTable} WHERE "id" = ? LIMIT 1`, [input.runId]))[0];
            if (!row) {
                throw new Error(`Formal derivation run ${input.runId} was not found`);
            }
            const sequence = Number(value(row, "nextEventSequence")) + 1;
            const events = parseEventsJson(String(value(row, "eventsJson") ?? "[]"));
            const record: FormalDerivationEventRecord = {
                sequence,
                eventJson: input.eventJson,
            };
            events.push(record);
            await this.execute(em, `UPDATE ${runTable}
         SET "eventsJson" = ?, "nextEventSequence" = ?, "updatedAt" = ?
         WHERE "id" = ?`, [
                JSON.stringify(events),
                sequence,
                timestamp(em, input.now),
                input.runId,
            ]);
            return record;
        });
    }
    async listEvents(runId: string, afterSequence = 0): Promise<readonly FormalDerivationEventRecord[]> {
        const run = await this.getRun(runId);
        if (!run)
            return [];
        return parseEventsJson(run.eventsJson).filter((event) => event.sequence > afterSequence);
    }
    async saveCheckpoint(input: Omit<FormalDerivationCheckpointRecord, "createdAt"> & {
        now: Date;
    }): Promise<void> {
        await this.execute(this.em, `INSERT INTO ${table(this.em, "FormalDerivationCheckpoint")} (
        "id", "runId", "stepOrdinal", "revision", "stateJson", "createdAt"
      ) VALUES (?, ?, ?, ?, ?, ?)`, [
            input.id,
            input.runId,
            input.stepOrdinal,
            input.revision,
            input.stateJson,
            timestamp(this.em, input.now),
        ]);
    }
}
