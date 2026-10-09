import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type {
  UnitSessionStateRecord,
  UnitSessionStateRepository,
  UpdateOwnedUnitSessionInput,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
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

function numberValue(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function qualifiedTable(em: EntityManager, table: string): string {
  const schema = em.schema ?? em.config?.getSchema();
  const quoted = `"${table.replaceAll('"', '""')}"`;
  return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}

function toRecord(row: ValueRow): UnitSessionStateRecord {
  return {
    id: stringValue(rowValue(row, "id")),
    unitId: stringValue(rowValue(row, "unitId")),
    currentStep: stringValue(rowValue(row, "currentStep"), "structured_input"),
    structuredSubStep: stringValue(rowValue(row, "structuredSubStep"), "sq"),
    graphState: stringValue(rowValue(row, "graphState"), "{}"),
    sq3rData: stringValue(rowValue(row, "sq3rData"), "{}"),
    socraticTurn: numberValue(rowValue(row, "socraticTurn")),
    cumulativeActiveSeconds: numberValue(
      rowValue(row, "cumulativeActiveSeconds"),
    ),
    updatedAt: referenceDateValue(
      rowValue(row, "updatedAt"),
      "unit session updatedAt",
    ),
  };
}

const PATCH_COLUMNS = [
  "currentStep",
  "structuredSubStep",
  "graphState",
  "sq3rData",
  "socraticTurn",
  "cumulativeActiveSeconds",
] as const;

export class MikroOrmUnitSessionStateRepository implements UnitSessionStateRepository {
  constructor(private readonly em: EntityManager) {}

  private async ownedUnit(userId: string, unitId: string): Promise<boolean> {
    const unitTable = qualifiedTable(this.em, "LearningUnit");
    const goalTable = qualifiedTable(this.em, "LearningGoal");
    const result = await this.em.getConnection().execute(
      `SELECT u."id"
         FROM ${unitTable} u
         JOIN ${goalTable} g ON g."id" = u."goalId"
        WHERE u."id" = ?
          AND g."userId" = ?
        LIMIT 1`,
      [unitId, userId],
    );
    return resultRows(result).length > 0;
  }

  private async read(unitId: string): Promise<UnitSessionStateRecord | null> {
    const table = qualifiedTable(this.em, "UnitSessionState");
    const result = await this.em.getConnection().execute(
      `SELECT "id", "unitId", "currentStep", "structuredSubStep",
              "graphState", "sq3rData", "socraticTurn",
              "cumulativeActiveSeconds", "updatedAt"
         FROM ${table}
        WHERE "unitId" = ?`,
      [unitId],
    );
    const row = resultRows(result)[0];
    return row ? toRecord(row) : null;
  }

  async getOrCreateOwned(
    userId: string,
    unitId: string,
  ): Promise<UnitSessionStateRecord | null> {
    if (!(await this.ownedUnit(userId, unitId))) return null;
    const unitTable = qualifiedTable(this.em, "LearningUnit");
    await this.em.getConnection().execute(
      `UPDATE ${unitTable}
          SET "status" = CASE
                WHEN "completedAt" IS NOT NULL AND "completionMethod" IS NOT NULL THEN 'completed'
                WHEN "status" = 'available' THEN 'in_progress'
                ELSE "status"
              END
        WHERE "id" = ?
          AND (("completedAt" IS NOT NULL AND "completionMethod" IS NOT NULL AND "status" <> 'completed')
            OR "status" = 'available')`,
      [unitId],
    );
    const existing = await this.read(unitId);
    if (existing) return existing;
    const table = qualifiedTable(this.em, "UnitSessionState");
    await this.em.getConnection().execute(
      `INSERT INTO ${table} ("id", "unitId", "updatedAt") VALUES (?, ?, ?)
         ON CONFLICT ("unitId") DO NOTHING`,
      [randomUUID(), unitId, new Date()],
    );
    return this.read(unitId);
  }

  async updateOwned(
    input: UpdateOwnedUnitSessionInput,
  ): Promise<UnitSessionStateRecord | null> {
    const current = await this.getOrCreateOwned(input.userId, input.unitId);
    if (!current) return null;
    const entries = Object.entries(input.patch).filter(
      ([key, value]) =>
        (PATCH_COLUMNS as readonly string[]).includes(key) &&
        value !== undefined,
    ) as [keyof typeof input.patch, unknown][];
    if (entries.length === 0) return current;
    const table = qualifiedTable(this.em, "UnitSessionState");
    const assignments = entries.map(([key]) => `"${key}" = ?`).join(", ");
    await this.em.getConnection().execute(
      `UPDATE ${table}
          SET ${assignments}, "updatedAt" = ?
        WHERE "unitId" = ?`,
      [...entries.map(([, value]) => value), new Date(), input.unitId],
    );
    return this.read(input.unitId);
  }
}
