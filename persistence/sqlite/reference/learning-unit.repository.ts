import type { EntityManager } from "@mikro-orm/core";
import type {
  InvalidateLearningUnitCognitiveModelInput,
  InvalidateLearningUnitCognitiveModelResult,
  LearningUnitCognitiveModelStatus,
  LearningUnitRecord,
  LearningUnitRepository,
  UnitModulePromptContext,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import { nullableReferenceDateValue } from "./date-value.ts";

type ValueRow = Readonly<Record<string, unknown>>;

const COGNITIVE_STATUSES = new Set<LearningUnitCognitiveModelStatus>([
  "pending",
  "building",
  "expanded",
  "failed",
  "provisional",
]);

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

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseStringArray(value: unknown): readonly string[] {
  if (Array.isArray(value))
    return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string" || value.trim() === "") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function dateValue(value: unknown): Date | null {
  return nullableReferenceDateValue(value);
}

function qualifiedTable(em: EntityManager): string {
  const schema = em.schema ?? em.config?.getSchema();
  return schema
    ? `"${schema.replaceAll('"', '""')}"."LearningUnit"`
    : '"LearningUnit"';
}

function toRecord(row: ValueRow): LearningUnitRecord {
  const status = stringValue(rowValue(row, "cognitiveModelStatus"), "pending");
  if (!COGNITIVE_STATUSES.has(status as LearningUnitCognitiveModelStatus)) {
    throw new Error(`Unsupported LearningUnit cognitive status: ${status}`);
  }
  return {
    id: stringValue(rowValue(row, "id")),
    goalId: stringValue(rowValue(row, "goalId")),
    curriculumKey: stringValue(rowValue(row, "curriculumKey")),
    parentUnitId: nullableString(rowValue(row, "parentUnitId")),
    unitKind: stringValue(rowValue(row, "unitKind"), "lesson"),
    title: stringValue(rowValue(row, "title")),
    contentSummary: stringValue(rowValue(row, "contentSummary")),
    orderIndex: Number(rowValue(row, "orderIndex") ?? 0),
    difficulty: stringValue(rowValue(row, "difficulty"), "medium"),
    prerequisites: stringValue(rowValue(row, "prerequisites"), "[]"),
    planAreaRef: stringValue(rowValue(row, "planAreaRef")),
    planningOutcomeRefs: parseStringArray(rowValue(row, "planningOutcomeRefs")),
    cognitiveModelStatus: status as LearningUnitCognitiveModelStatus,
    cognitiveModelBuildStartedAt: dateValue(
      rowValue(row, "cognitiveModelBuildStartedAt"),
    ),
    cognitiveModelBuildToken: nullableString(
      rowValue(row, "cognitiveModelBuildToken"),
    ),
    cognitiveModelBuildInputHash: nullableString(
      rowValue(row, "cognitiveModelBuildInputHash"),
    ),
  };
}

const curriculumSelect = `
  SELECT "id", "goalId", "curriculumKey", "parentUnitId", "unitKind",
         "title", "contentSummary", "orderIndex", "difficulty",
         "prerequisites", "planAreaRef", "planningOutcomeRefs",
         "cognitiveModelStatus", "cognitiveModelBuildStartedAt",
         "cognitiveModelBuildToken", "cognitiveModelBuildInputHash"
    FROM "LearningUnit"
   WHERE "goalId" = ?
   ORDER BY "orderIndex" ASC, "id" ASC
`;

/**
 * Raw-SQL curriculum projection adapter. LearningUnit is intentionally not
 * registered as an ORM entity yet because its module/assessment relations
 * belong to later B4 slices; this adapter owns only the narrow projection
 * declared by LearningUnitRepository.
 */
export class MikroOrmLearningUnitRepository implements LearningUnitRepository {
  constructor(private readonly em: EntityManager) {}

  private async readForCurriculum(
    em: EntityManager,
    goalId: string,
  ): Promise<readonly LearningUnitRecord[]> {
    const result = await em
      .getConnection()
      .execute(
        curriculumSelect.replaceAll('"LearningUnit"', qualifiedTable(em)),
        [goalId],
      );
    return resultRows(result).map(toRecord);
  }

  async listForCurriculum(
    goalId: string,
  ): Promise<readonly LearningUnitRecord[]> {
    return this.readForCurriculum(this.em, goalId);
  }

  async healCompletedStatuses(unitIds: readonly string[]): Promise<void> {
    if (!unitIds.length) return;
    const schema = this.em.schema ?? this.em.config?.getSchema();
    const name = schema ? `"${schema.replaceAll('"', '""')}"."LearningUnit"` : `"LearningUnit"`;
    await this.em.getConnection().execute(
      `UPDATE ${name} SET "status"='completed' WHERE "id" IN (${unitIds.map(() => "?").join(",")})`,
      [...unitIds],
    );
  }

  async findModulePromptContext(
    unitId: string,
  ): Promise<UnitModulePromptContext | null> {
    const schema = this.em.schema ?? this.em.config?.getSchema();
    const table = (name: string) => {
      const quoted = `"${name.replaceAll('"', '""')}"`;
      return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
    };
    const units = resultRows(
      await this.em.getConnection().execute(
        `SELECT u."moduleCapabilityRefs", m."id" AS "moduleId", m."title" AS "moduleTitle", m."objective" AS "moduleObjective"
           FROM ${table("LearningUnit")} u
           JOIN ${table("LearningModule")} m ON m."id" = u."moduleId"
          WHERE u."id" = ? LIMIT 1`,
        [unitId],
      ),
    );
    const unit = units[0];
    if (!unit) return null;
    const targets = resultRows(
      await this.em.getConnection().execute(
        `SELECT mt."localRef", mt."role", t."title", t."learningObjective"
           FROM ${table("ModuleLearningTarget")} mt
           JOIN ${table("LearningTarget")} t ON t."id" = mt."learningTargetId"
          WHERE mt."moduleId" = ?
          ORDER BY mt."orderIndex" ASC, mt."id" ASC`,
        [stringValue(rowValue(unit, "moduleId"))],
      ),
    );
    return {
      moduleTitle: stringValue(rowValue(unit, "moduleTitle")),
      moduleObjective: stringValue(rowValue(unit, "moduleObjective")),
      moduleCapabilityRefs: parseStringArray(
        rowValue(unit, "moduleCapabilityRefs"),
      ),
      learningTargets: targets.map((target) => ({
        localRef: stringValue(rowValue(target, "localRef")),
        role: stringValue(rowValue(target, "role")),
        title: stringValue(rowValue(target, "title")),
        learningObjective: stringValue(rowValue(target, "learningObjective")),
      })),
    };
  }

  async invalidateCognitiveModel(
    input: InvalidateLearningUnitCognitiveModelInput,
  ): Promise<InvalidateLearningUnitCognitiveModelResult> {
    // The repository is constructed from the caller's EntityManager. A
    // transactional manager is supplied by the application composition root;
    // opening a nested transaction here would break the same-unit-of-work
    // guarantee for goal mutation.
    const units = await this.readForCurriculum(this.em, input.goalId);
    const eligible = units.filter((unit) => unit.unitKind === "lesson");
    const expanded = input.preserveExpanded
      ? eligible.filter((unit) => unit.cognitiveModelStatus === "expanded")
      : [];
    const reset = eligible.filter(
      (unit) => !expanded.some((candidate) => candidate.id === unit.id),
    );

    if (expanded.length > 0) {
      await this.em.getConnection().execute(
        `UPDATE ${qualifiedTable(this.em)}
            SET "cognitiveModelBuildInputHash" = ?
          WHERE "goalId" = ?
            AND "unitKind" = 'lesson'
            AND "cognitiveModelStatus" = 'expanded'`,
        [input.nextInputHash, input.goalId],
      );
    }
    if (reset.length > 0) {
      await this.em.getConnection().execute(
        `UPDATE ${qualifiedTable(this.em)}
            SET "cognitiveModelStatus" = 'pending',
                "cognitiveModelBuildStartedAt" = NULL,
                "cognitiveModelBuildToken" = NULL,
                "cognitiveModelBuildInputHash" = NULL
          WHERE "goalId" = ?
            AND ("cognitiveModelStatus" <> 'expanded' OR ? = 0)`,
        [input.goalId, input.preserveExpanded ? 1 : 0],
      );
    }
    return {
      resetCount: reset.length,
      preservedExpandedCount: expanded.length,
    };
  }
}
