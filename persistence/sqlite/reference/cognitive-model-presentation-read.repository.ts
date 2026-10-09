import type { EntityManager } from "@mikro-orm/core";
import type {
  CognitiveModelGoalReadRecord,
  CognitiveModelPresentationReadRepository,
  CognitiveModelRevisionReadRecord,
  CognitiveModelUnitReadRecord,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
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
    throw new Error(`Cognitive model presentation row is missing ${label}`);
  }
  return value;
}

function numberValue(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Cognitive model presentation row has invalid ${label}`);
  }
  return parsed;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function nullableDate(value: unknown, label: string): Date | null {
  return nullableReferenceDateValue(value, `cognitive model ${label}`);
}

function dateValue(value: unknown, label: string): Date {
  return referenceDateValue(value, `cognitive model ${label}`);
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

function toRevision(row: Row): CognitiveModelRevisionReadRecord {
  return {
    version: numberValue(rowValue(row, "version"), "version"),
    status: stringValue(rowValue(row, "status"), "status"),
    scope: stringValue(rowValue(row, "scope"), "scope"),
    inputHash: stringValue(rowValue(row, "inputHash"), "inputHash"),
    snapshotSchemaVersion: numberValue(
      rowValue(row, "snapshotSchemaVersion"),
      "snapshotSchemaVersion",
    ),
    isFullSnapshot: booleanValue(rowValue(row, "isFullSnapshot")),
    snapshotJson: decodeJson(rowValue(row, "snapshotJson")),
    auditJson: decodeJson(rowValue(row, "auditJson")),
    publishedAt: nullableDate(rowValue(row, "publishedAt"), "publishedAt"),
    createdAt: dateValue(rowValue(row, "createdAt"), "createdAt"),
  };
}

/** Raw SQL adapter for last-good cognitive-model presentation inputs. */
export class MikroOrmCognitiveModelPresentationReadRepository implements CognitiveModelPresentationReadRepository {
  constructor(private readonly em: EntityManager) {}

  private execute(sql: string, params: unknown[] = []) {
    return this.em.getConnection().execute(sql, params);
  }

  private async revisions(
    goalId: string,
  ): Promise<readonly CognitiveModelRevisionReadRecord[]> {
    const rows = resultRows(
      await this.execute(
        `SELECT "version", "status", "scope", "inputHash",
                "snapshotSchemaVersion", "isFullSnapshot", "snapshotJson",
                "auditJson", "publishedAt", "createdAt"
           FROM ${qualifiedTable(this.em, "CognitiveModelRevision")}
          WHERE "goalId" = ? AND "status" IN ('published', 'superseded')
            AND "isFullSnapshot" = TRUE
          ORDER BY "version" DESC`,
        [goalId],
      ),
    );
    return rows.map(toRevision);
  }

  async findGoal(input: {
    goalId: string;
  }): Promise<CognitiveModelGoalReadRecord | null> {
    const rows = resultRows(
      await this.execute(
        `SELECT "id", "cognitiveModelStatus", "cognitiveModelVersion",
                "cognitiveModelInputHash", "cognitiveModelPublishedHash"
           FROM ${qualifiedTable(this.em, "LearningGoal")}
          WHERE "id" = ?`,
        [input.goalId],
      ),
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: stringValue(rowValue(row, "id"), "goal id"),
      cognitiveModelStatus: stringValue(
        rowValue(row, "cognitiveModelStatus"),
        "cognitiveModelStatus",
      ),
      cognitiveModelVersion: numberValue(
        rowValue(row, "cognitiveModelVersion"),
        "cognitiveModelVersion",
      ),
      cognitiveModelInputHash: stringValue(
        rowValue(row, "cognitiveModelInputHash"),
        "cognitiveModelInputHash",
      ),
      cognitiveModelPublishedHash: nullableString(
        rowValue(row, "cognitiveModelPublishedHash"),
      ),
      revisions: await this.revisions(input.goalId),
    };
  }

  async findUnit(input: {
    unitId: string;
  }): Promise<CognitiveModelUnitReadRecord | null> {
    const rows = resultRows(
      await this.execute(
        `SELECT u."id" AS "unitId", u."goalId", u."title", g."goalKind", g."learningMode",
                u."cognitiveModelStatus", u."cognitiveModelBuildInputHash",
                g."cognitiveModelStatus" AS "goalCognitiveModelStatus",
                g."cognitiveModelInputHash" AS "goalCognitiveModelInputHash",
                g."cognitiveModelPublishedHash" AS "goalCognitiveModelPublishedHash",
                m."unlockStatus" AS "moduleUnlockStatus",
                m."generationStatus" AS "moduleGenerationStatus",
                (SELECT COUNT(*) FROM ${qualifiedTable(this.em, "UnitLearningTarget")} ut
                  WHERE ut."unitId" = u."id") AS "canonicalTargetCount"
           FROM ${qualifiedTable(this.em, "LearningUnit")} u
           JOIN ${qualifiedTable(this.em, "LearningGoal")} g
             ON g."id" = u."goalId"
           LEFT JOIN ${qualifiedTable(this.em, "LearningModule")} m
             ON m."id" = u."moduleId"
          WHERE u."id" = ?`,
        [input.unitId],
      ),
    );
    const row = rows[0];
    if (!row) return null;
    const goalId = stringValue(rowValue(row, "goalId"), "goal id");
    return {
      unitId: stringValue(rowValue(row, "unitId"), "unit id"),
      goalId,
      title: stringValue(rowValue(row, "title"), "unit title"),
      goalKind: stringValue(rowValue(row, "goalKind"), "goal kind"),
      learningMode: stringValue(rowValue(row, "learningMode"), "learning mode"),
      moduleUnlockStatus: nullableString(rowValue(row, "moduleUnlockStatus")),
      moduleGenerationStatus: nullableString(
        rowValue(row, "moduleGenerationStatus"),
      ),
      canonicalTargetCount: numberValue(
        rowValue(row, "canonicalTargetCount"),
        "canonical target count",
      ),
      cognitiveModelStatus: stringValue(
        rowValue(row, "cognitiveModelStatus"),
        "unit cognitiveModelStatus",
      ),
      cognitiveModelBuildInputHash: nullableString(
        rowValue(row, "cognitiveModelBuildInputHash"),
      ),
      goalCognitiveModelStatus: stringValue(
        rowValue(row, "goalCognitiveModelStatus"),
        "goal cognitiveModelStatus",
      ),
      goalCognitiveModelInputHash: stringValue(
        rowValue(row, "goalCognitiveModelInputHash"),
        "goal cognitiveModelInputHash",
      ),
      goalCognitiveModelPublishedHash: nullableString(
        rowValue(row, "goalCognitiveModelPublishedHash"),
      ),
      revisions: await this.revisions(goalId),
    };
  }
}
