import type { EntityManager } from "@mikro-orm/core";
import type { GoalTextbookReadRepository } from "@xue-learn/core/domain";
import { referenceDateValue } from "./date-value.ts";

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

export class MikroOrmGoalTextbookReadRepository
  implements GoalTextbookReadRepository
{
  constructor(private readonly em: EntityManager) {}

  private execute(sql: string, params: unknown[] = []) {
    return this.em.getConnection().execute(sql, params, undefined, this.em.getTransactionContext());
  }

  async find(goalId: string) {
    const goal = rows(await this.execute(
      `SELECT "id", "title", "level", "topicOverview", "mapPlanJson", "createdAt"
         FROM ${table(this.em, "LearningGoal")} WHERE "id" = ? LIMIT 1`,
      [goalId],
    ))[0];
    if (!goal) return null;
    const units = rows(await this.execute(
      `SELECT u."id", u."title", u."unitKind", u."parentUnitId", u."orderIndex",
              u."contentSummary", u."status", s."sq3rData",
              c."id" AS "cornellId", c."notes", c."cues", c."summary"
         FROM ${table(this.em, "LearningUnit")} u
         LEFT JOIN ${table(this.em, "UnitSessionState")} s ON s."unitId" = u."id"
         LEFT JOIN ${table(this.em, "CornellNote")} c ON c."unitId" = u."id"
        WHERE u."goalId" = ? ORDER BY u."orderIndex" ASC`,
      [goalId],
    ));
    return {
      id: String(value(goal, "id")),
      title: String(value(goal, "title")),
      level: String(value(goal, "level")),
      topicOverview: String(value(goal, "topicOverview") ?? ""),
      mapPlanJson: String(value(goal, "mapPlanJson") ?? ""),
      createdAt: referenceDateValue(value(goal, "createdAt"), "goal createdAt"),
      units: units.map((row) => ({
        id: String(value(row, "id")),
        title: String(value(row, "title")),
        unitKind: String(value(row, "unitKind")),
        parentUnitId: value(row, "parentUnitId") == null ? null : String(value(row, "parentUnitId")),
        orderIndex: Number(value(row, "orderIndex") ?? 0),
        contentSummary: String(value(row, "contentSummary") ?? ""),
        status: String(value(row, "status")),
        sq3rData: value(row, "sq3rData") == null ? null : String(value(row, "sq3rData")),
        cornell: value(row, "cornellId") == null ? null : {
          notes: String(value(row, "notes") ?? ""),
          cues: String(value(row, "cues") ?? ""),
          summary: String(value(row, "summary") ?? ""),
        },
      })),
    };
  }
}
