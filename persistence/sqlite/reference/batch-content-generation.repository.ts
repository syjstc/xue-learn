import type { EntityManager } from "@mikro-orm/core";
import type { BatchContentGenerationRepository } from "@xue-learn/core/source/libs/domain/src/index.ts";

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

export class MikroOrmBatchContentGenerationRepository
  implements BatchContentGenerationRepository
{
  constructor(private readonly em: EntityManager) {}

  async findGoal(goalId: string) {
    const result = rows(
      await this.em.getConnection().execute(
        `SELECT g."id", g."userId", g."title" AS "goalTitle", g."level", g."contentLanguage",
                g."generationOptions", g."goalKind", g."topicCategory", g."mapPlanJson",
                u."id" AS "unitId", u."title" AS "unitTitle", u."contentSummary", u."contentRevision",
                s."sq3rData", lm."unitId" AS "materialUnitId"
           FROM ${table(this.em, "LearningGoal")} g
           LEFT JOIN ${table(this.em, "LearningUnit")} u
             ON u."goalId" = g."id" AND u."unitKind" = 'lesson'
           LEFT JOIN ${table(this.em, "UnitSessionState")} s ON s."unitId" = u."id"
           LEFT JOIN ${table(this.em, "LearningMaterial")} lm ON lm."unitId" = u."id"
          WHERE g."id" = ? ORDER BY u."orderIndex", u."id"`,
        [goalId],
      ),
    );
    const first = result[0];
    if (!first) return null;
    return {
      id: String(value(first, "id")),
      userId: String(value(first, "userId")),
      title: String(value(first, "goalTitle")),
      level: String(value(first, "level") ?? "zero"),
      contentLanguage: String(value(first, "contentLanguage") ?? "auto"),
      generationOptions: String(value(first, "generationOptions") ?? ""),
      goalKind: String(value(first, "goalKind") ?? "full"),
      topicCategory: String(value(first, "topicCategory") ?? ""),
      mapPlanJson: String(value(first, "mapPlanJson") ?? ""),
      lessons: result.flatMap((row) =>
        value(row, "unitId") == null
          ? []
          : [{
              id: String(value(row, "unitId")),
              title: String(value(row, "unitTitle")),
              contentSummary: String(value(row, "contentSummary") ?? ""),
              contentRevision: Number(value(row, "contentRevision") ?? 0),
              sq3rData: String(value(row, "sq3rData") ?? ""),
              hasMaterial: value(row, "materialUnitId") != null,
            }],
      ),
    };
  }
}
