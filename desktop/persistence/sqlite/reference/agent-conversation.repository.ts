import { createHash, randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { AgentConversationRepository, AgentMessageRecord, AgentThreadListRecord, AgentThreadRecord, GoalCreationEventRecord, GoalCreationJourneyRecord, GoalCreationParentRecord, GoalCreationResourceInput, GoalCreationResourceRecord, GoalCreationSessionRecord, } from "@xue-learn/core/domain";
import { referenceDateValue, nullableReferenceDateValue, sqlTimestampParameter, } from "./date-value.ts";
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
    return row[key] ?? row[key[0]?.toLowerCase() + key.slice(1)];
}
function date(value: unknown): Date {
    return referenceDateValue(value);
}
function nullableDate(item: unknown): Date | null {
    return nullableReferenceDateValue(item);
}
function jsonText(item: unknown, fallback = "{}"): string {
    if (typeof item === "string")
        return item;
    return item == null ? fallback : JSON.stringify(item);
}
function optional(row: Row, key: string): string | null {
    const item = value(row, key);
    return item == null ? null : String(item);
}
function thread(row: Row): AgentThreadRecord {
    return {
        id: String(value(row, "id")),
        userId: String(value(row, "userId")),
        scope: String(value(row, "scope")),
        scopeId: optional(row, "scopeId"),
        status: String(value(row, "status")),
        stateJson: String(value(row, "stateJson")),
        createdAt: date(value(row, "createdAt")),
        updatedAt: date(value(row, "updatedAt")),
    };
}
function message(row: Row, prefix = ""): AgentMessageRecord {
    const key = (name: string) => prefix ? `${prefix}${name[0]!.toUpperCase()}${name.slice(1)}` : name;
    return {
        id: String(value(row, key("id"))),
        threadId: String(value(row, key("threadId"))),
        role: String(value(row, key("role"))),
        content: String(value(row, key("content")) ?? ""),
        toolCalls: String(value(row, key("toolCalls")) ?? "[]"),
        toolCallId: optional(row, key("toolCallId")),
        uiPayload: String(value(row, key("uiPayload")) ?? "{}"),
        metadataJson: String(value(row, key("metadataJson")) ?? "{}"),
        createdAt: date(value(row, key("createdAt"))),
    };
}
function resource(row: Row): GoalCreationResourceRecord {
    return {
        id: String(value(row, "id")),
        sessionId: String(value(row, "sessionId")),
        kind: String(value(row, "kind")),
        filename: String(value(row, "filename")),
        sourceUrl: optional(row, "sourceUrl"),
        canonicalUrl: optional(row, "canonicalUrl"),
        provider: optional(row, "provider"),
        extractedText: String(value(row, "extractedText") ?? ""),
        status: String(value(row, "status")),
        warning: String(value(row, "warning") ?? ""),
        error: String(value(row, "error") ?? ""),
        createdAt: date(value(row, "createdAt")),
        updatedAt: date(value(row, "updatedAt")),
    };
}
function session(row: Row): GoalCreationSessionRecord {
    return {
        id: String(value(row, "id")),
        userId: String(value(row, "userId")),
        threadId: String(value(row, "threadId")),
        goalId: optional(row, "goalId"),
        activeSlot: optional(row, "activeSlot"),
        status: String(value(row, "status")),
        phase: String(value(row, "phase")),
        checkpointJson: jsonText(value(row, "checkpointJson")),
        currentRunId: optional(row, "currentRunId"),
        firstUnitId: optional(row, "firstUnitId"),
        stopRequestedAt: nullableDate(value(row, "stopRequestedAt")),
        stoppedAt: nullableDate(value(row, "stoppedAt")),
        completedAt: nullableDate(value(row, "completedAt")),
        lastError: String(value(row, "lastError") ?? ""),
        version: Number(value(row, "version")) || 1,
        nextEventSequence: Number(value(row, "nextEventSequence")) || 0,
        createdAt: date(value(row, "createdAt")),
        updatedAt: date(value(row, "updatedAt")),
    };
}
function table(em: EntityManager, name: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${name.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
function timestampParameter(em: EntityManager, input: Date): Date | string {
    return sqlTimestampParameter(false, input);
}
export class MikroOrmAgentConversationRepository implements AgentConversationRepository {
    constructor(private readonly em: EntityManager) { }
    private execute(em: EntityManager, sql: string, params: unknown[] = []) {
        return em
            .getConnection()
            .execute(sql, params, undefined, em.getTransactionContext());
    }
    async searchOwnedGoals(input: {
        userId: string;
        since: Date | null;
        until: Date | null;
        dateField: "createdAt" | "updatedAt";
        includeInactive: boolean;
        query: string | null;
        limit: number;
    }) {
        const clauses = [`g."userId" = ?`];
        const params: unknown[] = [input.userId];
        if (!input.includeInactive)
            clauses.push(`g."status" = 'active'`);
        if (input.query) {
            clauses.push(`LOWER(g."title") LIKE LOWER(?)`);
            params.push(`%${input.query}%`);
        }
        if (input.since) {
            clauses.push(`g."${input.dateField}" >= ?`);
            params.push(input.since);
        }
        if (input.until) {
            clauses.push(`g."${input.dateField}" <= ?`);
            params.push(input.until);
        }
        params.push(input.limit);
        return rows(await this.execute(this.em, `SELECT g."id", g."title", g."status", g."createdAt", g."updatedAt",
                COUNT(u."id") AS "unitCount",
                SUM(CASE WHEN u."status" IN ('completed','completed_needs_reinforcement') THEN 1 ELSE 0 END) AS "completedCount"
           FROM ${table(this.em, "LearningGoal")} g
           LEFT JOIN ${table(this.em, "LearningUnit")} u ON u."goalId" = g."id"
          WHERE ${clauses.join(" AND ")}
          GROUP BY g."id", g."title", g."status", g."createdAt", g."updatedAt"
          ORDER BY g."${input.dateField}" DESC LIMIT ?`, params)).map((row) => ({
            id: String(value(row, "id")),
            title: String(value(row, "title")),
            status: String(value(row, "status")),
            createdAt: date(value(row, "createdAt")),
            updatedAt: date(value(row, "updatedAt")),
            unitCount: Number(value(row, "unitCount")),
            completedCount: Number(value(row, "completedCount")),
        }));
    }
    async listOwnedRecentActivity(userId: string, limit: number) {
        const [goalResult, unitResult] = await Promise.all([
            this.execute(this.em, `SELECT "id", "title", "status", "updatedAt" FROM ${table(this.em, "LearningGoal")} WHERE "userId" = ? ORDER BY "updatedAt" DESC LIMIT ?`, [userId, limit]),
            this.execute(this.em, `SELECT u."id", u."title", u."status", u."goalId", g."title" AS "goalTitle",
                s."currentStep", s."structuredSubStep", s."updatedAt"
           FROM ${table(this.em, "UnitSessionState")} s
           JOIN ${table(this.em, "LearningUnit")} u ON u."id" = s."unitId"
           JOIN ${table(this.em, "LearningGoal")} g ON g."id" = u."goalId"
          WHERE g."userId" = ? ORDER BY s."updatedAt" DESC LIMIT ?`, [userId, limit]),
        ]);
        return {
            goals: rows(goalResult).map((row) => ({
                id: String(value(row, "id")),
                title: String(value(row, "title")),
                status: String(value(row, "status")),
                updatedAt: date(value(row, "updatedAt")),
            })),
            units: rows(unitResult).map((row) => ({
                id: String(value(row, "id")),
                title: String(value(row, "title")),
                status: String(value(row, "status")),
                goalId: String(value(row, "goalId")),
                goalTitle: String(value(row, "goalTitle")),
                currentStep: String(value(row, "currentStep") ?? ""),
                structuredSubStep: String(value(row, "structuredSubStep") ?? ""),
                updatedAt: date(value(row, "updatedAt")),
            })),
        };
    }
    async searchOwnedUnits(input: {
        userId: string;
        query: string | null;
        goalId: string | null;
        goalQuery: string | null;
        status: string | null;
        limit: number;
    }) {
        const clauses = [`g."userId" = ?`];
        const params: unknown[] = [input.userId];
        if (input.goalId) {
            clauses.push(`g."id" = ?`);
            params.push(input.goalId);
        }
        else if (input.goalQuery) {
            clauses.push(`LOWER(g."title") LIKE LOWER(?)`);
            params.push(`%${input.goalQuery}%`);
        }
        if (input.status === "completed") {
            clauses.push(`u."status" IN ('completed','completed_needs_reinforcement')`);
        }
        else if (input.status && input.status !== "all") {
            clauses.push(`u."status" = ?`);
            params.push(input.status);
        }
        if (input.query) {
            clauses.push(`LOWER(u."title") LIKE LOWER(?)`);
            params.push(`%${input.query}%`);
        }
        params.push(input.limit);
        return rows(await this.execute(this.em, `SELECT u."id", u."title", u."status", u."unitKind", u."orderIndex", u."goalId",
                g."title" AS "goalTitle", s."currentStep"
           FROM ${table(this.em, "LearningUnit")} u
           JOIN ${table(this.em, "LearningGoal")} g ON g."id" = u."goalId"
           LEFT JOIN ${table(this.em, "UnitSessionState")} s ON s."unitId" = u."id"
          WHERE ${clauses.join(" AND ")}
          ORDER BY g."updatedAt" DESC, u."orderIndex" ASC LIMIT ?`, params)).map((row) => ({
            id: String(value(row, "id")),
            title: String(value(row, "title")),
            status: String(value(row, "status")),
            unitKind: String(value(row, "unitKind")),
            orderIndex: Number(value(row, "orderIndex")),
            goalId: String(value(row, "goalId")),
            goalTitle: String(value(row, "goalTitle")),
            currentStep: value(row, "currentStep") == null
                ? null
                : String(value(row, "currentStep")),
        }));
    }
    async listActiveGlobalThreads(userId: string, limit: number) {
        return this.listActiveThreads(userId, { scope: "global", limit });
    }
    async listActiveThreads(userId: string, input: {
        scope: string;
        scopeId?: string | null;
        limit: number;
    }) {
        const filterScopeId = Boolean(input.scopeId);
        return rows(await this.execute(this.em, `SELECT * FROM ${table(this.em, "AgentThread")} WHERE "userId" = ? AND "scope" = ? AND "status" = 'active'${filterScopeId ? ` AND "scopeId" = ?` : ""} ORDER BY "updatedAt" DESC LIMIT ?`, filterScopeId
            ? [userId, input.scope, input.scopeId, input.limit]
            : [userId, input.scope, input.limit])).map(thread);
    }
    async createThread(input: {
        userId: string;
        scope: string;
        scopeId: string | null;
        stateJson: string;
    }) {
        const now = new Date();
        const result = {
            id: randomUUID(),
            ...input,
            status: "active",
            createdAt: now,
            updatedAt: now,
        };
        await this.execute(this.em, `INSERT INTO ${table(this.em, "AgentThread")} ("id", "userId", "scope", "scopeId", "status", "stateJson", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
            result.id,
            result.userId,
            result.scope,
            result.scopeId,
            result.status,
            result.stateJson,
            now,
            now,
        ]);
        return result;
    }
    async findOrCreateScopedThread(input: {
        userId: string;
        scope: string;
        scopeId: string;
        stateJson: string;
    }) {
        const id = `internal:${createHash("sha256")
            .update(`${input.scope}\0${input.scopeId}`)
            .digest("hex")}`;
        const now = new Date();
        await this.execute(this.em, `INSERT INTO ${table(this.em, "AgentThread")} ("id", "userId", "scope", "scopeId", "status", "stateJson", "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
       ON CONFLICT ("id") DO NOTHING`, [id, input.userId, input.scope, input.scopeId, input.stateJson, now, now]);
        const stored = await this.findThread(id);
        if (!stored ||
            stored.userId !== input.userId ||
            stored.scope !== input.scope ||
            stored.scopeId !== input.scopeId) {
            throw new Error("Scoped internal agent thread ownership mismatch");
        }
        return stored;
    }
    async listThreads(userId: string, scope: string | null, limit: number): Promise<readonly AgentThreadListRecord[]> {
        const result = await this.execute(this.em, `SELECT t.*, m."id" AS "messageId", m."threadId" AS "messageThreadId", m."role" AS "messageRole",
              m."content" AS "messageContent", m."toolCalls" AS "messageToolCalls", m."toolCallId" AS "messageToolCallId",
              m."uiPayload" AS "messageUiPayload", m."metadataJson" AS "messageMetadataJson", m."createdAt" AS "messageCreatedAt"
         FROM ${table(this.em, "AgentThread")} t
         JOIN ${table(this.em, "AgentMessage")} m ON m."id" = (
           SELECT m2."id" FROM ${table(this.em, "AgentMessage")} m2 WHERE m2."threadId" = t."id"
            ORDER BY m2."createdAt" DESC, m2."id" DESC LIMIT 1)
        WHERE t."userId" = ? ${scope ? `AND t."scope" = ?` : ""}
        ORDER BY t."updatedAt" DESC LIMIT ?`, [userId, ...(scope ? [scope] : []), limit]);
        return rows(result).map((row) => ({
            ...thread(row),
            latestMessage: value(row, "messageId") == null ? null : message(row, "message"),
        }));
    }
    async findThread(threadId: string) {
        const row = rows(await this.execute(this.em, `SELECT * FROM ${table(this.em, "AgentThread")} WHERE "id" = ? LIMIT 1`, [threadId]))[0];
        return row ? thread(row) : null;
    }
    async updateThreadState(threadId: string, stateJson: string): Promise<void> {
        await this.execute(this.em, `UPDATE ${table(this.em, "AgentThread")} SET "stateJson" = ?, "updatedAt" = ? WHERE "id" = ?`, [stateJson, new Date(), threadId]);
    }
    async resetThread(threadId: string, stateJson: string): Promise<void> {
        await this.em.transactional(async (em) => {
            const existing = rows(await this.execute(em, `SELECT "id" FROM ${table(em, "AgentThread")} WHERE "id" = ? LIMIT 1`, [threadId]))[0];
            if (!existing)
                throw new Error("Agent thread not found");
            await this.execute(em, `DELETE FROM ${table(em, "AgentMessage")} WHERE "threadId" = ?`, [threadId]);
            await this.execute(em, `UPDATE ${table(em, "AgentThread")} SET "stateJson" = ?, "updatedAt" = ? WHERE "id" = ?`, [stateJson, new Date(), threadId]);
        });
    }
    async appendMessage(threadId: string, input: {
        role: string;
        content: string;
        toolCalls: string;
        toolCallId: string | null;
        uiPayload: string;
        metadataJson: string;
    }): Promise<AgentMessageRecord> {
        return this.em.transactional(async (em) => {
            const owner = rows(await this.execute(em, `SELECT "userId", "scope" FROM ${table(em, "AgentThread")} WHERE "id" = ? LIMIT 1`, [threadId]))[0];
            const latest = rows(await this.execute(em, `SELECT MAX("createdAt") AS "latest" FROM ${table(em, "AgentMessage")} WHERE "threadId" = ?`, [threadId]))[0];
            const latestAt = value(latest ?? {}, "latest");
            const latestMs = latestAt == null || latestAt === ""
                ? 0
                : referenceDateValue(latestAt, "agent message date").getTime();
            // Keep insert order when several messages land in the same millisecond;
            // UUID `id` is not chronological and would put `tool` before `assistant`.
            const now = new Date(Math.max(Date.now(), latestMs + 1));
            const stored: AgentMessageRecord = {
                id: randomUUID(),
                threadId,
                ...input,
                createdAt: now,
            };
            await this.execute(em, `INSERT INTO ${table(em, "AgentMessage")} ("id", "threadId", "role", "content", "toolCalls", "toolCallId", "uiPayload", "metadataJson", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                stored.id,
                threadId,
                input.role,
                input.content,
                input.toolCalls,
                input.toolCallId,
                input.uiPayload,
                input.metadataJson,
                now,
            ]);
            const scope = owner ? String(value(owner, "scope")) : "";
            if (input.role === "assistant" &&
                owner &&
                (scope === "global" || scope === "goal_creation")) {
                const eventId = randomUUID();
                const userId = String(value(owner, "userId"));
                await this.execute(em, `INSERT INTO ${table(em, "DomainEventOutbox")} ("id", "type", "schemaVersion", "idempotencyKey", "userId", "threadId", "payload", "occurredAt", "createdAt") VALUES (?, 'agent.turn.completed.v1', 1, ?, ?, ?, ?, ?, ?) ON CONFLICT ("idempotencyKey") DO NOTHING`, [
                    eventId,
                    `agent-turn-completed:${stored.id}`,
                    userId,
                    threadId,
                    JSON.stringify({ throughMessageId: stored.id }),
                    now,
                    now,
                ]);
            }
            return stored;
        });
    }
    async listAllMessages(threadId: string): Promise<readonly AgentMessageRecord[]> {
        return rows(await this.execute(this.em, `SELECT * FROM ${table(this.em, "AgentMessage")} WHERE "threadId" = ? ORDER BY "createdAt" ASC, "id" ASC`, [threadId])).map((row) => message(row));
    }
    async readProceduralDefaults(userId: string) {
        const [settingsResult, goalsResult] = await Promise.all([
            this.execute(this.em, `SELECT "llmProvider", "teachingPersonaRef" FROM ${table(this.em, "UserSettings")} WHERE "userId" = ? LIMIT 1`, [userId]),
            this.execute(this.em, `SELECT "level", "contentLanguage" FROM ${table(this.em, "LearningGoal")} WHERE "userId" = ? ORDER BY "updatedAt" DESC LIMIT 1`, [userId]),
        ]);
        const settings = rows(settingsResult)[0] ?? {};
        const goal = rows(goalsResult)[0] ?? {};
        return {
            llmProvider: optional(settings, "llmProvider"),
            teachingPersonaRef: optional(settings, "teachingPersonaRef"),
            level: optional(goal, "level"),
            contentLanguage: optional(goal, "contentLanguage"),
        };
    }
    async findOwnedUnit(userId: string, unitId: string) {
        const row = rows(await this.execute(this.em, `SELECT u."id", u."goalId", u."title", u."contentRevision", g."title" AS "goalTitle"
           FROM ${table(this.em, "LearningUnit")} u
           JOIN ${table(this.em, "LearningGoal")} g ON g."id" = u."goalId"
          WHERE u."id" = ? AND g."userId" = ? LIMIT 1`, [unitId, userId]))[0];
        return row
            ? {
                id: String(value(row, "id")),
                goalId: String(value(row, "goalId")),
                title: String(value(row, "title")),
                contentRevision: Number(value(row, "contentRevision")) || 1,
                goalTitle: String(value(row, "goalTitle")),
            }
            : null;
    }
    async findGoalCreationSessionId(threadId: string): Promise<string | null> {
        const row = rows(await this.execute(this.em, `SELECT "id" FROM ${table(this.em, "GoalCreationSession")} WHERE "threadId" = ? LIMIT 1`, [threadId]))[0];
        return row ? String(value(row, "id")) : null;
    }
    async replacePendingGoalCreationResources(sessionId: string, kind: string, resources: readonly GoalCreationResourceInput[]): Promise<void> {
        await this.em.transactional(async (em) => {
            await this.execute(em, `DELETE FROM ${table(em, "GoalCreationSessionResource")} WHERE "sessionId" = ? AND "kind" = ? AND "status" <> 'ingested'`, [sessionId, kind]);
            const now = new Date();
            for (const item of resources) {
                await this.execute(em, `INSERT INTO ${table(em, "GoalCreationSessionResource")} ("id", "sessionId", "kind", "filename", "sourceUrl", "canonicalUrl", "provider", "extractedText", "status", "warning", "error", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, '', ?, ?)`, [
                    randomUUID(),
                    sessionId,
                    item.kind,
                    item.filename,
                    item.sourceUrl ?? null,
                    item.canonicalUrl ?? null,
                    item.provider ?? null,
                    item.extractedText,
                    item.warning ?? "",
                    now,
                    now,
                ]);
            }
        });
    }
    async listGoalCreationResources(sessionId: string, statuses: readonly string[]): Promise<readonly GoalCreationResourceRecord[]> {
        if (statuses.length === 0)
            return [];
        return rows(await this.execute(this.em, `SELECT * FROM ${table(this.em, "GoalCreationSessionResource")} WHERE "sessionId" = ? AND "status" IN (${statuses.map(() => "?").join(", ")}) ORDER BY "createdAt" ASC`, [sessionId, ...statuses])).map(resource);
    }
    async markGoalCreationResourceIngested(resourceId: string): Promise<void> {
        await this.execute(this.em, `UPDATE ${table(this.em, "GoalCreationSessionResource")} SET "status" = 'ingested', "updatedAt" = ? WHERE "id" = ?`, [new Date(), resourceId]);
    }
    async goalCreationWorkGate(goalId: string): Promise<"run" | "stopped"> {
        const row = rows(await this.execute(this.em, `SELECT "status" FROM ${table(this.em, "GoalCreationSession")} WHERE "goalId" = ? LIMIT 1`, [goalId]))[0];
        const status = row ? String(value(row, "status")) : null;
        return status === "stopped" || status === "stop_requested"
            ? "stopped"
            : "run";
    }
    async readGlobalBriefing(userId: string, now: Date) {
        const [reviews, flashcards, goals] = await Promise.all([
            this.execute(this.em, `SELECT COUNT(*) AS "count" FROM ${table(this.em, "ReviewCard")} r JOIN ${table(this.em, "LearningUnit")} u ON u."id" = r."unitId" JOIN ${table(this.em, "LearningGoal")} g ON g."id" = u."goalId" WHERE g."userId" = ? AND r."nextReviewAt" <= ?`, [userId, now]),
            this.execute(this.em, `SELECT COUNT(*) AS "count" FROM ${table(this.em, "FlashCard")} c JOIN ${table(this.em, "FlashCardDeck")} d ON d."id" = c."deckId" JOIN ${table(this.em, "LearningUnit")} u ON u."id" = d."unitId" JOIN ${table(this.em, "LearningGoal")} g ON g."id" = u."goalId" WHERE g."userId" = ? AND c."due" <= ?`, [userId, now]),
            this.execute(this.em, `SELECT COUNT(*) AS "count" FROM ${table(this.em, "LearningGoal")} WHERE "userId" = ? AND "status" = 'active'`, [userId]),
        ]);
        const count = (result: unknown) => Number(value(rows(result)[0] ?? {}, "count")) || 0;
        return {
            dueCount: count(reviews),
            flashcardDueCount: count(flashcards),
            activeGoalCount: count(goals),
        };
    }
    async listUnitLearningTargetIds(unitId: string): Promise<readonly string[]> {
        return rows(await this.execute(this.em, `SELECT "learningTargetId" FROM ${table(this.em, "UnitLearningTarget")} WHERE "unitId" = ?`, [unitId])).map((row) => String(value(row, "learningTargetId")));
    }
    private async findSession(where: string, params: unknown[], em = this.em) {
        const row = rows(await this.execute(em, `SELECT * FROM ${table(em, "GoalCreationSession")} WHERE ${where} LIMIT 1`, params))[0];
        return row ? session(row) : null;
    }
    async recoverInterruptedGoalCreationSessions(errorMessage: string) {
        return this.em.transactional(async (em) => {
            const interrupted = rows(await this.execute(em, `SELECT "id" FROM ${table(em, "GoalCreationSession")} WHERE "status" = 'running'
            AND ("currentRunId" IS NOT NULL OR "goalId" IS NOT NULL)`)).map((row) => String(value(row, "id")));
            const now = new Date();
            for (const id of interrupted) {
                await this.execute(em, `UPDATE ${table(em, "GoalCreationSession")} SET "status" = 'needs_attention', "currentRunId" = NULL, "lastError" = ?, "version" = "version" + 1, "updatedAt" = ? WHERE "id" = ? AND "status" = 'running'
            AND ("currentRunId" IS NOT NULL OR "goalId" IS NOT NULL)`, [errorMessage, now, id]);
            }
            return interrupted;
        });
    }
    findGoalCreationSessionByActiveSlot(userId: string) {
        return this.findSession(`"activeSlot" = ?`, [userId]);
    }
    findGoalCreationSessionById(sessionId: string) {
        return this.findSession(`"id" = ?`, [sessionId]);
    }
    findGoalCreationSessionByGoalId(goalId: string) {
        return this.findSession(`"goalId" = ?`, [goalId]);
    }
    findGoalCreationSessionByThreadId(threadId: string) {
        return this.findSession(`"threadId" = ?`, [threadId]);
    }
    async createGoalCreationSession(input: {
        userId: string;
        stateJson: string;
        phase: string;
    }) {
        return this.em.transactional(async (em) => {
            const existing = await this.findSession(`"activeSlot" = ?`, [input.userId], em);
            if (existing)
                return { session: existing, raced: true };
            const now = new Date();
            const threadId = randomUUID();
            const sessionId = randomUUID();
            await this.execute(em, `INSERT INTO ${table(em, "AgentThread")} ("id", "userId", "scope", "scopeId", "status", "stateJson", "createdAt", "updatedAt") VALUES (?, ?, 'goal_creation', NULL, 'active', ?, ?, ?)`, [
                threadId,
                input.userId,
                input.stateJson,
                timestampParameter(em, now),
                timestampParameter(em, now),
            ]);
            await this.execute(em, `INSERT INTO ${table(em, "GoalCreationSession")} ("id", "userId", "threadId", "activeSlot", "status", "phase", "checkpointJson", "lastError", "version", "nextEventSequence", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, 'running', ?, ?, '', 1, 0, ?, ?) ON CONFLICT ("activeSlot") DO NOTHING`, [
                sessionId,
                input.userId,
                threadId,
                input.userId,
                input.phase,
                input.stateJson,
                timestampParameter(em, now),
                timestampParameter(em, now),
            ]);
            const created = await this.findSession(`"id" = ?`, [sessionId], em);
            if (!created) {
                await this.execute(em, `DELETE FROM ${table(em, "AgentThread")} WHERE "id" = ?`, [threadId]);
                const raced = await this.findSession(`"activeSlot" = ?`, [input.userId], em);
                if (!raced)
                    throw new Error("Active goal-creation session race was not recoverable");
                return { session: raced, raced: true };
            }
            await this.execute(em, `UPDATE ${table(em, "AgentThread")} SET "scopeId" = ?, "updatedAt" = ? WHERE "id" = ?`, [sessionId, timestampParameter(em, now), threadId]);
            return { session: created, raced: false };
        });
    }
    async findFoundationParent(userId: string, goalId: string): Promise<GoalCreationParentRecord | null> {
        const row = rows(await this.execute(this.em, `SELECT "id", "title", "contentLanguage", "goalKind", "parentGoalId", "goalRelationType", "mapPlanJson" FROM ${table(this.em, "LearningGoal")} WHERE "id" = ? AND "userId" = ? LIMIT 1`, [goalId, userId]))[0];
        return row
            ? {
                id: String(value(row, "id")),
                title: String(value(row, "title")),
                contentLanguage: String(value(row, "contentLanguage")),
                goalKind: String(value(row, "goalKind")),
                parentGoalId: optional(row, "parentGoalId"),
                goalRelationType: optional(row, "goalRelationType"),
                mapPlanJson: jsonText(value(row, "mapPlanJson")),
            }
            : null;
    }
    async listFoundationRelationContexts(userId: string, parentGoalId: string) {
        return rows(await this.execute(this.em, `SELECT "goalRelationContextJson" FROM ${table(this.em, "LearningGoal")} WHERE "userId" = ? AND "parentGoalId" = ? AND "goalRelationType" = 'foundation_support'`, [userId, parentGoalId])).map((row) => jsonText(value(row, "goalRelationContextJson")));
    }
    async bindGoalCreationSessionGoal(input: {
        sessionId: string;
        threadId: string;
        goalId: string;
        phase: string;
        stateJson: string;
    }) {
        await this.em.transactional(async (em) => {
            const now = new Date();
            await this.execute(em, `UPDATE ${table(em, "AgentThread")} SET "stateJson" = ?, "updatedAt" = ? WHERE "id" = ?`, [input.stateJson, now, input.threadId]);
            await this.execute(em, `UPDATE ${table(em, "GoalCreationSession")} SET "goalId" = ?, "phase" = ?, "checkpointJson" = ?, "updatedAt" = ? WHERE "id" = ?`, [input.goalId, input.phase, input.stateJson, now, input.sessionId]);
        });
    }
    async deleteGoalCreationSession(sessionId: string) {
        await this.execute(this.em, `DELETE FROM ${table(this.em, "GoalCreationSession")} WHERE "id" = ?`, [sessionId]);
    }
    async deleteFoundationGoal(input: {
        userId: string;
        goalId: string;
        parentGoalId: string;
    }) {
        await this.execute(this.em, `DELETE FROM ${table(this.em, "LearningGoal")} WHERE "id" = ? AND "userId" = ? AND "parentGoalId" = ? AND "goalRelationType" = 'foundation_support'`, [input.goalId, input.userId, input.parentGoalId]);
    }
    async listLegacyGoalCreationThreads(userId: string, limit: number) {
        return rows(await this.execute(this.em, `SELECT t.* FROM ${table(this.em, "AgentThread")} t LEFT JOIN ${table(this.em, "GoalCreationSession")} s ON s."threadId" = t."id" WHERE t."userId" = ? AND t."status" = 'active' AND t."scope" IN ('global', 'goal_creation') AND s."id" IS NULL ORDER BY t."updatedAt" DESC LIMIT ?`, [userId, limit])).map(thread);
    }
    async goalOwnedExists(userId: string, goalId: string) {
        return (rows(await this.execute(this.em, `SELECT 1 AS "found" FROM ${table(this.em, "LearningGoal")} WHERE "id" = ? AND "userId" = ? LIMIT 1`, [goalId, userId])).length > 0);
    }
    async adoptLegacyGoalCreationSession(input: {
        userId: string;
        threadId: string;
        goalId: string | null;
        status: string;
        phase: string;
        checkpointJson: string;
    }) {
        return this.em.transactional(async (em) => {
            const now = new Date();
            const id = randomUUID();
            await this.execute(em, `INSERT INTO ${table(em, "GoalCreationSession")} ("id", "userId", "threadId", "goalId", "activeSlot", "status", "phase", "checkpointJson", "lastError", "version", "nextEventSequence", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', 1, 0, ?, ?) ON CONFLICT DO NOTHING`, [
                id,
                input.userId,
                input.threadId,
                input.goalId,
                input.userId,
                input.status,
                input.phase,
                input.checkpointJson,
                timestampParameter(em, now),
                timestampParameter(em, now),
            ]);
            const created = await this.findSession(`"id" = ?`, [id], em);
            if (created)
                await this.execute(em, `UPDATE ${table(em, "AgentThread")} SET "scopeId" = ?, "updatedAt" = ? WHERE "id" = ?`, [id, timestampParameter(em, now), input.threadId]);
            return (created ?? this.findSession(`"activeSlot" = ?`, [input.userId], em));
        });
    }
    async listGoalCreationEvents(sessionId: string, after: number, limit: number) {
        return rows(await this.execute(this.em, `SELECT "sequence", "type", "payload", CAST("createdAt" AS TEXT) AS "createdAt" FROM ${table(this.em, "GoalCreationSessionEvent")} WHERE "sessionId" = ? AND "sequence" > ? ORDER BY "sequence" ASC LIMIT ?`, [sessionId, after, limit])).map((row): GoalCreationEventRecord => ({
            sequence: Number(value(row, "sequence")),
            type: String(value(row, "type")),
            payload: typeof value(row, "payload") === "string"
                ? JSON.parse(String(value(row, "payload")))
                : value(row, "payload"),
            createdAt: date(value(row, "createdAt")),
        }));
    }
    async appendGoalCreationEvent(sessionId: string, event: {
        type: string;
        payload: unknown;
    }) {
        return this.em.transactional(async (em) => {
            const now = new Date();
            const id = randomUUID();
            const updated = rows(await this.execute(em, `UPDATE ${table(em, "GoalCreationSession")} SET "nextEventSequence" = "nextEventSequence" + 1, "version" = "version" + 1, "updatedAt" = ? WHERE "id" = ? RETURNING "nextEventSequence"`, [timestampParameter(em, now), sessionId]))[0];
            if (!updated)
                throw new Error("Goal-creation session not found");
            const sequence = Number(value(updated, "nextEventSequence"));
            await this.execute(em, `INSERT INTO ${table(em, "GoalCreationSessionEvent")} ("id", "sessionId", "sequence", "type", "payload", "createdAt") VALUES (?, ?, ?, ?, ?, ?)`, [
                id,
                sessionId,
                sequence,
                event.type,
                JSON.stringify(event.payload),
                timestampParameter(em, now),
            ]);
            return {
                sequence,
                type: event.type,
                payload: event.payload,
                createdAt: now,
            };
        });
    }
    async readGoalCreationJourney(goalId: string): Promise<GoalCreationJourneyRecord> {
        const goal = rows(await this.execute(this.em, `SELECT "learningMode" FROM ${table(this.em, "LearningGoal")} WHERE "id" = ? LIMIT 1`, [goalId]))[0];
        const moduleRows = rows(await this.execute(this.em, `SELECT m."id", m."title", m."orderIndex", m."generationStatus", u."id" AS "unitId", u."title" AS "unitTitle", u."orderIndex" AS "unitOrderIndex", u."cognitiveModelStatus" FROM ${table(this.em, "LearningModule")} m LEFT JOIN ${table(this.em, "LearningUnit")} u ON u."moduleId" = m."id" AND u."unitKind" = 'lesson' WHERE m."goalId" = ? ORDER BY m."orderIndex" ASC, u."orderIndex" ASC`, [goalId]));
        const modules = new Map<string, GoalCreationJourneyRecord["modules"][number] & {
            units: Array<GoalCreationJourneyRecord["modules"][number]["units"][number]>;
        }>();
        for (const row of moduleRows) {
            const id = String(value(row, "id"));
            let item = modules.get(id);
            if (!item) {
                item = {
                    id,
                    title: String(value(row, "title")),
                    orderIndex: Number(value(row, "orderIndex")),
                    generationStatus: String(value(row, "generationStatus")),
                    units: [],
                };
                modules.set(id, item);
            }
            if (value(row, "unitId") != null)
                item.units.push({
                    id: String(value(row, "unitId")),
                    title: String(value(row, "unitTitle")),
                    orderIndex: Number(value(row, "unitOrderIndex")),
                    cognitiveModelStatus: String(value(row, "cognitiveModelStatus")),
                });
        }
        const moduleList = [...modules.values()];
        const hasUnits = moduleList.some((module) => module.units.length > 0);
        if (!hasUnits) {
            const standalone = rows(await this.execute(this.em, `SELECT "id", "title", "orderIndex", "cognitiveModelStatus" FROM ${table(this.em, "LearningUnit")} WHERE "goalId" = ? AND "unitKind" IN ('lesson', 'overview') ORDER BY "orderIndex" ASC`, [goalId]));
            if (standalone.length > 0) {
                moduleList.push({
                    id: `${goalId}:micro`,
                    title: "",
                    orderIndex: 0,
                    generationStatus: "ready",
                    units: standalone.map((row) => ({
                        id: String(value(row, "id")),
                        title: String(value(row, "title")),
                        orderIndex: Number(value(row, "orderIndex")),
                        cognitiveModelStatus: String(value(row, "cognitiveModelStatus")),
                    })),
                });
            }
        }
        return {
            learningMode: goal ? String(value(goal, "learningMode")) : "mastery",
            modules: moduleList,
        };
    }
    async retryGoalCreationSession(sessionId: string, status: string) {
        await this.execute(this.em, `UPDATE ${table(this.em, "GoalCreationSession")} SET "status" = ?, "lastError" = '', "version" = "version" + 1, "updatedAt" = ? WHERE "id" = ?`, [status, new Date(), sessionId]);
    }
    async stopGoalCreationSession(sessionId: string, stoppedAt: Date) {
        await this.execute(this.em, `UPDATE ${table(this.em, "GoalCreationSession")} SET "status" = 'stopped', "stopRequestedAt" = ?, "stoppedAt" = ?, "currentRunId" = NULL, "activeSlot" = NULL, "version" = "version" + 1, "updatedAt" = ? WHERE "id" = ?`, [stoppedAt, stoppedAt, stoppedAt, sessionId]);
    }
    async markGoalCreationSessionError(sessionId: string, error: string) {
        await this.execute(this.em, `UPDATE ${table(this.em, "GoalCreationSession")} SET "status" = 'needs_attention', "lastError" = ?, "currentRunId" = NULL, "version" = "version" + 1, "updatedAt" = ? WHERE "id" = ? AND "status" NOT IN ('stopped', 'completed')`, [error, new Date(), sessionId]);
    }
    async markGoalCreationRunStarted(threadId: string, runId: string) {
        await this.execute(this.em, `UPDATE ${table(this.em, "GoalCreationSession")} SET "status" = 'running', "currentRunId" = ?, "lastError" = '', "version" = "version" + 1, "updatedAt" = ? WHERE "threadId" = ? AND "status" NOT IN ('stopped', 'completed')`, [runId, new Date(), threadId]);
    }
    async syncGoalCreationSession(input: {
        sessionId: string;
        goalId: string | null;
        phase: string;
        checkpointJson: string;
        status?: string;
        error?: string;
    }) {
        const assignments = [
            `"goalId" = ?`,
            `"phase" = ?`,
            `"checkpointJson" = ?`,
            `"currentRunId" = NULL`,
            `"version" = "version" + 1`,
            `"updatedAt" = ?`,
        ];
        const params: unknown[] = [
            input.goalId,
            input.phase,
            input.checkpointJson,
            new Date(),
        ];
        if (input.status !== undefined) {
            assignments.push(`"status" = ?`);
            params.push(input.status);
        }
        if (input.error !== undefined) {
            assignments.push(`"lastError" = ?`);
            params.push(input.error);
        }
        params.push(input.sessionId);
        await this.execute(this.em, `UPDATE ${table(this.em, "GoalCreationSession")} SET ${assignments.join(", ")} WHERE "id" = ?`, params);
    }
    async markGoalCreationFirstUnitReady(sessionId: string, firstUnitId: string) {
        const updated = rows(await this.execute(this.em, `UPDATE ${table(this.em, "GoalCreationSession")} SET "firstUnitId"=?, "version"="version"+1, "updatedAt"=? WHERE "id"=? AND "status"='running' AND ("firstUnitId" IS NULL OR "firstUnitId"='') RETURNING "id"`, [firstUnitId, new Date(), sessionId]));
        return updated.length > 0;
    }
    async completeGoalCreationSession(sessionId: string, firstUnitId: string, completedAt: Date) {
        const updated = rows(await this.execute(this.em, `UPDATE ${table(this.em, "GoalCreationSession")} SET "status" = 'completed', "phase" = 'ready', "firstUnitId" = ?, "activeSlot" = NULL, "completedAt" = ?, "currentRunId" = NULL, "version" = "version" + 1, "updatedAt" = ? WHERE "id" = ? AND "status" NOT IN ('stopped', 'completed') RETURNING "id"`, [firstUnitId, completedAt, completedAt, sessionId]));
        return updated.length > 0;
    }
    async advanceGoalCreationSessionToFirstUnit(sessionId: string, phase: string) {
        await this.execute(this.em, `UPDATE ${table(this.em, "GoalCreationSession")} SET "status" = 'running', "phase" = ?, "version" = "version" + 1, "updatedAt" = ? WHERE "id" = ? AND "phase" IN ('module_shell', 'goal_creation')`, [phase, new Date(), sessionId]);
    }
    async countGoalUnits(goalId: string, planBoundOnly = false) {
        const row = rows(await this.execute(this.em, `SELECT COUNT(*) AS "count" FROM ${table(this.em, "LearningUnit")} WHERE "goalId" = ?${planBoundOnly ? ` AND "planAreaRef" <> ''` : ""}`, [goalId]))[0];
        return Number(value(row ?? {}, "count")) || 0;
    }
    async listGoalOverviewBranches(goalId: string) {
        return rows(await this.execute(this.em, `SELECT "title", "contentSummary" FROM ${table(this.em, "LearningUnit")} WHERE "goalId" = ? AND "parentUnitId" IS NULL AND "unitKind" IN ('branch', 'module', 'lesson') ORDER BY "orderIndex" ASC`, [goalId])).map((row) => ({
            title: String(value(row, "title")),
            contentSummary: String(value(row, "contentSummary") ?? ""),
        }));
    }
    async listMessages(input: {
        threadId: string;
        beforeCreatedAt: Date | null;
        beforeId: string | null;
        limit: number;
    }) {
        const cursor = input.beforeCreatedAt
            ? input.beforeId
                ? ` AND ("createdAt" < ? OR ("createdAt" = ? AND "id" < ?))`
                : ` AND "createdAt" < ?`
            : "";
        const cursorParams = input.beforeCreatedAt
            ? input.beforeId
                ? [input.beforeCreatedAt, input.beforeCreatedAt, input.beforeId]
                : [input.beforeCreatedAt]
            : [];
        const [items, count] = await Promise.all([
            this.execute(this.em, `SELECT * FROM ${table(this.em, "AgentMessage")} WHERE "threadId" = ?${cursor} ORDER BY "createdAt" DESC, "id" DESC LIMIT ?`, [input.threadId, ...cursorParams, input.limit]),
            this.execute(this.em, `SELECT COUNT(*) AS "count" FROM ${table(this.em, "AgentMessage")} WHERE "threadId" = ?`, [input.threadId]),
        ]);
        return {
            messages: rows(items).map((row) => message(row)),
            total: Number(value(rows(count)[0] ?? {}, "count")) || 0,
        };
    }
    async clearThread(threadId: string, stateJson: string): Promise<void> {
        await this.em.transactional(async (em) => {
            await this.execute(em, `DELETE FROM ${table(em, "AgentMessage")} WHERE "threadId" = ?`, [threadId]);
            await this.execute(em, `UPDATE ${table(em, "AgentThread")} SET "stateJson" = ?, "updatedAt" = ? WHERE "id" = ?`, [stateJson, new Date(), threadId]);
        });
    }
    async resetThreadContext(threadId: string, stateJson: string, systemMessage: string, metadataJson: string): Promise<void> {
        await this.em.transactional(async (em) => {
            const now = new Date();
            await this.execute(em, `UPDATE ${table(em, "AgentThread")} SET "stateJson" = ?, "updatedAt" = ? WHERE "id" = ?`, [stateJson, now, threadId]);
            await this.execute(em, `INSERT INTO ${table(em, "AgentMessage")} ("id", "threadId", "role", "content", "metadataJson", "createdAt") VALUES (?, ?, 'system', ?, ?, ?)`, [randomUUID(), threadId, systemMessage, metadataJson, now]);
        });
    }
    async deleteThread(threadId: string): Promise<void> {
        await this.em.transactional(async (em) => {
            await this.execute(em, `DELETE FROM ${table(em, "MaterialFollowUp")} WHERE "id" = ?`, [threadId]);
            await this.execute(em, `DELETE FROM ${table(em, "AgentThread")} WHERE "id" = ?`, [threadId]);
        });
    }
}
