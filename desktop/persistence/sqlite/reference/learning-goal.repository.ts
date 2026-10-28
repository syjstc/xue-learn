import type { EntityManager } from "@mikro-orm/core";
import type {
  CreateLearningGoalInput,
  LearningGoalRecord,
  LearningGoalRepository,
  LastLearnedUnitRecord,
  UpdateLearningGoalInput,
} from "@xue-learn/core/domain";
import { LearningGoalEntity } from "./learning-goal.entity.ts";
import { UserEntity } from "./user.entity.ts";
import { referenceDateValue } from "./date-value.ts";

function relationId(
  value: LearningGoalEntity | UserEntity | string | null,
): string | null {
  if (value === null || typeof value === "string") return value;
  return value.id;
}

function toRecord(entity: LearningGoalEntity): LearningGoalRecord {
  return {
    id: entity.id,
    userId: relationId(entity.user),
    parentGoalId: relationId(entity.parentGoal),
    title: entity.title,
    level: entity.level,
    domainTag: entity.domainTag,
    topicCategory: entity.topicCategory,
    contentLanguage: entity.contentLanguage,
    teachingPersonaRef: entity.teachingPersonaRef,
    generationOptions: entity.generationOptions,
    goalKind: entity.goalKind,
    learningMode: entity.learningMode,
    learningModeTransitionStatus: entity.learningModeTransitionStatus,
    learningModeTransitionToken: entity.learningModeTransitionToken,
    learningModeTransitionStartedAt: entity.learningModeTransitionStartedAt,
    learningModeTransitionError: entity.learningModeTransitionError,
    learningModeTransitionArtifacts: entity.learningModeTransitionArtifacts,
    planningMode: entity.planningMode,
    curriculumVersion: entity.curriculumVersion,
    status: entity.status,
    pathSource: entity.pathSource,
    topicOverview: entity.topicOverview,
    mapSummaryJson: entity.mapSummaryJson,
    mapSummaryStatus: entity.mapSummaryStatus,
    mapPlanJson: entity.mapPlanJson,
    mapPlanStatus: entity.mapPlanStatus,
    detailedPlanStatus: entity.detailedPlanStatus,
    cognitiveModelEnabled: entity.cognitiveModelEnabled,
    cognitiveModelStatus: entity.cognitiveModelStatus,
    cognitiveModelVersion: entity.cognitiveModelVersion,
    cognitiveModelInputHash: entity.cognitiveModelInputHash,
    cognitiveModelPublishedHash: entity.cognitiveModelPublishedHash,
    iconSvg: entity.iconSvg,
    iconTint: entity.iconTint,
    goalRelationType: entity.goalRelationType,
    goalRelationContextJson: entity.goalRelationContextJson,
    overviewCourseStatus: entity.overviewCourseStatus,
    shareVisibility: entity.shareVisibility,
    activeShareId: entity.activeShareId,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

export class MikroOrmLearningGoalRepository implements LearningGoalRepository {
  constructor(private readonly em: EntityManager) {}

  private userReference(userId: string) {
    return typeof this.em.getReference === "function"
      ? this.em.getReference(UserEntity, userId)
      : userId;
  }

  private parentReference(goalId: string) {
    return typeof this.em.getReference === "function"
      ? this.em.getReference(LearningGoalEntity, goalId)
      : goalId;
  }

  async listLastLearnedUnits(
    goalIds: readonly string[],
  ): Promise<readonly LastLearnedUnitRecord[]> {
    if (goalIds.length === 0) return [];
    const schema = this.em.schema ?? this.em.config?.getSchema();
    const table = (name: string) => {
      const quoted = `"${name.replaceAll('"', '""')}"`;
      return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
    };
    const result = await this.em.getConnection().execute(
      `SELECT "goalId", "id", "title", "status", "updatedAt" FROM (
         SELECT u."goalId", u."id", u."title", u."status", s."updatedAt",
                ROW_NUMBER() OVER (PARTITION BY u."goalId" ORDER BY s."updatedAt" DESC, u."id" ASC) AS "rank"
           FROM ${table("LearningUnit")} u
           JOIN ${table("UnitSessionState")} s ON s."unitId" = u."id"
          WHERE u."goalId" IN (${goalIds.map(() => "?").join(",")})
            AND u."unitKind" = 'lesson'
       ) ranked WHERE "rank" = 1`,
      [...goalIds],
    );
    const rows = Array.isArray(result)
      ? (result as ReadonlyArray<Record<string, unknown>>)
      : [];
    const value = (row: Record<string, unknown>, key: string) =>
      row[key] ?? row[key[0]!.toLowerCase() + key.slice(1)];
    return rows.map((row) => ({
      goalId: String(value(row, "goalId")),
      id: String(value(row, "id")),
      title: String(value(row, "title")),
      status: String(value(row, "status")),
      updatedAt: referenceDateValue(value(row, "updatedAt"), "unit updatedAt"),
    }));
  }

  async sumLearningSecondsByGoalIds(goalIds: readonly string[]) {
    if (goalIds.length === 0) return new Map<string, number>();
    const schema = this.em.schema ?? this.em.config?.getSchema();
    const table = (name: string) => {
      const quoted = `"${name.replaceAll('"', '""')}"`;
      return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
    };
    const result = await this.em.getConnection().execute(
      `SELECT u."goalId", COALESCE(SUM(CASE WHEN s."cumulativeActiveSeconds" > 0 THEN s."cumulativeActiveSeconds" ELSE 0 END), 0) AS "totalLearningSeconds"
         FROM ${table("LearningUnit")} u
         JOIN ${table("UnitSessionState")} s ON s."unitId" = u."id"
        WHERE u."goalId" IN (${goalIds.map(() => "?").join(",")})
        GROUP BY u."goalId"`,
      [...goalIds],
    );
    const rows = Array.isArray(result)
      ? (result as ReadonlyArray<Record<string, unknown>>)
      : [];
    const value = (row: Record<string, unknown>, key: string) =>
      row[key] ?? row[key[0]!.toLowerCase() + key.slice(1)];
    return new Map(
      rows.map((row) => [
        String(value(row, "goalId")),
        Number(value(row, "totalLearningSeconds")),
      ]),
    );
  }

  async listOwned(userId: string): Promise<readonly LearningGoalRecord[]> {
    const entities = await this.em.find(
      LearningGoalEntity,
      { user: this.userReference(userId) },
      { orderBy: { updatedAt: "desc" } },
    );
    return entities.map(toRecord);
  }

  async findOwnedById(
    userId: string,
    goalId: string,
  ): Promise<LearningGoalRecord | null> {
    const entity = await this.em.findOne(LearningGoalEntity, {
      id: goalId,
      user: this.userReference(userId),
    });
    return entity ? toRecord(entity) : null;
  }

  async create(input: CreateLearningGoalInput): Promise<LearningGoalRecord> {
    const { userId, parentGoalId, ...scalar } = input;
    const entity = Object.assign(new LearningGoalEntity(), scalar, {
      user: userId ?? null,
      parentGoal: parentGoalId ?? null,
    });
    this.em.persist(entity);
    await this.em.flush();
    return toRecord(entity);
  }

  async updateOwned(
    userId: string,
    goalId: string,
    patch: UpdateLearningGoalInput,
  ): Promise<LearningGoalRecord | null> {
    const entity = await this.em.findOne(LearningGoalEntity, {
      id: goalId,
      user: this.userReference(userId),
    });
    if (!entity) return null;
    const { parentGoalId, ...scalar } = patch;
    Object.assign(entity, scalar);
    if (parentGoalId !== undefined) {
      entity.parentGoal =
        parentGoalId === null ? null : this.parentReference(parentGoalId);
    }
    await this.em.flush();
    return toRecord(entity);
  }

  async deleteOwned(userId: string, goalId: string): Promise<boolean> {
    const deleted = await this.em.nativeDelete(LearningGoalEntity, {
      id: goalId,
      user: this.userReference(userId),
    });
    return deleted > 0;
  }
}
