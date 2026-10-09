import type { EntityManager } from "@mikro-orm/core";
import type { MaterialEnrichmentRepository } from "@xue-learn/core/source/libs/domain/src/index.ts";
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
export class MikroOrmMaterialEnrichmentRepository implements MaterialEnrichmentRepository {
    constructor(private readonly em: EntityManager) { }
    private execute(sql: string, params: unknown[] = []) {
        return this.em
            .getConnection()
            .execute(sql, params, undefined, this.em.getTransactionContext());
    }
    async persistIfCurrent(input: {
        userId: string;
        unitId: string;
        expectedContentRevision: number;
        sections: string;
        sourceItemsJson: string;
    }): Promise<{
        applied: boolean;
        contentRevision: number;
    }> {
        const lock = "";
        const unit = rows(await this.execute(`SELECT u."contentRevision" FROM ${table(this.em, "LearningUnit")} u
          JOIN ${table(this.em, "LearningGoal")} g ON g."id" = u."goalId"
         WHERE u."id" = ? AND g."userId" = ?${lock}`, [input.unitId, input.userId]))[0];
        const current = Number(value(unit ?? {}, "contentRevision"));
        if (!unit || current !== input.expectedContentRevision) {
            return { applied: false, contentRevision: current || input.expectedContentRevision };
        }
        await this.execute(`UPDATE ${table(this.em, "LearningMaterial")} SET "sections" = ? WHERE "unitId" = ?`, [input.sections, input.unitId]);
        const session = rows(await this.execute(`SELECT "graphState" FROM ${table(this.em, "UnitSessionState")} WHERE "unitId" = ?`, [input.unitId]))[0];
        if (session) {
            let graph: Record<string, unknown> = {};
            try {
                const raw = value(session, "graphState");
                graph = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown>;
            }
            catch {
                graph = {};
            }
            graph.materialSourceItems = JSON.parse(input.sourceItemsJson);
            await this.execute(`UPDATE ${table(this.em, "UnitSessionState")} SET "graphState" = ? WHERE "unitId" = ?`, [JSON.stringify(graph), input.unitId]);
        }
        const changed = rows(await this.execute(`UPDATE ${table(this.em, "LearningUnit")}
          SET "contentRevision" = "contentRevision" + 1
        WHERE "id" = ? AND "contentRevision" = ?
        RETURNING "contentRevision"`, [input.unitId, input.expectedContentRevision]));
        if (changed.length !== 1) {
            throw new Error("Material enrichment revision changed");
        }
        return {
            applied: true,
            contentRevision: input.expectedContentRevision + 1,
        };
    }
}
