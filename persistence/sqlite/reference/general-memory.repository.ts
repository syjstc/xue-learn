import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { GeneralMemoryCreateInput, GeneralMemoryFormationCandidateInput, GeneralMemoryRecord, GeneralMemoryRepositoryPort, GeneralMemoryScopeInput, } from "@xue-learn/core/domain";
import { nullableReferenceDateValue, referenceDateValue } from "./date-value.ts";
type Row = Readonly<Record<string, unknown>>;
const PRODUCT_ID = "xuelearn";
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
    return row[key] ?? row[key[0]?.toLowerCase() + key.slice(1)];
}
function date(item: unknown): Date {
    return referenceDateValue(item);
}
function optionalDate(item: unknown): Date | null {
    return nullableReferenceDateValue(item);
}
function jsonObject(item: unknown): Record<string, unknown> {
    const parsed = typeof item === "string" ? JSON.parse(item) : item;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
}
function table(em: EntityManager, name: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${name.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
export class MikroOrmGeneralMemoryRepository implements GeneralMemoryRepositoryPort {
    constructor(private readonly em: EntityManager) { }
    private execute(em: EntityManager, sql: string, params: unknown[] = []) {
        return em
            .getConnection()
            .execute(sql, params, undefined, em.getTransactionContext());
    }
    private async hydrate(em: EntityManager, sourceRows: readonly Row[]) {
        if (sourceRows.length === 0)
            return [];
        const ids = sourceRows.map((row) => String(value(row, "id")));
        const evidenceRows = rows(await this.execute(em, `SELECT "id", "recordId", "sourceType", "excerpt", "occurredAt" FROM ${table(em, "MemoryEvidence")} WHERE "recordId" IN (${ids.map(() => "?").join(",")}) ORDER BY "occurredAt" DESC, "id" DESC`, ids));
        return sourceRows.map((row): GeneralMemoryRecord => ({
            id: String(value(row, "id")),
            userId: String(value(row, "userId")),
            productId: String(value(row, "productId")),
            domain: String(value(row, "domain")),
            scopeType: String(value(row, "scopeType")),
            scopeId: value(row, "scopeId") == null ? null : String(value(row, "scopeId")),
            kind: String(value(row, "kind")),
            stableKey: String(value(row, "stableKey")),
            contentJson: jsonObject(value(row, "contentJson")),
            searchText: String(value(row, "searchText")),
            authority: String(value(row, "authority")),
            status: String(value(row, "status")),
            confidence: Number(value(row, "confidence")),
            importance: Number(value(row, "importance")),
            validFrom: date(value(row, "validFrom")),
            validUntil: optionalDate(value(row, "validUntil")),
            lastConfirmedAt: optionalDate(value(row, "lastConfirmedAt")),
            expiresAt: optionalDate(value(row, "expiresAt")),
            currentRevision: Number(value(row, "currentRevision")),
            createdAt: date(value(row, "createdAt")),
            updatedAt: date(value(row, "updatedAt")),
            evidence: evidenceRows
                .filter((evidence) => String(value(evidence, "recordId")) === String(value(row, "id")))
                .slice(0, 5)
                .map((evidence) => ({
                id: String(value(evidence, "id")),
                sourceType: String(value(evidence, "sourceType")),
                excerpt: String(value(evidence, "excerpt") ?? ""),
                occurredAt: date(value(evidence, "occurredAt")),
            })),
        }));
    }
    private async find(em: EntityManager, where: string, params: unknown[]) {
        const source = rows(await this.execute(em, `SELECT * FROM ${table(em, "MemoryRecord")} WHERE ${where} LIMIT 1`, params));
        return (await this.hydrate(em, source))[0] ?? null;
    }
    async isEnabled(userId: string) {
        const row = rows(await this.execute(this.em, `SELECT "personalMemoryEnabled" FROM ${table(this.em, "UserSettings")} WHERE "userId" = ? LIMIT 1`, [userId]))[0];
        return Boolean(Number(value(row ?? {}, "personalMemoryEnabled")) ||
            value(row ?? {}, "personalMemoryEnabled") === true);
    }
    async setEnabled(userId: string, enabled: boolean) {
        await this.execute(this.em, `INSERT INTO ${table(this.em, "UserSettings")} ("userId", "personalMemoryEnabled", "updatedAt") VALUES (?, ?, ?) ON CONFLICT ("userId") DO UPDATE SET "personalMemoryEnabled" = excluded."personalMemoryEnabled", "updatedAt" = excluded."updatedAt"`, [userId, enabled, new Date()]);
    }
    async scopeExists(userId: string, scopeType: "goal" | "thread", scopeId: string) {
        const target = scopeType === "goal" ? "LearningGoal" : "AgentThread";
        return (rows(await this.execute(this.em, `SELECT 1 AS "found" FROM ${table(this.em, target)} WHERE "id" = ? AND "userId" = ? LIMIT 1`, [scopeId, userId])).length > 0);
    }
    findActive(input: GeneralMemoryScopeInput) {
        return this.find(this.em, `"userId" = ? AND "productId" = ? AND "domain" = ? AND "scopeType" = ? AND (("scopeId" IS NULL AND ? IS NULL) OR "scopeId" = ?) AND "kind" = ? AND "stableKey" = ? AND "status" = 'active'`, [
            input.userId,
            input.productId,
            input.domain,
            input.scopeType,
            input.scopeId,
            input.scopeId,
            input.kind,
            input.stableKey,
        ]);
    }
    findOwned(userId: string, memoryId: string) {
        return this.find(this.em, `"id" = ? AND "userId" = ? AND "productId" = ?`, [
            memoryId,
            userId,
            PRODUCT_ID,
        ]);
    }
    async listOwned(input: {
        userId: string;
        status: string;
        kind?: string;
        scopeType?: string;
        scopeId?: string | null;
        cursor?: string;
        limit: number;
    }) {
        const clauses = [`"userId" = ?`, `"productId" = ?`, `"status" = ?`];
        const params: unknown[] = [input.userId, PRODUCT_ID, input.status];
        if (input.kind) {
            clauses.push(`"kind" = ?`);
            params.push(input.kind);
        }
        if (input.scopeType) {
            clauses.push(`"scopeType" = ?`);
            params.push(input.scopeType);
        }
        if (input.scopeId !== undefined) {
            clauses.push(input.scopeId === null ? `"scopeId" IS NULL` : `"scopeId" = ?`);
            if (input.scopeId !== null)
                params.push(input.scopeId);
        }
        if (input.cursor) {
            const cursor = await this.findOwned(input.userId, input.cursor);
            if (cursor) {
                clauses.push(`("updatedAt" < ? OR ("updatedAt" = ? AND "id" < ?))`);
                params.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
            }
        }
        params.push(input.limit);
        return this.hydrate(this.em, rows(await this.execute(this.em, `SELECT * FROM ${table(this.em, "MemoryRecord")} WHERE ${clauses.join(" AND ")} ORDER BY "updatedAt" DESC, "id" DESC LIMIT ?`, params)));
    }
    private async appendChanged(em: EntityManager, userId: string, recordId: string, action: string, revision: number, now: Date) {
        await this.execute(em, `INSERT INTO ${table(em, "DomainEventOutbox")} ("id","type","schemaVersion","idempotencyKey","userId","payload","occurredAt","createdAt") VALUES (?, 'memory.changed.v1', 1, ?, ?, ?, ?, ?) ON CONFLICT ("idempotencyKey") DO NOTHING`, [
            randomUUID(),
            `memory-changed:${recordId}:${revision}:${action}`,
            userId,
            JSON.stringify({ recordId, action, revision }),
            now,
            now,
        ]);
    }
    async createIfAbsent(input: GeneralMemoryCreateInput) {
        return this.em.transactional(async (em) => {
            const existing = await this.find(em, `"userId" = ? AND "productId" = ? AND "domain" = ? AND "scopeType" = ? AND (("scopeId" IS NULL AND ? IS NULL) OR "scopeId" = ?) AND "kind" = ? AND "stableKey" = ? AND "status" = 'active'`, [
                input.userId,
                input.productId,
                input.domain,
                input.scopeType,
                input.scopeId,
                input.scopeId,
                input.kind,
                input.stableKey,
            ]);
            if (existing)
                return { record: existing, created: false };
            const id = randomUUID();
            const revisionId = randomUUID();
            const now = input.occurredAt;
            await this.execute(em, `INSERT INTO ${table(em, "MemoryRecord")} ("id","userId","productId","domain","scopeType","scopeId","kind","stableKey","contentJson","searchText","authority","status","confidence","importance","validFrom","lastConfirmedAt","currentRevision","indexStatus","indexError","createdAt","updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, 1, 'pending', '', ?, ?)`, [
                id,
                input.userId,
                input.productId,
                input.domain,
                input.scopeType,
                input.scopeId,
                input.kind,
                input.stableKey,
                JSON.stringify({ summary: input.summary }),
                `${input.stableKey}\n${input.summary}`,
                input.authority,
                input.confidence,
                input.importance,
                now,
                now,
                now,
                now,
            ]);
            await this.execute(em, `INSERT INTO ${table(em, "MemoryRevision")} ("id","recordId","revision","action","contentJson","confidence","importance","actorType","actorRef","createdAt") VALUES (?, ?, 1, 'create', ?, ?, ?, ?, ?, ?)`, [
                revisionId,
                id,
                JSON.stringify({ summary: input.summary }),
                input.confidence,
                input.importance,
                input.actorType,
                input.actorRef,
                now,
            ]);
            await this.execute(em, `INSERT INTO ${table(em, "MemoryEvidence")} ("id","recordId","revisionId","sourceType","sourceThreadId","sourceMessageId","excerpt","sourceHash","occurredAt","createdAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                randomUUID(),
                id,
                revisionId,
                input.sourceType,
                input.sourceThreadId,
                input.sourceMessageId,
                input.excerpt.slice(0, 300),
                input.sourceHash,
                now,
                now,
            ]);
            await this.appendChanged(em, input.userId, id, "create", 1, now);
            const record = await this.find(em, `"id" = ?`, [id]);
            if (!record)
                throw new Error("Created memory is unavailable");
            return { record, created: true };
        });
    }
    private async lockRecord(em: EntityManager, memoryId: string) {
    }
    async reinforce(input: {
        userId: string;
        memoryId: string;
        confidence: number;
        importance: number;
        sourceThreadId: string;
        sourceMessageId: string;
        excerpt: string;
        sourceHash: string;
        occurredAt: Date;
    }): Promise<GeneralMemoryRecord> {
        return this.em.transactional(async (em) => {
            await this.lockRecord(em, input.memoryId);
            const record = await this.find(em, `"id" = ? AND "userId" = ? AND "productId" = ? AND "status" = 'active'`, [input.memoryId, input.userId, PRODUCT_ID]);
            if (!record)
                throw new Error("Memory not found");
            const revision = record.currentRevision + 1;
            const confidence = Math.max(record.confidence, input.confidence);
            const importance = Math.max(record.importance, input.importance);
            const revisionId = randomUUID();
            await this.execute(em, `INSERT INTO ${table(em, "MemoryRevision")} ("id","recordId","revision","action","contentJson","confidence","importance","actorType","actorRef","createdAt") VALUES (?, ?, ?, 'reinforce', ?, ?, ?, 'system', ?, ?)`, [
                revisionId,
                record.id,
                revision,
                JSON.stringify(record.contentJson),
                confidence,
                importance,
                input.sourceMessageId,
                input.occurredAt,
            ]);
            await this.execute(em, `INSERT INTO ${table(em, "MemoryEvidence")} ("id","recordId","revisionId","sourceType","sourceThreadId","sourceMessageId","excerpt","sourceHash","occurredAt","createdAt") VALUES (?, ?, ?, 'message', ?, ?, ?, ?, ?, ?) ON CONFLICT ("recordId", "sourceHash") DO NOTHING`, [
                randomUUID(),
                record.id,
                revisionId,
                input.sourceThreadId,
                input.sourceMessageId,
                input.excerpt.slice(0, 300),
                input.sourceHash,
                input.occurredAt,
                input.occurredAt,
            ]);
            await this.execute(em, `UPDATE ${table(em, "MemoryRecord")} SET "confidence" = ?, "importance" = ?, "currentRevision" = ?, "lastConfirmedAt" = ?, "updatedAt" = ? WHERE "id" = ?`, [
                confidence,
                importance,
                revision,
                input.occurredAt,
                input.occurredAt,
                record.id,
            ]);
            await this.appendChanged(em, input.userId, record.id, "reinforce", revision, input.occurredAt);
            const updated = await this.find(em, `"id" = ?`, [record.id]);
            if (!updated)
                throw new Error("Reinforced memory is unavailable");
            return updated;
        });
    }
    async correct(input: {
        userId: string;
        memoryId: string;
        summary: string;
        importance?: number;
        actorType: string;
        actorRef: string | null;
        sourceThreadId: string | null;
        sourceMessageId: string | null;
        excerpt: string;
        sourceHash: string;
        occurredAt: Date;
    }): Promise<GeneralMemoryRecord> {
        return this.em.transactional(async (em) => {
            await this.lockRecord(em, input.memoryId);
            const record = await this.find(em, `"id" = ? AND "userId" = ? AND "productId" = ?`, [input.memoryId, input.userId, PRODUCT_ID]);
            if (!record)
                throw new Error("Memory not found");
            const revision = record.currentRevision + 1;
            const importance = input.importance ?? record.importance;
            const confidence = input.actorType === "learner" ? 1 : record.confidence;
            const revisionId = randomUUID();
            await this.execute(em, `INSERT INTO ${table(em, "MemoryRevision")} ("id","recordId","revision","action","contentJson","confidence","importance","actorType","actorRef","createdAt") VALUES (?, ?, ?, 'correct', ?, ?, ?, ?, ?, ?)`, [
                revisionId,
                record.id,
                revision,
                JSON.stringify({ summary: input.summary }),
                confidence,
                importance,
                input.actorType,
                input.actorRef,
                input.occurredAt,
            ]);
            await this.execute(em, `UPDATE ${table(em, "MemoryRecord")} SET "contentJson" = ?, "searchText" = ?, "confidence" = ?, "importance" = ?, "authority" = ?, "currentRevision" = ?, "lastConfirmedAt" = ?, "indexStatus" = 'pending', "indexError" = '', "updatedAt" = ? WHERE "id" = ?`, [
                JSON.stringify({ summary: input.summary }),
                `${record.stableKey}\n${input.summary}`,
                confidence,
                importance,
                input.actorType === "learner" ? "learner_declared" : record.authority,
                revision,
                input.occurredAt,
                input.occurredAt,
                record.id,
            ]);
            await this.execute(em, `INSERT INTO ${table(em, "MemoryEvidence")} ("id","recordId","revisionId","sourceType","sourceThreadId","sourceMessageId","excerpt","sourceHash","occurredAt","createdAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT ("recordId", "sourceHash") DO NOTHING`, [
                randomUUID(),
                record.id,
                revisionId,
                input.sourceMessageId ? "message" : "manual",
                input.sourceThreadId,
                input.sourceMessageId,
                input.excerpt.slice(0, 300),
                input.sourceHash,
                input.occurredAt,
                input.occurredAt,
            ]);
            await this.appendChanged(em, input.userId, record.id, "correct", revision, input.occurredAt);
            const updated = await this.find(em, `"id" = ?`, [record.id]);
            if (!updated)
                throw new Error("Corrected memory is unavailable");
            return updated;
        });
    }
    async archive(userId: string, memoryId: string) {
        return this.em.transactional(async (em) => {
            await this.lockRecord(em, memoryId);
            const record = await this.find(em, `"id" = ? AND "userId" = ? AND "productId" = ?`, [memoryId, userId, PRODUCT_ID]);
            if (!record)
                throw new Error("Memory not found");
            if (record.status === "archived")
                return record;
            const revision = record.currentRevision + 1;
            const now = new Date();
            await this.execute(em, `INSERT INTO ${table(em, "MemoryRevision")} ("id","recordId","revision","action","contentJson","confidence","importance","actorType","actorRef","createdAt") VALUES (?, ?, ?, 'archive', ?, ?, ?, 'learner', ?, ?)`, [
                randomUUID(),
                record.id,
                revision,
                JSON.stringify(record.contentJson),
                record.confidence,
                record.importance,
                userId,
                now,
            ]);
            await this.execute(em, `UPDATE ${table(em, "MemoryRecord")} SET "status" = 'archived', "currentRevision" = ?, "updatedAt" = ? WHERE "id" = ?`, [revision, now, record.id]);
            await this.appendChanged(em, userId, record.id, "archive", revision, now);
            const updated = await this.find(em, `"id" = ?`, [record.id]);
            if (!updated)
                throw new Error("Archived memory is unavailable");
            return updated;
        });
    }
    async deleteOwned(userId: string, memoryId: string) {
        await this.em.transactional(async (em) => {
            const record = await this.find(em, `"id" = ? AND "userId" = ? AND "productId" = ?`, [memoryId, userId, PRODUCT_ID]);
            if (!record)
                throw new Error("Memory not found");
            const now = new Date();
            await this.execute(em, `INSERT INTO ${table(em, "MemoryDeletionAudit")} ("id","userId","productId","kind","scopeType","actorType","deletedAt") VALUES (?, ?, ?, ?, ?, 'learner', ?)`, [randomUUID(), userId, PRODUCT_ID, record.kind, record.scopeType, now]);
            await this.appendChanged(em, userId, record.id, "delete", 0, now);
            await this.execute(em, `DELETE FROM ${table(em, "MemoryRecord")} WHERE "id" = ?`, [record.id]);
        });
    }
    async listSearchCandidates(input: {
        userId: string;
        goalId?: string;
        threadId?: string;
        now: Date;
    }) {
        const scopes = [`("scopeType" = 'user' AND "scopeId" IS NULL)`];
        const params: unknown[] = [input.userId, PRODUCT_ID, input.now, input.now];
        if (input.goalId) {
            scopes.push(`("scopeType" = 'goal' AND "scopeId" = ?)`);
            params.push(input.goalId);
        }
        if (input.threadId) {
            scopes.push(`("scopeType" = 'thread' AND "scopeId" = ?)`);
            params.push(input.threadId);
        }
        return this.hydrate(this.em, rows(await this.execute(this.em, `SELECT * FROM ${table(this.em, "MemoryRecord")} WHERE "userId" = ? AND "productId" = ? AND "status" = 'active' AND "validFrom" <= ? AND ("validUntil" IS NULL OR "validUntil" > ?) AND ("expiresAt" IS NULL OR "expiresAt" > ?) AND (${scopes.join(" OR ")}) ORDER BY "updatedAt" DESC, "id" DESC LIMIT 500`, [
            input.userId,
            PRODUCT_ID,
            input.now,
            input.now,
            input.now,
            ...params.slice(4),
        ])));
    }
    async semanticScores(input: {
        userId: string;
        recordIds: readonly string[];
        vector: readonly number[];
        provider: string;
        model: string;
    }) {
        if (input.recordIds.length === 0 || input.vector.length === 0)
            return new Map<string, number>();
        const vectorSql = `[${input.vector.join(",")}]`;
        {
            const indexState = rows(await this.execute(this.em, `SELECT "status","providerId","model" FROM ${table(this.em, "LocalEmbeddingIndexState")} WHERE "id"='desktop-local' LIMIT 1`))[0];
            if (indexState &&
                (String(value(indexState, "status")) !== "published" ||
                    String(value(indexState, "providerId")) !== input.provider ||
                    String(value(indexState, "model")) !== input.model)) {
                return new Map<string, number>();
            }
            const result = rows(await this.execute(this.em, `SELECT "id", 1 - vec_distance_cosine("embedding", ?) AS "similarity" FROM ${table(this.em, "MemoryRecord")} WHERE "userId" = ? AND "productId" = ? AND "status" = 'active' AND "id" IN (${input.recordIds.map(() => "?").join(",")}) AND "embedding" IS NOT NULL AND "embeddingProvider" = ? AND "embeddingModel" = ? AND "embeddingDimensions" = ? AND "indexStatus" = 'ready' ORDER BY vec_distance_cosine("embedding", ?) LIMIT 100`, [
                vectorSql,
                input.userId,
                PRODUCT_ID,
                ...input.recordIds,
                input.provider,
                input.model,
                input.vector.length,
                vectorSql,
            ]));
            return new Map(result.map((row) => [
                String(value(row, "id")),
                Number(value(row, "similarity")),
            ]));
        }
    }
    async markIndexed(input: {
        recordId: string;
        vector: readonly number[];
        provider: string;
        model: string;
    }) {
        const vector = `[${input.vector.join(",")}]`;
        const expression = `?`;
        await this.execute(this.em, `UPDATE ${table(this.em, "MemoryRecord")} SET "embedding" = ${expression}, "embeddingProvider" = ?, "embeddingModel" = ?, "embeddingDimensions" = ?, "indexStatus" = 'ready', "indexError" = '', "updatedAt" = ? WHERE "id" = ?`, [
            vector,
            input.provider,
            input.model,
            input.vector.length,
            new Date(),
            input.recordId,
        ]);
    }
    async markIndexFailed(recordId: string, error: string) {
        await this.execute(this.em, `UPDATE ${table(this.em, "MemoryRecord")} SET "indexStatus" = 'failed', "indexError" = ?, "updatedAt" = ? WHERE "id" = ?`, [error.slice(0, 1000), new Date(), recordId]);
    }
    private candidate(row: Row) {
        return {
            id: String(value(row, "id")),
            userId: String(value(row, "userId")),
            kind: String(value(row, "kind")),
            stableKey: String(value(row, "stableKey")),
            proposedContent: jsonObject(value(row, "proposedContent")),
            proposedAction: String(value(row, "proposedAction")),
            existingRecordId: value(row, "existingRecordId") == null
                ? null
                : String(value(row, "existingRecordId")),
            confidence: Number(value(row, "confidence")),
            importance: Number(value(row, "importance")),
            scopeType: String(value(row, "scopeType")),
            scopeId: value(row, "scopeId") == null ? null : String(value(row, "scopeId")),
            createdAt: date(value(row, "createdAt")),
        };
    }
    async listReviewCandidates(userId: string, limit: number) {
        return rows(await this.execute(this.em, `SELECT * FROM ${table(this.em, "MemoryCandidate")} WHERE "userId" = ? AND "productId" = ? AND "status" = 'needs_review' ORDER BY "createdAt" DESC LIMIT ?`, [userId, PRODUCT_ID, limit])).map((row) => this.candidate(row));
    }
    async findReviewCandidate(userId: string, candidateId: string) {
        const row = rows(await this.execute(this.em, `SELECT * FROM ${table(this.em, "MemoryCandidate")} WHERE "id" = ? AND "userId" = ? AND "productId" = ? AND "status" = 'needs_review' LIMIT 1`, [candidateId, userId, PRODUCT_ID]))[0];
        return row ? this.candidate(row) : null;
    }
    async rejectCandidate(candidateId: string, resolvedAt: Date) {
        await this.execute(this.em, `UPDATE ${table(this.em, "MemoryCandidate")} SET "status" = 'rejected', "rejectionReason" = 'learner_rejected', "resolvedAt" = ?, "updatedAt" = ? WHERE "id" = ? AND "status" = 'needs_review'`, [resolvedAt, resolvedAt, candidateId]);
    }
    async activateCandidate(candidateId: string, memoryId: string, resolvedAt: Date) {
        await this.execute(this.em, `UPDATE ${table(this.em, "MemoryCandidate")} SET "status" = 'activated', "existingRecordId" = ?, "resolvedAt" = ?, "updatedAt" = ? WHERE "id" = ? AND "status" = 'needs_review'`, [memoryId, resolvedAt, resolvedAt, candidateId]);
    }
    async enqueueFormationTurn(input: {
        userId: string;
        threadId: string;
        throughMessageId: string;
    }) {
        if (!(await this.isEnabled(input.userId)))
            return false;
        return this.em.transactional(async (em) => {
            const message = rows(await this.execute(em, `SELECT m."createdAt" FROM ${table(em, "AgentMessage")} m JOIN ${table(em, "AgentThread")} t ON t."id" = m."threadId" WHERE m."id" = ? AND m."threadId" = ? AND t."userId" = ? AND t."scope" IN ('global', 'goal_creation') LIMIT 1`, [input.throughMessageId, input.threadId, input.userId]))[0];
            if (!message)
                return false;
            const current = rows(await this.execute(em, `SELECT c."requestedThroughMessageId", m."createdAt" FROM ${table(em, "MemoryFormationCursor")} c LEFT JOIN ${table(em, "AgentMessage")} m ON m."id" = c."requestedThroughMessageId" WHERE c."threadId" = ? LIMIT 1`, [input.threadId]))[0];
            if (current &&
                optionalDate(value(current, "createdAt"))?.getTime()! >=
                    date(value(message, "createdAt")).getTime()) {
                return true;
            }
            const now = new Date();
            await this.execute(em, `INSERT INTO ${table(em, "MemoryFormationCursor")} ("id","userId","productId","threadId","requestedThroughMessageId","status","attempts","nextAttemptAt","lastError","createdAt","updatedAt") VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, '', ?, ?) ON CONFLICT ("threadId") DO UPDATE SET "requestedThroughMessageId" = excluded."requestedThroughMessageId", "status" = 'pending', "nextAttemptAt" = excluded."nextAttemptAt", "lastError" = '', "updatedAt" = excluded."updatedAt"`, [
                randomUUID(),
                input.userId,
                PRODUCT_ID,
                input.threadId,
                input.throughMessageId,
                now,
                now,
                now,
            ]);
            return true;
        });
    }
    async claimFormationCursors(input: {
        now: Date;
        workerId: string;
        limit: number;
        leaseExpiresAt: Date;
    }) {
        const candidates = rows(await this.execute(this.em, `SELECT "id", "requestedThroughMessageId", "attempts" FROM ${table(this.em, "MemoryFormationCursor")} WHERE (("status" IN ('pending','failed') AND "nextAttemptAt" <= ?) OR ("status" = 'processing' AND "leaseExpiresAt" < ?)) ORDER BY "nextAttemptAt" ASC, "id" ASC LIMIT ?`, [input.now, input.now, input.limit]));
        const claimed: Array<{
            id: string;
            requestedThroughMessageId: string;
            attempts: number;
        }> = [];
        for (const candidate of candidates) {
            const id = String(value(candidate, "id"));
            const result = await this.execute(this.em, `UPDATE ${table(this.em, "MemoryFormationCursor")} SET "status" = 'processing', "attempts" = "attempts" + 1, "leaseOwner" = ?, "leaseExpiresAt" = ?, "nextAttemptAt" = NULL, "updatedAt" = ? WHERE "id" = ? AND (("status" IN ('pending','failed') AND "nextAttemptAt" <= ?) OR ("status" = 'processing' AND "leaseExpiresAt" < ?)) RETURNING "id"`, [
                input.workerId,
                input.leaseExpiresAt,
                input.now,
                id,
                input.now,
                input.now,
            ]);
            const affected = typeof result === "number"
                ? result
                : Number((result as {
                    affectedRows?: number;
                }).affectedRows ?? 0);
            if (rows(result).length > 0 || affected > 0) {
                claimed.push({
                    id,
                    requestedThroughMessageId: String(value(candidate, "requestedThroughMessageId")),
                    attempts: Number(value(candidate, "attempts")),
                });
            }
        }
        return claimed;
    }
    async loadFormationCursor(cursorId: string) {
        const cursor = rows(await this.execute(this.em, `SELECT c.*, t."scope" AS "threadScope", watermark."createdAt" AS "watermarkCreatedAt" FROM ${table(this.em, "MemoryFormationCursor")} c JOIN ${table(this.em, "AgentThread")} t ON t."id" = c."threadId" LEFT JOIN ${table(this.em, "AgentMessage")} watermark ON watermark."id" = c."requestedThroughMessageId" AND watermark."threadId" = c."threadId" WHERE c."id" = ? LIMIT 1`, [cursorId]))[0];
        if (!cursor)
            return null;
        const watermark = optionalDate(value(cursor, "watermarkCreatedAt"));
        if (!watermark)
            throw new Error("Memory formation watermark is unavailable");
        const messages = rows(await this.execute(this.em, `SELECT "id", "role", "content", "createdAt" FROM ${table(this.em, "AgentMessage")} WHERE "threadId" = ? AND "createdAt" <= ? ORDER BY "createdAt" DESC, "id" DESC LIMIT 12`, [String(value(cursor, "threadId")), watermark]))
            .map((row) => ({
            id: String(value(row, "id")),
            role: String(value(row, "role")),
            content: String(value(row, "content")),
            createdAt: date(value(row, "createdAt")),
        }))
            .reverse();
        return {
            id: String(value(cursor, "id")),
            userId: String(value(cursor, "userId")),
            threadId: String(value(cursor, "threadId")),
            requestedThroughMessageId: String(value(cursor, "requestedThroughMessageId")),
            attempts: Number(value(cursor, "attempts")),
            threadScope: String(value(cursor, "threadScope")),
            messages,
        };
    }
    async deleteFormationCursor(cursorId: string) {
        await this.execute(this.em, `DELETE FROM ${table(this.em, "MemoryFormationCursor")} WHERE "id" = ?`, [cursorId]);
    }
    async settleFormationCursor(input: {
        cursorId: string;
        workerId: string;
        requestedThroughMessageId: string;
        now: Date;
    }) {
        const result = await this.execute(this.em, `UPDATE ${table(this.em, "MemoryFormationCursor")} SET "processedThroughMessageId" = ?, "status" = 'completed', "attempts" = 0, "nextAttemptAt" = NULL, "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "lastError" = '', "updatedAt" = ? WHERE "id" = ? AND "leaseOwner" = ? AND "requestedThroughMessageId" = ? RETURNING "id"`, [
            input.requestedThroughMessageId,
            input.now,
            input.cursorId,
            input.workerId,
            input.requestedThroughMessageId,
        ]);
        const affected = typeof result === "number"
            ? result
            : Number((result as {
                affectedRows?: number;
            }).affectedRows ?? 0);
        if (rows(result).length === 0 && affected === 0) {
            await this.execute(this.em, `UPDATE ${table(this.em, "MemoryFormationCursor")} SET "status" = 'pending', "nextAttemptAt" = ?, "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "updatedAt" = ? WHERE "id" = ? AND "leaseOwner" = ?`, [input.now, input.now, input.cursorId, input.workerId]);
        }
    }
    async failFormationCursor(input: {
        cursorId: string;
        workerId: string;
        nextAttemptAt: Date;
        error: string;
        now: Date;
    }) {
        await this.execute(this.em, `UPDATE ${table(this.em, "MemoryFormationCursor")} SET "status" = 'failed', "nextAttemptAt" = ?, "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "lastError" = ?, "updatedAt" = ? WHERE "id" = ? AND "leaseOwner" = ?`, [
            input.nextAttemptAt,
            input.error,
            input.now,
            input.cursorId,
            input.workerId,
        ]);
    }
    async upsertFormationCandidate(input: GeneralMemoryFormationCandidateInput) {
        const id = randomUUID();
        const now = new Date();
        await this.execute(this.em, `INSERT INTO ${table(this.em, "MemoryCandidate")} ("id","userId","productId","domain","scopeType","scopeId","threadId","sourceEventId","extractorPolicyVersion","extractorOperation","extractorProvider","extractorModel","kind","stableKey","proposedContent","proposedAction","existingRecordId","confidence","importance","explicit","status","rejectionReason","resolvedAt","createdAt","updatedAt") VALUES (?, ?, ?, 'personal', 'user', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT ("userId", "sourceEventId", "stableKey") DO NOTHING`, [
            id,
            input.userId,
            PRODUCT_ID,
            input.threadId,
            input.sourceEventId,
            input.extractorPolicyVersion,
            input.extractorOperation,
            input.extractorProvider,
            input.extractorModel,
            input.kind,
            input.stableKey,
            JSON.stringify(input.proposedContent),
            input.proposedAction,
            input.existingRecordId,
            input.confidence,
            input.importance,
            input.explicit,
            input.status,
            input.rejectionReason,
            input.resolvedAt,
            now,
            now,
        ]);
        const row = rows(await this.execute(this.em, `SELECT "id", "status" FROM ${table(this.em, "MemoryCandidate")} WHERE "userId" = ? AND "sourceEventId" = ? AND "stableKey" = ? LIMIT 1`, [input.userId, input.sourceEventId, input.stableKey]))[0];
        if (!row)
            throw new Error("Memory candidate is unavailable");
        return {
            id: String(value(row, "id")),
            status: String(value(row, "status")),
        };
    }
    async updateFormationCandidate(input: {
        candidateId: string;
        status: string;
        rejectionReason?: string;
        existingRecordId?: string;
        resolvedAt?: Date;
    }) {
        const assignments = [`"status" = ?`, `"updatedAt" = ?`];
        const params: unknown[] = [input.status, new Date()];
        if (input.rejectionReason !== undefined) {
            assignments.push(`"rejectionReason" = ?`);
            params.push(input.rejectionReason);
        }
        if (input.existingRecordId !== undefined) {
            assignments.push(`"existingRecordId" = ?`);
            params.push(input.existingRecordId);
        }
        if (input.resolvedAt !== undefined) {
            assignments.push(`"resolvedAt" = ?`);
            params.push(input.resolvedAt);
        }
        params.push(input.candidateId);
        await this.execute(this.em, `UPDATE ${table(this.em, "MemoryCandidate")} SET ${assignments.join(", ")} WHERE "id" = ?`, params);
    }
    async listPendingIndexes(input: {
        before: Date;
        limit: number;
        provider?: string;
        model?: string;
    }) {
        const mismatch = input.provider && input.model
            ? ` OR "embeddingProvider" IS NULL OR "embeddingProvider" <> ? OR "embeddingModel" IS NULL OR "embeddingModel" <> ?`
            : "";
        const source = rows(await this.execute(this.em, `SELECT "id", "contentJson" FROM ${table(this.em, "MemoryRecord")} WHERE "productId" = ? AND "status" = 'active' AND ("indexStatus" = 'pending' OR ("indexStatus" = 'failed' AND "updatedAt" <= ?)${mismatch}) ORDER BY "updatedAt" ASC, "id" ASC LIMIT ?`, [
            PRODUCT_ID,
            input.before,
            ...(input.provider && input.model
                ? [input.provider, input.model]
                : []),
            input.limit,
        ]));
        return source.flatMap((row) => {
            const summary = jsonObject(value(row, "contentJson")).summary;
            return typeof summary === "string"
                ? [{ id: String(value(row, "id")), summary }]
                : [];
        });
    }
}
