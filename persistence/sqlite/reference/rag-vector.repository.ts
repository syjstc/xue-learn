import type { EntityManager } from "@mikro-orm/core";
import type { LocalEmbeddingIndexRecord, RagVectorFilter, RagVectorRepository, } from "@xue-learn/core/domain";
import { randomUUID } from "node:crypto";
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
function table(em: EntityManager, name: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${name.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
function clauses(filter: RagVectorFilter, start = 0) {
    const sql = [`"scope" = ?`, `"scopeId" = ?`];
    const params: unknown[] = [filter.scope, filter.scopeId];
    if (filter.embeddingProvider != null) {
        sql.push(`"embeddingProvider" = ?`);
        params.push(filter.embeddingProvider);
    }
    if (filter.embeddingModel != null) {
        sql.push(`"embeddingModel" = ?`);
        params.push(filter.embeddingModel);
    }
    for (const [key, value] of Object.entries(filter.metadata ?? {})) {
        sql.push(`"metadata"->>'${key.replaceAll("'", "''")}' = ?`);
        params.push(value);
    }
    return { sql: sql.join(" AND "), params, next: start + params.length };
}
function lexicalClauses(filter: RagVectorFilter) {
    return clauses({
        scope: filter.scope,
        scopeId: filter.scopeId,
        metadata: filter.metadata,
    });
}
function date(value: unknown): Date {
    return referenceDateValue(value);
}
export class MikroOrmRagVectorRepository implements RagVectorRepository {
    constructor(private readonly em: EntityManager) { }
    private execute(sql: string, params: unknown[] = []) {
        return this.em.getConnection().execute(sql, params);
    }
    async delete(filter: RagVectorFilter): Promise<void> {
        const where = clauses(filter);
        await this.em.transactional(async (em) => {
            const connection = em.getConnection();
            const execute = (sql: string, params: unknown[] = []) => connection.execute(sql, params, undefined, em.getTransactionContext());
            const ids = rows(await execute(`SELECT "id" FROM ${table(em, "RagChunk")} WHERE ${where.sql}`, where.params)).map((row) => String(row.id));
            if (!ids.length)
                return;
            const placeholders = ids.map(() => "?").join(", ");
            await execute(`DELETE FROM ${table(em, "RagChunkFts")} WHERE "chunkId" IN (${placeholders})`, ids);
            await execute(`DELETE FROM ${table(em, "RagChunk")} WHERE "id" IN (${placeholders})`, ids);
        });
    }
    async findDimensions(filter: RagVectorFilter): Promise<number | null> {
        const where = clauses(filter);
        const row = rows(await this.execute(`SELECT "dimensions" FROM ${table(this.em, "RagChunk")} WHERE ${where.sql} LIMIT 1`, where.params))[0];
        return row ? Number(row.dimensions) : null;
    }
    async insert(filter: {
        scope: string;
        scopeId: string;
        embeddingProvider: string;
        embeddingModel: string;
    }, chunks: Parameters<RagVectorRepository["insert"]>[1]): Promise<void> {
        if (!chunks.length)
            return;
        const params: unknown[] = [];
        const postgres = false;
        const groups = chunks.map((chunk) => {
            params.push(chunk.id, filter.scope, filter.scopeId, filter.embeddingProvider, filter.embeddingModel, chunk.dimensions, chunk.content, JSON.stringify(chunk.metadata), chunk.embeddingSql);
            return `(?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`;
        });
        await this.em.transactional(async (em) => {
            await em
                .getConnection()
                .execute(`INSERT INTO ${table(em, "RagChunk")} ("id", "scope", "scopeId", "embeddingProvider", "embeddingModel", "dimensions", "content", "metadata", "embedding", "createdAt") VALUES ${groups.join(", ")}`, params, undefined, em.getTransactionContext());
            {
                for (const chunk of chunks) {
                    await em
                        .getConnection()
                        .execute(`INSERT INTO ${table(em, "RagChunkFts")} ("chunkId", "content") VALUES (?, ?)`, [chunk.id, chunk.content], undefined, em.getTransactionContext());
                }
            }
        });
    }
    async insertLexical(filter: {
        scope: string;
        scopeId: string;
        embeddingProvider: string;
        embeddingModel: string;
    }, chunks: readonly Readonly<{
        id: string;
        content: string;
        metadata: Readonly<Record<string, string | number | boolean | null>>;
    }>[], error: string): Promise<void> {
        if (chunks.length === 0)
            return;
        await this.em.transactional(async (em) => {
            const connection = em.getConnection();
            for (const chunk of chunks) {
                await connection.execute(`INSERT INTO ${table(em, "RagChunk")} ("id","scope","scopeId","embeddingProvider","embeddingModel","dimensions","content","metadata","embedding","indexStatus","indexError","createdAt","updatedAt") VALUES (?,?,?,?,?,0,?,?,?,'failed',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [
                    chunk.id,
                    filter.scope,
                    filter.scopeId,
                    filter.embeddingProvider,
                    filter.embeddingModel,
                    chunk.content,
                    JSON.stringify(chunk.metadata),
                    "[]",
                    error.slice(0, 1000),
                ], undefined, em.getTransactionContext());
                await connection.execute(`INSERT INTO ${table(em, "RagChunkFts")} ("chunkId","content") VALUES (?,?)`, [chunk.id, chunk.content], undefined, em.getTransactionContext());
            }
        });
        const queued = await this.queueLocalEmbeddingReindex({
            providerId: filter.embeddingProvider,
            model: filter.embeddingModel,
        });
        await this.updateLocalEmbeddingIndexState({
            status: "failed",
            providerId: filter.embeddingProvider,
            model: filter.embeddingModel,
            error: error || queued.error,
        });
    }
    async count(filter: RagVectorFilter): Promise<number> {
        const where = lexicalClauses(filter);
        const row = rows(await this.execute(`SELECT COUNT(*) AS "count" FROM ${table(this.em, "RagChunk")} WHERE ${where.sql}`, where.params))[0];
        return Number(row?.count ?? 0);
    }
    async listSourceChunks(filter: RagVectorFilter, limit: number) {
        const where = clauses(filter);
        const result = await this.execute(`SELECT "content", "metadata" FROM ${table(this.em, "RagChunk")}
       WHERE ${where.sql} ORDER BY "id" LIMIT ?`, [...where.params, limit]);
        return rows(result).map((row) => ({
            content: String(row.content ?? ""),
            metadata: typeof row.metadata === "string"
                ? JSON.parse(row.metadata)
                : row.metadata,
        }));
    }
    async nearest(filter: {
        scope: string;
        scopeId: string;
        embeddingProvider: string;
        embeddingModel: string;
        metadata?: Readonly<Record<string, string>>;
    }, embeddingSql: string, queryText: string, limit: number) {
        const where = clauses(filter);
        const lexicalWhere = lexicalClauses(filter);
        const ftsQuery = queryText
            .split(/\s+/)
            .filter(Boolean)
            .map((token) => `"${token.replaceAll('"', '""')}"`)
            .join(" OR ") || '""';
        const lexical = rows(await this.execute(`SELECT c."id", c."content", c."metadata" FROM ${table(this.em, "RagChunkFts")} f
             JOIN ${table(this.em, "RagChunk")} c ON c."id" = f."chunkId"
            WHERE ${lexicalWhere.sql.replaceAll('"scope"', 'c."scope"').replaceAll('"scopeId"', 'c."scopeId"').replaceAll('"metadata"', 'c."metadata"')}
              AND ${table(this.em, "RagChunkFts")} MATCH ?
            ORDER BY bm25(${table(this.em, "RagChunkFts")}) LIMIT ?`, [...lexicalWhere.params, ftsQuery, Math.max(limit * 4, limit)]));
        const state = await this.getLocalEmbeddingIndexState();
        let semantic: readonly Row[] = [];
        if ((state == null ||
            state.status === "no_chunks" ||
            state.status === "published") &&
            (state == null ||
                (state.providerId === filter.embeddingProvider &&
                    state.model === filter.embeddingModel))) {
            const parsedEmbedding = JSON.parse(embeddingSql) as unknown;
            const dimensions = Array.isArray(parsedEmbedding)
                ? parsedEmbedding.length
                : 0;
            semantic = rows(await this.execute(`SELECT c."id", c."content", c."metadata", vec_distance_cosine(c."embedding", ?) AS "distance"
             FROM ${table(this.em, "RagChunk")} c
            WHERE ${where.sql.replaceAll('"scope"', 'c."scope"').replaceAll('"scopeId"', 'c."scopeId"').replaceAll('"embeddingProvider"', 'c."embeddingProvider"').replaceAll('"embeddingModel"', 'c."embeddingModel"').replaceAll('"metadata"', 'c."metadata"')}
              AND c."indexStatus" = 'ready' AND c."dimensions" = ?
            ORDER BY "distance" ASC LIMIT ?`, [
                embeddingSql,
                ...where.params,
                dimensions,
                Math.max(limit * 4, limit),
            ]));
        }
        const fused = new Map<string, {
            row: Row;
            score: number;
        }>();
        const add = (source: readonly Row[], weight: number) => {
            source.forEach((row, index) => {
                const id = String(row.id);
                const current = fused.get(id) ?? { row, score: 0 };
                current.score += weight / (60 + index + 1);
                fused.set(id, current);
            });
        };
        add(semantic, 1);
        add(lexical, 0.7);
        return [...fused.values()]
            .sort((a, b) => b.score - a.score || String(a.row.id).localeCompare(String(b.row.id)))
            .slice(0, limit)
            .map(({ row }) => ({
            content: String(row.content ?? ""),
            metadata: typeof row.metadata === "string"
                ? JSON.parse(row.metadata)
                : row.metadata,
        }));
    }
    async getLocalEmbeddingIndexState() {
        const row = rows(await this.execute(`SELECT * FROM ${table(this.em, "LocalEmbeddingIndexState")} WHERE "id" = 'desktop-local' LIMIT 1`))[0];
        return row
            ? {
                status: String(row.status) as LocalEmbeddingIndexRecord["status"],
                providerId: String(row.providerId),
                model: String(row.model),
                lexicalChunks: Number(row.lexicalChunks),
                indexedVectors: Number(row.indexedVectors),
                generationId: row.generationId == null ? null : String(row.generationId),
                jobId: row.jobId == null ? null : String(row.jobId),
                attempt: Number(row.attempt),
                error: row.error == null ? null : String(row.error),
                updatedAt: date(row.updatedAt),
            }
            : null;
    }
    async queueLocalEmbeddingReindex(input: {
        providerId: string;
        model: string;
    }) {
        const current = await this.getLocalEmbeddingIndexState();
        await this.execute(`UPDATE ${table(this.em, "RagChunk")} SET "indexStatus" = 'pending', "indexError" = '', "updatedAt" = CURRENT_TIMESTAMP WHERE "embeddingProvider" <> ? OR "embeddingModel" <> ? OR "indexStatus" <> 'ready'`, [input.providerId, input.model]);
        const countRow = rows(await this.execute(`SELECT COUNT(*) AS "count" FROM ${table(this.em, "RagChunk")}`))[0];
        const lexicalChunks = Number(countRow?.count ?? 0);
        const jobId = randomUUID();
        const generationId = randomUUID();
        await this.execute(`INSERT INTO ${table(this.em, "LocalEmbeddingIndexState")} ("id","status","providerId","model","lexicalChunks","indexedVectors","generationId","jobId","attempt","error","updatedAt") VALUES ('desktop-local', ?, ?, ?, ?, 0, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
       ON CONFLICT ("id") DO UPDATE SET "status"=excluded."status","providerId"=excluded."providerId","model"=excluded."model","lexicalChunks"=excluded."lexicalChunks","indexedVectors"=0,"generationId"=excluded."generationId","jobId"=excluded."jobId","attempt"=excluded."attempt","error"=NULL,"updatedAt"=CURRENT_TIMESTAMP`, [
            lexicalChunks === 0 ? "no_chunks" : "queued",
            input.providerId,
            input.model,
            lexicalChunks,
            generationId,
            jobId,
            (current?.attempt ?? 0) + 1,
        ]);
        return (await this.getLocalEmbeddingIndexState())!;
    }
    async listLocalEmbeddingReindexSources(input: {
        providerId: string;
        model: string;
        limit: number;
    }) {
        return rows(await this.execute(`SELECT "id", "content" AS "text" FROM ${table(this.em, "RagChunk")} WHERE "embeddingProvider" <> ? OR "embeddingModel" <> ? OR "indexStatus" <> 'ready' ORDER BY "updatedAt" ASC, "id" ASC LIMIT ?`, [input.providerId, input.model, input.limit])).map((row) => ({ id: String(row.id), text: String(row.text ?? "") }));
    }
    async saveLocalEmbeddingReindexVectors(input: {
        providerId: string;
        model: string;
        rows: readonly Readonly<{
            id: string;
            vector: readonly number[];
        }>[];
    }) {
        if (false || input.rows.length === 0)
            return;
        await this.em.transactional(async (em) => {
            for (const row of input.rows) {
                await em
                    .getConnection()
                    .execute(`UPDATE ${table(em, "RagChunk")} SET "embeddingProvider"=?,"embeddingModel"=?,"dimensions"=?,"embedding"=?,"indexStatus"='ready',"indexError"='',"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=?`, [
                    input.providerId,
                    input.model,
                    row.vector.length,
                    JSON.stringify(row.vector),
                    row.id,
                ], undefined, em.getTransactionContext());
            }
        });
    }
    async updateLocalEmbeddingIndexState(input: {
        status: "no_chunks" | "lexical_only" | "queued" | "building" | "published" | "failed";
        providerId: string;
        model: string;
        error?: string | null;
    }) {
        const counts = rows(await this.execute(`SELECT COUNT(*) AS "lexicalChunks", SUM(CASE WHEN "embeddingProvider"=? AND "embeddingModel"=? AND "indexStatus"='ready' THEN 1 ELSE 0 END) AS "indexedVectors" FROM ${table(this.em, "RagChunk")}`, [input.providerId, input.model]))[0];
        await this.execute(`UPDATE ${table(this.em, "LocalEmbeddingIndexState")} SET "status"=?,"providerId"=?,"model"=?,"lexicalChunks"=?,"indexedVectors"=?,"error"=?,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"='desktop-local'`, [
            input.status,
            input.providerId,
            input.model,
            Number(counts?.lexicalChunks ?? 0),
            Number(counts?.indexedVectors ?? 0),
            input.error?.slice(0, 1000) ?? null,
        ]);
        return (await this.getLocalEmbeddingIndexState())!;
    }
}
