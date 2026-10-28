import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type {
  CompleteUnitSectionInput,
  UnitSectionProgressRecord,
  UnitSectionProgressRepository,
} from "@xue-learn/core/domain";
import { safeReferenceDateValue } from "./date-value.ts";

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

function numberValue(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nullableDateValue(value: unknown): Date | null {
  return safeReferenceDateValue(value);
}

function dateValue(value: unknown, fallback = new Date()): Date {
  return nullableDateValue(value) ?? fallback;
}

function qualifiedTable(em: EntityManager, table: string): string {
  const schema = em.schema ?? em.config?.getSchema();
  const quoted = `"${table.replaceAll('"', '""')}"`;
  return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}

function toRecord(row: ValueRow): UnitSectionProgressRecord {
  return {
    id: stringValue(rowValue(row, "id")),
    userId: stringValue(rowValue(row, "userId")),
    sectionId: stringValue(rowValue(row, "sectionId")),
    status: stringValue(rowValue(row, "status"), "available"),
    activeSeconds: numberValue(rowValue(row, "activeSeconds")),
    startedAt: nullableDateValue(rowValue(row, "startedAt")),
    contentCompletedAt: nullableDateValue(rowValue(row, "contentCompletedAt")),
    completedAt: nullableDateValue(rowValue(row, "completedAt")),
    skippedAt: nullableDateValue(rowValue(row, "skippedAt")),
    skipReason:
      typeof rowValue(row, "skipReason") === "string"
        ? String(rowValue(row, "skipReason"))
        : null,
    updatedAt: dateValue(rowValue(row, "updatedAt")),
  };
}

/** Raw-SQL adapter for the owner-scoped section-progress completion write. */
export class MikroOrmUnitSectionProgressRepository implements UnitSectionProgressRepository {
  constructor(private readonly em: EntityManager) {}

  async completeOwned(
    input: CompleteUnitSectionInput,
  ): Promise<UnitSectionProgressRecord> {
    return this.em.transactional((tx) => this.completeInTransaction(tx, input));
  }

  private async completeInTransaction(
    em: EntityManager,
    input: CompleteUnitSectionInput,
  ): Promise<UnitSectionProgressRecord> {
    const sectionTable = qualifiedTable(em, "MainCourseSection");
    const unitTable = qualifiedTable(em, "LearningUnit");
    const goalTable = qualifiedTable(em, "LearningGoal");
    const progressTable = qualifiedTable(em, "UnitSectionProgress");
    const connection = em.getConnection();
    const execute = (sql: string, params: unknown[] = []) =>
      connection.execute(sql, params, undefined, em.getTransactionContext());

    const owner = resultRows(
      await execute(
        `SELECT s."id",s."contentRevision" AS "sectionRevision",u."contentRevision" AS "unitRevision"
           FROM ${sectionTable} s
           JOIN ${unitTable} u ON u."id" = s."unitId"
           JOIN ${goalTable} g ON g."id" = u."goalId"
          WHERE s."id" = ? AND s."unitId" = ? AND g."userId" = ?`,
        [input.sectionId, input.unitId, input.userId],
      ),
    )[0];
    if (!owner) throw new Error("Section not found");
    if(input.expectedUnitRevision!==undefined&&Number(owner.unitRevision)!==input.expectedUnitRevision||input.expectedSectionRevision!==undefined&&Number(owner.sectionRevision)!==input.expectedSectionRevision)
      throw new Error("LEARNING_CONTENT_CHANGED: Published content revision changed");

    const now = new Date();
    await execute(
      `INSERT INTO ${progressTable}
        ("id", "userId", "sectionId", "status", "activeSeconds", "startedAt", "contentCompletedAt", "completedAt", "skippedAt", "skipReason", "updatedAt")
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
       ON CONFLICT ("userId", "sectionId") DO UPDATE SET
        "status" = excluded."status",
        "startedAt" = excluded."startedAt",
        "contentCompletedAt" = excluded."contentCompletedAt",
        "completedAt" = excluded."completedAt",
        "skippedAt" = excluded."skippedAt",
        "skipReason" = excluded."skipReason",
        "updatedAt" = excluded."updatedAt"`,
      [
        `progress-${randomUUID()}`,
        input.userId,
        input.sectionId,
        input.status,
        input.startedAt,
        input.contentCompletedAt,
        input.completedAt,
        input.skippedAt,
        input.skipReason,
        now,
      ],
    );
    const row = resultRows(
      await execute(
        `SELECT "id", "userId", "sectionId", "status", "activeSeconds", "startedAt", "contentCompletedAt", "completedAt", "skippedAt", "skipReason", "updatedAt"
           FROM ${progressTable}
          WHERE "userId" = ? AND "sectionId" = ?`,
        [input.userId, input.sectionId],
      ),
    )[0];
    if (!row) throw new Error("Section progress write did not persist");
    return toRecord(row);
  }
}
