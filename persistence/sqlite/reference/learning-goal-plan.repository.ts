import type { EntityManager } from "@mikro-orm/core";
import type { BeginOwnedLearningGoalPlanResult, BeginOwnedLearningGoalDetailedPlanRefreshResult, LearningGoalDetailedPlanFailureResult, LearningGoalPlanApprovalResult, LearningGoalPlanContext, LearningGoalPlanMutationResult, LearningGoalPlanRepository, LearningGoalPlanRecord, LearningGoalPlanningModeMutationResult, PublishOwnedLearningGoalDetailedPlanInput, PublishOwnedLearningGoalPlanInput, UpdateOwnedLearningGoalPlanInput, } from "@xue-learn/core/domain";
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
function rowValue(row: ValueRow, key: string): unknown {
    return row[key] ?? row[key[0]?.toLowerCase() + key.slice(1)];
}
function stringValue(value: unknown): string {
    return typeof value === "string" ? value : "";
}
function nullableStringValue(value: unknown): string | null {
    return typeof value === "string" ? value : null;
}
function booleanValue(value: unknown): boolean {
    return value === true || value === 1 || value === "1";
}
function jsonValue(value: unknown): unknown {
    if (typeof value !== "string")
        return value;
    try {
        return JSON.parse(value) as unknown;
    }
    catch {
        return value;
    }
}
function qualifiedTable(em: EntityManager, table: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${table.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
function execute(em: EntityManager, sql: string, params: unknown[] = []) {
    return em
        .getConnection()
        .execute(sql, params, undefined, em.getTransactionContext());
}
async function curriculumCount(em: EntityManager, table: string, goalId: string): Promise<number> {
    const result = await execute(em, `SELECT COUNT(*) AS "count"
       FROM ${qualifiedTable(em, table)}
      WHERE "goalId" = ?`, [goalId]);
    const row = resultRows(result)[0];
    return Number(row ? rowValue(row, "count") : 0);
}
/** Transaction-neutral owner-scoped legacy goal-plan mutation adapter. */
export class MikroOrmLearningGoalPlanRepository implements LearningGoalPlanRepository {
    constructor(private readonly em: EntityManager) { }
    async findOwnedContext(userId: string, goalId: string): Promise<LearningGoalPlanContext | null> {
        const rows = resultRows(await execute(this.em, `SELECT "id", "userId", "title", "level", "goalKind", "learningMode",
                "parentGoalId", "goalRelationType", "goalRelationContextJson",
                "planningMode", "pathSource", "contentLanguage", "generationOptions",
                "topicOverview", "mapSummaryJson", "mapSummaryStatus",
                "mapPlanJson", "mapPlanStatus", "detailedPlanStatus", "curriculumVersion",
                "cognitiveModelEnabled", "cognitiveModelInputHash"
           FROM ${qualifiedTable(this.em, "LearningGoal")}
          WHERE "id" = ? AND "userId" = ?
          LIMIT 1`, [goalId, userId]));
        const goal = rows[0];
        if (!goal)
            return null;
        const [unitCountValue, moduleCountValue, documentCountValue, boundUnits, unitRows,] = await Promise.all([
            curriculumCount(this.em, "LearningUnit", goalId),
            curriculumCount(this.em, "LearningModule", goalId),
            curriculumCount(this.em, "UploadedDocument", goalId),
            execute(this.em, `SELECT COUNT(*) AS "count"
             FROM ${qualifiedTable(this.em, "LearningUnit")}
            WHERE "goalId" = ? AND "planAreaRef" <> ''`, [goalId]),
            execute(this.em, `SELECT "id", "title", "unitKind", "difficulty", "contentSummary",
                  "orderIndex", "parentUnitId", "mapOrigin", "mapEdited"
             FROM ${qualifiedTable(this.em, "LearningUnit")}
            WHERE "goalId" = ?
            ORDER BY "orderIndex" ASC, "id" ASC`, [goalId]),
        ]);
        const boundRow = resultRows(boundUnits)[0];
        return {
            id: stringValue(rowValue(goal, "id")),
            userId: stringValue(rowValue(goal, "userId")),
            title: stringValue(rowValue(goal, "title")),
            level: stringValue(rowValue(goal, "level")),
            goalKind: stringValue(rowValue(goal, "goalKind")),
            learningMode: stringValue(rowValue(goal, "learningMode")),
            parentGoalId: nullableStringValue(rowValue(goal, "parentGoalId")),
            goalRelationType: stringValue(rowValue(goal, "goalRelationType")),
            goalRelationContextJson: jsonValue(rowValue(goal, "goalRelationContextJson")),
            planningMode: stringValue(rowValue(goal, "planningMode")),
            pathSource: stringValue(rowValue(goal, "pathSource")),
            contentLanguage: stringValue(rowValue(goal, "contentLanguage")),
            generationOptions: stringValue(rowValue(goal, "generationOptions")),
            topicOverview: stringValue(rowValue(goal, "topicOverview")),
            mapSummaryJson: stringValue(rowValue(goal, "mapSummaryJson")),
            mapSummaryStatus: stringValue(rowValue(goal, "mapSummaryStatus")),
            mapPlanJson: stringValue(rowValue(goal, "mapPlanJson")),
            mapPlanStatus: stringValue(rowValue(goal, "mapPlanStatus")),
            detailedPlanStatus: stringValue(rowValue(goal, "detailedPlanStatus")),
            curriculumVersion: Number(rowValue(goal, "curriculumVersion") ?? 1),
            cognitiveModelEnabled: booleanValue(rowValue(goal, "cognitiveModelEnabled")),
            cognitiveModelInputHash: nullableStringValue(rowValue(goal, "cognitiveModelInputHash")),
            unitCount: unitCountValue,
            moduleCount: moduleCountValue,
            documentCount: documentCountValue,
            boundUnitCount: Number(boundRow ? rowValue(boundRow, "count") : 0),
            units: resultRows(unitRows).map((unit) => ({
                id: stringValue(rowValue(unit, "id")),
                title: stringValue(rowValue(unit, "title")),
                unitKind: stringValue(rowValue(unit, "unitKind")),
                difficulty: stringValue(rowValue(unit, "difficulty")),
                contentSummary: stringValue(rowValue(unit, "contentSummary")),
                orderIndex: Number(rowValue(unit, "orderIndex") ?? 0),
                parentUnitId: nullableStringValue(rowValue(unit, "parentUnitId")),
                mapOrigin: stringValue(rowValue(unit, "mapOrigin")),
                mapEdited: booleanValue(rowValue(unit, "mapEdited")),
            })),
        };
    }
    async countOwnedLessons(userId: string, goalId: string): Promise<number | null> {
        if (!(await this.findOwned(userId, goalId)))
            return null;
        const rows = resultRows(await execute(this.em, `SELECT COUNT(*) AS "count"
           FROM ${qualifiedTable(this.em, "LearningUnit")}
          WHERE "goalId" = ? AND "unitKind" = 'lesson'`, [goalId]));
        return Number(rows[0] ? rowValue(rows[0], "count") : 0);
    }
    async listOwnedOverviewBranches(userId: string, goalId: string) {
        if (!(await this.findOwned(userId, goalId)))
            return [];
        const moduleRows = resultRows(await execute(this.em, `SELECT m."title", m."summary", m."objective", m."id"
           FROM ${qualifiedTable(this.em, "LearningModule")} m
          WHERE m."goalId" = ?
          ORDER BY m."orderIndex" ASC, m."id" ASC`, [goalId]));
        if (moduleRows.length > 0) {
            const lessonRows = resultRows(await execute(this.em, `SELECT "moduleId", "title", "orderIndex"
             FROM ${qualifiedTable(this.em, "LearningUnit")}
            WHERE "goalId" = ? AND "unitKind" = 'lesson' AND "moduleId" IS NOT NULL
            ORDER BY "orderIndex" ASC, "id" ASC`, [goalId]));
            const lessonsByModule = new Map<string, string[]>();
            for (const row of lessonRows) {
                const moduleId = stringValue(rowValue(row, "moduleId"));
                const title = stringValue(rowValue(row, "title"));
                if (!moduleId || !title)
                    continue;
                const list = lessonsByModule.get(moduleId) ?? [];
                list.push(title);
                lessonsByModule.set(moduleId, list);
            }
            return moduleRows.map((row) => {
                const moduleId = stringValue(rowValue(row, "id"));
                const summary = stringValue(rowValue(row, "summary"));
                const objective = stringValue(rowValue(row, "objective"));
                const lessons = lessonsByModule.get(moduleId) ?? [];
                const lessonLine = lessons.length
                    ? `Lessons: ${lessons.join(" · ")}`
                    : "";
                return {
                    title: stringValue(rowValue(row, "title")),
                    contentSummary: [summary, objective, lessonLine]
                        .map((part) => part.trim())
                        .filter(Boolean)
                        .join("\n"),
                };
            });
        }
        const rows = resultRows(await execute(this.em, `SELECT "title", "contentSummary"
           FROM ${qualifiedTable(this.em, "LearningUnit")}
          WHERE "goalId" = ?
            AND "parentUnitId" IS NULL
            AND "unitKind" IN ('branch', 'module', 'lesson')
          ORDER BY "orderIndex" ASC, "id" ASC`, [goalId]));
        return rows.map((row) => ({
            title: stringValue(rowValue(row, "title")),
            contentSummary: stringValue(rowValue(row, "contentSummary")),
        }));
    }
    async listOwnedModules(userId: string, goalId: string) {
        if (!(await this.findOwned(userId, goalId)))
            return [];
        return resultRows(await execute(this.em, `SELECT m.*
           FROM ${qualifiedTable(this.em, "LearningModule")} m
          WHERE m."goalId" = ?
          ORDER BY m."orderIndex" ASC, m."id" ASC`, [goalId])).map((row) => ({
            ...row,
            plannedOutcomes: jsonValue(rowValue(row, "plannedOutcomes")),
            entryFoundationBriefs: jsonValue(rowValue(row, "entryFoundationBriefs")),
            exitCapabilityBriefs: jsonValue(rowValue(row, "exitCapabilityBriefs")),
            unitPlanningBrief: jsonValue(rowValue(row, "unitPlanningBrief")),
        }));
    }
    private async findOwned(userId: string, goalId: string): Promise<ValueRow | undefined> {
        const lock = "";
        const result = await execute(this.em, `SELECT "id"
         FROM ${qualifiedTable(this.em, "LearningGoal")}
        WHERE "id" = ? AND "userId" = ?
        ${lock}`, [goalId, userId]);
        return resultRows(result)[0];
    }
    async beginOwnedPlan(userId: string, goalId: string, pathSource: string): Promise<BeginOwnedLearningGoalPlanResult> {
        if (!(await this.findOwned(userId, goalId))) {
            return { status: "not_found" };
        }
        await execute(this.em, `UPDATE ${qualifiedTable(this.em, "LearningGoal")}
          SET "pathSource" = ?,
              "mapPlanStatus" = 'pending',
              "updatedAt" = ?
        WHERE "id" = ? AND "userId" = ?`, [pathSource, new Date(), goalId, userId]);
        return { status: "started" };
    }
    async beginOwnedDetailedPlanRefresh(userId: string, goalId: string): Promise<BeginOwnedLearningGoalDetailedPlanRefreshResult> {
        if (!(await this.findOwned(userId, goalId))) {
            return { status: "not_found" };
        }
        await execute(this.em, `UPDATE ${qualifiedTable(this.em, "LearningGoal")}
          SET "detailedPlanStatus" = 'pending',
              "updatedAt" = ?
        WHERE "id" = ? AND "userId" = ?`, [new Date(), goalId, userId]);
        return { status: "started" };
    }
    async publishOwnedDetailedPlan(input: PublishOwnedLearningGoalDetailedPlanInput): Promise<LearningGoalPlanMutationResult> {
        if (!(await this.findOwned(input.userId, input.goalId))) {
            return { status: "not_found" };
        }
        const assignments = [
            '"topicOverview" = ?',
            '"mapPlanJson" = ?',
            "\"mapPlanStatus\" = 'ready'",
            "\"detailedPlanStatus\" = 'ready'",
        ];
        const params: unknown[] = [input.topicOverview, input.mapPlanJson];
        if (input.pathSource !== undefined) {
            assignments.push('"pathSource" = ?');
            params.push(input.pathSource);
        }
        if (input.domainTag !== undefined) {
            assignments.push('"domainTag" = ?');
            params.push(input.domainTag);
        }
        if (input.topicCategory !== undefined) {
            assignments.push('"topicCategory" = ?');
            params.push(input.topicCategory);
        }
        assignments.push('"updatedAt" = ?');
        params.push(new Date(), input.goalId, input.userId);
        await execute(this.em, `UPDATE ${qualifiedTable(this.em, "LearningGoal")}
          SET ${assignments.join(", ")}
        WHERE "id" = ? AND "userId" = ?`, params);
        return {
            status: "updated",
            plan: {
                goalId: input.goalId,
                topicOverview: input.topicOverview,
                mapPlanJson: input.mapPlanJson,
                mapPlanStatus: "ready",
            },
        };
    }
    async markOwnedDetailedPlanRefreshFailed(userId: string, goalId: string): Promise<LearningGoalDetailedPlanFailureResult> {
        if (!(await this.findOwned(userId, goalId))) {
            return { status: "not_found" };
        }
        await execute(this.em, `UPDATE ${qualifiedTable(this.em, "LearningGoal")}
          SET "detailedPlanStatus" = 'failed',
              "updatedAt" = ?
        WHERE "id" = ? AND "userId" = ?`, [new Date(), goalId, userId]);
        return { status: "updated" };
    }
    async updateOwnedPlan(input: UpdateOwnedLearningGoalPlanInput): Promise<LearningGoalPlanMutationResult> {
        const lock = "";
        const goalResult = await execute(this.em, `SELECT "id", "topicOverview", "mapPlanJson", "mapPlanStatus"
         FROM ${qualifiedTable(this.em, "LearningGoal")}
        WHERE "id" = ? AND "userId" = ?
        ${lock}`, [input.goalId, input.userId]);
        const goal = resultRows(goalResult)[0];
        if (!goal)
            return { status: "not_found" };
        const [unitCount, moduleCount] = await Promise.all([
            curriculumCount(this.em, "LearningUnit", input.goalId),
            curriculumCount(this.em, "LearningModule", input.goalId),
        ]);
        if (unitCount > 0 || moduleCount > 0) {
            return { status: "locked" };
        }
        await execute(this.em, `UPDATE ${qualifiedTable(this.em, "LearningGoal")}
          SET "topicOverview" = ?,
              "mapPlanJson" = ?,
              "mapPlanStatus" = 'ready',
              "updatedAt" = ?
        WHERE "id" = ? AND "userId" = ?`, [
            input.topicOverview,
            input.mapPlanJson,
            new Date(),
            input.goalId,
            input.userId,
        ]);
        return {
            status: "updated",
            plan: {
                goalId: input.goalId,
                topicOverview: input.topicOverview,
                mapPlanJson: input.mapPlanJson,
                mapPlanStatus: "ready",
            },
        };
    }
    async publishOwnedPlan(input: PublishOwnedLearningGoalPlanInput): Promise<LearningGoalPlanMutationResult> {
        const lock = "";
        const goalResult = await execute(this.em, `SELECT "id"
         FROM ${qualifiedTable(this.em, "LearningGoal")}
        WHERE "id" = ? AND "userId" = ?
        ${lock}`, [input.goalId, input.userId]);
        if (!resultRows(goalResult)[0])
            return { status: "not_found" };
        const [unitCount, moduleCount] = await Promise.all([
            curriculumCount(this.em, "LearningUnit", input.goalId),
            curriculumCount(this.em, "LearningModule", input.goalId),
        ]);
        if (unitCount > 0 || moduleCount > 0) {
            return { status: "locked" };
        }
        const assignments = [
            '"title" = ?',
            '"topicOverview" = ?',
            '"mapPlanJson" = ?',
            "\"mapPlanStatus\" = 'ready'",
            "\"detailedPlanStatus\" = 'ready'",
            '"pathSource" = ?',
            '"domainTag" = ?',
            '"topicCategory" = ?',
        ];
        const params: unknown[] = [
            input.title,
            input.topicOverview,
            input.mapPlanJson,
            input.pathSource,
            input.domainTag,
            input.topicCategory,
        ];
        if (input.contentLanguage !== undefined) {
            assignments.push('"contentLanguage" = ?');
            params.push(input.contentLanguage);
        }
        if (input.generationOptions !== undefined) {
            assignments.push('"generationOptions" = ?');
            params.push(input.generationOptions);
        }
        if (input.resetIcon) {
            assignments.push("\"iconSvg\" = ''", "\"iconTint\" = ''");
        }
        assignments.push('"updatedAt" = ?');
        params.push(new Date(), input.goalId, input.userId);
        await execute(this.em, `UPDATE ${qualifiedTable(this.em, "LearningGoal")}
          SET ${assignments.join(", ")}
        WHERE "id" = ? AND "userId" = ?`, params);
        return {
            status: "updated",
            plan: {
                goalId: input.goalId,
                topicOverview: input.topicOverview,
                mapPlanJson: input.mapPlanJson,
                mapPlanStatus: "ready",
            },
        };
    }
    async approveOwnedPlan(userId: string, goalId: string): Promise<LearningGoalPlanApprovalResult> {
        const lock = "";
        const goalResult = await execute(this.em, `SELECT "id", "mapPlanStatus"
         FROM ${qualifiedTable(this.em, "LearningGoal")}
        WHERE "id" = ? AND "userId" = ?
        ${lock}`, [goalId, userId]);
        const goal = resultRows(goalResult)[0];
        if (!goal)
            return { status: "not_found" };
        if (stringValue(rowValue(goal, "mapPlanStatus")) === "approved") {
            return { status: "locked" };
        }
        await execute(this.em, `UPDATE ${qualifiedTable(this.em, "LearningGoal")}
          SET "mapPlanStatus" = 'approved',
              "updatedAt" = ?
        WHERE "id" = ? AND "userId" = ?`, [new Date(), goalId, userId]);
        return { status: "approved" };
    }
    async updateOwnedPlanningMode(userId: string, goalId: string, planningMode: string): Promise<LearningGoalPlanningModeMutationResult> {
        const lock = "";
        const goalResult = await execute(this.em, `SELECT "id", "mapPlanStatus"
         FROM ${qualifiedTable(this.em, "LearningGoal")}
        WHERE "id" = ? AND "userId" = ?
        ${lock}`, [goalId, userId]);
        const goal = resultRows(goalResult)[0];
        if (!goal)
            return { status: "not_found" };
        if (stringValue(rowValue(goal, "mapPlanStatus")) === "approved") {
            return { status: "locked" };
        }
        await execute(this.em, `UPDATE ${qualifiedTable(this.em, "LearningGoal")}
          SET "planningMode" = ?,
              "updatedAt" = ?
        WHERE "id" = ? AND "userId" = ?
          AND "mapPlanStatus" <> 'approved'`, [planningMode, new Date(), goalId, userId]);
        return { status: "updated" };
    }
}
