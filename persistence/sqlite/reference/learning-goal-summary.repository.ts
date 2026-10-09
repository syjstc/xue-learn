import type { EntityManager } from "@mikro-orm/core";
import type { BeginOwnedLearningGoalSummaryResult, LearningGoalSummaryApprovalResult, LearningGoalSummaryContext, LearningGoalSummaryMutationResult, LearningGoalSummaryRepository, PublishOwnedLearningGoalSummaryInput, UpdateOwnedLearningGoalSummaryInput, } from "@xue-learn/core/source/libs/domain/src/index.ts";
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
function qualifiedTable(em: EntityManager, table: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${table.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
async function unitCount(em: EntityManager, goalId: string): Promise<number> {
    const result = await em.getConnection().execute(`SELECT COUNT(*) AS "count"
       FROM ${qualifiedTable(em, "LearningUnit")}
      WHERE "goalId" = ?`, [goalId]);
    const row = resultRows(result)[0];
    return Number(row ? rowValue(row, "count") : 0);
}
/** Transaction-neutral owner-scoped summary mutation adapter. */
export class MikroOrmLearningGoalSummaryRepository implements LearningGoalSummaryRepository {
    constructor(private readonly em: EntityManager) { }
    private async findOwned(em: EntityManager, userId: string, goalId: string): Promise<ValueRow | undefined> {
        const lock = "";
        const result = await em.getConnection().execute(`SELECT "id", "title", "topicOverview", "mapSummaryJson", "mapSummaryStatus"
         FROM ${qualifiedTable(em, "LearningGoal")}
        WHERE "id" = ? AND "userId" = ?
        ${lock}`, [goalId, userId]);
        return resultRows(result)[0];
    }
    async findOwnedContext(userId: string, goalId: string): Promise<LearningGoalSummaryContext | null> {
        const goal = resultRows(await this.em.getConnection().execute(`SELECT "id", "userId", "title", "level", "contentLanguage", "generationOptions",
                "goalKind", "topicOverview", "mapSummaryJson", "mapSummaryStatus"
           FROM ${qualifiedTable(this.em, "LearningGoal")}
          WHERE "id" = ? AND "userId" = ?
          LIMIT 1`, [goalId, userId]))[0];
        if (!goal)
            return null;
        const count = await unitCount(this.em, goalId);
        const units = resultRows(await this.em.getConnection().execute(`SELECT "id", "unitKind"
           FROM ${qualifiedTable(this.em, "LearningUnit")}
          WHERE "goalId" = ? AND "unitKind" IN ('lesson', 'overview')
          ORDER BY "orderIndex" ASC, "id" ASC
          LIMIT 1`, [goalId]));
        const first = units[0];
        return {
            id: stringValue(rowValue(goal, "id")),
            userId: stringValue(rowValue(goal, "userId")),
            title: stringValue(rowValue(goal, "title")),
            level: stringValue(rowValue(goal, "level")),
            contentLanguage: stringValue(rowValue(goal, "contentLanguage")),
            generationOptions: stringValue(rowValue(goal, "generationOptions")),
            goalKind: stringValue(rowValue(goal, "goalKind")),
            topicOverview: stringValue(rowValue(goal, "topicOverview")),
            mapSummaryJson: stringValue(rowValue(goal, "mapSummaryJson")),
            mapSummaryStatus: stringValue(rowValue(goal, "mapSummaryStatus")),
            unitCount: count,
            firstUnit: first
                ? {
                    id: stringValue(rowValue(first, "id")),
                    unitKind: stringValue(rowValue(first, "unitKind")),
                }
                : null,
        };
    }
    async beginOwnedSummary(userId: string, goalId: string, pathSource: string): Promise<BeginOwnedLearningGoalSummaryResult> {
        const goal = await this.findOwned(this.em, userId, goalId);
        if (!goal)
            return { status: "not_found" };
        if ((await unitCount(this.em, goalId)) > 0) {
            return { status: "locked" };
        }
        await this.em.getConnection().execute(`UPDATE ${qualifiedTable(this.em, "LearningGoal")}
          SET "pathSource" = ?,
              "mapSummaryStatus" = 'pending',
              "updatedAt" = ?
        WHERE "id" = ? AND "userId" = ?`, [pathSource, new Date(), goalId, userId]);
        return { status: "started" };
    }
    async updateOwnedSummary(input: UpdateOwnedLearningGoalSummaryInput): Promise<LearningGoalSummaryMutationResult> {
        const goal = await this.findOwned(this.em, input.userId, input.goalId);
        if (!goal)
            return { status: "not_found" };
        if ((await unitCount(this.em, input.goalId)) > 0) {
            return { status: "locked" };
        }
        await this.em.getConnection().execute(`UPDATE ${qualifiedTable(this.em, "LearningGoal")}
          SET "title" = ?,
              "topicOverview" = ?,
              "mapSummaryJson" = ?,
              "mapSummaryStatus" = 'ready',
              "updatedAt" = ?
        WHERE "id" = ? AND "userId" = ?`, [
            input.title,
            input.topicOverview,
            input.mapSummaryJson,
            new Date(),
            input.goalId,
            input.userId,
        ]);
        return {
            status: "updated",
            summary: {
                goalId: input.goalId,
                title: input.title,
                topicOverview: input.topicOverview,
                mapSummaryJson: input.mapSummaryJson,
                mapSummaryStatus: "ready",
            },
        };
    }
    async approveOwnedSummary(userId: string, goalId: string): Promise<LearningGoalSummaryApprovalResult> {
        const goal = await this.findOwned(this.em, userId, goalId);
        if (!goal)
            return { status: "not_found" };
        if ((await unitCount(this.em, goalId)) > 0) {
            return { status: "locked" };
        }
        const mapSummaryJson = stringValue(rowValue(goal, "mapSummaryJson"));
        if (!mapSummaryJson.trim() || mapSummaryJson.trim() === "{}") {
            return { status: "summary_required" };
        }
        await this.em.getConnection().execute(`UPDATE ${qualifiedTable(this.em, "LearningGoal")}
          SET "mapSummaryStatus" = 'approved',
              "updatedAt" = ?
        WHERE "id" = ? AND "userId" = ?`, [new Date(), goalId, userId]);
        return { status: "approved" };
    }
    async publishOwnedSummary(input: PublishOwnedLearningGoalSummaryInput): Promise<LearningGoalSummaryMutationResult> {
        const goal = await this.findOwned(this.em, input.userId, input.goalId);
        if (!goal)
            return { status: "not_found" };
        if ((await unitCount(this.em, input.goalId)) > 0) {
            return { status: "locked" };
        }
        const assignments = [
            '"title" = ?',
            '"topicOverview" = ?',
            '"mapSummaryJson" = ?',
            "\"mapSummaryStatus\" = 'ready'",
            '"pathSource" = ?',
        ];
        const params: unknown[] = [
            input.title,
            input.topicOverview,
            input.mapSummaryJson,
            input.pathSource,
        ];
        if (input.contentLanguage !== undefined) {
            assignments.push('"contentLanguage" = ?');
            params.push(input.contentLanguage);
        }
        if (input.resetIcon) {
            assignments.push("\"iconSvg\" = ''", "\"iconTint\" = ''");
        }
        assignments.push('"updatedAt" = ?');
        params.push(new Date(), input.goalId, input.userId);
        await this.em.getConnection().execute(`UPDATE ${qualifiedTable(this.em, "LearningGoal")}
          SET ${assignments.join(", ")}
        WHERE "id" = ? AND "userId" = ?`, params);
        return {
            status: "updated",
            summary: {
                goalId: input.goalId,
                title: input.title,
                topicOverview: input.topicOverview,
                mapSummaryJson: input.mapSummaryJson,
                mapSummaryStatus: "ready",
            },
        };
    }
}
