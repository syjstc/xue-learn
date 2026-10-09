import type { EntityManager } from "@mikro-orm/core";
import type {
  AgendaItemExplanationRecord,
  AgendaProjectionItemRecord,
  AgendaProjectionReadRepository,
  AgendaProjectionUnitRecord,
  AgendaRevisionProjection,
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
function nullableString(row: Row, key: string): string | null {
  const result = value(row, key);
  return result == null ? null : String(result);
}
function nullableDate(row: Row, key: string): Date | null {
  return nullableReferenceDateValue(value(row, key), key);
}
function json(row: Row, key: string): unknown {
  const result = value(row, key);
  if (typeof result !== "string") return result;
  try {
    return JSON.parse(result) as unknown;
  } catch {
    return {};
  }
}
function table(em: EntityManager, name: string): string {
  const schema = em.schema ?? em.config?.getSchema();
  const quoted = `"${name.replaceAll('"', '""')}"`;
  return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}

export class MikroOrmAgendaProjectionReadRepository implements AgendaProjectionReadRepository {
  constructor(private readonly em: EntityManager) {}
  private execute(sql: string, params: unknown[] = []) {
    return this.em.getConnection().execute(sql, params);
  }

  async findDailyActiveSeconds(
    userId: string,
    localDate: string,
  ): Promise<number> {
    const result = await this.execute(
      `SELECT "activeSeconds" FROM ${table(this.em, "LearnerDailyActivity")}
        WHERE "userId" = ? AND "localDate" = ? LIMIT 1`,
      [userId, localDate],
    );
    return Number(value(rows(result)[0] ?? {}, "activeSeconds") ?? 0);
  }

  async findActiveProjection(
    userId: string,
    planningDate?: string,
  ): Promise<AgendaRevisionProjection | null> {
    const params: unknown[] = [userId];
    const dateFilter = planningDate
      ? (params.push(planningDate), ' AND "planningDate" = ?')
      : "";
    const revision = rows(
      await this.execute(
        `SELECT "id", "capacityMinutes", "capacityJson", "generationSource", "reason"
           FROM ${table(this.em, "AgendaRevision")}
          WHERE "userId" = ? AND "status" = 'active'${dateFilter}
          ORDER BY "activatedAt" DESC, "createdAt" DESC LIMIT 1`,
        params,
      ),
    )[0];
    if (!revision) return null;
    const revisionId = String(value(revision, "id"));
    const itemRows = rows(
      await this.execute(
        `SELECT i.*, g."title" AS "goalTitle", s."title" AS "sectionTitle"
           FROM ${table(this.em, "AgendaItem")} i
           JOIN ${table(this.em, "LearningGoal")} g ON g."id" = i."goalId"
           LEFT JOIN ${table(this.em, "MainCourseSection")} s ON s."id" = i."sectionId"
          WHERE i."revisionId" = ?
          ORDER BY i."plannedDate" ASC, i."sortIndex" ASC`,
        [revisionId],
      ),
    );
    const items: AgendaProjectionItemRecord[] = itemRows.map((row) => ({
      id: String(value(row, "id")),
      goalId: String(value(row, "goalId")),
      unitId: String(value(row, "unitId")),
      sectionId: nullableString(row, "sectionId"),
      goalTitle: String(value(row, "goalTitle") ?? ""),
      sectionTitle: nullableString(row, "sectionTitle"),
      itemType: String(value(row, "itemType")),
      plannedDate: String(value(row, "plannedDate")),
      estimatedMinutes: Number(value(row, "estimatedMinutes")),
      priority: Number(value(row, "priority")),
      explanation: String(value(row, "explanation") ?? ""),
      explanationCode: String(value(row, "explanationCode") ?? ""),
      completedAt: nullableDate(row, "completedAt"),
      reviewDueAt: nullableDate(row, "reviewDueAt"),
      reviewCardId: nullableString(row, "reviewCardId"),
      cognitiveEntityIds: String(value(row, "cognitiveEntityIds") ?? "[]"),
      targetState: json(row, "targetState"),
      expectedEvidence: json(row, "expectedEvidence"),
      sortIndex: Number(value(row, "sortIndex")),
    }));
    const unitIds = [...new Set(items.map((item) => item.unitId))];
    let units: AgendaProjectionUnitRecord[] = [];
    if (unitIds.length) {
      const unitRows = rows(
        await this.execute(
          `SELECT "id", "title", "status", "completedAt", "completionMethod"
             FROM ${table(this.em, "LearningUnit")}
            WHERE "id" IN (${unitIds.map(() => "?").join(", ")})`,
          unitIds,
        ),
      );
      units = unitRows.map((row) => ({
        id: String(value(row, "id")),
        title: String(value(row, "title")),
        status: String(value(row, "status")),
        completedAt: nullableDate(row, "completedAt"),
        completionMethod: nullableString(row, "completionMethod"),
      }));
    }
    return {
      id: revisionId,
      capacityMinutes: Number(value(revision, "capacityMinutes")),
      capacityJson: String(value(revision, "capacityJson") ?? "{}"),
      generationSource: String(value(revision, "generationSource")),
      reason: String(value(revision, "reason")),
      items,
      units,
    };
  }

  async findActiveItemExplanation(
    userId: string,
    itemId: string,
  ): Promise<AgendaItemExplanationRecord | null> {
    const result = await this.execute(
      `SELECT i."id", i."explanation", i."explanationCode", i."itemType",
              i."plannedDate", i."priority"
         FROM ${table(this.em, "AgendaItem")} i
         JOIN ${table(this.em, "AgendaRevision")} r ON r."id" = i."revisionId"
        WHERE i."id" = ? AND r."userId" = ? AND r."status" = 'active'
        LIMIT 1`,
      [itemId, userId],
    );
    const row = rows(result)[0];
    return row
      ? {
          id: String(value(row, "id")),
          explanation: String(value(row, "explanation") ?? ""),
          explanationCode: String(value(row, "explanationCode") ?? ""),
          itemType: String(value(row, "itemType")),
          plannedDate: String(value(row, "plannedDate")),
          priority: Number(value(row, "priority")),
        }
      : null;
  }
}
