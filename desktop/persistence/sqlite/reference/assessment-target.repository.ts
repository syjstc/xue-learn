import type { EntityManager } from "@mikro-orm/core";
import { randomUUID } from "node:crypto";
import type {
  AssessmentTargetEntityKind,
  AssessmentTargetRecord,
  AssessmentTargetRepository,
  CognitiveDimension,
} from "@xue-learn/core/domain";
import { learningTargetWorkload } from "@xue-learn/core/server/cognitive-model/workload";

type Row = Readonly<Record<string, unknown>>;

const DIMENSIONS = new Set<CognitiveDimension>([
  "memory",
  "understanding",
  "application",
  "transfer",
  "fluency",
  "stability",
  "independence",
]);
const ENTITY_KINDS = new Set<AssessmentTargetEntityKind>([
  "atom",
  "concept",
  "skill",
  "competency",
]);
const IMPORTANCE = new Set<AssessmentTargetRecord["importance"]>([
  "core",
  "supporting",
  "enrichment",
]);
const DIFFICULTY = new Set<AssessmentTargetRecord["difficulty"]>([
  "easy",
  "medium",
  "hard",
]);
const COGNITIVE_LEVELS = new Set<
  AssessmentTargetRecord["targetCognitiveLevel"]
>(["remember", "understand", "apply", "analyze", "evaluate", "create"]);

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
    throw new Error(`Assessment target row is missing ${label}`);
  }
  return value;
}

function numberValue(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Assessment target row has invalid ${label}`);
  }
  return parsed;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function decodeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function criteria(value: unknown): readonly { ref: string; text: string }[] {
  const parsed = decodeJson(value);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("LearningTarget assessment criteria must be an array");
  }
  return parsed.map((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      typeof (item as { ref?: unknown }).ref !== "string" ||
      !(item as { ref: string }).ref.trim() ||
      typeof (item as { text?: unknown }).text !== "string" ||
      !(item as { text: string }).text.trim()
    ) {
      throw new Error("LearningTarget has an invalid assessment criterion");
    }
    return {
      ref: (item as { ref: string }).ref.trim(),
      text: (item as { text: string }).text.trim(),
    };
  });
}

function enumValue<T extends string>(
  value: unknown,
  values: ReadonlySet<T>,
  label: string,
): T {
  if (typeof value === "string" && values.has(value as T)) {
    return value as T;
  }
  throw new Error(`Assessment target has invalid ${label}`);
}

function qualifiedTable(em: EntityManager, table: string): string {
  const schema = em.schema ?? em.config?.getSchema();
  const quoted = `"${table.replaceAll('"', '""')}"`;
  return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}

type MappingMode = "unit" | "module" | "goal";

function buildTargets(
  rows: readonly Row[],
  mode: MappingMode,
): readonly AssessmentTargetRecord[] {
  const grouped = new Map<
    string,
    {
      target: AssessmentTargetRecord;
      requirements: AssessmentTargetRecord["requirements"][number][];
    }
  >();

  for (const row of rows) {
    const targetId = stringValue(rowValue(row, "targetId"), "targetId");
    const mappingId = rowValue(row, "mappingId");
    const key = `${targetId}:${mappingId == null ? "goal" : String(mappingId)}`;
    let current = grouped.get(key);
    if (!current) {
      const importance = enumValue(
        rowValue(row, "importance"),
        IMPORTANCE,
        "importance",
      );
      const role =
        mode === "goal"
          ? "exit"
          : stringValue(rowValue(row, "mappingRole"), "mappingRole");
      current = {
        target: {
          id: targetId,
          localRef: stringValue(
            rowValue(row, "mappingLocalRef"),
            "mappingLocalRef",
          ),
          title: stringValue(rowValue(row, "title"), "title"),
          description: stringValue(rowValue(row, "explanation"), "explanation"),
          learningObjective: stringValue(
            rowValue(row, "learningObjective"),
            "learningObjective",
          ),
          assessmentCriteria: criteria(rowValue(row, "assessmentCriteria")),
          required:
            mode === "goal"
              ? importance === "core"
              : booleanValue(rowValue(row, "mappingRequired")),
          weight:
            mode === "goal"
              ? numberValue(
                  rowValue(row, "importanceWeight"),
                  "importanceWeight",
                )
              : numberValue(rowValue(row, "mappingWeight"), "mappingWeight"),
          role,
          isEntry:
            mode === "unit"
              ? booleanValue(rowValue(row, "mappingIsEntry"))
              : role === "entry",
          isExit:
            mode === "unit"
              ? booleanValue(rowValue(row, "mappingIsExit"))
              : role === "exit",
          importance,
          importanceWeight: numberValue(
            rowValue(row, "importanceWeight"),
            "importanceWeight",
          ),
          difficulty: enumValue(
            rowValue(row, "difficulty"),
            DIFFICULTY,
            "difficulty",
          ),
          targetCognitiveLevel: enumValue(
            rowValue(row, "targetCognitiveLevel"),
            COGNITIVE_LEVELS,
            "targetCognitiveLevel",
          ),
          estimatedMinutes: learningTargetWorkload({
            importance,
            difficulty: enumValue(
              rowValue(row, "difficulty"),
              DIFFICULTY,
              "difficulty",
            ),
            targetCognitiveLevel: enumValue(
              rowValue(row, "targetCognitiveLevel"),
              COGNITIVE_LEVELS,
              "targetCognitiveLevel",
            ),
          }).teachingMinutes,
          requirements: [],
        },
        requirements: [],
      };
      grouped.set(key, current);
    }

    if (rowValue(row, "requirementId") == null) {
      throw new Error(
        `LearningTarget ${targetId} has no cognitive requirements`,
      );
    }
    const entityKind = enumValue(
      rowValue(row, "entityKind"),
      ENTITY_KINDS,
      "entityKind",
    );
    const dimension = enumValue(
      rowValue(row, "dimension"),
      DIMENSIONS,
      "dimension",
    );
    if (
      stringValue(rowValue(row, "entityStatus"), "entityStatus") !== "active"
    ) {
      throw new Error(
        `LearningTarget ${targetId} has an inactive cognitive requirement`,
      );
    }
    current.requirements.push({
      cognitiveEntityId: stringValue(
        rowValue(row, "cognitiveEntityId"),
        "cognitiveEntityId",
      ),
      entityKind,
      entityDefinitionVersion: numberValue(
        rowValue(row, "entityDefinitionVersion"),
        "entityDefinitionVersion",
      ),
      dimension,
      required: booleanValue(rowValue(row, "requirementRequired")),
      gate: booleanValue(rowValue(row, "requirementGate")),
      weight: numberValue(
        rowValue(row, "requirementWeight"),
        "requirementWeight",
      ),
      threshold: numberValue(
        rowValue(row, "requirementThreshold"),
        "requirementThreshold",
      ),
    });
  }

  return [...grouped.values()].map(({ target, requirements }) => ({
    ...target,
    requirements,
  }));
}

/** Raw SQL read adapter for learner-owned assessment target bindings. */
export class MikroOrmAssessmentTargetRepository implements AssessmentTargetRepository {
  constructor(private readonly em: EntityManager) {}

  private execute(sql: string, params: unknown[] = []) {
    return this.em.getConnection().execute(sql, params);
  }

  private async assertOwned(
    table: "LearningGoal" | "LearningModule" | "LearningUnit",
    id: string,
    userId: string,
  ): Promise<void> {
    const row = resultRows(
      await this.execute(
        `SELECT x."id"
           FROM ${qualifiedTable(this.em, table)} x
           JOIN ${qualifiedTable(this.em, "LearningGoal")} g
             ON g."id" = ${table === "LearningGoal" ? 'x."id"' : 'x."goalId"'}
          WHERE x."id" = ? AND g."userId" = ?`,
        [id, userId],
      ),
    )[0];
    if (!row) throw new Error(`${table.replace("Learning", "")} not found`);
  }

  private async load(
    mode: MappingMode,
    id: string,
    userId: string,
    role?: "entry" | "exit",
  ): Promise<readonly AssessmentTargetRecord[]> {
    const target = qualifiedTable(this.em, "LearningTarget");
    const requirement = qualifiedTable(this.em, "LearningTargetRequirement");
    const entity = qualifiedTable(this.em, "CognitiveEntity");
    const common = `
      t."id" AS "targetId", t."title", t."explanation", t."learningObjective",
      t."assessmentCriteria", t."importance", t."importanceWeight",
      t."difficulty", t."targetCognitiveLevel",
      r."id" AS "requirementId", r."cognitiveEntityId",
      r."dimension", r."required" AS "requirementRequired",
      r."gate" AS "requirementGate", r."weight" AS "requirementWeight",
      r."threshold" AS "requirementThreshold",
      e."kind" AS "entityKind", e."definitionVersion" AS "entityDefinitionVersion",
      e."status" AS "entityStatus"`;
    if (mode === "unit") {
      await this.assertOwned("LearningUnit", id, userId);
      const mapping = qualifiedTable(this.em, "UnitLearningTarget");
      const rows = await this.execute(
        `SELECT m."id" AS "mappingId", m."localRef" AS "mappingLocalRef",
                m."required" AS "mappingRequired", m."weight" AS "mappingWeight",
                m."role" AS "mappingRole", m."isEntry" AS "mappingIsEntry",
                m."isExit" AS "mappingIsExit", ${common}
           FROM ${mapping} m
           JOIN ${target} t ON t."id" = m."learningTargetId"
           LEFT JOIN ${requirement} r ON r."learningTargetId" = t."id"
           LEFT JOIN ${entity} e ON e."id" = r."cognitiveEntityId"
          WHERE m."unitId" = ? AND t."status" = 'active'
          ORDER BY m."orderIndex" ASC, m."id" ASC,
                   r."orderIndex" ASC, r."id" ASC`,
        [id],
      );
      return buildTargets(resultRows(rows), mode);
    }
    if (mode === "module") {
      await this.assertOwned("LearningModule", id, userId);
      const mapping = qualifiedTable(this.em, "ModuleLearningTarget");
      const rows = await this.execute(
        `SELECT m."id" AS "mappingId", m."localRef" AS "mappingLocalRef",
                m."required" AS "mappingRequired", m."weight" AS "mappingWeight",
                m."role" AS "mappingRole", ${common}
           FROM ${mapping} m
           JOIN ${target} t ON t."id" = m."learningTargetId"
           LEFT JOIN ${requirement} r ON r."learningTargetId" = t."id"
           LEFT JOIN ${entity} e ON e."id" = r."cognitiveEntityId"
          WHERE m."moduleId" = ? AND m."role" = ? AND t."status" = 'active'
          ORDER BY m."orderIndex" ASC, m."id" ASC,
                   r."orderIndex" ASC, r."id" ASC`,
        [id, role ?? "exit"],
      );
      return buildTargets(resultRows(rows), mode);
    }
    await this.assertOwned("LearningGoal", id, userId);
    const rows = await this.execute(
      `SELECT NULL AS "mappingId", t."stableKey" AS "mappingLocalRef",
              ${common}
         FROM ${target} t
         LEFT JOIN ${requirement} r ON r."learningTargetId" = t."id"
         LEFT JOIN ${entity} e ON e."id" = r."cognitiveEntityId"
        WHERE t."goalId" = ? AND t."status" = 'active'
        ORDER BY t."stableKey" ASC, t."id" ASC,
                 r."orderIndex" ASC, r."id" ASC`,
      [id],
    );
    return buildTargets(resultRows(rows), mode);
  }

  private async repairQuizTargets(
    targets: readonly AssessmentTargetRecord[],
  ): Promise<boolean> {
    let changed = false;
    for (const target of targets) {
      if (target.requirements.some((requirement) =>
        requirement.dimension === "memory" ||
        requirement.dimension === "understanding")) continue;
      if (target.importance !== "core" && target.importance !== "supporting") continue;
      const seed = target.requirements[0];
      if (!seed) continue;
      const dimension = seed.entityKind === "atom" ? "memory" : "understanding";
      await this.execute(
        `INSERT INTO ${qualifiedTable(this.em, "LearningTargetRequirement")}
          ("id", "learningTargetId", "cognitiveEntityId", "dimension", "required",
           "threshold", "gate", "weight", "orderIndex", "rationale")
         VALUES (?, ?, ?, ?, true, ?, false, 1, ?, ?)
         ON CONFLICT ("learningTargetId", "cognitiveEntityId", "dimension") DO NOTHING`,
        [randomUUID(), target.id, seed.cognitiveEntityId, dimension,
         seed.threshold, target.requirements.length,
         "Server repair: selected-response evidence dimension for legacy performance-only LearningTarget"],
      );
      changed = true;
    }
    return changed;
  }

  async ensureQuizAssessableForUnit(input: { userId: string; unitId: string }) {
    let targets = await this.findForUnit(input);
    if (await this.repairQuizTargets(targets)) {
      targets = await this.findForUnit(input);
    }
    return targets;
  }

  async ensureQuizAssessableForModule(input: {
    userId: string;
    moduleId: string;
  }): Promise<readonly AssessmentTargetRecord[]> {
    let targets = await this.findForModule({
      userId: input.userId,
      moduleId: input.moduleId,
      role: "exit",
    });
    if (await this.repairQuizTargets(targets)) {
      targets = await this.findForModule({
        userId: input.userId,
        moduleId: input.moduleId,
        role: "exit",
      });
    }
    return targets;
  }

  findForUnit(input: { userId: string; unitId: string }) {
    return this.load("unit", input.unitId, input.userId);
  }

  findForModule(input: {
    userId: string;
    moduleId: string;
    role?: "entry" | "exit";
  }) {
    return this.load("module", input.moduleId, input.userId, input.role);
  }

  findForGoal(input: { userId: string; goalId: string }) {
    return this.load("goal", input.goalId, input.userId);
  }
}
