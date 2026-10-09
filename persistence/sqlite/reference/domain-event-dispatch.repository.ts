import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { ClaimedDomainEventDelivery, DomainEventDispatchRepository, DomainEventDeliverySettlementInput, PendingDomainEvent, } from "@xue-learn/core/source/libs/domain/src/index.ts";
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
    return row[key] ?? row[key[0]?.toLowerCase() + key.slice(1)];
}
function string(row: Row, key: string): string {
    const result = value(row, key);
    return typeof result === "string" ? result : String(result ?? "");
}
function nullableString(row: Row, key: string): string | null {
    const result = value(row, key);
    return result == null ? null : String(result);
}
function date(row: Row, key: string): Date {
    return referenceDateValue(value(row, key), key);
}
function payload(row: Row): unknown {
    const result = value(row, "payload");
    if (typeof result !== "string")
        return result;
    try {
        return JSON.parse(result) as unknown;
    }
    catch {
        return result;
    }
}
function table(em: EntityManager, name: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${name.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
export class MikroOrmDomainEventDispatchRepository implements DomainEventDispatchRepository {
    constructor(private readonly em: EntityManager) { }
    private execute(sql: string, params: unknown[] = []) {
        return this.em
            .getConnection()
            .execute(sql, params, undefined, this.em.getTransactionContext());
    }
    async listPendingFanout(limit: number): Promise<readonly PendingDomainEvent[]> {
        const result = await this.execute(`SELECT "id", "type"
         FROM ${table(this.em, "DomainEventOutbox")}
        WHERE "fanoutCompletedAt" IS NULL
        ORDER BY "occurredAt" ASC, "id" ASC
        LIMIT ?`, [limit]);
        return rows(result).map((row) => ({
            id: string(row, "id"),
            type: string(row, "type"),
        }));
    }
    async fanOutAndMarkComplete(input: {
        eventId: string;
        subscriberIds: readonly string[];
        completedAt: Date;
    }): Promise<boolean> {
        return this.em.transactional(async (tx) => {
            const repository = new MikroOrmDomainEventDispatchRepository(tx);
            const outbox = table(tx, "DomainEventOutbox");
            const delivery = table(tx, "DomainEventDelivery");
            const event = rows(await repository.execute(`SELECT "id" FROM ${outbox}
            WHERE "id" = ? AND "fanoutCompletedAt" IS NULL
            ${""}`, [input.eventId]))[0];
            if (!event)
                return false;
            for (const subscriberId of input.subscriberIds) {
                await repository.execute(`INSERT INTO ${delivery}
            ("id", "eventId", "subscriberId", "status", "attempts", "nextAttemptAt", "createdAt", "updatedAt")
           VALUES (?, ?, ?, 'pending', 0, ?, ?, ?)
           ON CONFLICT ("eventId", "subscriberId") DO NOTHING`, [
                    randomUUID(),
                    input.eventId,
                    subscriberId,
                    input.completedAt,
                    input.completedAt,
                    input.completedAt,
                ]);
            }
            await repository.execute(`UPDATE ${outbox} SET "fanoutCompletedAt" = ?
          WHERE "id" = ? AND "fanoutCompletedAt" IS NULL`, [input.completedAt, input.eventId]);
            return true;
        });
    }
    async claimDueDeliveries(input: {
        limit: number;
        now: Date;
        staleProcessingBefore: Date;
    }): Promise<readonly ClaimedDomainEventDelivery[]> {
        return this.em.transactional(async (tx) => {
            const repository = new MikroOrmDomainEventDispatchRepository(tx);
            const delivery = table(tx, "DomainEventDelivery");
            const outbox = table(tx, "DomainEventOutbox");
            const candidates = rows(await repository.execute(`SELECT d."id", d."subscriberId", d."attempts",
                  e."id" AS "eventId", e."type", e."schemaVersion",
                  e."userId", e."goalId", e."unitId", e."threadId",
                  e."occurredAt", e."payload"
             FROM ${delivery} d
             JOIN ${outbox} e ON e."id" = d."eventId"
            WHERE (d."status" = 'pending' AND
                   (d."nextAttemptAt" IS NULL OR d."nextAttemptAt" <= ?))
               OR (d."status" = 'processing' AND d."processingStartedAt" <= ?)
            ORDER BY d."createdAt" ASC, d."id" ASC
            LIMIT ?
            ${""}`, [input.now, input.staleProcessingBefore, input.limit]));
            const claimed: ClaimedDomainEventDelivery[] = [];
            for (const row of candidates) {
                const updated = rows(await repository.execute(`UPDATE ${delivery}
                SET "status" = 'processing', "attempts" = "attempts" + 1,
                    "processingStartedAt" = ?, "lastAttemptAt" = ?,
                    "nextAttemptAt" = NULL, "updatedAt" = ?
              WHERE "id" = ? AND
                    (("status" = 'pending' AND
                      ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ?)) OR
                     ("status" = 'processing' AND "processingStartedAt" <= ?))
              RETURNING "attempts"`, [
                    input.now,
                    input.now,
                    input.now,
                    string(row, "id"),
                    input.now,
                    input.staleProcessingBefore,
                ]))[0];
                if (!updated)
                    continue;
                claimed.push({
                    id: string(row, "id"),
                    subscriberId: string(row, "subscriberId"),
                    attempts: Number(value(updated, "attempts")),
                    event: {
                        id: string(row, "eventId"),
                        type: string(row, "type"),
                        schemaVersion: Number(value(row, "schemaVersion")),
                        userId: nullableString(row, "userId"),
                        goalId: nullableString(row, "goalId"),
                        unitId: nullableString(row, "unitId"),
                        threadId: nullableString(row, "threadId"),
                        occurredAt: date(row, "occurredAt"),
                        payload: payload(row),
                    },
                });
            }
            return claimed;
        });
    }
    async settleDelivery(input: DomainEventDeliverySettlementInput): Promise<boolean> {
        const result = await this.execute(`UPDATE ${table(this.em, "DomainEventDelivery")}
          SET "status" = ?, "processingStartedAt" = ?, "nextAttemptAt" = ?,
              "deliveredAt" = ?, "deadLetteredAt" = ?, "lastError" = ?,
              "updatedAt" = ?
        WHERE "id" = ? AND "status" = 'processing'
        RETURNING "id"`, [
            input.status,
            input.processingStartedAt,
            input.nextAttemptAt,
            input.deliveredAt,
            input.deadLetteredAt,
            input.lastError,
            new Date(),
            input.deliveryId,
        ]);
        return rows(result).length === 1;
    }
}
