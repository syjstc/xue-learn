import type { EntityManager } from "@mikro-orm/core";
import type { DeepPlanningResearchConcurrencySnapshot, DeepPlanningResearchRepository, } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { referenceDateValue } from "./date-value.ts";
type Row = Readonly<Record<string, unknown>>;
const SETTINGS_ID = "global";
const DEFAULT_CONCURRENCY = 2;
const LOCK_KEY = "xuelearn:deep-planning-research-slots:v1";
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
function date(value: unknown): Date {
    return referenceDateValue(value);
}
/**
 * SQLite binds Date parameters as epoch numbers, while lease columns are
 * timestamp text. Compare through julianday so mixed ISO / CURRENT_TIMESTAMP
 * values still expire and acquire correctly.
 */
function dateParameter(em: EntityManager, input: Date): Date | string {
    return input.toISOString();
}
function timestampCompare(em: EntityManager, column: string, operator: "<=" | ">"): string {
    return `julianday("${column}") ${operator} julianday(?)`;
}
export class MikroOrmDeepPlanningResearchRepository implements DeepPlanningResearchRepository {
    constructor(private readonly em: EntityManager) { }
    private execute(em: EntityManager, sql: string, params: unknown[] = []) {
        return em
            .getConnection()
            .execute(sql, params, undefined, em.getTransactionContext());
    }
    private async ensureSettings(em: EntityManager, now: Date): Promise<Row> {
        const settings = table(em, "GlobalGenerationSettings");
        await this.execute(em, `INSERT INTO ${settings} ("id", "deepPlanningResearchConcurrency", "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?) ON CONFLICT ("id") DO NOTHING`, [
            SETTINGS_ID,
            DEFAULT_CONCURRENCY,
            dateParameter(em, now),
            dateParameter(em, now),
        ]);
        const found = rows(await this.execute(em, `SELECT "deepPlanningResearchConcurrency", "updatedAt", "updatedByUserId"
           FROM ${settings} WHERE "id" = ?`, [SETTINGS_ID]))[0];
        if (!found)
            throw new Error("Global generation settings are unavailable");
        return found;
    }
    private async expire(em: EntityManager, now: Date): Promise<void> {
        await this.execute(em, `UPDATE ${table(em, "DeepPlanningResearchLease")}
          SET "status" = 'expired', "releasedAt" = ?, "updatedAt" = ?
        WHERE "status" = 'active' AND ${timestampCompare(em, "expiresAt", "<=")}`, [dateParameter(em, now), dateParameter(em, now), dateParameter(em, now)]);
    }
    async getSnapshot(now: Date): Promise<DeepPlanningResearchConcurrencySnapshot> {
        return this.em.transactional(async (em) => {
            await this.expire(em, now);
            const settings = await this.ensureSettings(em, now);
            const lease = table(em, "DeepPlanningResearchLease");
            const counts = rows(await this.execute(em, `SELECT
             SUM(CASE WHEN "status" = 'active' AND ${timestampCompare(em, "expiresAt", ">")} THEN 1 ELSE 0 END) AS "activeResearchCount",
             SUM(CASE WHEN "status" = 'queued' THEN 1 ELSE 0 END) AS "queuedResearchCount",
             SUM(CASE WHEN "status" = 'expired' THEN 1 ELSE 0 END) AS "expiredLeaseCount"
           FROM ${lease}`, [dateParameter(em, now)]))[0] ?? {};
            return {
                deepPlanningResearchConcurrency: Number(value(settings, "deepPlanningResearchConcurrency")),
                updatedAt: date(value(settings, "updatedAt")),
                updatedByUserId: (value(settings, "updatedByUserId") as string | null) ?? null,
                activeResearchCount: Number(value(counts, "activeResearchCount")) || 0,
                queuedResearchCount: Number(value(counts, "queuedResearchCount")) || 0,
                expiredLeaseCount: Number(value(counts, "expiredLeaseCount")) || 0,
            };
        });
    }
    async updateConcurrency(input: {
        value: number;
        updatedByUserId: string;
        now: Date;
    }): Promise<void> {
        await this.ensureSettings(this.em, input.now);
        await this.execute(this.em, `UPDATE ${table(this.em, "GlobalGenerationSettings")}
          SET "deepPlanningResearchConcurrency" = ?, "updatedByUserId" = ?, "updatedAt" = ?
        WHERE "id" = ?`, [
            input.value,
            input.updatedByUserId,
            dateParameter(this.em, input.now),
            SETTINGS_ID,
        ]);
    }
    async enqueue(input: {
        id: string;
        ownerKey: string;
        goalId?: string;
        moduleKey?: string;
        now: Date;
    }): Promise<void> {
        await this.ensureSettings(this.em, input.now);
        await this.execute(this.em, `INSERT INTO ${table(this.em, "DeepPlanningResearchLease")}
        ("id", "ownerKey", "goalId", "moduleKey", "status", "queuedAt", "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)`, [
            input.id,
            input.ownerKey,
            input.goalId ?? null,
            input.moduleKey ?? null,
            dateParameter(this.em, input.now),
            dateParameter(this.em, input.now),
            dateParameter(this.em, input.now),
        ]);
    }
    async tryAcquire(input: {
        id: string;
        now: Date;
        expiresAt: Date;
    }): Promise<boolean> {
        return this.em.transactional(async (em) => {
            await this.expire(em, input.now);
            const settings = await this.ensureSettings(em, input.now);
            const lease = table(em, "DeepPlanningResearchLease");
            const active = rows(await this.execute(em, `SELECT COUNT(*) AS "count" FROM ${lease}
            WHERE "status" = 'active' AND ${timestampCompare(em, "expiresAt", ">")}`, [dateParameter(em, input.now)]))[0] ?? {};
            if (Number(value(active, "count")) >=
                Number(value(settings, "deepPlanningResearchConcurrency"))) {
                return false;
            }
            const next = rows(await this.execute(em, `SELECT "id" FROM ${lease} WHERE "status" = 'queued'
            ORDER BY "queuedAt" ASC, "id" ASC LIMIT 1`))[0];
            if (value(next ?? {}, "id") !== input.id)
                return false;
            const updated = await this.execute(em, `UPDATE ${lease}
            SET "status" = 'active', "acquiredAt" = ?, "heartbeatAt" = ?,
                "expiresAt" = ?, "updatedAt" = ?
          WHERE "id" = ? AND "status" = 'queued' RETURNING "id"`, [
                dateParameter(em, input.now),
                dateParameter(em, input.now),
                dateParameter(em, input.expiresAt),
                dateParameter(em, input.now),
                input.id,
            ]);
            return rows(updated).length === 1;
        });
    }
    async cancelQueued(id: string, now: Date): Promise<void> {
        await this.execute(this.em, `UPDATE ${table(this.em, "DeepPlanningResearchLease")}
          SET "status" = 'cancelled', "releasedAt" = ?, "updatedAt" = ?
        WHERE "id" = ? AND "status" = 'queued'`, [dateParameter(this.em, now), dateParameter(this.em, now), id]);
    }
    async renew(input: {
        id: string;
        now: Date;
        expiresAt: Date;
    }): Promise<boolean> {
        const updated = await this.execute(this.em, `UPDATE ${table(this.em, "DeepPlanningResearchLease")}
          SET "heartbeatAt" = ?, "expiresAt" = ?, "updatedAt" = ?
        WHERE "id" = ? AND "status" = 'active' AND ${timestampCompare(this.em, "expiresAt", ">")} RETURNING "id"`, [
            dateParameter(this.em, input.now),
            dateParameter(this.em, input.expiresAt),
            dateParameter(this.em, input.now),
            input.id,
            dateParameter(this.em, input.now),
        ]);
        return rows(updated).length === 1;
    }
    async release(id: string, now: Date): Promise<void> {
        await this.execute(this.em, `UPDATE ${table(this.em, "DeepPlanningResearchLease")}
          SET "status" = 'released', "releasedAt" = ?, "expiresAt" = NULL, "updatedAt" = ?
        WHERE "id" = ? AND "status" = 'active'`, [dateParameter(this.em, now), dateParameter(this.em, now), id]);
    }
}
