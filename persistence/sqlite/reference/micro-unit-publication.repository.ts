import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { BeginOwnedMicroGoalConversionInput, BeginOwnedMicroGoalConversionResult, MicroUnitPublicationRepository, OwnedMicroGoalConversionContext, OwnedMicroUnitCreationContext, PublishOwnedMicroUnitInput, PublishOwnedMicroUnitResult, RestoreOwnedMicroGoalInput, RestoreOwnedMicroGoalResult, UpgradeOwnedOverviewToLessonInput, UpgradeOwnedOverviewToLessonResult, } from "@xue-learn/core/source/libs/domain/src/index.ts";
type ValueRow = Readonly<Record<string, unknown>>;
function resultRows(result: unknown): readonly ValueRow[] {
    if (Array.isArray(result))
        return result as ValueRow[];
    if (result && typeof result === "object" && "rows" in result) {
        const rows = (result as {
            rows?: unknown;
        }).rows;
        return Array.isArray(rows) ? (rows as ValueRow[]) : [];
    }
    return [];
}
function qualifiedTable(em: EntityManager, table: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${table.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
/** Transaction-neutral owner-scoped micro-unit publication adapter. */
export class MikroOrmMicroUnitPublicationRepository implements MicroUnitPublicationRepository {
    constructor(private readonly em: EntityManager) { }
    private execute(sql: string, params: unknown[] = []) {
        return this.em
            .getConnection()
            .execute(sql, params, undefined, this.em.getTransactionContext());
    }
    async findOwnedCreationContext(userId: string, goalId: string): Promise<OwnedMicroUnitCreationContext | null> {
        const found = resultRows(await this.execute(`SELECT g."id" AS "goalId", g."userId", g."title" AS "goalTitle", g."level", g."contentLanguage", g."generationOptions",
              u."id" AS "unitId", u."title" AS "unitTitle", u."contentSummary", u."unitKind", s."sq3rData",
              CASE WHEN m."unitId" IS NULL THEN 0 ELSE 1 END AS "hasLearningMaterial"
         FROM ${qualifiedTable(this.em, "LearningGoal")} g
         LEFT JOIN ${qualifiedTable(this.em, "LearningUnit")} u ON u."id" = (SELECT x."id" FROM ${qualifiedTable(this.em, "LearningUnit")} x WHERE x."goalId" = g."id" AND x."unitKind" IN ('lesson','overview') ORDER BY x."orderIndex" ASC LIMIT 1)
         LEFT JOIN ${qualifiedTable(this.em, "UnitSessionState")} s ON s."unitId" = u."id"
         LEFT JOIN ${qualifiedTable(this.em, "LearningMaterial")} m ON m."unitId" = u."id"
        WHERE g."id" = ? AND g."userId" = ? LIMIT 1`, [goalId, userId]))[0];
        if (!found)
            return null;
        return { goal: { id: String(found.goalId), userId: String(found.userId), title: String(found.goalTitle), level: String(found.level), contentLanguage: String(found.contentLanguage), generationOptions: String(found.generationOptions) }, unit: found.unitId == null ? null : { id: String(found.unitId), title: String(found.unitTitle), contentSummary: String(found.contentSummary ?? found.unitTitle), unitKind: String(found.unitKind), sq3rData: found.sq3rData == null ? null : String(found.sq3rData), hasLearningMaterial: Boolean(Number(found.hasLearningMaterial)) } };
    }
    async findOwnedConversionContext(userId: string, goalId: string): Promise<OwnedMicroGoalConversionContext | null> {
        const result = resultRows(await this.execute(`SELECT g."id" AS "goalId", g."userId", g."title" AS "goalTitle",
                g."level", g."contentLanguage", g."generationOptions",
                g."topicOverview", g."mapPlanStatus", g."detailedPlanStatus",
                u."id" AS "unitId", u."title" AS "unitTitle",
                u."contentSummary", u."unitKind", u."difficulty",
                u."prerequisites", u."status",
                (SELECT COUNT(*) FROM ${qualifiedTable(this.em, "LearningUnit")} c
                  WHERE c."parentUnitId" = u."id") AS "childCount"
           FROM ${qualifiedTable(this.em, "LearningGoal")} g
           JOIN ${qualifiedTable(this.em, "LearningUnit")} u ON u."goalId" = g."id"
          WHERE g."id" = ? AND g."userId" = ? AND g."goalKind" = 'micro'
            AND u."unitKind" IN ('lesson', 'overview')
          ORDER BY u."orderIndex" ASC LIMIT 1`, [goalId, userId]))[0];
        if (!result)
            return null;
        const text = (key: string) => String(result[key] ?? "");
        return {
            goal: {
                id: text("goalId"),
                userId: text("userId"),
                title: text("goalTitle"),
                level: text("level"),
                contentLanguage: text("contentLanguage"),
                generationOptions: text("generationOptions"),
                topicOverview: text("topicOverview"),
                mapPlanStatus: text("mapPlanStatus"),
                detailedPlanStatus: text("detailedPlanStatus"),
            },
            unit: {
                id: text("unitId"),
                title: text("unitTitle"),
                contentSummary: result.contentSummary == null ? null : text("contentSummary"),
                unitKind: text("unitKind"),
                difficulty: text("difficulty"),
                prerequisites: text("prerequisites"),
                status: text("status"),
                childCount: Number(result.childCount) || 0,
            },
        };
    }
    async publishOwnedMicroUnit(input: PublishOwnedMicroUnitInput): Promise<PublishOwnedMicroUnitResult> {
        const goalTable = qualifiedTable(this.em, "LearningGoal");
        const unitTable = qualifiedTable(this.em, "LearningUnit");
        const lock = "";
        const goal = resultRows(await this.execute(`SELECT "id"
           FROM ${goalTable}
          WHERE "id" = ? AND "userId" = ?${lock}`, [input.goalId, input.userId]))[0];
        if (!goal)
            return { status: "not_found" };
        const now = new Date();
        await this.execute(`UPDATE ${goalTable}
          SET "title" = ?,
              "contentLanguage" = ?,
              "topicOverview" = ?,
              "pathSource" = ?,
              "mapSummaryStatus" = 'skipped',
              "mapPlanStatus" = 'skipped',
              "detailedPlanStatus" = 'skipped',
              "updatedAt" = ?
        WHERE "id" = ? AND "userId" = ?`, [
            input.goalTitle,
            input.contentLanguage,
            input.topicOverview,
            input.pathSource,
            now,
            input.goalId,
            input.userId,
        ]);
        const unitId = randomUUID();
        await this.execute(`INSERT INTO ${unitTable}
        ("id", "curriculumKey", "goalId", "parentUnitId", "unitKind",
         "title", "orderIndex", "difficulty", "contentSummary",
         "prerequisites", "status")
       VALUES (?, ?, ?, NULL, 'lesson', ?, 0, ?, ?, '[]', 'available')`, [
            unitId,
            randomUUID(),
            input.goalId,
            input.unitTitle,
            input.difficulty,
            input.contentSummary,
        ]);
        return { status: "published", unitId, title: input.unitTitle, contentSummary: input.contentSummary };
    }
    async upgradeOwnedOverviewToLesson(input: UpgradeOwnedOverviewToLessonInput): Promise<UpgradeOwnedOverviewToLessonResult> {
        const goalTable = qualifiedTable(this.em, "LearningGoal");
        const unitTable = qualifiedTable(this.em, "LearningUnit");
        const materialTable = qualifiedTable(this.em, "LearningMaterial");
        const lock = "";
        const goal = resultRows(await this.execute(`SELECT "id"
           FROM ${goalTable}
          WHERE "id" = ? AND "userId" = ?${lock}`, [input.goalId, input.userId]))[0];
        if (!goal)
            return { status: "not_found" };
        const unit = resultRows(await this.execute(`SELECT "id"
           FROM ${unitTable}
          WHERE "id" = ? AND "goalId" = ? AND "unitKind" = 'overview'${lock}`, [input.unitId, input.goalId]))[0];
        if (!unit)
            return { status: "not_found" };
        await this.execute(`DELETE FROM ${materialTable}
        WHERE "unitId" = ?`, [input.unitId]);
        await this.execute(`UPDATE ${unitTable}
          SET "unitKind" = 'lesson',
              "title" = ?,
              "orderIndex" = 0,
              "note" = '',
              "status" = 'available',
              "completionMethod" = NULL,
              "completionAttemptId" = NULL,
              "completedAt" = NULL,
              "skippedAt" = NULL,
              "contentRevision" = "contentRevision" + 1
        WHERE "id" = ? AND "goalId" = ? AND "unitKind" = 'overview'`, [input.title, input.unitId, input.goalId]);
        await this.execute(`UPDATE ${goalTable}
          SET "overviewCourseStatus" = 'skipped',
              "updatedAt" = ?
        WHERE "id" = ? AND "userId" = ?`, [new Date(), input.goalId, input.userId]);
        return { status: "upgraded", unitId: input.unitId };
    }
    async beginOwnedMicroGoalConversion(input: BeginOwnedMicroGoalConversionInput): Promise<BeginOwnedMicroGoalConversionResult> {
        const goalTable = qualifiedTable(this.em, "LearningGoal");
        const lock = "";
        const goal = resultRows(await this.execute(`SELECT "id"
           FROM ${goalTable}
          WHERE "id" = ? AND "userId" = ?${lock}`, [input.goalId, input.userId]))[0];
        if (!goal)
            return { status: "not_found" };
        await this.execute(`UPDATE ${goalTable}
          SET "goalKind" = 'full',
              "mapPlanStatus" = 'pending',
              "detailedPlanStatus" = 'stale',
              "title" = ?,
              "contentLanguage" = COALESCE(?, "contentLanguage"),
              "updatedAt" = ?
        WHERE "id" = ? AND "userId" = ?`, [
            input.title,
            input.contentLanguage ?? null,
            new Date(),
            input.goalId,
            input.userId,
        ]);
        return { status: "started" };
    }
    async restoreOwnedMicroGoal(input: RestoreOwnedMicroGoalInput): Promise<RestoreOwnedMicroGoalResult> {
        const goalTable = qualifiedTable(this.em, "LearningGoal");
        const unitTable = qualifiedTable(this.em, "LearningUnit");
        const lock = "";
        const goal = resultRows(await this.execute(`SELECT "id"
           FROM ${goalTable}
          WHERE "id" = ? AND "userId" = ?${lock}`, [input.goalId, input.userId]))[0];
        if (!goal)
            return { status: "not_found" };
        const existingUnit = resultRows(await this.execute(`SELECT "id"
           FROM ${unitTable}
          WHERE "id" = ? AND "goalId" = ?${lock}`, [input.unitId, input.goalId]))[0];
        if (!existingUnit) {
            await this.execute(`DELETE FROM ${unitTable} WHERE "goalId" = ?`, [
                input.goalId,
            ]);
            await this.execute(`INSERT INTO ${unitTable}
          ("id", "curriculumKey", "goalId", "parentUnitId", "unitKind",
           "title", "orderIndex", "difficulty", "contentSummary",
           "prerequisites", "status")
         VALUES (?, ?, ?, NULL, ?, ?, 0, ?, ?, ?, ?)`, [
                input.unitId,
                randomUUID(),
                input.goalId,
                input.originalUnit.unitKind,
                input.originalUnit.title,
                input.originalUnit.difficulty,
                input.originalUnit.contentSummary,
                input.originalUnit.prerequisites,
                input.originalUnit.status,
            ]);
        }
        const assignments = [
            "\"goalKind\" = 'micro'",
            '"mapPlanStatus" = ?',
            '"detailedPlanStatus" = ?',
            '"title" = ?',
        ];
        const params: unknown[] = [
            input.mapPlanStatus,
            input.detailedPlanStatus,
            input.title,
        ];
        if (input.restoreContentLanguage) {
            assignments.push('"contentLanguage" = ?');
            params.push(input.contentLanguage ?? null);
        }
        assignments.push('"updatedAt" = ?');
        params.push(new Date(), input.goalId, input.userId);
        await this.execute(`UPDATE ${goalTable}
          SET ${assignments.join(", ")}
        WHERE "id" = ? AND "userId" = ?`, params);
        return { status: "restored", unitId: input.unitId };
    }
}
