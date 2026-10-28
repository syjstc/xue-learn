import type { EntityManager } from "@mikro-orm/core";
import type { MediaAccessRepository } from "@xue-learn/core/domain";

function rows(result: unknown): readonly unknown[] {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object" && "rows" in result) {
    const value = (result as { rows?: unknown }).rows;
    return Array.isArray(value) ? value : [];
  }
  return [];
}
function table(em: EntityManager, name: string): string {
  const schema = em.schema ?? em.config?.getSchema();
  const quoted = `"${name.replaceAll('"', '""')}"`;
  return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}

export class MikroOrmMediaAccessRepository implements MediaAccessRepository {
  constructor(private readonly em: EntityManager) {}
  private execute(sql: string, params: unknown[]) {
    return this.em.getConnection().execute(sql, params, undefined, this.em.getTransactionContext());
  }
  async ownsGoal(userId: string, goalId: string) {
    return rows(await this.execute(
      `SELECT 1 FROM ${table(this.em, "LearningGoal")} WHERE "id" = ? AND "userId" = ? LIMIT 1`,
      [goalId, userId],
    )).length > 0;
  }
  async ownsUnit(userId: string, unitId: string) {
    return rows(await this.execute(
      `SELECT 1 FROM ${table(this.em, "LearningUnit")} u JOIN ${table(this.em, "LearningGoal")} g ON g."id" = u."goalId" WHERE u."id" = ? AND g."userId" = ? LIMIT 1`,
      [unitId, userId],
    )).length > 0;
  }
}
