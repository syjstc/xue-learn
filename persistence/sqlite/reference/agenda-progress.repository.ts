import type { EntityManager } from "@mikro-orm/core";
import type { AgendaProgressRepository } from "@xue-learn/core/source/libs/domain/src/index.ts";

function table(em: EntityManager, name: string): string {
  const schema = em.schema ?? em.config?.getSchema();
  const quoted = `"${name.replaceAll('"', '""')}"`;
  return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}

function affected(result: unknown): number {
  if (typeof result === "number") return result;
  if (result && typeof result === "object") {
    const value = (result as { affectedRows?: unknown; rowCount?: unknown })
      .affectedRows;
    const fallback = (result as { rowCount?: unknown }).rowCount;
    return Number(value ?? fallback ?? 0);
  }
  return 0;
}

export class MikroOrmAgendaProgressRepository implements AgendaProgressRepository {
  constructor(private readonly em: EntityManager) {}

  async completeUnitItems(input: {
    userId: string;
    planningDate: string;
    unitId: string;
    itemType?: "new_learning" | "review";
    completedAt: Date;
  }): Promise<number> {
    const params: unknown[] = [
      input.completedAt,
      input.userId,
      input.planningDate,
      input.unitId,
    ];
    const itemType = input.itemType
      ? (params.push(input.itemType), ' AND i."itemType" = ?')
      : "";
    const result = await this.em.getConnection().execute(
      `UPDATE ${table(this.em, "AgendaItem")} AS i
          SET "completedAt" = ?
        WHERE i."revisionId" IN (
          SELECT r."id" FROM ${table(this.em, "AgendaRevision")} r
           WHERE r."userId" = ? AND r."planningDate" = ?
             AND r."status" = 'active'
        )
          AND i."unitId" = ? AND i."completedAt" IS NULL${itemType}`,
      params,
    );
    return affected(result);
  }
}
