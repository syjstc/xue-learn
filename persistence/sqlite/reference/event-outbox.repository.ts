import type { EntityManager } from "@mikro-orm/core";
import type { AppendEventOutboxInput, AppendUnlessUnpublishedInput, EventOutboxRecord, EventOutboxRepository, } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { EventOutboxEntity } from "./event-outbox.entity.ts";
import { sqlTimestampParameter } from "./date-value.ts";
function toRecord(entity: EventOutboxEntity): EventOutboxRecord {
    return {
        id: entity.id,
        type: entity.type,
        payload: entity.payload,
        createdAt: entity.createdAt,
        publishedAt: entity.publishedAt,
        attemptCount: entity.attemptCount,
        nextAttemptAt: entity.nextAttemptAt,
        lastError: entity.lastError,
        deadLetteredAt: entity.deadLetteredAt,
    };
}
function qualifiedTable(em: EntityManager, table: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${table.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
export class MikroOrmEventOutboxRepository implements EventOutboxRepository {
    constructor(private readonly em: EntityManager) { }
    async append(input: AppendEventOutboxInput): Promise<EventOutboxRecord> {
        const createdAt = input.createdAt ?? new Date();
        const entity = Object.assign(new EventOutboxEntity(), {
            id: input.id,
            type: input.type,
            payload: input.payload,
            createdAt,
            nextAttemptAt: input.nextAttemptAt === undefined ? createdAt : input.nextAttemptAt,
        });
        this.em.persist(entity);
        await this.em.flush();
        return toRecord(entity);
    }
    async appendUnlessUnpublished(input: AppendUnlessUnpublishedInput): Promise<boolean> {
        const createdAt = input.event.createdAt ?? new Date();
        const nextAttemptAt = input.event.nextAttemptAt === undefined
            ? createdAt
            : (input.event.nextAttemptAt ?? createdAt);
        const postgres = false;
        const createdAtParam = sqlTimestampParameter(false, createdAt);
        const nextAttemptAtParam = sqlTimestampParameter(false, nextAttemptAt);
        const table = qualifiedTable(this.em, "EventOutbox");
        await this.em.getConnection().execute(`INSERT INTO ${table}
        ("id", "type", "payload", "createdAt", "nextAttemptAt", "attemptCount")
       SELECT ?, ?, ?, ?, ?, 0
        WHERE NOT EXISTS (
          SELECT 1
            FROM ${table}
           WHERE "type" = ?
             AND "publishedAt" IS NULL
             AND "deadLetteredAt" IS NULL
             AND "payload" LIKE ?
        )`, [
            input.event.id,
            input.event.type,
            input.event.payload,
            createdAtParam,
            nextAttemptAtParam,
            input.unpublishedType,
            `%${input.payloadIncludes}%`,
        ], undefined, this.em.getTransactionContext());
        return true;
    }
}
