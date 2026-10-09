import type { EntityManager } from "@mikro-orm/core";
import type {
  UnitCompletionContext,
  UnitCompletionReadRepository,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import { nullableReferenceDateValue } from "./date-value.ts";

type Row = Readonly<Record<string, unknown>>;

function rows(result: unknown): readonly Row[] {
  if (Array.isArray(result)) return result as Row[];
  if (result && typeof result === "object" && "rows" in result) {
    const value = (result as { rows?: unknown }).rows;
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

export class MikroOrmUnitCompletionReadRepository implements UnitCompletionReadRepository {
  constructor(private readonly em: EntityManager) {}

  async findOwnedContext(
    userId: string,
    unitId: string,
  ): Promise<UnitCompletionContext | null> {
    const result = await this.em.getConnection().execute(
      `SELECT u."id" AS "unitId", u."goalId", g."userId", r."nextReviewAt"
         FROM ${table(this.em, "LearningUnit")} u
         JOIN ${table(this.em, "LearningGoal")} g ON g."id" = u."goalId"
         LEFT JOIN ${table(this.em, "ReviewCard")} r ON r."unitId" = u."id"
        WHERE u."id" = ? AND g."userId" = ?
        LIMIT 1`,
      [unitId, userId],
    );
    const row = rows(result)[0];
    if (!row) return null;
    const nextReviewAt = value(row, "nextReviewAt");
    return {
      unitId: String(value(row, "unitId")),
      goalId: String(value(row, "goalId")),
      userId: String(value(row, "userId")),
      nextReviewAt: nullableReferenceDateValue(nextReviewAt, "nextReviewAt"),
    };
  }
}
