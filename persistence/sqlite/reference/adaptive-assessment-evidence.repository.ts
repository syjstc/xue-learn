import type { EntityManager } from "@mikro-orm/core";
import type {
  AdaptiveAssessmentEvidenceRecord,
  AdaptiveAssessmentEvidenceRepository,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
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

function qualifiedTable(em: EntityManager, table: string): string {
  const schema = em.schema ?? em.config?.getSchema();
  const quoted = `"${table.replaceAll('"', '""')}"`;
  return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}

function json(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function date(value: unknown): Date {
  return referenceDateValue(value);
}

function number(value: unknown): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

/** Raw SQL read adapter for active adaptive-assessment evidence context. */
export class MikroOrmAdaptiveAssessmentEvidenceRepository implements AdaptiveAssessmentEvidenceRepository {
  constructor(private readonly em: EntityManager) {}

  private execute(sql: string, params: unknown[] = []) {
    return this.em
      .getConnection()
      .execute(sql, params, undefined, this.em.getTransactionContext());
  }

  async findActive(input: {
    userId: string;
    learningTargetIds: readonly string[];
    asOf?: Date;
  }): Promise<readonly AdaptiveAssessmentEvidenceRecord[]> {
    if (input.learningTargetIds.length === 0) return [];
    const claims = qualifiedTable(this.em, "EvidenceClaim");
    const observations = qualifiedTable(this.em, "TaskObservation");
    const attempts = qualifiedTable(this.em, "TaskAttempt");
    const tasks = qualifiedTable(this.em, "LearningTask");
    const targetPlaceholders = input.learningTargetIds
      .map(() => "?")
      .join(", ");
    const rows = resultRows(
      await this.execute(
        `SELECT c."learningTargetId", c."cognitiveEntityId", c."dimension",
                c."contextKey", c."evaluatorReliability", c."groundingReliability",
                o."observedAt", o."metadata", a."assistanceLevel",
                t."taskType", t."origin"
           FROM ${claims} c
           JOIN ${observations} o ON o."id" = c."observationId"
           JOIN ${attempts} a ON a."id" = o."attemptId"
           JOIN ${tasks} t ON t."id" = a."taskId"
          WHERE c."userId" = ?
            AND c."status" = 'active'
            AND c."learningTargetId" IN (${targetPlaceholders})
            AND (c."validUntil" IS NULL OR c."validUntil" > ?)
          ORDER BY c."createdAt" ASC, c."id" ASC`,
        [input.userId, ...input.learningTargetIds, input.asOf ?? new Date()],
      ),
    );
    return rows.map((row) => ({
      learningTargetId:
        rowValue(row, "learningTargetId") == null
          ? null
          : String(rowValue(row, "learningTargetId")),
      cognitiveEntityId: String(rowValue(row, "cognitiveEntityId")),
      dimension: String(rowValue(row, "dimension")),
      contextKey: String(rowValue(row, "contextKey") ?? ""),
      evaluatorReliability: number(rowValue(row, "evaluatorReliability")),
      groundingReliability: number(rowValue(row, "groundingReliability")),
      observation: {
        observedAt: date(rowValue(row, "observedAt")),
        metadata: json(rowValue(row, "metadata")),
        attempt: {
          assistanceLevel: number(rowValue(row, "assistanceLevel")),
          task: {
            taskType: String(rowValue(row, "taskType")),
            origin: String(rowValue(row, "origin")),
          },
        },
      },
    }));
  }
}
