import type { EntityManager } from "@mikro-orm/core";
import type { ClaimEventOutboxInput, EventOutboxDeliveryRepository, EventOutboxRecord, SettleEventOutboxFailureInput, } from "@xue-learn/core/domain";
import { nullableReferenceDateValue } from "./date-value.ts";
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
function nullableDate(input: unknown): Date | null {
    return nullableReferenceDateValue(input, "event outbox timestamp");
}
function record(row: Row): EventOutboxRecord {
    return {
        id: String(value(row, "id")),
        type: String(value(row, "type")),
        payload: String(value(row, "payload")),
        createdAt: nullableDate(value(row, "createdAt"))!,
        publishedAt: nullableDate(value(row, "publishedAt")),
        attemptCount: Number(value(row, "attemptCount")),
        nextAttemptAt: nullableDate(value(row, "nextAttemptAt")),
        lastError: value(row, "lastError") == null ? null : String(value(row, "lastError")),
        deadLetteredAt: nullableDate(value(row, "deadLetteredAt")),
    };
}
function table(em: EntityManager): string {
    const schema = em.schema ?? em.config?.getSchema();
    return schema
        ? `"${schema.replaceAll('"', '""')}"."EventOutbox"`
        : '"EventOutbox"';
}
/**
 * PostgreSQL drivers preserve Date parameters, while the SQLite driver binds
 * them as epoch numbers. EventOutbox's SQLite defaults are timestamp text, so
 * comparing those two storage classes directly never considers a fresh row
 * due. Keep SQLite delivery timestamps textual at this raw-SQL boundary and
 * normalize comparisons through julianday for both the default and ISO forms.
 */
function dateParameter(em: EntityManager, input: Date): Date | string {
    return input.toISOString();
}
function duePredicate(em: EntityManager): string {
    return 'julianday("nextAttemptAt") <= julianday(?)';
}
export class MikroOrmEventOutboxDeliveryRepository implements EventOutboxDeliveryRepository {
    constructor(private readonly em: EntityManager) { }
    private execute(sql: string, params: unknown[] = []) {
        return this.em
            .getConnection()
            .execute(sql, params, undefined, this.em.getTransactionContext());
    }
    async claimDue(input: ClaimEventOutboxInput): Promise<readonly EventOutboxRecord[]> {
        return this.em.transactional(async (tx) => {
            const repository = new MikroOrmEventOutboxDeliveryRepository(tx);
            const eventTable = table(tx);
            const placeholders = input.types.map(() => "?").join(", ");
            const typePredicate = input.types.length
                ? `AND "type" ${input.includeTypes ? "IN" : "NOT IN"} (${placeholders})`
                : "";
            const candidates = rows(await repository.execute(`SELECT "id", "type", "payload", "createdAt", "publishedAt",
                  "attemptCount", "nextAttemptAt", "lastError", "deadLetteredAt"
             FROM ${eventTable}
            WHERE "publishedAt" IS NULL AND "deadLetteredAt" IS NULL
              AND ${duePredicate(tx)} ${typePredicate}
            ORDER BY "createdAt" ASC, "id" ASC
            LIMIT ?
            ${""}`, [dateParameter(tx, input.now), ...input.types, input.limit]));
            const claimed: EventOutboxRecord[] = [];
            for (const candidate of candidates) {
                const updated = rows(await repository.execute(`UPDATE ${eventTable}
                SET "attemptCount" = "attemptCount" + 1,
                    "nextAttemptAt" = ?
              WHERE "id" = ? AND "publishedAt" IS NULL
                AND "deadLetteredAt" IS NULL AND "attemptCount" = ?
                AND ${duePredicate(tx)}
              RETURNING "attemptCount", "nextAttemptAt"`, [
                    dateParameter(tx, input.leaseUntil),
                    value(candidate, "id"),
                    value(candidate, "attemptCount"),
                    dateParameter(tx, input.now),
                ]))[0];
                if (!updated)
                    continue;
                claimed.push(record({
                    ...candidate,
                    attemptCount: value(updated, "attemptCount"),
                    nextAttemptAt: value(updated, "nextAttemptAt"),
                }));
            }
            return claimed;
        });
    }
    async settleFailure(input: SettleEventOutboxFailureInput): Promise<boolean> {
        const result = await this.execute(`UPDATE ${table(this.em)}
          SET "attemptCount" = ?, "nextAttemptAt" = ?, "lastError" = ?,
              "deadLetteredAt" = ?
        WHERE "id" = ? AND "publishedAt" IS NULL
          AND "deadLetteredAt" IS NULL AND "attemptCount" = ?
        RETURNING "id"`, [
            input.attemptCount,
            input.nextAttemptAt == null
                ? null
                : dateParameter(this.em, input.nextAttemptAt),
            input.lastError,
            input.deadLetteredAt == null
                ? null
                : dateParameter(this.em, input.deadLetteredAt),
            input.id,
            input.expectedAttemptCount,
        ]);
        return rows(result).length === 1;
    }
    async markPublished(input: {
        id: string;
        expectedAttemptCount: number;
        publishedAt: Date;
    }): Promise<boolean> {
        const result = await this.execute(`UPDATE ${table(this.em)}
          SET "publishedAt" = ?, "nextAttemptAt" = NULL
        WHERE "id" = ? AND "publishedAt" IS NULL
          AND "deadLetteredAt" IS NULL AND "attemptCount" = ?
        RETURNING "id"`, [
            dateParameter(this.em, input.publishedAt),
            input.id,
            input.expectedAttemptCount,
        ]);
        return rows(result).length === 1;
    }
    async deleteClaimed(input: {
        id: string;
        expectedAttemptCount: number;
    }): Promise<boolean> {
        const result = await this.execute(`DELETE FROM ${table(this.em)}
        WHERE "id" = ? AND "publishedAt" IS NULL
          AND "deadLetteredAt" IS NULL AND "attemptCount" = ?
        RETURNING "id"`, [input.id, input.expectedAttemptCount]);
        return rows(result).length === 1;
    }
    async releaseClaim(input: {
        id: string;
        expectedAttemptCount: number;
        nextAttemptAt: Date;
    }): Promise<boolean> {
        const result = await this.execute(`UPDATE ${table(this.em)} SET "nextAttemptAt" = ?
        WHERE "id" = ? AND "publishedAt" IS NULL
          AND "deadLetteredAt" IS NULL AND "attemptCount" = ?
        RETURNING "id"`, [
            dateParameter(this.em, input.nextAttemptAt),
            input.id,
            input.expectedAttemptCount,
        ]);
        return rows(result).length === 1;
    }
}
