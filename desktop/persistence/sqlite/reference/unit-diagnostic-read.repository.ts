import type { EntityManager } from "@mikro-orm/core";
import type {
  UnitDiagnosticAttemptRecord,
  UnitDiagnosticReadRecord,
  UnitDiagnosticReadRepository,
} from "@xue-learn/core/domain";
import { referenceDateValue } from "./date-value.ts";

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
    throw new Error(`Unit diagnostic row is missing ${label}`);
  }
  return value;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Unit diagnostic row has invalid ${label}`);
  }
  return parsed;
}

function nullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableBoolean(value: unknown): boolean | null {
  if (value == null) return null;
  return value === true || value === 1 || value === "1" || value === "true";
}

function dateValue(value: unknown, label: string): Date {
  return referenceDateValue(value, `unit diagnostic ${label}`);
}

function qualifiedTable(em: EntityManager, table: string): string {
  const schema = em.schema ?? em.config?.getSchema();
  const quoted = `"${table.replaceAll('"', '""')}"`;
  return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}

function toAttempt(row: Row): UnitDiagnosticAttemptRecord {
  return {
    id: stringValue(rowValue(row, "id"), "attempt id"),
    status: stringValue(rowValue(row, "status"), "attempt status"),
    questions: stringValue(rowValue(row, "questions"), "questions"),
    results: stringValue(rowValue(row, "results"), "results"),
    perLearningTargetResults: stringValue(
      rowValue(row, "perLearningTargetResults"),
      "perLearningTargetResults",
    ),
    overallScore: nullableNumber(rowValue(row, "overallScore")),
    passed: nullableBoolean(rowValue(row, "passed")),
    createdAt: dateValue(rowValue(row, "createdAt"), "createdAt"),
    submittedAt:
      rowValue(row, "submittedAt") == null
        ? null
        : dateValue(rowValue(row, "submittedAt"), "submittedAt"),
  };
}

/** Raw SQL read adapter for learner-owned unit diagnostic state. */
export class MikroOrmUnitDiagnosticReadRepository implements UnitDiagnosticReadRepository {
  constructor(private readonly em: EntityManager) {}

  private execute(sql: string, params: unknown[] = []) {
    return this.em.getConnection().execute(sql, params);
  }

  private async latestAttempt(
    userId: string,
    unitId: string,
  ): Promise<UnitDiagnosticAttemptRecord | null> {
    const rows = resultRows(
      await this.execute(
        `SELECT "id", "status", "questions", "results",
                "perLearningTargetResults", "overallScore", "passed",
                "createdAt", "submittedAt"
           FROM ${qualifiedTable(this.em, "DiagnosticAttempt")}
          WHERE "userId" = ? AND "unitId" = ?
          ORDER BY "createdAt" DESC, "id" DESC
          LIMIT 1`,
        [userId, unitId],
      ),
    );
    return rows[0] ? toAttempt(rows[0]) : null;
  }

  async listGoalUnits(input: { userId: string; goalId: string }) {
    return resultRows(
      await this.execute(
        `SELECT u."id", u."parentUnitId", u."unitKind", u."orderIndex", u."status"
           FROM ${qualifiedTable(this.em, "LearningUnit")} u
           JOIN ${qualifiedTable(this.em, "LearningGoal")} g ON g."id" = u."goalId"
          WHERE u."goalId" = ? AND g."userId" = ?`,
        [input.goalId, input.userId],
      ),
    ).map((row) => ({
      id: stringValue(rowValue(row, "id"), "unit id"),
      parentUnitId: nullableString(rowValue(row, "parentUnitId")),
      unitKind: stringValue(rowValue(row, "unitKind"), "unit kind"),
      orderIndex: numberValue(rowValue(row, "orderIndex"), "order index"),
      status: stringValue(rowValue(row, "status"), "unit status"),
    }));
  }

  async findUnit(input: {
    userId: string;
    unitId: string;
  }): Promise<UnitDiagnosticReadRecord | null> {
    const rows = resultRows(
      await this.execute(
        `SELECT u."id" AS "unitId", u."goalId", u."unitKind", u."status",
                u."completionMethod", g."goalKind", g."learningMode",
                (SELECT COUNT(*)
                   FROM ${qualifiedTable(this.em, "LearningUnit")} child
                  WHERE child."parentUnitId" = u."id") AS "childCount",
                (SELECT remediation."id"
                   FROM ${qualifiedTable(this.em, "LearningUnit")} remediation
                  WHERE remediation."remediationSourceUnitId" = u."id"
                  LIMIT 1) AS "remediationUnitId"
           FROM ${qualifiedTable(this.em, "LearningUnit")} u
           JOIN ${qualifiedTable(this.em, "LearningGoal")} g
             ON g."id" = u."goalId"
          WHERE u."id" = ? AND g."userId" = ?`,
        [input.unitId, input.userId],
      ),
    );
    const row = rows[0];
    if (!row) return null;
    return {
      unitId: stringValue(rowValue(row, "unitId"), "unitId"),
      goalId: stringValue(rowValue(row, "goalId"), "goalId"),
      goalKind: stringValue(rowValue(row, "goalKind"), "goalKind"),
      learningMode: stringValue(rowValue(row, "learningMode"), "learningMode"),
      unitKind: stringValue(rowValue(row, "unitKind"), "unitKind"),
      status: stringValue(rowValue(row, "status"), "status"),
      completionMethod: nullableString(rowValue(row, "completionMethod")),
      childCount: numberValue(rowValue(row, "childCount"), "childCount"),
      remediationUnitId: nullableString(rowValue(row, "remediationUnitId")),
      latestAttempt: await this.latestAttempt(input.userId, input.unitId),
    };
  }

  async findAttempt(input: {
    userId: string;
    unitId: string;
    attemptId: string;
  }): Promise<UnitDiagnosticAttemptRecord | null> {
    const rows = resultRows(
      await this.execute(
        `SELECT "id", "status", "questions", "results",
                "perLearningTargetResults", "overallScore", "passed",
                "createdAt", "submittedAt"
           FROM ${qualifiedTable(this.em, "DiagnosticAttempt")}
          WHERE "id" = ? AND "userId" = ? AND "unitId" = ?`,
        [input.attemptId, input.userId, input.unitId],
      ),
    );
    return rows[0] ? toAttempt(rows[0]) : null;
  }
}
