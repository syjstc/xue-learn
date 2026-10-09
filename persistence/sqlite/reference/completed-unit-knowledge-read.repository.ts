import type { EntityManager } from "@mikro-orm/core";
import type {
  CompletedUnitKnowledgeReadRepository,
  CompletedUnitKnowledgeSnapshot,
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

function text(row: Row, key: string): string {
  const value = row[key] ?? row[key[0]?.toLowerCase() + key.slice(1)];
  return typeof value === "string" ? value : "";
}

function table(em: EntityManager, name: string): string {
  const schema = em.schema ?? em.config?.getSchema();
  const quoted = `"${name.replaceAll('"', '""')}"`;
  return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}

export class MikroOrmCompletedUnitKnowledgeReadRepository implements CompletedUnitKnowledgeReadRepository {
  constructor(private readonly em: EntityManager) {}

  async findOwnedSnapshot(
    userId: string,
    unitId: string,
  ): Promise<CompletedUnitKnowledgeSnapshot | null> {
    const result = await this.em.getConnection().execute(
      `SELECT u."id" AS "unitId", u."goalId", u."title" AS "unitTitle",
              u."contentSummary", g."userId", g."title" AS "goalTitle",
              m."introduction", m."sections", m."keyTakeaways"
         FROM ${table(this.em, "LearningUnit")} u
         JOIN ${table(this.em, "LearningGoal")} g ON g."id" = u."goalId"
         JOIN ${table(this.em, "LearningMaterial")} m ON m."unitId" = u."id"
        WHERE u."id" = ? AND g."userId" = ?
        LIMIT 1`,
      [unitId, userId],
    );
    const row = rows(result)[0];
    if (!row) return null;
    return {
      userId: text(row, "userId"),
      goalId: text(row, "goalId"),
      goalTitle: text(row, "goalTitle"),
      unitId: text(row, "unitId"),
      unitTitle: text(row, "unitTitle"),
      contentSummary: text(row, "contentSummary"),
      material: {
        introduction: text(row, "introduction"),
        sections: text(row, "sections"),
        keyTakeaways: text(row, "keyTakeaways"),
      },
    };
  }
}
