import type { EntityManager } from "@mikro-orm/core";
import type {
  ModuleEntryReadinessReadRecord,
  ModuleEntryReadinessReadRepository,
  ModuleEntryReadinessRequirementRecord,
  ModuleEntryReadinessTargetRecord,
} from "@xue-learn/core/source/libs/domain/src/index.ts";

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
    throw new Error(`Module entry readiness row is missing ${label}`);
  }
  return value;
}

function numberValue(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Module entry readiness row has invalid ${label}`);
  }
  return parsed;
}

function nullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function qualifiedTable(em: EntityManager, table: string): string {
  const schema = em.schema ?? em.config?.getSchema();
  const quoted = `"${table.replaceAll('"', '""')}"`;
  return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}

/** Raw SQL read adapter for module entry readiness and learner dimension state. */
export class MikroOrmModuleEntryReadinessReadRepository implements ModuleEntryReadinessReadRepository {
  constructor(private readonly em: EntityManager) {}

  private execute(sql: string, params: unknown[] = []) {
    return this.em.getConnection().execute(sql, params);
  }

  async findForModule(input: {
    userId: string;
    goalId: string;
    moduleId: string;
  }): Promise<ModuleEntryReadinessReadRecord | null> {
    const moduleRows = resultRows(
      await this.execute(
        `SELECT m."id"
           FROM ${qualifiedTable(this.em, "LearningModule")} m
           JOIN ${qualifiedTable(this.em, "LearningGoal")} g
             ON g."id" = m."goalId"
          WHERE m."id" = ? AND m."goalId" = ? AND g."userId" = ?`,
        [input.moduleId, input.goalId, input.userId],
      ),
    );
    if (!moduleRows[0]) return null;

    const rows = resultRows(
      await this.execute(
        `SELECT mlt."learningTargetId" AS "learningTargetId",
                lt."title", mlt."required" AS "mappingRequired",
                req."dimension", req."threshold",
                req."required" AS "requirementRequired", req."gate",
                lds."estimate", lds."evidenceSufficiency",
                lds."status" AS "dimensionStatus"
           FROM ${qualifiedTable(this.em, "ModuleLearningTarget")} mlt
           JOIN ${qualifiedTable(this.em, "LearningModule")} m
             ON m."id" = mlt."moduleId"
           JOIN ${qualifiedTable(this.em, "LearningGoal")} g
             ON g."id" = m."goalId"
           JOIN ${qualifiedTable(this.em, "LearningTarget")} lt
             ON lt."id" = mlt."learningTargetId"
            AND lt."status" = 'active'
           JOIN ${qualifiedTable(this.em, "LearningTargetRequirement")} req
             ON req."learningTargetId" = lt."id"
           JOIN ${qualifiedTable(this.em, "CognitiveEntity")} entity
             ON entity."id" = req."cognitiveEntityId"
           LEFT JOIN ${qualifiedTable(this.em, "LearnerEntityState")} les
             ON les."cognitiveEntityId" = entity."id"
            AND les."userId" = ?
           LEFT JOIN ${qualifiedTable(this.em, "LearnerDimensionState")} lds
             ON lds."learnerEntityStateId" = les."id"
            AND lds."dimension" = req."dimension"
          WHERE mlt."moduleId" = ? AND m."goalId" = ?
            AND g."userId" = ? AND mlt."role" = 'entry'
          ORDER BY mlt."orderIndex" ASC, req."orderIndex" ASC,
                   req."id" ASC`,
        [input.userId, input.moduleId, input.goalId, input.userId],
      ),
    );
    const targets = new Map<string, ModuleEntryReadinessTargetRecord>();
    for (const row of rows) {
      const learningTargetId = stringValue(
        rowValue(row, "learningTargetId"),
        "learningTargetId",
      );
      let target = targets.get(learningTargetId);
      if (!target) {
        target = {
          learningTargetId,
          title: stringValue(rowValue(row, "title"), "title"),
          required: booleanValue(rowValue(row, "mappingRequired")),
          requirements: [],
        };
        targets.set(learningTargetId, target);
      }
      const requirement: ModuleEntryReadinessRequirementRecord = {
        dimension: stringValue(rowValue(row, "dimension"), "dimension"),
        threshold: numberValue(rowValue(row, "threshold"), "threshold"),
        required: booleanValue(rowValue(row, "requirementRequired")),
        gate: booleanValue(rowValue(row, "gate")),
        estimate: nullableNumber(rowValue(row, "estimate")),
        evidenceSufficiency: numberValue(
          rowValue(row, "evidenceSufficiency") ?? 0,
          "evidenceSufficiency",
        ),
        status: nullableString(rowValue(row, "dimensionStatus")),
      };
      (target.requirements as ModuleEntryReadinessRequirementRecord[]).push(
        requirement,
      );
    }

    const bridgeRows = resultRows(
      await this.execute(
        `SELECT "id"
           FROM ${qualifiedTable(this.em, "LearningUnit")}
          WHERE "goalId" = ? AND "moduleId" = ?
            AND "supportKind" = 'prerequisite_bridge'
          ORDER BY "orderIndex" ASC, "id" ASC
          LIMIT 1`,
        [input.goalId, input.moduleId],
      ),
    );
    return {
      bridgeUnitId: bridgeRows[0]
        ? nullableString(rowValue(bridgeRows[0], "id"))
        : null,
      targets: [...targets.values()],
    };
  }
}
