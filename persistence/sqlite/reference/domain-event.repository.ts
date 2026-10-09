import type { EntityManager } from "@mikro-orm/core";
import type {
  AppendDomainEventOutboxInput,
  DomainEventOutboxRecord,
  DomainEventOutboxRepository,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import { safeReferenceDateValue } from "./date-value.ts";

type ValueRow = Readonly<Record<string, unknown>>;

function resultRows(result: unknown): readonly ValueRow[] {
  if (Array.isArray(result)) return result as ValueRow[];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    return Array.isArray(rows) ? (rows as ValueRow[]) : [];
  }
  return [];
}

function rowValue(row: ValueRow, key: string): unknown {
  return row[key] ?? row[key[0]?.toLowerCase() + key.slice(1)];
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function dateValue(value: unknown, fallback = new Date()): Date {
  return safeReferenceDateValue(value) ?? fallback;
}

function qualifiedTable(em: EntityManager): string {
  const schema = em.schema ?? em.config?.getSchema();
  return schema
    ? `"${schema.replaceAll('"', '""')}"."DomainEventOutbox"`
    : '"DomainEventOutbox"';
}

function toRecord(row: ValueRow): DomainEventOutboxRecord {
  return {
    id: stringValue(rowValue(row, "id")),
    type: stringValue(rowValue(row, "type")),
    schemaVersion: numberValue(rowValue(row, "schemaVersion"), 1),
    idempotencyKey: nullableString(rowValue(row, "idempotencyKey")),
    userId: nullableString(rowValue(row, "userId")),
    goalId: nullableString(rowValue(row, "goalId")),
    unitId: nullableString(rowValue(row, "unitId")),
    threadId: nullableString(rowValue(row, "threadId")),
    payload: stringValue(rowValue(row, "payload"), "{}"),
    occurredAt: dateValue(rowValue(row, "occurredAt")),
    fanoutCompletedAt: rowValue(row, "fanoutCompletedAt")
      ? dateValue(rowValue(row, "fanoutCompletedAt"))
      : null,
    createdAt: dateValue(rowValue(row, "createdAt")),
  };
}

/** Raw-SQL adapter for the idempotent DomainEventOutbox append boundary. */
export class MikroOrmDomainEventOutboxRepository implements DomainEventOutboxRepository {
  constructor(private readonly em: EntityManager) {}

  async append(
    input: AppendDomainEventOutboxInput,
  ): Promise<DomainEventOutboxRecord> {
    const table = qualifiedTable(this.em);
    const connection = this.em.getConnection();
    const execute = (sql: string, params: unknown[] = []) =>
      connection.execute(
        sql,
        params,
        undefined,
        this.em.getTransactionContext(),
      );
    const occurredAt = input.occurredAt;
    const createdAt = input.createdAt ?? occurredAt;
    const fanoutCompletedAt = input.fanoutCompletedAt ?? null;

    await execute(
      `INSERT INTO ${table}
        ("id", "type", "schemaVersion", "idempotencyKey", "userId", "goalId", "unitId", "threadId", "payload", "occurredAt", "fanoutCompletedAt", "createdAt")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT ("idempotencyKey") DO NOTHING`,
      [
        input.id,
        input.type,
        input.schemaVersion,
        input.idempotencyKey,
        input.userId,
        input.goalId,
        input.unitId,
        input.threadId,
        input.payload,
        occurredAt,
        fanoutCompletedAt,
        createdAt,
      ],
    );

    const rows = resultRows(
      await execute(
        input.idempotencyKey === null
          ? `SELECT "id", "type", "schemaVersion", "idempotencyKey", "userId", "goalId", "unitId", "threadId", "payload", "occurredAt", "fanoutCompletedAt", "createdAt" FROM ${table} WHERE "id" = ?`
          : `SELECT "id", "type", "schemaVersion", "idempotencyKey", "userId", "goalId", "unitId", "threadId", "payload", "occurredAt", "fanoutCompletedAt", "createdAt" FROM ${table} WHERE "idempotencyKey" = ?`,
        [input.idempotencyKey === null ? input.id : input.idempotencyKey],
      ),
    );
    const row = rows[0];
    if (!row) throw new Error("Domain event append did not persist");
    return toRecord(row);
  }
}
