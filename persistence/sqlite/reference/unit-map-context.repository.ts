import type { EntityManager } from "@mikro-orm/core";
import type {
  UnitMapContextRecord,
  UnitMapContextRepository,
} from "@xue-learn/core/source/libs/domain/src/index.ts";

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
  return row[key] ?? row[key[0]!.toLowerCase() + key.slice(1)];
}
function table(em: EntityManager, name: string): string {
  const schema = em.schema ?? em.config?.getSchema();
  const quoted = `"${name.replaceAll('"', '""')}"`;
  return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}

export class MikroOrmUnitMapContextRepository implements UnitMapContextRepository {
  constructor(private readonly em: EntityManager) {}

  async find(unitId: string): Promise<UnitMapContextRecord | null> {
    const connection = this.em.getConnection();
    const unitTable = table(this.em, "LearningUnit");
    const goalTable = table(this.em, "LearningGoal");
    const selected = rows(
      await connection.execute(
        `SELECT u."id", u."goalId", u."title", u."contentSummary", u."parentUnitId",
                g."title" AS "goalTitle", g."mapPlanJson"
           FROM ${unitTable} u JOIN ${goalTable} g ON g."id" = u."goalId"
          WHERE u."id" = ? LIMIT 1`,
        [unitId],
      ),
    )[0];
    if (!selected) return null;
    const goalId = String(value(selected, "goalId"));
    const all = rows(
      await connection.execute(
        `SELECT "id", "title", "contentSummary", "parentUnitId", "orderIndex"
           FROM ${unitTable} WHERE "goalId" = ? ORDER BY "orderIndex" ASC, "id" ASC`,
        [goalId],
      ),
    );
    const text = (row: Row, key: string) => String(value(row, key) ?? "");
    return {
      unit: {
        id: text(selected, "id"),
        goalId,
        title: text(selected, "title"),
        contentSummary: text(selected, "contentSummary"),
        parentUnitId:
          value(selected, "parentUnitId") == null
            ? null
            : text(selected, "parentUnitId"),
      },
      goal: {
        title: text(selected, "goalTitle"),
        mapPlanJson: text(selected, "mapPlanJson"),
      },
      units: all.map((row) => ({
        id: text(row, "id"),
        title: text(row, "title"),
        contentSummary: text(row, "contentSummary"),
        parentUnitId:
          value(row, "parentUnitId") == null ? null : text(row, "parentUnitId"),
        orderIndex: Number(value(row, "orderIndex")) || 0,
      })),
    };
  }
}
