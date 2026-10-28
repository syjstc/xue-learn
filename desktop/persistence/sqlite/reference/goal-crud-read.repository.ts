import type { EntityManager } from "@mikro-orm/core";
import type { GoalCrudReadRepository } from "@xue-learn/core/domain";
import { nullableReferenceDateValue, referenceDateValue } from "./date-value.ts";

type Row = Record<string, any>;
const rows = (result: unknown): Row[] =>
  Array.isArray(result)
    ? (result as Row[])
    : result &&
        typeof result === "object" &&
        "rows" in result &&
        Array.isArray((result as { rows?: unknown }).rows)
      ? (result as { rows: Row[] }).rows
      : [];
const table = (em: EntityManager, name: string) => {
  const schema = em.schema ?? em.config?.getSchema();
  const quoted = `"${name.replaceAll('"', '""')}"`;
  return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
};
const json = (value: unknown) =>
  typeof value === "string"
    ? (() => {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      })()
    : value;
const dates = (row: Row) => ({
  ...row,
  createdAt:
    row.createdAt == null ? row.createdAt : referenceDateValue(row.createdAt),
  updatedAt:
    row.updatedAt == null ? row.updatedAt : referenceDateValue(row.updatedAt),
  completedAt: nullableReferenceDateValue(row.completedAt),
  skippedAt: nullableReferenceDateValue(row.skippedAt),
});

export class MikroOrmGoalCrudReadRepository implements GoalCrudReadRepository {
  constructor(private readonly em: EntityManager) {}
  private execute(sql: string, params: unknown[] = []) {
    return this.em
      .getConnection()
      .execute(sql, params, undefined, this.em.getTransactionContext());
  }
  async listFoundationGoals(userId: string, parentGoalId: string) {
    const goals = rows(
      await this.execute(
        `SELECT * FROM ${table(this.em, "LearningGoal")} WHERE "userId"=? AND "parentGoalId"=? AND "goalRelationType"='foundation_support' ORDER BY "createdAt" ASC`,
        [userId, parentGoalId],
      ),
    );
    return Promise.all(
      goals.map(async (goal) => ({
        ...dates(goal),
        goalRelationContextJson: json(goal.goalRelationContextJson),
        units: rows(
          await this.execute(
            `SELECT "status" FROM ${table(this.em, "LearningUnit")} WHERE "goalId"=? AND "requiredForModuleCompletion"=?`,
            [goal.id, true],
          ),
        ),
        modules: rows(
          await this.execute(
            `SELECT "unlockStatus" FROM ${table(this.em, "LearningModule")} WHERE "goalId"=?`,
            [goal.id],
          ),
        ),
      })),
    );
  }
  async listOwnedOverview(userId: string) {
    const goals: Row[] = rows(
      await this.execute(
        `SELECT g.*,(SELECT COUNT(*) FROM ${table(this.em, "UploadedDocument")} d WHERE d."goalId"=g."id") AS "documentCount" FROM ${table(this.em, "LearningGoal")} g WHERE g."userId"=?`,
        [userId],
      ),
    ).map((goal): Row => ({
      ...dates(goal),
      _count: { documents: Number(goal.documentCount ?? 0) },
    }));
    const ids = goals.map((goal) => goal.id);
    if (!ids.length)
      return { goals, units: [], modules: [], pendingShares: [] };
    const p = ids.map(() => "?").join(",");
    const units = rows(
      await this.execute(
        `SELECT u."id",u."title",u."goalId",u."moduleId",u."status",u."unitKind",u."parentUnitId",u."orderIndex",s."currentStep",m."unlockStatus",m."generationStatus" FROM ${table(this.em, "LearningUnit")} u LEFT JOIN ${table(this.em, "UnitSessionState")} s ON s."unitId"=u."id" LEFT JOIN ${table(this.em, "LearningModule")} m ON m."id"=u."moduleId" WHERE u."goalId" IN (${p})`,
        ids,
      ),
    ).map((unit) => ({
      ...unit,
      sessionState:
        unit.currentStep == null ? null : { currentStep: unit.currentStep },
      module:
        unit.moduleId == null
          ? null
          : {
              unlockStatus: unit.unlockStatus,
              generationStatus: unit.generationStatus,
            },
    }));
    const modules = rows(
      await this.execute(
        `SELECT "id","goalId","orderIndex","unlockStatus","generationStatus" FROM ${table(this.em, "LearningModule")} WHERE "goalId" IN (${p}) ORDER BY "orderIndex" ASC`,
        ids,
      ),
    );
    const pendingShares: Row[] = [];
    return { goals, units, modules, pendingShares };
  }
  async findDetail(userId: string, goalId: string) {
    const goal = rows(
      await this.execute(
        `SELECT g.*,p."id" AS "parentId",p."title" AS "parentTitle" FROM ${table(this.em, "LearningGoal")} g LEFT JOIN ${table(this.em, "LearningGoal")} p ON p."id"=g."parentGoalId" AND p."userId"=? WHERE g."id"=? AND g."userId"=? LIMIT 1`,
        [userId, goalId, userId],
      ),
    )[0];
    if (!goal) return null;
    const documents = rows(
      await this.execute(
        `SELECT "id","filename","createdAt","sourceType","sourceUrl","canonicalUrl","provider","title","warning","subtitleStatus","storageKey","contentHash","contentType","byteSize" FROM ${table(this.em, "UploadedDocument")} WHERE "goalId"=? ORDER BY "createdAt" DESC`,
        [goalId],
      ),
    ).map((document) => ({
      ...document,
      createdAt: new Date(document.createdAt),
    }));
    const units = rows(
      await this.execute(
        `SELECT u.*,s."currentStep",s."sq3rData",s."graphState",s."cumulativeActiveSeconds",s."updatedAt" AS "sessionUpdatedAt",lm."id" AS "materialId",lm."sections",lm."introduction",lm."keyTakeaways",r."nextReviewAt",r."intervalDays",m."unlockStatus",m."generationStatus" FROM ${table(this.em, "LearningUnit")} u LEFT JOIN ${table(this.em, "UnitSessionState")} s ON s."unitId"=u."id" LEFT JOIN ${table(this.em, "LearningMaterial")} lm ON lm."unitId"=u."id" LEFT JOIN ${table(this.em, "ReviewCard")} r ON r."unitId"=u."id" LEFT JOIN ${table(this.em, "LearningModule")} m ON m."id"=u."moduleId" WHERE u."goalId"=? ORDER BY u."orderIndex" ASC`,
        [goalId],
      ),
    ).map((unit) => ({
      ...dates(unit),
      prerequisites: unit.prerequisites,
      moduleCapabilityRefs: json(unit.moduleCapabilityRefs),
      sessionState:
        unit.currentStep == null &&
        unit.sq3rData == null &&
        unit.graphState == null
          ? null
          : {
              currentStep: unit.currentStep,
              sq3rData: unit.sq3rData,
              graphState: unit.graphState,
              cumulativeActiveSeconds: Number(
                unit.cumulativeActiveSeconds ?? 0,
              ),
              updatedAt: unit.sessionUpdatedAt
                ? new Date(unit.sessionUpdatedAt)
                : undefined,
            },
      learningMaterial: unit.materialId
        ? {
            id: unit.materialId,
            sections: unit.sections,
            introduction: unit.introduction,
            keyTakeaways: unit.keyTakeaways,
          }
        : null,
      reviewCard:
        unit.nextReviewAt == null && unit.intervalDays == null
          ? null
          : {
              nextReviewAt: unit.nextReviewAt
                ? new Date(unit.nextReviewAt)
                : null,
              intervalDays: unit.intervalDays,
            },
      module: unit.moduleId
        ? {
            unlockStatus: unit.unlockStatus,
            generationStatus: unit.generationStatus,
          }
        : null,
    }));
    const creationSession = rows(
      await this.execute(
        `SELECT "id","status","phase","firstUnitId","updatedAt" FROM ${table(this.em, "GoalCreationSession")} WHERE "goalId"=? LIMIT 1`,
        [goalId],
      ),
    )[0];
    return {
      ...dates(goal),
      documents,
      units,
      creationSession: creationSession
        ? { ...creationSession, updatedAt: new Date(creationSession.updatedAt) }
        : null,
      parentGoal: goal.parentId
        ? { id: goal.parentId, title: goal.parentTitle }
        : null,
    };
  }
  async findCognitiveStatus(userId: string, goalId: string) {
    const row = rows(
      await this.execute(
        `SELECT g."learningMode",g."cognitiveModelStatus",g."cognitiveModelVersion",g."curriculumVersion",EXISTS(SELECT 1 FROM ${table(this.em, "LearningModule")} m WHERE m."goalId"=g."id" AND m."generationStatus"='building') AS "hasBuildingModule" FROM ${table(this.em, "LearningGoal")} g WHERE g."id"=? AND g."userId"=? LIMIT 1`,
        [goalId, userId],
      ),
    )[0];
    return row
      ? { ...row, modules: row.hasBuildingModule ? [{ id: "building" }] : [] }
      : null;
  }
}
