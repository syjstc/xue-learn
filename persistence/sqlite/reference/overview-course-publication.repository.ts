import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { OverviewCoursePublicationRepository, BeginOwnedOverviewCourseResult, CompleteOwnedOverviewUnitInput, CompleteOwnedOverviewUnitResult, EnsureOwnedOverviewCourseShellInput, EnsureOwnedOverviewCourseShellResult, PublishOwnedOverviewCourseInput, PublishOwnedOverviewCourseResult, } from "@xue-learn/core/domain";
import { sqlTimestampParameter } from "./date-value.ts";
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
function serializeOverviewUnitCompletionNote(raw: unknown, completedAt: Date | null): string {
    let parsed: Partial<{
        keyConcepts: unknown;
        branchIncludes: unknown;
        checkQuestion: unknown;
    }> = {};
    if (typeof raw === "string" && raw.trim()) {
        try {
            const candidate = JSON.parse(raw) as unknown;
            if (candidate && typeof candidate === "object") {
                parsed = candidate as typeof parsed;
            }
        }
        catch {
            parsed = {};
        }
    }
    return JSON.stringify({
        keyConcepts: Array.isArray(parsed.keyConcepts) ? parsed.keyConcepts : [],
        branchIncludes: Array.isArray(parsed.branchIncludes)
            ? parsed.branchIncludes
            : [],
        checkQuestion: typeof parsed.checkQuestion === "string" ? parsed.checkQuestion : "",
        completedAt: completedAt?.toISOString() ?? null,
    });
}
/** Transaction-neutral owner-scoped overview-course publication adapter. */
export class MikroOrmOverviewCoursePublicationRepository implements OverviewCoursePublicationRepository {
    constructor(private readonly em: EntityManager) { }
    async beginOwnedOverviewCourse(userId: string, goalId: string): Promise<BeginOwnedOverviewCourseResult> {
        const connection = this.em.getConnection();
        const execute = (sql: string, params: unknown[] = []) => connection.execute(sql, params, undefined, this.em.getTransactionContext());
        const lock = "";
        const result = await execute(`SELECT "id"
         FROM ${qualifiedTable(this.em, "LearningGoal")}
        WHERE "id" = ? AND "userId" = ?${lock}`, [goalId, userId]);
        if (!resultRows(result)[0])
            return { status: "not_found" };
        await execute(`UPDATE ${qualifiedTable(this.em, "LearningGoal")}
          SET "overviewCourseStatus" = 'pending',
              "updatedAt" = ?
        WHERE "id" = ? AND "userId" = ?`, [sqlTimestampParameter(false, new Date()), goalId, userId]);
        return { status: "started" };
    }
    async ensureOwnedOverviewCourseShell(input: EnsureOwnedOverviewCourseShellInput): Promise<EnsureOwnedOverviewCourseShellResult> {
        const connection = this.em.getConnection();
        const execute = (sql: string, params: unknown[] = []) => connection.execute(sql, params, undefined, this.em.getTransactionContext());
        const goalTable = qualifiedTable(this.em, "LearningGoal");
        const unitTable = qualifiedTable(this.em, "LearningUnit");
        const lock = "";
        const goal = resultRows(await execute(`SELECT "id"
           FROM ${goalTable}
          WHERE "id" = ? AND "userId" = ?${lock}`, [input.goalId, input.userId]))[0];
        if (!goal || rowValue(goal, "id") !== input.goalId) {
            return { status: "not_found" };
        }
        const existing = resultRows(await execute(`SELECT "id", "title"
           FROM ${unitTable}
          WHERE "goalId" = ? AND "unitKind" = 'overview'${lock}
          ORDER BY "orderIndex" ASC, "id" ASC
          LIMIT 1`, [input.goalId]))[0];
        const existingId = existing ? rowValue(existing, "id") : undefined;
        if (typeof existingId === "string" && existingId.length > 0) {
            if (stringValue(rowValue(existing, "title")) !== input.title) {
                await execute(`UPDATE ${unitTable}
              SET "title" = ?
            WHERE "id" = ?`, [input.title, existingId]);
                await execute(`UPDATE ${qualifiedTable(this.em, "UnitSection")}
              SET "title" = ?, "updatedAt" = ?
            WHERE "unitId" = ? AND "stableKey" = 'orientation'`, [
                    input.title,
                    sqlTimestampParameter(false, new Date()),
                    existingId,
                ]);
            }
            await execute(`UPDATE ${goalTable}
            SET "overviewCourseStatus" = 'ready',
                "updatedAt" = ?
          WHERE "id" = ? AND "userId" = ?`, [
                sqlTimestampParameter(false, new Date()),
                input.goalId,
                input.userId,
            ]);
            return { status: "ready", unitId: existingId, created: false };
        }
        const unitId = randomUUID();
        const sectionId = randomUUID();
        const now = new Date();
        await execute(`INSERT INTO ${unitTable}
        ("id", "curriculumKey", "goalId", "parentUnitId", "unitKind",
         "title", "orderIndex", "difficulty", "contentSummary",
         "prerequisites", "note", "status")
       VALUES (?, ?, ?, NULL, 'overview', ?, -1, ?, ?, '[]', ?, 'available')`, [
            unitId,
            randomUUID(),
            input.goalId,
            input.title,
            input.difficulty,
            input.contentSummary,
            input.note,
        ]);
        await execute(`INSERT INTO ${qualifiedTable(this.em, "UnitSection")}
        ("id", "unitId", "stableKey", "orderIndex", "title", "contentSummary",
         "requiredForCompletion", "assessmentAfter", "baseEstimatedMinutes",
         "componentPlan", "generationStatus", "generationError",
         "generationInputHash", "testGenerationStatus", "testGenerationError",
         "contentRevision", "contentKind", "createdAt", "updatedAt")
       VALUES (?, ?, 'orientation', 0, ?, ?, ?, ?, 8, '[]', 'pending', '',
               '', 'idle', '', 0, 'standard', ?, ?)`, [
            sectionId,
            unitId,
            input.title,
            input.contentSummary,
            1,
            0,
            sqlTimestampParameter(false, now),
            sqlTimestampParameter(false, now),
        ]);
        const assignments = ["\"overviewCourseStatus\" = 'ready'"];
        const goalParams: unknown[] = [];
        const topicOverview = input.topicOverview?.trim();
        if (topicOverview) {
            assignments.push('"topicOverview" = ?');
            goalParams.push(topicOverview);
        }
        assignments.push('"updatedAt" = ?');
        goalParams.push(sqlTimestampParameter(false, now), input.goalId, input.userId);
        await execute(`UPDATE ${goalTable}
          SET ${assignments.join(", ")}
        WHERE "id" = ? AND "userId" = ?`, goalParams);
        return { status: "ready", unitId, created: true };
    }
    async publishOwnedOverviewCourse(input: PublishOwnedOverviewCourseInput): Promise<PublishOwnedOverviewCourseResult> {
        const connection = this.em.getConnection();
        const execute = (sql: string, params: unknown[] = []) => connection.execute(sql, params, undefined, this.em.getTransactionContext());
        const goalTable = qualifiedTable(this.em, "LearningGoal");
        const unitTable = qualifiedTable(this.em, "LearningUnit");
        const materialTable = qualifiedTable(this.em, "LearningMaterial");
        const lock = "";
        const goal = resultRows(await execute(`SELECT "id"
           FROM ${goalTable}
          WHERE "id" = ? AND "userId" = ?${lock}`, [input.goalId, input.userId]))[0];
        if (!goal || rowValue(goal, "id") !== input.goalId) {
            return { status: "not_found" };
        }
        const existingOverview = resultRows(await execute(`SELECT "id"
           FROM ${unitTable}
          WHERE "goalId" = ? AND "unitKind" = 'overview'${lock}`, [input.goalId]))
            .map((row) => rowValue(row, "id"))
            .filter((id): id is string => typeof id === "string" && id.length > 0);
        if (existingOverview.length > 0) {
            const placeholders = existingOverview.map(() => "?").join(", ");
            const sectionRows = resultRows(await execute(`SELECT "id"
             FROM ${qualifiedTable(this.em, "MainCourseSection")}
            WHERE "unitId" IN (${placeholders})`, existingOverview));
            const sectionIds = sectionRows
                .map((row) => rowValue(row, "id"))
                .filter((id): id is string => typeof id === "string" && id.length > 0);
            if (sectionIds.length > 0) {
                const sectionPlaceholders = sectionIds.map(() => "?").join(", ");
                await execute(`DELETE FROM ${qualifiedTable(this.em, "UnitSectionMaterial")}
            WHERE "sectionId" IN (${sectionPlaceholders})`, sectionIds);
                await execute(`DELETE FROM ${qualifiedTable(this.em, "UnitSectionDerivation")}
            WHERE "sectionId" IN (${sectionPlaceholders})`, sectionIds);
                await execute(`DELETE FROM ${qualifiedTable(this.em, "UnitSectionTeachingDerivation")}
            WHERE "sectionId" IN (${sectionPlaceholders})`, sectionIds);
                await execute(`DELETE FROM ${qualifiedTable(this.em, "TeachingDerivationRun")}
            WHERE "sectionId" IN (${sectionPlaceholders})`, sectionIds);
                await execute(`DELETE FROM ${qualifiedTable(this.em, "UnitSectionProgress")}
            WHERE "sectionId" IN (${sectionPlaceholders})`, sectionIds);
                await execute(`DELETE FROM ${qualifiedTable(this.em, "UnitSection")}
            WHERE "id" IN (${sectionPlaceholders})`, sectionIds);
            }
            await execute(`DELETE FROM ${materialTable}
          WHERE "unitId" IN (${placeholders})`, existingOverview);
            await execute(`DELETE FROM ${unitTable}
          WHERE "id" IN (${placeholders})`, existingOverview);
        }
        const unitId = randomUUID();
        const sectionId = randomUUID();
        const now = new Date();
        await execute(`INSERT INTO ${unitTable}
        ("id", "curriculumKey", "goalId", "parentUnitId", "unitKind",
         "title", "orderIndex", "difficulty", "contentSummary",
         "prerequisites", "note", "status")
       VALUES (?, ?, ?, NULL, 'overview', ?, -1, ?, ?, '[]', ?, 'available')`, [
            unitId,
            randomUUID(),
            input.goalId,
            input.title,
            input.difficulty,
            input.contentSummary,
            input.note,
        ]);
        await execute(`INSERT INTO ${materialTable}
        ("id", "unitId", "introduction", "sections", "keyTakeaways",
         "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, ?, ?, ?)`, [
            randomUUID(),
            unitId,
            input.material.introduction,
            input.material.sections,
            input.material.keyTakeaways,
            sqlTimestampParameter(false, now),
            sqlTimestampParameter(false, now),
        ]);
        await execute(`INSERT INTO ${qualifiedTable(this.em, "UnitSection")}
        ("id", "unitId", "stableKey", "orderIndex", "title", "contentSummary",
         "requiredForCompletion", "assessmentAfter", "baseEstimatedMinutes",
         "componentPlan", "generationStatus", "generationError",
         "generationInputHash", "testGenerationStatus", "testGenerationError",
         "contentRevision", "contentKind", "createdAt", "updatedAt")
       VALUES (?, ?, 'orientation', 0, ?, ?, ?, ?, 8, '[]', 'ready', '',
               '', 'idle', '', 1, 'standard', ?, ?)`, [
            sectionId,
            unitId,
            input.title,
            input.contentSummary,
            1,
            0,
            sqlTimestampParameter(false, now),
            sqlTimestampParameter(false, now),
        ]);
        await execute(`INSERT INTO ${qualifiedTable(this.em, "UnitSectionMaterial")}
        ("id", "sectionId", "introduction", "blocks", "keyTakeaways",
         "contextSources", "sourceItems", "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, ?, '', '[]', ?, ?)`, [
            randomUUID(),
            sectionId,
            input.material.introduction,
            input.material.sections,
            input.material.keyTakeaways,
            sqlTimestampParameter(false, now),
            sqlTimestampParameter(false, now),
        ]);
        await execute(`UPDATE ${unitTable} SET "contentRevision" = 1 WHERE "id" = ?`, [unitId]);
        const assignments = ["\"overviewCourseStatus\" = 'ready'"];
        const goalParams: unknown[] = [];
        const topicOverview = input.topicOverview?.trim();
        if (topicOverview) {
            assignments.push('"topicOverview" = ?');
            goalParams.push(topicOverview);
        }
        assignments.push('"updatedAt" = ?');
        goalParams.push(sqlTimestampParameter(false, now), input.goalId, input.userId);
        await execute(`UPDATE ${goalTable}
          SET ${assignments.join(", ")}
        WHERE "id" = ? AND "userId" = ?`, goalParams);
        return { status: "published", unitId };
    }
    async completeOwnedOverviewUnit(input: CompleteOwnedOverviewUnitInput): Promise<CompleteOwnedOverviewUnitResult> {
        const connection = this.em.getConnection();
        const execute = (sql: string, params: unknown[] = []) => connection.execute(sql, params, undefined, this.em.getTransactionContext());
        const unit = resultRows(await execute(`SELECT u."note"
           FROM ${qualifiedTable(this.em, "LearningUnit")} u
           JOIN ${qualifiedTable(this.em, "LearningGoal")} g
             ON g."id" = u."goalId"
          WHERE u."id" = ? AND u."goalId" = ? AND u."unitKind" = 'overview'
            AND g."userId" = ?${""}`, [input.unitId, input.goalId, input.userId]))[0];
        if (!unit)
            return { status: "not_found" };
        await execute(`UPDATE ${qualifiedTable(this.em, "LearningUnit")}
          SET "status" = ?, "note" = ?
        WHERE "id" = ? AND "goalId" = ? AND "unitKind" = 'overview'`, [
            input.completedAt ? "completed" : "available",
            serializeOverviewUnitCompletionNote(rowValue(unit, "note"), input.completedAt),
            input.unitId,
            input.goalId,
        ]);
        const updated = resultRows(await execute(`SELECT u."id", u."title", u."contentSummary", u."note", u."orderIndex", u."status",
                m."introduction", m."sections", m."keyTakeaways", m."id" AS "materialId"
           FROM ${qualifiedTable(this.em, "LearningUnit")} u
           LEFT JOIN ${qualifiedTable(this.em, "LearningMaterial")} m
             ON m."unitId" = u."id"
          WHERE u."id" = ? AND u."goalId" = ? AND u."unitKind" = 'overview'
          LIMIT 1`, [input.unitId, input.goalId]))[0];
        if (!updated)
            return { status: "not_found" };
        return {
            status: "updated",
            unit: {
                id: stringValue(rowValue(updated, "id")),
                title: stringValue(rowValue(updated, "title")),
                contentSummary: stringValue(rowValue(updated, "contentSummary")),
                note: stringValue(rowValue(updated, "note")),
                orderIndex: Number(rowValue(updated, "orderIndex") ?? 0),
                status: stringValue(rowValue(updated, "status")),
                learningMaterial: rowValue(updated, "materialId")
                    ? {
                        introduction: stringValue(rowValue(updated, "introduction")),
                        sections: stringValue(rowValue(updated, "sections")),
                        keyTakeaways: stringValue(rowValue(updated, "keyTakeaways")),
                    }
                    : null,
            },
        };
    }
    async updateOwnedOverviewMaterial(input: {
        userId: string;
        goalId: string;
        unitId: string;
        material: {
            introduction: string;
            sections: string;
            keyTakeaways: string;
        };
    }) {
        const owned = resultRows(await this.em.getConnection().execute(`SELECT u."id" FROM ${qualifiedTable(this.em, "LearningUnit")} u
          JOIN ${qualifiedTable(this.em, "LearningGoal")} g ON g."id" = u."goalId"
         WHERE u."id" = ? AND u."goalId" = ? AND u."unitKind" = 'overview' AND g."userId" = ? LIMIT 1`, [input.unitId, input.goalId, input.userId]))[0];
        if (!owned)
            return { status: "not_found" as const };
        await this.em.getConnection().execute(`UPDATE ${qualifiedTable(this.em, "LearningMaterial")}
          SET "introduction" = ?, "sections" = ?, "keyTakeaways" = ?
        WHERE "unitId" = ?`, [
            input.material.introduction,
            input.material.sections,
            input.material.keyTakeaways,
            input.unitId,
        ]);
        return { status: "updated" as const };
    }
}
