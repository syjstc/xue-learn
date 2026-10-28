import type { EntityManager } from "@mikro-orm/core";
import type {
  LearningModuleRecord,
  LearningModuleRepository,
} from "@xue-learn/core/domain";
import { referenceDateValue } from "./date-value.ts";

type ValueRow = Readonly<Record<string, unknown>>;

function resultRows(result: unknown): readonly ValueRow[] {
  if (Array.isArray(result)) return result as ValueRow[];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    return Array.isArray(rows) ? (rows as ValueRow[]) : [];
  }
  return [];
}

function rowValue(row: ValueRow, key: string): unknown {
  return row[key] ?? row[key[0]?.toLowerCase() + key.slice(1)];
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function dateValue(value: unknown): Date {
  return referenceDateValue(value);
}

function parseStringArray(value: unknown): readonly string[] {
  const parsed =
    typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value) as unknown;
          } catch {
            return [];
          }
        })()
      : value;
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
}

function qualifiedTable(em: EntityManager, table: string): string {
  const schema = em.schema ?? em.config?.getSchema();
  const quoted = `"${table.replaceAll('"', '""')}"`;
  return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}

function toRecord(row: ValueRow): LearningModuleRecord {
  return {
    id: stringValue(rowValue(row, "id")),
    curriculumKey: stringValue(rowValue(row, "curriculumKey")),
    goalId: stringValue(rowValue(row, "goalId")),
    planRef: stringValue(rowValue(row, "planRef")),
    orderIndex: Number(rowValue(row, "orderIndex") ?? 0),
    title: stringValue(rowValue(row, "title")),
    summary: stringValue(rowValue(row, "summary")),
    objective: stringValue(rowValue(row, "objective")),
    plannedOutcomes: parseStringArray(rowValue(row, "plannedOutcomes")),
    unlockStatus: stringValue(rowValue(row, "unlockStatus"), "locked"),
    generationStatus: stringValue(rowValue(row, "generationStatus"), "pending"),
    generationVersion: Number(rowValue(row, "generationVersion") ?? 0),
    createdAt: dateValue(rowValue(row, "createdAt")),
    updatedAt: dateValue(rowValue(row, "updatedAt")),
  };
}

export class MikroOrmLearningModuleRepository implements LearningModuleRepository {
  constructor(private readonly em: EntityManager) {}

  async listOwnedForGoal(
    userId: string,
    goalId: string,
  ): Promise<readonly LearningModuleRecord[]> {
    const moduleTable = qualifiedTable(this.em, "LearningModule");
    const goalTable = qualifiedTable(this.em, "LearningGoal");
    const result = await this.em.getConnection().execute(
      `SELECT m."id", m."curriculumKey", m."goalId", m."planRef",
              m."orderIndex", m."title", m."summary", m."objective",
              m."plannedOutcomes", m."unlockStatus", m."generationStatus",
              m."generationVersion", m."createdAt", m."updatedAt"
         FROM ${moduleTable} m
         JOIN ${goalTable} g ON g."id" = m."goalId"
        WHERE m."goalId" = ?
          AND g."userId" = ?
        ORDER BY m."orderIndex" ASC, m."id" ASC`,
      [goalId, userId],
    );
    return resultRows(result).map(toRecord);
  }
}
