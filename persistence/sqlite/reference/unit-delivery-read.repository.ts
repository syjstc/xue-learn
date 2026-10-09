import type { EntityManager } from "@mikro-orm/core";
import type {
  UnitDeliveryAccessRecord,
  UnitDeliveryContentRecord,
  UnitDeliveryPageRecord,
  UnitDeliveryReadRepository,
  UnitDeliverySessionRecord,
  UnitScenarioContentReadRecord,
  UnitScenarioSessionReadRecord,
  UnitLabContentReadRecord,
  UnitLabSessionReadRecord,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import { nullableReferenceDateValue, referenceDateValue } from "./date-value.ts";

type Row = Readonly<Record<string, unknown>>;
const rows = (value: unknown): readonly Row[] =>
  Array.isArray(value)
    ? (value as Row[])
    : value &&
        typeof value === "object" &&
        "rows" in value &&
        Array.isArray((value as { rows?: unknown }).rows)
      ? (value as { rows: Row[] }).rows
      : [];
const nullable = (value: unknown): string | null =>
  value == null ? null : String(value);
const json = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};
const date = (value: unknown): Date =>
  referenceDateValue(value, "unit delivery date");
const bool = (value: unknown): boolean =>
  value === true || value === 1 || value === "1" || value === "true";
const table = (em: EntityManager, name: string): string => {
  const schema = em.schema ?? em.config?.getSchema();
  const quoted = `"${name.replaceAll('"', '""')}"`;
  return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
};

export class MikroOrmUnitDeliveryReadRepository implements UnitDeliveryReadRepository {
  constructor(private readonly em: EntityManager) {}
  private execute(sql: string, params: unknown[] = []) {
    return this.em
      .getConnection()
      .execute(sql, params, undefined, this.em.getTransactionContext());
  }

  async findPage(input: {
    userId: string;
    unitId: string;
  }): Promise<UnitDeliveryPageRecord | null> {
    const unit = table(this.em, "LearningUnit");
    const goal = table(this.em, "LearningGoal");
    const session = table(this.em, "UnitSessionState");
    const decomposition = table(this.em, "UnitDecomposition");
    const found = rows(
      await this.execute(
        `WITH RECURSIVE ancestors("id", "parentUnitId", "depth") AS (
      SELECT "id", "parentUnitId", 0 FROM ${unit} WHERE "id" = ?
      UNION ALL
      SELECT parent."id", parent."parentUnitId", ancestors."depth" + 1
      FROM ${unit} parent JOIN ancestors ON parent."id" = ancestors."parentUnitId"
    )
    SELECT u."id", u."title", u."goalId", u."parentUnitId", u."contentSummary", u."difficulty", u."unitKind", u."status", u."completionMethod",
      s."currentStep", d."stepsJson" AS "decompositionSteps",
      (SELECT COUNT(*) FROM ${unit} child WHERE child."parentUnitId" = u."id") AS "childCount",
      (SELECT MAX("depth") FROM ancestors) AS "depth",
      g."title" AS "goalTitle", g."goalKind", g."learningMode", g."domainTag", g."contentLanguage", g."level", g."generationOptions", g."topicCategory", g."mapPlanJson", g."cognitiveModelInputHash", g."userId"
    FROM ${unit} u JOIN ${goal} g ON g."id" = u."goalId"
    LEFT JOIN ${session} s ON s."unitId" = u."id"
    LEFT JOIN ${decomposition} d ON d."unitId" = u."id"
    WHERE u."id" = ? AND g."userId" = ? LIMIT 1`,
        [input.unitId, input.unitId, input.userId],
      ),
    );
    const row = found[0];
    if (!row) return null;
    return {
      id: String(row.id),
      title: String(row.title),
      goalId: String(row.goalId),
      parentUnitId: nullable(row.parentUnitId),
      contentSummary: String(row.contentSummary ?? ""),
      difficulty: String(row.difficulty ?? "medium"),
      unitKind: String(row.unitKind),
      status: String(row.status),
      completionMethod: nullable(row.completionMethod),
      currentStep: nullable(row.currentStep),
      decompositionSteps: row.decompositionSteps ?? [],
      childCount: Number(row.childCount ?? 0),
      depth: Number(row.depth ?? 0),
      goalTitle: String(row.goalTitle),
      goalKind: String(row.goalKind),
      learningMode: String(row.learningMode),
      domainTag: String(row.domainTag ?? ""),
      contentLanguage: String(row.contentLanguage ?? ""),
      level: String(row.level ?? "zero"),
      generationOptions: String(row.generationOptions ?? "{}"),
      topicCategory: String(row.topicCategory ?? "general"),
      mapPlanJson: String(row.mapPlanJson ?? "{}"),
      cognitiveModelInputHash: String(row.cognitiveModelInputHash ?? ""),
      userId: String(row.userId),
    };
  }

  async findLearningAccess(input: {
    userId: string;
    unitId: string;
  }): Promise<UnitDeliveryAccessRecord | null> {
    const found = rows(
      await this.execute(
        `SELECT u."id", u."goalId", u."cognitiveModelStatus", u."cognitiveModelBuildInputHash",
      g."goalKind", g."learningMode", g."cognitiveModelStatus" AS "goalCognitiveModelStatus",
      g."cognitiveModelInputHash" AS "goalCognitiveModelInputHash", g."cognitiveModelPublishedHash" AS "goalCognitiveModelPublishedHash",
      m."unlockStatus" AS "moduleUnlockStatus", m."generationStatus" AS "moduleGenerationStatus",
      (SELECT COUNT(*) FROM ${table(this.em, "UnitLearningTarget")} target WHERE target."unitId" = u."id") AS "canonicalTargetCount",
      (EXISTS (SELECT 1 FROM ${table(this.em, "LearningMaterial")} material WHERE material."unitId" = u."id")
        OR EXISTS (SELECT 1 FROM ${table(this.em, "UnitSessionState")} state WHERE state."unitId" = u."id" AND state."sq3rData" <> '')) AS "hasCanonicalContent"
      FROM ${table(this.em, "LearningUnit")} u
      JOIN ${table(this.em, "LearningGoal")} g ON g."id" = u."goalId"
      LEFT JOIN ${table(this.em, "LearningModule")} m ON m."id" = u."moduleId"
      WHERE u."id" = ? AND g."userId" = ? LIMIT 1`,
        [input.unitId, input.userId],
      ),
    );
    const row = found[0];
    if (!row) return null;
    return {
      id: String(row.id),
      goalId: String(row.goalId),
      cognitiveModelStatus: String(row.cognitiveModelStatus),
      cognitiveModelBuildInputHash: nullable(row.cognitiveModelBuildInputHash),
      goalKind: String(row.goalKind),
      learningMode: String(row.learningMode),
      goalCognitiveModelStatus: String(row.goalCognitiveModelStatus),
      goalCognitiveModelInputHash: String(
        row.goalCognitiveModelInputHash ?? "",
      ),
      goalCognitiveModelPublishedHash: nullable(
        row.goalCognitiveModelPublishedHash,
      ),
      moduleUnlockStatus: nullable(row.moduleUnlockStatus),
      moduleGenerationStatus: nullable(row.moduleGenerationStatus),
      canonicalTargetCount: Number(row.canonicalTargetCount ?? 0),
      hasCanonicalContent: bool(row.hasCanonicalContent),
    };
  }

  async findContent(input: {
    userId: string;
    unitId: string;
  }): Promise<UnitDeliveryContentRecord | null> {
    const found = rows(
      await this.execute(
        `SELECT u."id", u."goalId", u."contentRevision", g."contentLanguage", g."title" AS "goalTitle",
      state."sq3rData", state."graphState", decomposition."stepsJson" AS "decompositionSteps",
      material."introduction", material."sections", material."keyTakeaways", material."contextSources"
      FROM ${table(this.em, "LearningUnit")} u JOIN ${table(this.em, "LearningGoal")} g ON g."id" = u."goalId"
      LEFT JOIN ${table(this.em, "UnitSessionState")} state ON state."unitId" = u."id"
      LEFT JOIN ${table(this.em, "UnitDecomposition")} decomposition ON decomposition."unitId" = u."id"
      LEFT JOIN ${table(this.em, "LearningMaterial")} material ON material."unitId" = u."id"
      WHERE u."id" = ? AND g."userId" = ? LIMIT 1`,
        [input.unitId, input.userId],
      ),
    );
    const row = found[0];
    if (!row) return null;
    return {
      id: String(row.id),
      goalId: String(row.goalId),
      contentRevision: Number(row.contentRevision ?? 0),
      contentLanguage: String(row.contentLanguage ?? ""),
      goalTitle: String(row.goalTitle),
      sq3rData: nullable(row.sq3rData),
      graphState: nullable(row.graphState),
      decompositionSteps: row.decompositionSteps ?? [],
      learningMaterial:
        row.introduction == null
          ? null
          : {
              introduction: String(row.introduction),
              sections: String(row.sections),
              keyTakeaways: String(row.keyTakeaways),
              contextSources: String(row.contextSources),
            },
    };
  }

  async findSession(input: {
    userId: string;
    unitId: string;
  }): Promise<UnitDeliverySessionRecord | null> {
    const access = await this.findLearningAccess(input);
    if (!access) return null;
    const found = rows(
      await this.execute(
        `SELECT u."status", u."contentRevision", g."title" AS "goalTitle", g."contentLanguage", g."teachingPersonaRef", g."pathSource",
      state."currentStep", state."structuredSubStep", state."graphState", state."sq3rData",
      material."introduction", material."sections", material."keyTakeaways", material."contextSources",
      note."notes", note."cues", note."summary"
      FROM ${table(this.em, "LearningUnit")} u JOIN ${table(this.em, "LearningGoal")} g ON g."id" = u."goalId"
      LEFT JOIN ${table(this.em, "UnitSessionState")} state ON state."unitId" = u."id"
      LEFT JOIN ${table(this.em, "LearningMaterial")} material ON material."unitId" = u."id"
      LEFT JOIN ${table(this.em, "CornellNote")} note ON note."unitId" = u."id"
      WHERE u."id" = ? AND g."userId" = ? LIMIT 1`,
        [input.unitId, input.userId],
      ),
    );
    const row = found[0];
    if (!row) return null;
    return {
      access,
      status: String(row.status),
      contentRevision: Number(row.contentRevision ?? 0),
      goalTitle: String(row.goalTitle),
      contentLanguage: String(row.contentLanguage ?? ""),
      teachingPersonaRef: nullable(row.teachingPersonaRef),
      pathSource: String(row.pathSource ?? ""),
      session:
        row.currentStep == null
          ? null
          : {
              currentStep: String(row.currentStep),
              structuredSubStep: String(row.structuredSubStep ?? "sq"),
              graphState: String(row.graphState ?? "{}"),
              sq3rData: String(row.sq3rData ?? ""),
            },
      learningMaterial:
        row.introduction == null
          ? null
          : {
              introduction: String(row.introduction),
              sections: String(row.sections),
              keyTakeaways: String(row.keyTakeaways),
              contextSources: String(row.contextSources),
            },
      cornellNote:
        row.notes == null
          ? null
          : {
              notes: String(row.notes),
              cues: String(row.cues),
              summary: String(row.summary),
            },
    };
  }

  async listMaterialCheckAttempts(input: {
    userId: string;
    unitId: string;
    stableKeyPrefixes: readonly string[];
  }) {
    if (input.stableKeyPrefixes.length === 0) return [];
    const found = rows(
      await this.execute(
        `SELECT attempt."response", attempt."submittedAt", task."stableKey"
      FROM ${table(this.em, "TaskAttempt")} attempt JOIN ${table(this.em, "LearningTask")} task ON task."id" = attempt."taskId"
      WHERE attempt."userId" = ? AND attempt."unitId" = ? AND attempt."status" = 'evaluated'
        AND task."origin" = 'material_check' AND task."status" = 'active'
      ORDER BY attempt."submittedAt" ASC, attempt."id" ASC`,
        [input.userId, input.unitId],
      ),
    );
    return found
      .filter((row) =>
        input.stableKeyPrefixes.some(
          (prefix) =>
            String(row.stableKey) === prefix ||
            String(row.stableKey).startsWith(`${prefix}:v`),
        ),
      )
      .map((row) => ({
        response: row.response,
        submittedAt: row.submittedAt == null ? null : date(row.submittedAt),
      }));
  }

  async findScenarioContent(input: {
    userId: string;
    unitId: string;
  }): Promise<UnitScenarioContentReadRecord | null> {
    const found = rows(
      await this.execute(
        `SELECT g."id" AS "goalId", theater."status", theater."recommended", theater."recommendation", theater."revision", theater."definitionJson", theater."generationError"
      FROM ${table(this.em, "LearningUnit")} unit JOIN ${table(this.em, "LearningGoal")} g ON g."id" = unit."goalId"
      JOIN ${table(this.em, "UnitScenarioTheater")} theater ON theater."unitId" = unit."id"
      WHERE unit."id" = ? AND g."userId" = ? LIMIT 1`,
        [input.unitId, input.userId],
      ),
    );
    const row = found[0];
    return row
      ? {
          goalId: String(row.goalId),
          status: String(row.status),
          recommended: bool(row.recommended),
          recommendation: String(row.recommendation ?? ""),
          revision: Number(row.revision),
          definitionJson: json(row.definitionJson),
          generationError: String(row.generationError ?? ""),
        }
      : null;
  }

  async findScenarioSession(input: {
    userId: string;
    unitId: string;
  }): Promise<UnitScenarioSessionReadRecord | null> {
    const theaters = rows(
      await this.execute(
        `SELECT theater."id", theater."status", theater."revision" FROM ${table(this.em, "UnitScenarioTheater")} theater
      JOIN ${table(this.em, "LearningUnit")} unit ON unit."id" = theater."unitId" JOIN ${table(this.em, "LearningGoal")} goal ON goal."id" = unit."goalId"
      WHERE unit."id" = ? AND goal."userId" = ? LIMIT 1`,
        [input.unitId, input.userId],
      ),
    );
    const theater = theaters[0];
    if (!theater) return null;
    const active = rows(
      await this.execute(
        `SELECT * FROM ${table(this.em, "ScenarioTheaterRun")} WHERE "userId" = ? AND "unitId" = ? AND "theaterRevision" = ? AND "status" = 'active' ORDER BY "updatedAt" DESC LIMIT 1`,
        [input.userId, input.unitId, Number(theater.revision)],
      ),
    )[0];
    const completed = rows(
      await this.execute(
        `SELECT COUNT(*) AS "count" FROM ${table(this.em, "ScenarioTheaterRun")} WHERE "userId" = ? AND "unitId" = ? AND "status" = 'completed'`,
        [input.userId, input.unitId],
      ),
    )[0];
    let currentSceneStatus: string | null = null;
    if (active?.currentSceneId != null) {
      const scene = rows(
        await this.execute(
          `SELECT "status" FROM ${table(this.em, "ScenarioTheaterScene")} WHERE "theaterId" = ? AND "theaterRevision" = ? AND "sceneId" = ? LIMIT 1`,
          [
            String(theater.id),
            Number(theater.revision),
            String(active.currentSceneId),
          ],
        ),
      )[0];
      currentSceneStatus = String(scene?.status ?? "ready");
    }
    return {
      status: String(theater.status),
      revision: Number(theater.revision),
      completedOnce: Number(completed?.count ?? 0) > 0,
      currentSceneStatus,
      activeRun: active
        ? {
            id: String(active.id),
            theaterRevision: Number(active.theaterRevision),
            runVersion: Number(active.runVersion),
            status: String(active.status),
            currentSceneId: nullable(active.currentSceneId),
            metersJson: active.metersJson,
            pathJson: active.pathJson,
            endingId: nullable(active.endingId),
            startedAt: referenceDateValue(
              active.startedAt,
              "scenario theater run startedAt",
            ),
            completedAt: nullableReferenceDateValue(
              active.completedAt,
              "scenario theater run completedAt",
            ),
          }
        : null,
    };
  }

  async findLabContent(input: {
    userId: string;
    unitId: string;
  }): Promise<UnitLabContentReadRecord | null> {
    const found = rows(
      await this.execute(
        `SELECT g."id" AS "goalId", lab."status", lab."recommended", lab."recommendation", lab."revision", lab."definitionJson", lab."generationError"
      FROM ${table(this.em, "LearningUnit")} unit JOIN ${table(this.em, "LearningGoal")} g ON g."id" = unit."goalId"
      JOIN ${table(this.em, "UnitLab")} lab ON lab."unitId" = unit."id"
      WHERE unit."id" = ? AND g."userId" = ? LIMIT 1`,
        [input.unitId, input.userId],
      ),
    );
    const row = found[0];
    return row
      ? {
          goalId: String(row.goalId),
          status: String(row.status),
          recommended: bool(row.recommended),
          recommendation: String(row.recommendation ?? ""),
          revision: Number(row.revision),
          definitionJson: json(row.definitionJson),
          generationError: String(row.generationError ?? ""),
        }
      : null;
  }

  async findLabSession(input: {
    userId: string;
    unitId: string;
  }): Promise<UnitLabSessionReadRecord | null> {
    const labs = rows(
      await this.execute(
        `SELECT lab."id", lab."status", lab."revision" FROM ${table(this.em, "UnitLab")} lab
      JOIN ${table(this.em, "LearningUnit")} unit ON unit."id" = lab."unitId" JOIN ${table(this.em, "LearningGoal")} goal ON goal."id" = unit."goalId"
      WHERE unit."id" = ? AND goal."userId" = ? LIMIT 1`,
        [input.unitId, input.userId],
      ),
    );
    const lab = labs[0];
    if (!lab) return null;
    const visit = rows(
      await this.execute(
        `SELECT "status","completedAt" FROM ${table(this.em, "UnitLabVisit")} WHERE "userId" = ? AND "unitId" = ? LIMIT 1`,
        [input.userId, input.unitId],
      ),
    )[0];
    return {
      status: String(lab.status),
      revision: Number(lab.revision),
      openedOnce: Boolean(visit),
      completedOnce: Boolean(visit?.completedAt),
    };
  }
}
