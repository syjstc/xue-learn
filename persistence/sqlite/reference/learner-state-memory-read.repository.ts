import type { EntityManager } from "@mikro-orm/core";
import type {
  LearnerStateMemoryReadRecord,
  LearnerStateMemoryReadRepository,
} from "@xue-learn/core/domain";
import { nullableReferenceDateValue, referenceDateValue } from "./date-value.ts";

type Row = Readonly<Record<string, unknown>>;

function resultRows(result: unknown): readonly Row[] {
  if (Array.isArray(result)) return result as Row[];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    return Array.isArray(rows) ? (rows as Row[]) : [];
  }
  return [];
}

function rowValue(row: Row, key: string): unknown {
  return row[key] ?? row[key[0]?.toLowerCase() + key.slice(1)];
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`Learner-state memory row is missing ${label}`);
  }
  return value;
}

function numberValue(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Learner-state memory row has invalid ${label}`);
  }
  return parsed;
}

function dateValue(value: unknown): Date {
  return referenceDateValue(value, "learner-state memory timestamp");
}

function nullableDate(value: unknown): Date | null {
  return nullableReferenceDateValue(value, "learner-state memory timestamp");
}

function decodeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function qualifiedTable(em: EntityManager, table: string): string {
  const schema = em.schema ?? em.config?.getSchema();
  const quoted = `"${table.replaceAll('"', '""')}"`;
  return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}

/** Raw SQL adapter for the read-only global learner-state memory cache. */
export class MikroOrmLearnerStateMemoryReadRepository implements LearnerStateMemoryReadRepository {
  constructor(private readonly em: EntityManager) {}

  async findByUser(input: {
    userId: string;
  }): Promise<LearnerStateMemoryReadRecord | null> {
    const result = await this.em.getConnection().execute(
      `SELECT "userId", "schemaVersion", "sourceSchemaVersion",
              "inferencePolicyVersion", "sourceFingerprint",
              "sourceRevisionCutoffAt", "stateJson", "refreshedAt",
              "invalidatedAt", "nextRefreshAt", "lastRefreshReason", "lastError"
         FROM ${qualifiedTable(this.em, "LearnerStateMemory")}
        WHERE "userId" = ?`,
      [input.userId],
    );
    const row = resultRows(result)[0];
    if (!row) return null;
    return {
      userId: stringValue(rowValue(row, "userId"), "userId"),
      schemaVersion: numberValue(
        rowValue(row, "schemaVersion"),
        "schemaVersion",
      ),
      sourceSchemaVersion: numberValue(
        rowValue(row, "sourceSchemaVersion"),
        "sourceSchemaVersion",
      ),
      inferencePolicyVersion: numberValue(
        rowValue(row, "inferencePolicyVersion"),
        "inferencePolicyVersion",
      ),
      sourceFingerprint: stringValue(
        rowValue(row, "sourceFingerprint"),
        "sourceFingerprint",
      ),
      sourceRevisionCutoffAt: nullableDate(
        rowValue(row, "sourceRevisionCutoffAt"),
      ),
      stateJson: decodeJson(rowValue(row, "stateJson")),
      refreshedAt: nullableDate(rowValue(row, "refreshedAt")),
      invalidatedAt: nullableDate(rowValue(row, "invalidatedAt")),
      nextRefreshAt: nullableDate(rowValue(row, "nextRefreshAt")),
      lastRefreshReason: stringValue(
        rowValue(row, "lastRefreshReason"),
        "lastRefreshReason",
      ),
      lastError: stringValue(rowValue(row, "lastError"), "lastError"),
    };
  }
}
