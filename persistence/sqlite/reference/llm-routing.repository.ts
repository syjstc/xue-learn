import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { LlmRoutingRepository } from "@xue-learn/core/source/libs/domain/src/index.ts";
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
function table(em: EntityManager, name: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${name.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
const date = referenceDateValue;
export class MikroOrmLlmRoutingRepository implements LlmRoutingRepository {
    constructor(private readonly em: EntityManager) { }
    private execute(em: EntityManager, sql: string, params: unknown[] = []) {
        return em.getConnection().execute(sql, params, undefined, em.getTransactionContext());
    }
    async listRoutes() {
        return rows(await this.execute(this.em, `SELECT "provider", "operationKey", "model", "reasoningMode", "updatedAt", "updatedByUserId"
           FROM ${table(this.em, "GlobalLlmRoute")} ORDER BY "provider", "operationKey"`)).map((row) => ({
            provider: String(value(row, "provider")),
            operationKey: String(value(row, "operationKey")),
            model: String(value(row, "model")),
            reasoningMode: String(value(row, "reasoningMode") ?? "inherit"),
            updatedAt: date(value(row, "updatedAt")),
            updatedByUserId: value(row, "updatedByUserId") == null ? null : String(value(row, "updatedByUserId")),
        }));
    }
    async applyChanges(changes: Parameters<LlmRoutingRepository["applyChanges"]>[0], updatedByUserId: string): Promise<void> {
        await this.em.transactional(async (em) => {
            for (const change of changes) {
                if (change.action === "remove") {
                    await this.execute(em, `DELETE FROM ${table(em, "GlobalLlmRoute")} WHERE "provider" = ? AND "operationKey" = ?`, [change.provider, change.operationKey]);
                    continue;
                }
                const now = new Date();
                await this.execute(em, `INSERT INTO ${table(em, "GlobalLlmRoute")}
            ("id", "provider", "operationKey", "model", "reasoningMode", "updatedByUserId", "createdAt", "updatedAt")
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT ("provider", "operationKey") DO UPDATE SET
             "model" = excluded."model", "reasoningMode" = excluded."reasoningMode",
             "updatedByUserId" = excluded."updatedByUserId", "updatedAt" = excluded."updatedAt"`, [randomUUID(), change.provider, change.operationKey, change.model, change.reasoningMode, updatedByUserId, now, now]);
            }
        });
    }
}
