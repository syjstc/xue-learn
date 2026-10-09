import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { DiagnosticRemediationRepository, ResolveDiagnosticRemediationInput, UpsertDiagnosticRemediationInput, } from "@xue-learn/core/domain";
import { CognitionPersistenceError } from "@xue-learn/core/server/cognition/persistence/error";
type Row = Readonly<Record<string, unknown>>;
function resultRows(result: unknown): readonly Row[] {
    if (Array.isArray(result))
        return result as Row[];
    if (result && typeof result === "object" && "rows" in result) {
        const rows = (result as {
            rows?: unknown;
        }).rows;
        return Array.isArray(rows) ? (rows as Row[]) : [];
    }
    return [];
}
function rowValue(row: Row, key: string): unknown {
    return row[key] ?? row[key[0]?.toLowerCase() + key.slice(1)];
}
function requiredString(row: Row, key: string): string {
    const value = rowValue(row, key);
    if (typeof value !== "string" || value.length === 0) {
        throw new CognitionPersistenceError("not_found", `Diagnostic remediation row is missing ${key}`);
    }
    return value;
}
function numberValue(value: unknown, fallback = 0): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function jsonText(value: unknown): string {
    if (typeof value === "string")
        return value;
    try {
        return JSON.stringify(value ?? []) ?? "[]";
    }
    catch {
        return "[]";
    }
}
function qualifiedTable(em: EntityManager, table: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${table.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
function maxDifficulty(values: readonly string[]): string {
    const rank: Record<string, number> = { easy: 0, medium: 1, hard: 2 };
    return values.reduce((hardest, value) => (rank[value] ?? 1) > (rank[hardest] ?? 1) ? value : hardest, "easy");
}
function remediationCopy(language: string, sourceTitle: string, titles: readonly string[]) {
    const targetList = titles.join("、");
    const inferredEnglish = language === "auto" &&
        !/[^\u0000-\u007f]/u.test(`${sourceTitle}${targetList}`);
    if (language === "en" || inferredEnglish) {
        return {
            title: `Targeted practice · ${sourceTitle}`,
            summary: `A focused adaptive lesson for unresolved learning targets from “${sourceTitle}”: ${titles.join(", ")}. Rebuild the missing structure, practise it in context, and gather new direct evidence.`,
        };
    }
    if (language === "zh-Hant") {
        return {
            title: `學習目標強化 · ${sourceTitle}`,
            summary: `針對「${sourceTitle}」診斷中尚未達標的學習目標進行強化：${targetList}。重建缺失結構、在情境中練習，並重新收集直接證據。`,
        };
    }
    return {
        title: `学习目标强化 · ${sourceTitle}`,
        summary: `针对“${sourceTitle}”诊断中尚未达标的学习目标进行强化：${targetList}。重建缺失结构、在情境中练习，并重新收集直接证据。`,
    };
}
/** Raw SQL adapter for the complete diagnostic-remediation write set. */
export class MikroOrmDiagnosticRemediationRepository implements DiagnosticRemediationRepository {
    constructor(private readonly em: EntityManager) { }
    private execute(sql: string, params: unknown[] = []) {
        return this.em
            .getConnection()
            .execute(sql, params, undefined, this.em.getTransactionContext());
    }
    private lockClause(): string {
        return "";
    }
    async upsert(input: UpsertDiagnosticRemediationInput): Promise<string | null> {
        const weakIds = [
            ...new Set(input.weakTargets.map((target) => target.learningTargetId)),
        ];
        if (weakIds.length === 0)
            return null;
        if (!input.userId || !input.sourceUnitId || !input.attemptId) {
            throw new CognitionPersistenceError("invalid_declaration", "Diagnostic remediation identifiers are required");
        }
        const unitTable = qualifiedTable(this.em, "LearningUnit");
        const goalTable = qualifiedTable(this.em, "LearningGoal");
        const targetTable = qualifiedTable(this.em, "LearningTarget");
        const mappingTable = qualifiedTable(this.em, "UnitLearningTarget");
        const sourceRows = resultRows(await this.execute(`SELECT u."id", u."goalId", u."moduleId", u."parentUnitId",
                u."orderIndex", u."title" AS "sourceTitle",
                u."prerequisites", g."contentLanguage",
                lt."id" AS "learningTargetId", lt."title" AS "targetTitle",
                lt."difficulty", ult."weight", ult."orderIndex" AS "targetOrderIndex"
           FROM ${unitTable} u
           JOIN ${goalTable} g ON g."id" = u."goalId"
           JOIN ${mappingTable} ult ON ult."unitId" = u."id"
           JOIN ${targetTable} lt ON lt."id" = ult."learningTargetId"
          WHERE u."id" = ? AND g."userId" = ?
            AND ult."learningTargetId" IN (${weakIds.map(() => "?").join(", ")})
          ORDER BY ult."orderIndex" ASC${this.lockClause()}`, [input.sourceUnitId, input.userId, ...weakIds]));
        if (sourceRows.length === 0)
            return null;
        const first = sourceRows[0]!;
        const sourceGoalId = requiredString(first, "goalId");
        const sourceTitle = requiredString(first, "sourceTitle");
        const sourceCopy = remediationCopy(String(rowValue(first, "contentLanguage") ?? "auto"), sourceTitle, sourceRows.map((row) => requiredString(row, "targetTitle")));
        const difficulty = maxDifficulty(sourceRows.map((row) => String(rowValue(row, "difficulty") ?? "medium")));
        const prerequisites = jsonText(rowValue(first, "prerequisites"));
        const moduleId = rowValue(first, "moduleId");
        const parentUnitId = rowValue(first, "parentUnitId");
        const sourceOrderIndex = numberValue(rowValue(first, "orderIndex"));
        const remediationRows = resultRows(await this.execute(`SELECT "id" FROM ${unitTable}
          WHERE "remediationSourceUnitId" = ?${this.lockClause()}`, [input.sourceUnitId]));
        let remediationId = remediationRows[0]
            ? requiredString(remediationRows[0], "id")
            : null;
        if (!remediationId) {
            const siblingWhere = `"goalId" = ?
        AND (("moduleId" = ?) OR ("moduleId" IS NULL AND ? IS NULL))
        AND (("parentUnitId" = ?) OR ("parentUnitId" IS NULL AND ? IS NULL))
        AND "orderIndex" > ?`;
            await this.execute(`UPDATE ${unitTable}
            SET "orderIndex" = "orderIndex" + 1
          WHERE ${siblingWhere}`, [
                sourceGoalId,
                moduleId,
                moduleId,
                parentUnitId,
                parentUnitId,
                sourceOrderIndex,
            ]);
            remediationId = `remediation_${randomUUID().replaceAll("-", "")}`;
            await this.execute(`INSERT INTO ${unitTable}
          ("id", "curriculumKey", "goalId", "moduleId", "parentUnitId",
           "unitKind", "title", "orderIndex", "difficulty", "prerequisites",
           "contentSummary", "mapOrigin", "status", "cognitiveModelStatus",
           "requiredForModuleCompletion", "remediationSourceUnitId", "remediationAttemptId")
         VALUES (?, ?, ?, ?, ?, 'lesson', ?, ?, ?, ?, ?, 'adaptive', 'available',
                 'expanded', false, ?, ?)`, [
                remediationId,
                `remediation:${input.sourceUnitId}`,
                sourceGoalId,
                moduleId,
                parentUnitId,
                sourceCopy.title,
                sourceOrderIndex + 1,
                difficulty,
                prerequisites,
                sourceCopy.summary,
                input.sourceUnitId,
                input.attemptId,
            ]);
        }
        else {
            const cleanupTables = [
                "QuizAttempt",
                "QuizSet",
                "DiagnosticAttempt",
                "FeynmanSession",
                "ReviewCard",
                "MaterialFollowUp",
                "CornellNote",
                "LearningMaterial",
                "UnitSessionState",
            ];
            for (const table of cleanupTables) {
                await this.execute(`DELETE FROM ${qualifiedTable(this.em, table)} WHERE "unitId" = ?`, [remediationId]);
            }
            await this.execute(`UPDATE ${unitTable}
            SET "title" = ?, "moduleId" = ?, "difficulty" = ?,
                "prerequisites" = ?, "contentSummary" = ?, "status" = 'available',
                "completionMethod" = NULL, "completionAttemptId" = NULL,
                "completedAt" = NULL, "remediationAttemptId" = ?,
                "cognitiveModelStatus" = 'expanded',
                "requiredForModuleCompletion" = false,
                "contentRevision" = "contentRevision" + 1
          WHERE "id" = ? AND "goalId" = ?`, [
                sourceCopy.title,
                moduleId,
                difficulty,
                prerequisites,
                sourceCopy.summary,
                input.attemptId,
                remediationId,
                sourceGoalId,
            ]);
        }
        await this.execute(`DELETE FROM ${qualifiedTable(this.em, "UnitLearningTarget")} WHERE "unitId" = ?`, [remediationId]);
        for (const [orderIndex, row] of sourceRows.entries()) {
            const targetId = requiredString(row, "learningTargetId");
            await this.execute(`INSERT INTO ${qualifiedTable(this.em, "UnitLearningTarget")}
          ("id", "unitId", "learningTargetId", "localRef", "required", "weight",
           "orderIndex", "role", "isEntry", "isExit")
         VALUES (?, ?, ?, ?, true, ?, ?, 'review', ?, ?)`, [
                `${remediationId}:target:${orderIndex + 1}`,
                remediationId,
                targetId,
                `lt_${orderIndex + 1}`,
                numberValue(rowValue(row, "weight"), 1),
                orderIndex,
                orderIndex === 0,
                orderIndex === sourceRows.length - 1,
            ]);
        }
        return remediationId;
    }
    async resolve(input: ResolveDiagnosticRemediationInput): Promise<void> {
        if (!input.userId || !input.sourceUnitId) {
            throw new CognitionPersistenceError("invalid_declaration", "Diagnostic remediation identifiers are required");
        }
        await this.execute(`UPDATE ${qualifiedTable(this.em, "LearningUnit")}
          SET "status" = 'completed', "completionMethod" = 'test_out',
              "completedAt" = ?
        WHERE "remediationSourceUnitId" = ?
          AND "status" <> 'completed'
          AND "goalId" IN (SELECT "id" FROM ${qualifiedTable(this.em, "LearningGoal")} WHERE "userId" = ?)`, [input.completedAt, input.sourceUnitId, input.userId]);
    }
}
