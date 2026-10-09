import type { EntityManager } from "@mikro-orm/core";
import type { RequestMetricsRepository } from "@xue-learn/core/domain";
import { referenceDateValue } from "./date-value.ts";

type Row = Readonly<Record<string, unknown>>;
function rows(result: unknown): readonly Row[] {
  if (Array.isArray(result)) return result as Row[];
  if (result && typeof result === "object" && "rows" in result) {
    const value = (result as { rows?: unknown }).rows;
    return Array.isArray(value) ? value as Row[] : [];
  }
  return [];
}
function table(em: EntityManager, name: string): string {
  const schema = em.schema ?? em.config?.getSchema();
  const quoted = `"${name.replaceAll('"', '""')}"`;
  return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
export class MikroOrmRequestMetricsRepository implements RequestMetricsRepository {
  constructor(private readonly em: EntityManager) {}
  async listSince(since: Date) {
    const found = rows(await this.em.getConnection().execute(
      `SELECT "createdAt", "method", "route", "statusCode", "durationMs" FROM ${table(this.em, "ApiRequestLog")} WHERE "createdAt" >= ? ORDER BY "createdAt" ASC`,
      [since], undefined, this.em.getTransactionContext(),
    ));
    return found.map((row) => ({
      createdAt: referenceDateValue(row.createdAt, "request metric createdAt"),
      method: String(row.method), route: String(row.route),
      statusCode: Number(row.statusCode), durationMs: Number(row.durationMs),
    }));
  }
}
