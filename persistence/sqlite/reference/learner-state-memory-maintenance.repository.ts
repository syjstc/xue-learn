import type { EntityManager } from "@mikro-orm/core";
import type { LearnerStateMemoryMaintenanceRepository, LearnerStateMemoryReadRecord, } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { nullableReferenceDateValue, referenceDateValue } from "./date-value.ts";
type Row = Readonly<Record<string, unknown>>;
const sqliteExclusiveTails = new Map<string, Promise<void>>();
async function runSqliteExclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const predecessor = sqliteExclusiveTails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const tail = predecessor.catch(() => undefined).then(() => gate);
    sqliteExclusiveTails.set(key, tail);
    await predecessor.catch(() => undefined);
    try {
        return await operation();
    }
    finally {
        release();
        if (sqliteExclusiveTails.get(key) === tail) {
            sqliteExclusiveTails.delete(key);
        }
    }
}
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
function optionalDate(value: unknown): Date | null {
    return nullableReferenceDateValue(value);
}
function json(value: unknown): unknown {
    if (typeof value !== "string")
        return value;
    try {
        return JSON.parse(value);
    }
    catch {
        return value;
    }
}
function table(em: EntityManager, name: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${name.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
function memory(row: Row | undefined): LearnerStateMemoryReadRecord | null {
    if (!row)
        return null;
    return {
        userId: String(value(row, "userId")),
        schemaVersion: Number(value(row, "schemaVersion")),
        sourceSchemaVersion: Number(value(row, "sourceSchemaVersion")),
        inferencePolicyVersion: Number(value(row, "inferencePolicyVersion")),
        sourceFingerprint: String(value(row, "sourceFingerprint") ?? ""),
        sourceRevisionCutoffAt: optionalDate(value(row, "sourceRevisionCutoffAt")),
        stateJson: json(value(row, "stateJson")),
        refreshedAt: optionalDate(value(row, "refreshedAt")),
        invalidatedAt: optionalDate(value(row, "invalidatedAt")),
        nextRefreshAt: optionalDate(value(row, "nextRefreshAt")),
        lastRefreshReason: String(value(row, "lastRefreshReason") ?? ""),
        lastError: String(value(row, "lastError") ?? ""),
    };
}
export class MikroOrmLearnerStateMemoryMaintenanceRepository implements LearnerStateMemoryMaintenanceRepository {
    constructor(private readonly em: EntityManager) { }
    private execute(em: EntityManager, sql: string, params: unknown[] = []) {
        return em
            .getConnection()
            .execute(sql, params, undefined, em.getTransactionContext());
    }
    async listGoals(userId: string) {
        const result = await this.execute(this.em, `SELECT "id", "title" FROM ${table(this.em, "LearningGoal")}
        WHERE "userId" = ? AND "learningMode" <> 'exploration' ORDER BY "updatedAt" DESC`, [userId]);
        return rows(result).map((row) => ({
            id: String(value(row, "id")),
            title: String(value(row, "title")),
        }));
    }
    async findLatestStateRevisionAt(userId: string): Promise<Date | null> {
        const row = rows(await this.execute(this.em, `SELECT MAX("createdAt") AS "createdAt" FROM ${table(this.em, "LearnerStateRevision")} WHERE "userId" = ?`, [userId]))[0];
        return row ? optionalDate(value(row, "createdAt")) : null;
    }
    async totalActiveSeconds(userId: string): Promise<number> {
        const row = rows(await this.execute(this.em, `SELECT COALESCE(SUM(s."cumulativeActiveSeconds"), 0) AS "seconds"
         FROM ${table(this.em, "UnitSessionState")} s JOIN ${table(this.em, "LearningUnit")} u ON u."id" = s."unitId"
         JOIN ${table(this.em, "LearningGoal")} g ON g."id" = u."goalId" WHERE g."userId" = ?`, [userId]))[0];
        return Math.max(0, Number(value(row ?? {}, "seconds")) || 0);
    }
    async listDueUsers(now: Date, limit: number): Promise<readonly string[]> {
        const result = await this.execute(this.em, `SELECT "userId" FROM ${table(this.em, "LearnerStateMemory")}
        WHERE "invalidatedAt" IS NOT NULL OR "nextRefreshAt" <= ?
        ORDER BY "invalidatedAt" ASC, "nextRefreshAt" ASC LIMIT ?`, [now, limit]);
        return rows(result).map((row) => String(value(row, "userId")));
    }
    async recordError(userId: string, message: string): Promise<void> {
        await this.execute(this.em, `UPDATE ${table(this.em, "LearnerStateMemory")} SET "lastError" = ?, "updatedAt" = ? WHERE "userId" = ?`, [message.slice(0, 1000), new Date(), userId]);
    }
    async runExclusive<T>(userId: string, operation: Parameters<LearnerStateMemoryMaintenanceRepository["runExclusive"]>[1]): Promise<T> {
        const run = async (em: EntityManager) => {
            const existing = memory(rows(await this.execute(em, `SELECT * FROM ${table(em, "LearnerStateMemory")} WHERE "userId" = ? ${""}`, [userId]))[0]);
            const outcome = await operation(existing);
            if (outcome.publication) {
                const publish = async (publicationEm: EntityManager) => {
                    const p = outcome.publication!;
                    const now = new Date();
                    await this.execute(publicationEm, `INSERT INTO ${table(publicationEm, "LearnerStateMemory")}
            ("userId", "schemaVersion", "sourceSchemaVersion", "inferencePolicyVersion", "sourceFingerprint",
             "sourceRevisionCutoffAt", "stateJson", "refreshedAt", "nextRefreshAt", "lastError", "createdAt", "updatedAt")
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)
           ON CONFLICT ("userId") DO UPDATE SET "schemaVersion" = EXCLUDED."schemaVersion",
             "sourceSchemaVersion" = EXCLUDED."sourceSchemaVersion", "inferencePolicyVersion" = EXCLUDED."inferencePolicyVersion",
             "sourceFingerprint" = EXCLUDED."sourceFingerprint", "sourceRevisionCutoffAt" = EXCLUDED."sourceRevisionCutoffAt",
             "stateJson" = EXCLUDED."stateJson", "refreshedAt" = EXCLUDED."refreshedAt",
             "nextRefreshAt" = EXCLUDED."nextRefreshAt", "lastError" = '', "updatedAt" = EXCLUDED."updatedAt"`, [
                        userId,
                        p.schemaVersion,
                        p.sourceSchemaVersion,
                        p.inferencePolicyVersion,
                        p.sourceFingerprint,
                        p.sourceRevisionCutoffAt,
                        JSON.stringify(p.stateJson),
                        p.refreshedAt,
                        p.nextRefreshAt,
                        now,
                        now,
                    ]);
                    if (existing?.invalidatedAt) {
                        await this.execute(publicationEm, `UPDATE ${table(publicationEm, "LearnerStateMemory")} SET "invalidatedAt" = NULL, "updatedAt" = ?
              WHERE "userId" = ? AND "invalidatedAt" = ?`, [now, userId, existing.invalidatedAt]);
                    }
                };
                await this.em.transactional(publish);
            }
            return outcome.result as T;
        };
        // SQLite has a single connection. Holding a transaction open while the
        // projection callback reads through this repository's root entity manager
        // queues those reads behind the transaction and deadlocks the request.
        // The desktop runtime is single-process, so serialize rebuilds in-process
        // and use a short transaction only for publication.
        return runSqliteExclusive(userId, () => run(this.em));
    }
}
