import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type {
  ApiErrorOccurrenceRecord,
  ApiRequestLogWrite,
  BackendErrorGroupRecord,
  BackendErrorListQuery,
  BackendErrorWrite,
  ObservabilityRepository,
} from "@xue-learn/core/domain";
import { referenceDateValue } from "./date-value.ts";

type Row = Readonly<Record<string, unknown>>;
const rows = (value: unknown): readonly Row[] => Array.isArray(value) ? value as Row[] : value && typeof value === "object" && "rows" in value && Array.isArray((value as { rows?: unknown }).rows) ? (value as { rows: Row[] }).rows : [];
const date = (value: unknown) => referenceDateValue(value, "observability date");
const nullable = (value: unknown) => value == null ? null : String(value);
function table(em: EntityManager, name: string): string {
  const schema = em.schema ?? em.config?.getSchema();
  const quoted = `"${name.replaceAll('"', '""')}"`;
  return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
function group(row: Row): BackendErrorGroupRecord {
  return {
    id: String(row.id), createdAt: date(row.createdAt), updatedAt: date(row.updatedAt),
    fingerprint: String(row.fingerprint), source: String(row.source), service: String(row.service),
    errorName: nullable(row.errorName) ?? undefined, errorCode: nullable(row.errorCode) ?? undefined,
    message: String(row.message), stack: nullable(row.stack) ?? undefined,
    statusCode: row.statusCode == null ? undefined : Number(row.statusCode),
    method: nullable(row.method) ?? undefined, route: nullable(row.route) ?? undefined,
    operation: nullable(row.operation) ?? undefined, firstSeenAt: date(row.firstSeenAt),
    lastSeenAt: date(row.lastSeenAt), occurrenceCount: Number(row.occurrenceCount),
  };
}

export class MikroOrmObservabilityRepository implements ObservabilityRepository {
  constructor(private readonly em: EntityManager) {}

  private async upsert(em: EntityManager, error: BackendErrorWrite): Promise<void> {
    const now = new Date();
    const result = await em.getConnection().execute(
      `UPDATE ${table(em, "BackendErrorGroup")} SET "updatedAt" = ?, "source" = ?, "service" = ?, "errorName" = ?, "errorCode" = ?, "message" = ?, "stack" = ?, "statusCode" = ?, "method" = ?, "route" = ?, "operation" = ?, "lastSeenAt" = ?, "occurrenceCount" = "occurrenceCount" + 1 WHERE "fingerprint" = ?`,
      [now, error.source, error.service, error.errorName ?? null, error.errorCode ?? null, error.message, error.stack ?? null, error.statusCode ?? null, error.method ?? null, error.route ?? null, error.operation ?? null, now, error.fingerprint], undefined, em.getTransactionContext(),
    );
    const affected = typeof result === "object" && result && "affectedRows" in result ? Number((result as { affectedRows: unknown }).affectedRows) : 0;
    if (affected > 0) return;
    try {
      await em.getConnection().execute(
        `INSERT INTO ${table(em, "BackendErrorGroup")} ("id", "createdAt", "updatedAt", "fingerprint", "source", "service", "errorName", "errorCode", "message", "stack", "statusCode", "method", "route", "operation", "firstSeenAt", "lastSeenAt", "occurrenceCount") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [randomUUID(), now, now, error.fingerprint, error.source, error.service, error.errorName ?? null, error.errorCode ?? null, error.message, error.stack ?? null, error.statusCode ?? null, error.method ?? null, error.route ?? null, error.operation ?? null, now, now], undefined, em.getTransactionContext(),
      );
    } catch {
      await em.getConnection().execute(
        `UPDATE ${table(em, "BackendErrorGroup")} SET "updatedAt" = ?, "lastSeenAt" = ?, "occurrenceCount" = "occurrenceCount" + 1 WHERE "fingerprint" = ?`,
        [now, now, error.fingerprint], undefined, em.getTransactionContext(),
      );
    }
  }

  async upsertBackendError(error: BackendErrorWrite): Promise<void> {
    await this.em.transactional((em) => this.upsert(em, error));
  }

  async recordApiRequest(request: ApiRequestLogWrite | undefined, error: BackendErrorWrite | undefined): Promise<void> {
    await this.em.transactional(async (em) => {
      if (request) {
        await em.getConnection().execute(
          `INSERT INTO ${table(em, "ApiRequestLog")} ("id", "createdAt", "requestId", "traceId", "userId", "method", "route", "statusCode", "durationMs", "requestBytes", "responseBytes", "platform", "ipHash", "userAgentHash", "errorCode", "errorMessage", "errorFingerprint") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [randomUUID(), new Date(), request.requestId, request.traceId, request.userId ?? null, request.method, request.route, request.statusCode, request.durationMs, request.requestBytes ?? null, request.responseBytes ?? null, request.platform ?? null, request.ipHash ?? null, request.userAgentHash ?? null, request.errorCode ?? null, request.errorMessage ?? null, request.errorFingerprint ?? null], undefined, em.getTransactionContext(),
        );
      }
      if (error) await this.upsert(em, error);
    });
  }

  async listBackendErrors(query: BackendErrorListQuery): Promise<BackendErrorGroupRecord[]> {
    const clauses = [`"lastSeenAt" >= ?`];
    const params: unknown[] = [query.since];
    if (query.source) { clauses.push(`"source" = ?`); params.push(query.source); }
    if (query.service) { clauses.push(`"service" = ?`); params.push(query.service); }
    if (query.status === "5xx") clauses.push(`"statusCode" >= 500 AND "statusCode" < 600`);
    else if (typeof query.status === "number") { clauses.push(`"statusCode" = ?`); params.push(query.status); }
    if (query.search) {
      clauses.push(`(LOWER("fingerprint") LIKE ? OR LOWER("message") LIKE ? OR LOWER(COALESCE("errorCode", '')) LIKE ? OR LOWER(COALESCE("route", '')) LIKE ? OR LOWER(COALESCE("operation", '')) LIKE ?)`);
      const value = `%${query.search.toLowerCase()}%`; params.push(value, value, value, value, value);
    }
    if (query.cursor) {
      clauses.push(`("lastSeenAt" < ? OR ("lastSeenAt" = ? AND "id" < ?))`);
      params.push(query.cursor.lastSeenAt, query.cursor.lastSeenAt, query.cursor.id);
    }
    params.push(query.limit);
    const found = rows(await this.em.getConnection().execute(
      `SELECT * FROM ${table(this.em, "BackendErrorGroup")} WHERE ${clauses.join(" AND ")} ORDER BY "lastSeenAt" DESC, "id" DESC LIMIT ?`,
      params, undefined, this.em.getTransactionContext(),
    ));
    return found.map(group);
  }

  async findBackendError(id: string): Promise<BackendErrorGroupRecord | null> {
    const found = rows(await this.em.getConnection().execute(`SELECT * FROM ${table(this.em, "BackendErrorGroup")} WHERE "id" = ? LIMIT 1`, [id], undefined, this.em.getTransactionContext()));
    return found[0] ? group(found[0]) : null;
  }

  async listApiErrorOccurrences(fingerprint: string, limit: number): Promise<ApiErrorOccurrenceRecord[]> {
    const found = rows(await this.em.getConnection().execute(
      `SELECT "id", "createdAt", "requestId", "traceId", "userId", "method", "route", "statusCode", "durationMs", "platform", "errorCode", "errorMessage" FROM ${table(this.em, "ApiRequestLog")} WHERE "errorFingerprint" = ? ORDER BY "createdAt" DESC, "id" DESC LIMIT ?`,
      [fingerprint, limit], undefined, this.em.getTransactionContext(),
    ));
    return found.map((row) => ({ id: String(row.id), createdAt: date(row.createdAt), requestId: String(row.requestId), traceId: String(row.traceId), userId: nullable(row.userId), method: String(row.method), route: String(row.route), statusCode: Number(row.statusCode), durationMs: Number(row.durationMs), platform: nullable(row.platform), errorCode: nullable(row.errorCode), errorMessage: nullable(row.errorMessage) }));
  }
}
