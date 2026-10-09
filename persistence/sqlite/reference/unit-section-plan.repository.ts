import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { UnitSectionPlanDraft, UnitSectionPlanRepository, UnitSectionPlanSource, UnitSectionPlanTargetRecord, } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { MikroOrmMaterialCheckCompletionRepository } from "./material-check-completion.repository.ts";
import { MikroOrmVerifiedEvidenceAppendRepository } from "./verified-evidence-append.repository.ts";
import { parseLearningMaterial } from "@xue-learn/core/source/libs/server/src/graph/unit-session.ts";
import { publishedMaterialCheckDefinitions } from "@xue-learn/core/source/libs/server/src/assessment/activities.ts";
import { nullableReferenceDateValue, sqlTimestampParameter } from "./date-value.ts";
type Row = Readonly<Record<string, unknown>>;
function rows(result: unknown): readonly Row[] {
    if (Array.isArray(result))
        return result as Row[];
    if (result && typeof result === "object" && "rows" in result) {
        const value = (result as {
            rows?: unknown;
        }).rows;
        return Array.isArray(value) ? (value as Row[]) : [];
    }
    return [];
}
function affected(result: unknown): number {
    if (typeof result === "number")
        return result;
    if (!result || typeof result !== "object")
        return 0;
    return Number((result as {
        affectedRows?: unknown;
        rowCount?: unknown;
    }).affectedRows ?? (result as {
        rowCount?: unknown;
    }).rowCount ?? 0);
}
function value(row: Row, key: string): unknown {
    return row[key] ?? row[key[0]?.toLowerCase() + key.slice(1)];
}
function nullableString(row: Row, key: string): string | null {
    const result = value(row, key);
    return result == null ? null : String(result);
}
function numberValue(row: Row, key: string): number {
    const result = Number(value(row, key));
    return Number.isFinite(result) ? result : 0;
}
function booleanValue(row: Row, key: string): boolean {
    const result = value(row, key);
    return result === true || result === 1 || result === "1" || result === "true";
}
function dateValue(row: Row, key: string): Date | null {
    return nullableReferenceDateValue(value(row, key), key);
}
function jsonValue(value: unknown): unknown {
    if (typeof value !== "string")
        return value;
    try {
        return JSON.parse(value);
    }
    catch {
        return value;
    }
}
function table(em: EntityManager, name: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${name.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
export class MikroOrmUnitSectionPlanRepository implements UnitSectionPlanRepository {
    constructor(private readonly em: EntityManager) { }
    private execute(em: EntityManager, sql: string, params: unknown[] = []): Promise<unknown> {
        return em
            .getConnection()
            .execute(sql, params, undefined, em.getTransactionContext());
    }
    async deleteAll(unitId: string): Promise<number> {
        const existing = rows(await this.execute(this.em, `SELECT "id" FROM ${table(this.em, "MainCourseSection")} WHERE "unitId" = ?`, [unitId]));
        const ids = existing.map((row) => String(value(row, "id")));
        if (ids.length) {
            const placeholders = ids.map(() => "?").join(", ");
            for (const name of [
                "UnitSectionMaterial",
                "UnitSectionDerivation",
                "UnitSectionTeachingDerivation",
                "TeachingDerivationRun",
                "FormalDerivationRun",
                "UnitSectionProgress",
                "ChatNarrationAudio",
            ]) {
                await this.execute(this.em, `DELETE FROM ${table(this.em, name)} WHERE "sectionId" IN (${placeholders})`, ids);
            }
        }
        await this.execute(this.em, `DELETE FROM ${table(this.em, "LessonPerformanceProject")} WHERE "unitId" = ?`, [unitId]);
        await this.execute(this.em, `DELETE FROM ${table(this.em, "UnitSection")} WHERE "courseRole" = \'main\' AND "unitId" = ?`, [unitId]);
        return existing.length;
    }
    async clearGenerated(unitId: string): Promise<number> {
        return this.em.transactional(async (em) => {
            const sections = rows(await this.execute(em, `SELECT "id" FROM ${table(em, "MainCourseSection")} WHERE "unitId" = ?`, [unitId]));
            if (sections.length === 0)
                return 0;
            const ids = sections.map((row) => String(value(row, "id")));
            const placeholders = ids.map(() => "?").join(", ");
            await this.execute(em, `DELETE FROM ${table(em, "UnitSectionMaterial")} WHERE "sectionId" IN (${placeholders})`, ids);
            await this.execute(em, `DELETE FROM ${table(em, "UnitSectionDerivation")} WHERE "sectionId" IN (${placeholders})`, ids);
            await this.execute(em, `DELETE FROM ${table(em, "UnitSectionTeachingDerivation")} WHERE "sectionId" IN (${placeholders})`, ids);
            await this.execute(em, `DELETE FROM ${table(em, "TeachingDerivationRun")} WHERE "sectionId" IN (${placeholders})`, ids);
            await this.execute(em, `DELETE FROM ${table(em, "FormalDerivationRun")} WHERE "sectionId" IN (${placeholders})`, ids);
            await this.execute(em, `DELETE FROM ${table(em, "UnitSectionProgress")} WHERE "sectionId" IN (${placeholders})`, ids);
            await this.execute(em, `UPDATE ${table(em, "UnitSection")}
            SET "generationStatus" = 'pending', "generationError" = '',
                "generationStartedAt" = NULL, "generationToken" = NULL,
                "testGenerationStatus" = 'pending', "testGenerationError" = '',
                "testGenerationStartedAt" = NULL, "testGenerationToken" = NULL,
                "updatedAt" = ? WHERE "courseRole" = \'main\' AND "unitId" = ?`, [new Date(), unitId]);
            return sections.length;
        });
    }
    async cancelGeneration(input: {
        userId: string;
        unitId: string;
        sectionId: string;
        kind: "content" | "mini_test";
        stoppedMessage: string;
    }) {
        return this.em.transactional(async (em) => {
            const section = rows(await this.execute(em, `SELECT s."id", s."generationToken", s."testGenerationToken"
             FROM ${table(em, "MainCourseSection")} s
             JOIN ${table(em, "LearningUnit")} u ON u."id" = s."unitId"
             JOIN ${table(em, "LearningGoal")} g ON g."id" = u."goalId"
            WHERE s."id" = ? AND s."unitId" = ? AND g."userId" = ? LIMIT 1`, [input.sectionId, input.unitId, input.userId]))[0];
            if (!section)
                throw new Error("Section not found");
            const token = nullableString(section, input.kind === "content" ? "generationToken" : "testGenerationToken");
            const result = await this.execute(em, input.kind === "content"
                ? `UPDATE ${table(em, "UnitSection")}
                SET "generationStatus" = 'failed', "generationError" = ?,
                    "generationStartedAt" = NULL, "generationToken" = NULL,
                    "updatedAt" = ?
              WHERE "id" = ? AND "generationStatus" = 'building'
                AND (? IS NULL OR "generationToken" = ?) RETURNING "id"`
                : `UPDATE ${table(em, "UnitSection")}
                SET "testGenerationStatus" = 'failed', "testGenerationError" = ?,
                    "testGenerationStartedAt" = NULL, "testGenerationToken" = NULL,
                    "updatedAt" = ?
              WHERE "id" = ? AND "testGenerationStatus" = 'building'
                AND (? IS NULL OR "testGenerationToken" = ?) RETURNING "id"`, [input.stoppedMessage, new Date(), input.sectionId, token, token]);
            return { cancelled: rows(result).length === 1, token };
        });
    }
    async findGenerationSource(input: {
        userId: string;
        unitId: string;
        sectionId: string;
    }) {
        const joined = rows(await this.execute(this.em, `SELECT s.*, u."title" AS "unitTitle", u."contentSummary" AS "unitContentSummary", u."goalId", u."unitKind" AS "learningUnitKind", u."contentRevision" AS "unitContentRevision", ss."sq3rData", m."sectionId" AS "materialSectionId", m."introduction", m."blocks", m."keyTakeaways", m."contextSources", m."sourceItems", d."documentJson" AS "derivationJson", td."documentJson" AS "teachingDerivationJson", td."derivedJson" AS "teachingDerivationDerivedJson" FROM ${table(this.em, "MainCourseSection")} s JOIN ${table(this.em, "LearningUnit")} u ON u."id" = s."unitId" JOIN ${table(this.em, "LearningGoal")} g ON g."id" = u."goalId" LEFT JOIN ${table(this.em, "UnitSessionState")} ss ON ss."unitId" = u."id" LEFT JOIN ${table(this.em, "UnitSectionMaterial")} m ON m."sectionId" = s."id" LEFT JOIN ${table(this.em, "UnitSectionDerivation")} d ON d."sectionId" = s."id" LEFT JOIN ${table(this.em, "UnitSectionTeachingDerivation")} td ON td."sectionId" = s."id" WHERE s."id" = ? AND s."unitId" = ? AND g."userId" = ? LIMIT 1`, [input.sectionId, input.unitId, input.userId]))[0];
        if (!joined)
            return null;
        const goal = rows(await this.execute(this.em, `SELECT * FROM ${table(this.em, "LearningGoal")} WHERE "id" = ? LIMIT 1`, [value(joined, "goalId")]))[0] ?? {};
        const sectionRows = rows(await this.execute(this.em, `SELECT s.*, m."sectionId" AS "materialSectionId", m."introduction", m."blocks", m."keyTakeaways", m."contextSources", m."sourceItems", p."status" AS "progressStatus", p."contentCompletedAt" FROM ${table(this.em, "MainCourseSection")} s LEFT JOIN ${table(this.em, "UnitSectionMaterial")} m ON m."sectionId" = s."id" LEFT JOIN ${table(this.em, "UnitSectionProgress")} p ON p."sectionId" = s."id" AND p."userId" = ? WHERE s."unitId" = ? ORDER BY s."orderIndex" ASC`, [input.userId, input.unitId]));
        const bindings = rows(await this.execute(this.em, `SELECT uslt."sectionId", uslt."learningTargetId", ult."localRef" FROM ${table(this.em, "UnitSectionLearningTarget")} uslt LEFT JOIN ${table(this.em, "UnitLearningTarget")} ult ON ult."unitId" = ? AND ult."learningTargetId" = uslt."learningTargetId" WHERE uslt."sectionId" IN (SELECT "id" FROM ${table(this.em, "MainCourseSection")} WHERE "unitId" = ?)`, [input.unitId, input.unitId]));
        const targetRows = rows(await this.execute(this.em, `SELECT ult.*, lt."title" AS "targetTitle", lt."explanation", lt."learningObjective", lt."assessmentCriteria", lt."importance", lt."importanceWeight", lt."difficulty", lt."targetCognitiveLevel", ltr."cognitiveEntityId", ltr."dimension", ltr."required" AS "requirementRequired", ltr."gate", ltr."weight" AS "requirementWeight", ltr."threshold", ltr."orderIndex" AS "requirementOrderIndex", ce."kind" AS "entityKind", ce."definitionVersion" AS "entityDefinitionVersion", ce."status" AS "entityStatus" FROM ${table(this.em, "UnitLearningTarget")} ult JOIN ${table(this.em, "LearningTarget")} lt ON lt."id" = ult."learningTargetId" LEFT JOIN ${table(this.em, "LearningTargetRequirement")} ltr ON ltr."learningTargetId" = lt."id" LEFT JOIN ${table(this.em, "CognitiveEntity")} ce ON ce."id" = ltr."cognitiveEntityId" WHERE ult."unitId" = ? AND lt."status" = 'active' ORDER BY ult."orderIndex" ASC, ult."id" ASC, ltr."orderIndex" ASC`, [input.unitId]));
        const groupedTargets = new Map<string, Row[]>();
        for (const row of targetRows) {
            const id = String(value(row, "learningTargetId"));
            groupedTargets.set(id, [...(groupedTargets.get(id) ?? []), row]);
        }
        const material = (row: Row) => value(row, "materialSectionId") == null ? null : { introduction: String(value(row, "introduction") ?? ""), blocks: String(value(row, "blocks") ?? "[]"), keyTakeaways: String(value(row, "keyTakeaways") ?? "[]"), contextSources: String(value(row, "contextSources") ?? "[]"), sourceItems: jsonValue(value(row, "sourceItems")) };
        const normalizedSections = sectionRows.map(row => ({ ...row, componentPlan: jsonValue(value(row, "componentPlan")), material: material(row), targets: bindings.filter(binding => String(value(binding, "sectionId")) === String(value(row, "id"))).map(binding => ({ learningTargetId: String(value(binding, "learningTargetId")), localRef: nullableString(binding, "localRef") })), progress: [{ status: nullableString(row, "progressStatus"), contentCompletedAt: dateValue(row, "contentCompletedAt") }] }));
        const sectionId = String(value(joined, "id"));
        const ownBindings = bindings.filter(row => String(value(row, "sectionId")) === sectionId);
        const unitKind = String(value(joined, "learningUnitKind") ?? value(joined, "unitKind") ?? "lesson");
        const goalId = String(value(joined, "goalId"));
        let overviewCatalog: Array<{
            title: string;
            summary: string;
        }> = [];
        if (unitKind === "overview") {
            const moduleRows = rows(await this.execute(this.em, `SELECT m."id", m."title", m."summary", m."objective" FROM ${table(this.em, "LearningModule")} m WHERE m."goalId" = ? ORDER BY m."orderIndex" ASC, m."id" ASC`, [goalId]));
            if (moduleRows.length > 0) {
                const lessonRows = rows(await this.execute(this.em, `SELECT "moduleId", "title" FROM ${table(this.em, "LearningUnit")} WHERE "goalId" = ? AND "unitKind" = 'lesson' AND "moduleId" IS NOT NULL ORDER BY "orderIndex" ASC, "id" ASC`, [goalId]));
                const lessonsByModule = new Map<string, string[]>();
                for (const row of lessonRows) {
                    const moduleId = String(value(row, "moduleId") ?? "");
                    const title = String(value(row, "title") ?? "").trim();
                    if (!moduleId || !title)
                        continue;
                    const list = lessonsByModule.get(moduleId) ?? [];
                    list.push(title);
                    lessonsByModule.set(moduleId, list);
                }
                overviewCatalog = moduleRows.map((row) => {
                    const moduleId = String(value(row, "id"));
                    const lessons = lessonsByModule.get(moduleId) ?? [];
                    const lessonLine = lessons.length ? `Lessons: ${lessons.join(" · ")}` : "";
                    return {
                        title: String(value(row, "title") ?? ""),
                        summary: [String(value(row, "summary") ?? ""), String(value(row, "objective") ?? ""), lessonLine]
                            .map((part) => part.trim())
                            .filter(Boolean)
                            .join(" "),
                    };
                }).filter((row) => row.title);
            }
        }
        return {
            section: { ...joined, componentPlan: jsonValue(value(joined, "componentPlan")), material: material(joined), targets: ownBindings.map(row => ({ learningTargetId: String(value(row, "learningTargetId")), localRef: nullableString(row, "localRef") })) },
            unit: { id: input.unitId, title: String(value(joined, "unitTitle")), contentSummary: String(value(joined, "unitContentSummary") ?? ""), goalId: String(value(joined, "goalId")), unitKind: String(value(joined, "learningUnitKind") ?? value(joined, "unitKind") ?? "lesson"), contentRevision: numberValue(joined, "unitContentRevision"), sq3rData: nullableString(joined, "sq3rData") },
            goal: { ...goal }, material: material(joined),
            derivationJson: nullableString(joined, "derivationJson"),
            teachingDerivationJson: nullableString(joined, "teachingDerivationJson"),
            teachingDerivationDerivedJson: nullableString(joined, "teachingDerivationDerivedJson"),
            targetLocalRefs: ownBindings.flatMap(row => nullableString(row, "localRef") ? [String(value(row, "localRef"))] : []),
            targetIds: ownBindings.map(row => String(value(row, "learningTargetId"))), sections: normalizedSections,
            assessmentTargets: [...groupedTargets.values()].map(group => { const row = group[0]!; return { id: String(value(row, "learningTargetId")), localRef: String(value(row, "localRef")), title: String(value(row, "targetTitle")), description: String(value(row, "explanation") ?? ""), learningObjective: String(value(row, "learningObjective") ?? ""), assessmentCriteria: jsonValue(value(row, "assessmentCriteria")), required: booleanValue(row, "required"), weight: Number(value(row, "weight") ?? 1), role: String(value(row, "role")), isEntry: booleanValue(row, "isEntry"), isExit: booleanValue(row, "isExit"), importance: String(value(row, "importance")), importanceWeight: Number(value(row, "importanceWeight") ?? 1), difficulty: String(value(row, "difficulty")), targetCognitiveLevel: String(value(row, "targetCognitiveLevel")), requirements: group.filter(item => value(item, "cognitiveEntityId") != null).map(item => ({ cognitiveEntityId: String(value(item, "cognitiveEntityId")), entityKind: String(value(item, "entityKind")), entityDefinitionVersion: numberValue(item, "entityDefinitionVersion"), dimension: String(value(item, "dimension")), required: booleanValue(item, "requirementRequired"), gate: booleanValue(item, "gate"), weight: Number(value(item, "requirementWeight") ?? 1), threshold: Number(value(item, "threshold") ?? 0) })) }; }),
            overviewCatalog,
        };
    }
    async claimGeneration(input: {
        sectionId: string;
        kind: "content" | "mini_test";
        token: string;
        staleBefore: Date;
        force?: boolean;
        initialAttempt: boolean;
    }) {
        const status = input.kind === "content" ? "generationStatus" : "testGenerationStatus";
        const started = input.kind === "content" ? "generationStartedAt" : "testGenerationStartedAt";
        const token = input.kind === "content" ? "generationToken" : "testGenerationToken";
        const error = input.kind === "content" ? "generationError" : "testGenerationError";
        const allowed = input.initialAttempt ? (input.kind === "content" ? ["pending", "failed", ...(input.force ? ["ready"] : [])] : ["pending", "failed"]) : [];
        const clauses = [...allowed.map(() => `"${status}" = ?`), `"${started}" < ?`];
        const now = sqlTimestampParameter(false, new Date());
        const staleBefore = sqlTimestampParameter(false, input.staleBefore);
        const result = await this.execute(this.em, `UPDATE ${table(this.em, "UnitSection")} SET "${status}"='building', "${error}"='', "${started}"=?, "${token}"=?, "updatedAt"=? WHERE "id"=? AND (${clauses.join(" OR ")}) RETURNING "id"`, [now, input.token, now, input.sectionId, ...allowed, staleBefore]);
        if (rows(result).length === 1 || affected(result) >= 1)
            return "claimed" as const;
        const current = rows(await this.execute(this.em, `SELECT "${status}" AS "status" FROM ${table(this.em, "MainCourseSection")} WHERE "id"=? LIMIT 1`, [input.sectionId]))[0];
        if (!current)
            return "missing" as const;
        const currentStatus = String(value(current, "status"));
        return currentStatus === "ready" ? "ready" as const : currentStatus === "building" ? "building" as const : "failed" as const;
    }
    async heartbeatGeneration(input: {
        sectionId: string;
        kind: "content" | "mini_test";
        token: string;
        at: Date;
    }) { const status = input.kind === "content" ? "generationStatus" : "testGenerationStatus"; const started = input.kind === "content" ? "generationStartedAt" : "testGenerationStartedAt"; const token = input.kind === "content" ? "generationToken" : "testGenerationToken"; return rows(await this.execute(this.em, `UPDATE ${table(this.em, "UnitSection")} SET "${started}"=?, "updatedAt"=? WHERE "id"=? AND "${status}"='building' AND "${token}"=? RETURNING "id"`, [input.at, input.at, input.sectionId, input.token])).length === 1; }
    async ownsGeneration(input: {
        sectionId: string;
        kind: "content" | "mini_test";
        token: string;
    }) { const status = input.kind === "content" ? "generationStatus" : "testGenerationStatus"; const token = input.kind === "content" ? "generationToken" : "testGenerationToken"; return rows(await this.execute(this.em, `SELECT "id" FROM ${table(this.em, "MainCourseSection")} WHERE "id"=? AND "${status}"='building' AND "${token}"=? LIMIT 1`, [input.sectionId, input.token])).length === 1; }
    async failGeneration(input: {
        sectionId: string;
        kind: "content" | "mini_test";
        token: string;
        error: string;
    }) { const status = input.kind === "content" ? "generationStatus" : "testGenerationStatus"; const started = input.kind === "content" ? "generationStartedAt" : "testGenerationStartedAt"; const token = input.kind === "content" ? "generationToken" : "testGenerationToken"; const error = input.kind === "content" ? "generationError" : "testGenerationError"; return rows(await this.execute(this.em, `UPDATE ${table(this.em, "UnitSection")} SET "${status}"='failed', "${error}"=?, "${started}"=NULL, "${token}"=NULL, "updatedAt"=? WHERE "id"=? AND "${token}"=? RETURNING "id"`, [input.error, new Date(), input.sectionId, input.token])).length === 1; }
    async persistIllustration(input: {
        unitId: string;
        sectionId: string;
        expectedContentRevision: number;
        blocks: string;
    }) { return this.em.transactional(async (em) => { const claimed = rows(await this.execute(em, `UPDATE ${table(em, "UnitSection")} SET "contentRevision"="contentRevision"+1, "updatedAt"=? WHERE "id"=? AND "contentRevision"=? AND "generationStatus"='ready' RETURNING "id"`, [new Date(), input.sectionId, input.expectedContentRevision])); if (claimed.length !== 1)
        return false; await this.execute(em, `UPDATE ${table(em, "UnitSectionMaterial")} SET "blocks"=?, "updatedAt"=? WHERE "sectionId"=?`, [input.blocks, new Date(), input.sectionId]); await this.execute(em, `UPDATE ${table(em, "LearningUnit")} SET "contentRevision"="contentRevision"+1 WHERE "id"=?`, [input.unitId]); return true; }); }
    async findKeyPointSources(unitId: string) {
        const sectionRows = rows(await this.execute(this.em, `SELECT s."id", s."title", s."orderIndex", s."contentKind", s."generationStatus",
                m."keyTakeaways", m."blocks"
           FROM ${table(this.em, "MainCourseSection")} s
           LEFT JOIN ${table(this.em, "UnitSectionMaterial")} m ON m."sectionId" = s."id"
          WHERE s."unitId" = ?
          ORDER BY s."orderIndex" ASC`, [unitId]));
        return sectionRows.map((row) => ({
            id: String(value(row, "id")),
            title: String(value(row, "title") ?? ""),
            orderIndex: numberValue(row, "orderIndex"),
            contentKind: String(value(row, "contentKind") ?? "standard"),
            generationStatus: String(value(row, "generationStatus") ?? ""),
            keyTakeaways: String(value(row, "keyTakeaways") ?? "[]"),
            blocks: value(row, "blocks") == null ? null : String(value(row, "blocks")),
        }));
    }
    async saveUnitKeyTakeaways(input: {
        unitId: string;
        assignments: readonly Readonly<{
            sectionId: string;
            keyTakeaways: string;
        }>[];
        unitKeyTakeaways: string;
    }) {
        const now = new Date();
        await this.em.transactional(async (em) => {
            for (const assignment of input.assignments) {
                await this.execute(em, `UPDATE ${table(em, "UnitSectionMaterial")}
              SET "keyTakeaways" = ?, "updatedAt" = ?
            WHERE "sectionId" = ?`, [assignment.keyTakeaways, now, assignment.sectionId]);
            }
            await this.execute(em, `UPDATE ${table(em, "LearningMaterial")}
            SET "keyTakeaways" = ?, "updatedAt" = ?
          WHERE "unitId" = ?`, [input.unitKeyTakeaways, now, input.unitId]);
        });
    }
    async publishGeneratedContent(input: {
        userId: string;
        goalId: string;
        unitId: string;
        sectionId: string;
        token: string;
        force: boolean;
        material: {
            introduction: string;
            blocks: string;
            keyTakeaways: string;
            contextSources: string;
            sourceItemsJson: string;
        };
        materialCheckTasks: readonly import("@xue-learn/core/source/libs/domain/src/index.ts").MaterialCheckTaskDefinition[];
    }) {
        return this.em.transactional(async (em) => {
            const now = new Date();
            const own = rows(await this.execute(em, `SELECT "orderIndex","contentRevision" FROM ${table(em, "MainCourseSection")} WHERE "id"=? AND "generationToken"=? LIMIT 1`, [input.sectionId, input.token]))[0];
            if (!own)
                throw new Error("Section generation lease was superseded");
            const affected = new Set<string>();
            if (input.force) {
                const checkpoint = rows(await this.execute(em, `SELECT s."id",m."sectionId" AS "materialSectionId",m."introduction",m."blocks",m."keyTakeaways" FROM ${table(em, "MainCourseSection")} s LEFT JOIN ${table(em, "UnitSectionMaterial")} m ON m."sectionId"=s."id" WHERE s."unitId"=? AND s."orderIndex">=? AND s."assessmentAfter"=? ORDER BY s."orderIndex" ASC LIMIT 1`, [input.unitId, value(own, "orderIndex"), true]))[0];
                const oldMaterial = checkpoint && value(checkpoint, "materialSectionId") != null ? parseLearningMaterial({ introduction: String(value(checkpoint, "introduction") ?? ""), sections: String(value(checkpoint, "blocks") ?? "[]"), keyTakeaways: String(value(checkpoint, "keyTakeaways") ?? "[]") }) : null;
                const checkIds = publishedMaterialCheckDefinitions(oldMaterial ?? { introduction: "", blocks: [], keyTakeaways: [] }).map(item => item.checkId);
                if (checkIds.length) {
                    const clauses = checkIds.map(() => `(t."stableKey"=? OR t."stableKey" LIKE ?)`).join(" OR ");
                    const keys = checkIds.flatMap(id => [`assessment:material-check:${id}`, `assessment:material-check:${id}:v%`]);
                    const claims = rows(await this.execute(em, `SELECT ec."id",ec."cognitiveEntityId" FROM ${table(em, "EvidenceClaim")} ec JOIN ${table(em, "TaskObservation")} o ON o."id"=ec."observationId" JOIN ${table(em, "TaskAttempt")} a ON a."id"=o."attemptId" JOIN ${table(em, "LearningTask")} t ON t."id"=a."taskId" WHERE ec."userId"=? AND ec."status"='active' AND a."unitId"=? AND (${clauses})`, [input.userId, input.unitId, ...keys]));
                    for (const claim of claims) {
                        const id = String(value(claim, "id"));
                        const entityId = String(value(claim, "cognitiveEntityId"));
                        await this.execute(em, `INSERT INTO ${table(em, "EvidenceLifecycleEvent")} ("id","evidenceClaimId","eventType","reason","actorUserId","replacementClaimId","payload","createdAt") VALUES (?,?,'retracted','unit_section_regenerated',?,NULL,?,?)`, [randomUUID(), id, input.userId, JSON.stringify({ unitId: input.unitId, sectionId: input.sectionId, checkpointSectionId: checkpoint ? String(value(checkpoint, "id")) : null }), now]);
                        await this.execute(em, `UPDATE ${table(em, "EvidenceClaim")} SET "status"='retracted',"validUntil"=? WHERE "id"=?`, [now, id]);
                        affected.add(entityId);
                    }
                    const evidence = new MikroOrmVerifiedEvidenceAppendRepository(em);
                    for (const entityId of affected)
                        await evidence.replayEntityState(input.userId, entityId, now);
                }
                if (checkpoint) {
                    const checkpointId = String(value(checkpoint, "id"));
                    await this.execute(em, `UPDATE ${table(em, "UnitSection")} SET "testGenerationStatus"='pending',"testGenerationError"='',"testGenerationStartedAt"=NULL,"testGenerationToken"=NULL WHERE "id"=?`, [checkpointId]);
                    if (checkpointId !== input.sectionId && oldMaterial) {
                        const checkSet = new Set(publishedMaterialCheckDefinitions(oldMaterial).map(item => item.checkId));
                        const blocks = oldMaterial.blocks.filter(block => block.type !== "check" && !(block.type === "heading" && block.level === 2 && ["小节测验", "小節測驗", "Section questions", "セクション問題", "섹션 확인 문제", "Preguntas de la sección", "Questions de la section", "Abschnittsfragen"].includes(block.text)));
                        await this.execute(em, `UPDATE ${table(em, "UnitSectionMaterial")} SET "blocks"=?,"updatedAt"=? WHERE "sectionId"=?`, [JSON.stringify(blocks), now, checkpointId]);
                        void checkSet;
                        await this.execute(em, `UPDATE ${table(em, "UnitSectionProgress")} SET "status"='in_progress',"completedAt"=NULL,"skippedAt"=NULL,"skipReason"=NULL,"updatedAt"=? WHERE "sectionId"=? AND "userId"=?`, [now, checkpointId, input.userId]);
                    }
                }
                await this.execute(em, `UPDATE ${table(em, "UnitSectionProgress")} SET "status"='available',"contentCompletedAt"=NULL,"completedAt"=NULL,"skippedAt"=NULL,"skipReason"=NULL,"updatedAt"=? WHERE "sectionId"=? AND "userId"=?`, [now, input.sectionId, input.userId]);
            }
            const jsonCast = "";
            await this.execute(em, `INSERT INTO ${table(em, "UnitSectionMaterial")} ("id","sectionId","introduction","blocks","keyTakeaways","contextSources","sourceItems","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?${jsonCast},?,?) ON CONFLICT ("sectionId") DO UPDATE SET "introduction"=?,"blocks"=?,"keyTakeaways"=?,"contextSources"=?,"sourceItems"=?${jsonCast},"updatedAt"=?`, [randomUUID(), input.sectionId, input.material.introduction, input.material.blocks, input.material.keyTakeaways, input.material.contextSources, input.material.sourceItemsJson, now, now, input.material.introduction, input.material.blocks, input.material.keyTakeaways, input.material.contextSources, input.material.sourceItemsJson, now]);
            await new MikroOrmMaterialCheckCompletionRepository(em).publishTasks({ userId: input.userId, goalId: input.goalId, unitId: input.unitId, tasks: input.materialCheckTasks });
            await this.execute(em, `UPDATE ${table(em, "LearningUnit")} SET "contentRevision"="contentRevision"+1 WHERE "id"=?`, [input.unitId]);
            const published = rows(await this.execute(em, `UPDATE ${table(em, "UnitSection")} SET "generationStatus"='ready',"generationError"='',"generationToken"=NULL,"generationStartedAt"=NULL,"testGenerationStatus"='pending',"testGenerationError"='',"testGenerationStartedAt"=NULL,"testGenerationToken"=NULL,"contentRevision"="contentRevision"+1,"updatedAt"=? WHERE "id"=? AND "generationToken"=? RETURNING "contentRevision"`, [now, input.sectionId, input.token]));
            if (published.length !== 1)
                throw new Error("Section generation lease was superseded");
            return { contentRevision: numberValue(published[0]!, "contentRevision"), affectedEntityIds: [...affected] };
        });
    }
    async publishGeneratedMiniTest(input: {
        userId: string;
        goalId: string;
        unitId: string;
        sectionId: string;
        token: string;
        blocks: string;
        materialCheckTasks: readonly import("@xue-learn/core/source/libs/domain/src/index.ts").MaterialCheckTaskDefinition[];
    }) { return this.em.transactional(async (em) => { const now = new Date(); const owned = rows(await this.execute(em, `SELECT "id" FROM ${table(em, "MainCourseSection")} WHERE "id"=? AND "testGenerationToken"=? LIMIT 1`, [input.sectionId, input.token])); if (owned.length !== 1)
        throw new Error("Mini-test generation lease was superseded"); await this.execute(em, `UPDATE ${table(em, "UnitSectionMaterial")} SET "blocks"=?,"updatedAt"=? WHERE "sectionId"=?`, [input.blocks, now, input.sectionId]); await new MikroOrmMaterialCheckCompletionRepository(em).publishTasks({ userId: input.userId, goalId: input.goalId, unitId: input.unitId, tasks: input.materialCheckTasks }); await this.execute(em, `UPDATE ${table(em, "LearningUnit")} SET "contentRevision"="contentRevision"+1 WHERE "id"=?`, [input.unitId]); const published = rows(await this.execute(em, `UPDATE ${table(em, "UnitSection")} SET "testGenerationStatus"='ready',"testGenerationError"='',"testGenerationStartedAt"=NULL,"testGenerationToken"=NULL,"contentRevision"="contentRevision"+1,"updatedAt"=? WHERE "id"=? AND "testGenerationToken"=? RETURNING "contentRevision"`, [now, input.sectionId, input.token])); if (published.length !== 1)
        throw new Error("Mini-test generation lease was superseded"); return { contentRevision: numberValue(published[0]!, "contentRevision") }; }); }
    async publishGeneratedDerivation(input: {
        userId: string;
        goalId: string;
        unitId: string;
        sectionId: string;
        token: string;
        force: boolean;
        runId: string;
        documentJson: string;
    }) {
        return this.em.transactional(async (em) => {
            const now = new Date();
            const own = rows(await this.execute(em, `SELECT "id" FROM ${table(em, "MainCourseSection")} WHERE "id"=? AND "generationToken"=? LIMIT 1`, [input.sectionId, input.token]))[0];
            if (!own)
                throw new Error("Section generation lease was superseded");
            if (input.force) {
                await this.execute(em, `UPDATE ${table(em, "UnitSectionProgress")} SET "status"='available',"contentCompletedAt"=NULL,"completedAt"=NULL,"skippedAt"=NULL,"skipReason"=NULL,"updatedAt"=? WHERE "sectionId"=? AND "userId"=?`, [now, input.sectionId, input.userId]);
            }
            await this.execute(em, `INSERT INTO ${table(em, "UnitSectionDerivation")} ("id","sectionId","runId","documentJson","createdAt","updatedAt") VALUES (?,?,?,?,?,?) ON CONFLICT ("sectionId") DO UPDATE SET "runId"=excluded."runId","documentJson"=excluded."documentJson","updatedAt"=excluded."updatedAt"`, [randomUUID(), input.sectionId, input.runId, input.documentJson, now, now]);
            await this.execute(em, `UPDATE ${table(em, "LearningUnit")} SET "contentRevision"="contentRevision"+1 WHERE "id"=?`, [input.unitId]);
            const published = rows(await this.execute(em, `UPDATE ${table(em, "UnitSection")} SET "generationStatus"='ready',"generationError"='',"generationToken"=NULL,"generationStartedAt"=NULL,"derivationFormat"='classic',"contentRevision"="contentRevision"+1,"updatedAt"=? WHERE "id"=? AND "generationToken"=? RETURNING "contentRevision"`, [now, input.sectionId, input.token]));
            if (published.length !== 1)
                throw new Error("Section generation lease was superseded");
            void input.goalId;
            return { contentRevision: numberValue(published[0]!, "contentRevision") };
        });
    }
    async lockDerivationFormat(input: {
        sectionId: string;
        format: "classic" | "teaching_v1";
        regenerationToken?: string;
    }) {
        return this.em.transactional(async (em) => {
            // Only the owner of an explicit regeneration may replace a legacy format lock.
            if (input.regenerationToken && input.format === "teaching_v1") {
                const changed = rows(await this.execute(em, `UPDATE ${table(em, "UnitSection")} SET "derivationFormat"=?, "updatedAt"=? WHERE "id"=? AND "generationToken"=? RETURNING "id"`, [input.format, new Date(), input.sectionId, input.regenerationToken]));
                return changed.length === 1 ? "locked" as const : "conflict" as const;
            }
            const row = rows(await this.execute(em, `SELECT "derivationFormat" FROM ${table(em, "MainCourseSection")} WHERE "id"=? LIMIT 1`, [input.sectionId]))[0];
            if (!row)
                return "conflict" as const;
            const locked = nullableString(row, "derivationFormat");
            if (locked === input.format)
                return "already" as const;
            if (locked && locked !== input.format)
                return "conflict" as const;
            const opposite = input.format === "teaching_v1"
                ? [
                    ...rows(await this.execute(em, `SELECT "id" FROM ${table(em, "UnitSectionDerivation")} WHERE "sectionId"=? LIMIT 1`, [input.sectionId])),
                    ...rows(await this.execute(em, `SELECT "id" FROM ${table(em, "FormalDerivationRun")} WHERE "sectionId"=? LIMIT 1`, [input.sectionId])),
                ]
                : [
                    ...rows(await this.execute(em, `SELECT "id" FROM ${table(em, "UnitSectionTeachingDerivation")} WHERE "sectionId"=? LIMIT 1`, [input.sectionId])),
                    ...rows(await this.execute(em, `SELECT "id" FROM ${table(em, "TeachingDerivationRun")} WHERE "sectionId"=? LIMIT 1`, [input.sectionId])),
                ];
            if (opposite.length > 0)
                return "conflict" as const;
            const now = new Date();
            await this.execute(em, `UPDATE ${table(em, "UnitSection")} SET "derivationFormat"=?, "updatedAt"=? WHERE "id"=? AND ("derivationFormat" IS NULL OR "derivationFormat"=?)`, [input.format, now, input.sectionId, input.format]);
            return "locked" as const;
        });
    }
    async updateTeachingPresentation(input: {
        userId: string;
        unitId: string;
        sectionId: string;
        expectedContentRevision: number;
        expectedDocumentJson: string;
        documentJson: string;
        derivedJson: string;
    }) {
        return this.em.transactional(async (em) => {
            const now = new Date();
            const changed = rows(await this.execute(em, `UPDATE ${table(em, "UnitSection")} SET "contentRevision"="contentRevision"+1,"updatedAt"=? WHERE "id"=? AND "unitId"=? AND "contentRevision"=? AND "generationToken" IS NULL AND EXISTS (SELECT 1 FROM ${table(em, "LearningUnit")} u JOIN ${table(em, "LearningGoal")} g ON g."id"=u."goalId" WHERE u."id"=? AND g."userId"=?) AND EXISTS (SELECT 1 FROM ${table(em, "UnitSectionTeachingDerivation")} d WHERE d."sectionId"=? AND d."documentJson"=?) RETURNING "id"`, [now, input.sectionId, input.unitId, input.expectedContentRevision, input.unitId, input.userId, input.sectionId, input.expectedDocumentJson]));
            if (changed.length !== 1)
                return false;
            await this.execute(em, `UPDATE ${table(em, "UnitSectionTeachingDerivation")} SET "documentJson"=?,"derivedJson"=?,"updatedAt"=? WHERE "sectionId"=?`, [input.documentJson, input.derivedJson, now, input.sectionId]);
            await this.execute(em, `UPDATE ${table(em, "LearningUnit")} SET "contentRevision"="contentRevision"+1 WHERE "id"=?`, [input.unitId]);
            return true;
        });
    }
    async publishGeneratedTeachingDerivation(input: {
        userId: string;
        goalId: string;
        unitId: string;
        sectionId: string;
        token: string;
        force: boolean;
        runId: string;
        documentJson: string;
        derivedJson: string;
        parserVersion: string;
        analyzerVersion: string;
        matcherVersion: string;
        compilerVersion: string;
    }) {
        return this.em.transactional(async (em) => {
            const now = new Date();
            const own = rows(await this.execute(em, `SELECT "id" FROM ${table(em, "MainCourseSection")} WHERE "id"=? AND "generationToken"=? LIMIT 1`, [input.sectionId, input.token]))[0];
            if (!own)
                throw new Error("Section generation lease was superseded");
            if (input.force) {
                await this.execute(em, `UPDATE ${table(em, "UnitSectionProgress")} SET "status"='available',"contentCompletedAt"=NULL,"completedAt"=NULL,"skippedAt"=NULL,"skipReason"=NULL,"updatedAt"=? WHERE "sectionId"=? AND "userId"=?`, [now, input.sectionId, input.userId]);
            }
            // Keep the old published document until its replacement is ready, then retire it atomically.
            await this.execute(em, `DELETE FROM ${table(em, "UnitSectionDerivation")} WHERE "sectionId"=?`, [input.sectionId]);
            await this.execute(em, `INSERT INTO ${table(em, "UnitSectionTeachingDerivation")} ("id","sectionId","runId","documentJson","derivedJson","parserVersion","analyzerVersion","matcherVersion","compilerVersion","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT ("sectionId") DO UPDATE SET "runId"=excluded."runId","documentJson"=excluded."documentJson","derivedJson"=excluded."derivedJson","parserVersion"=excluded."parserVersion","analyzerVersion"=excluded."analyzerVersion","matcherVersion"=excluded."matcherVersion","compilerVersion"=excluded."compilerVersion","updatedAt"=excluded."updatedAt"`, [randomUUID(), input.sectionId, input.runId, input.documentJson, input.derivedJson, input.parserVersion, input.analyzerVersion, input.matcherVersion, input.compilerVersion, now, now]);
            await this.execute(em, `UPDATE ${table(em, "LearningUnit")} SET "contentRevision"="contentRevision"+1 WHERE "id"=?`, [input.unitId]);
            const published = rows(await this.execute(em, `UPDATE ${table(em, "UnitSection")} SET "generationStatus"='ready',"generationError"='',"generationToken"=NULL,"generationStartedAt"=NULL,"derivationFormat"='teaching_v1',"contentRevision"="contentRevision"+1,"updatedAt"=? WHERE "id"=? AND "generationToken"=? RETURNING "contentRevision"`, [now, input.sectionId, input.token]));
            if (published.length !== 1)
                throw new Error("Section generation lease was superseded");
            void input.goalId;
            return { contentRevision: numberValue(published[0]!, "contentRevision") };
        });
    }
    async findSource(unitId: string): Promise<UnitSectionPlanSource | null> {
        const sourceRows = rows(await this.execute(this.em, `SELECT u."id", u."title", u."contentSummary", u."unitKind", g."goalKind", g."learningMode", g."userId",
                s."sq3rData", CASE WHEN lm."unitId" IS NULL THEN 0 ELSE 1 END AS "hasLearningMaterial"
           FROM ${table(this.em, "LearningUnit")} u
           JOIN ${table(this.em, "LearningGoal")} g ON g."id" = u."goalId"
           LEFT JOIN ${table(this.em, "UnitSessionState")} s ON s."unitId" = u."id"
           LEFT JOIN ${table(this.em, "LearningMaterial")} lm ON lm."unitId" = u."id"
          WHERE u."id" = ? LIMIT 1`, [unitId]));
        const source = sourceRows[0];
        if (!source)
            return null;
        const [sectionResult, targetResult] = await Promise.all([
            this.execute(this.em, `SELECT * FROM ${table(this.em, "MainCourseSection")} WHERE "unitId" = ? ORDER BY "orderIndex" ASC`, [unitId]),
            this.execute(this.em, `SELECT ult."learningTargetId", ult."localRef", ult."role", lt."title", lt."explanation",
                lt."learningObjective", lt."importance", lt."difficulty", lt."targetCognitiveLevel",
                lt."definitionVersion"
           FROM ${table(this.em, "UnitLearningTarget")} ult
           JOIN ${table(this.em, "LearningTarget")} lt ON lt."id" = ult."learningTargetId"
          WHERE ult."unitId" = ? AND ult."role" <> 'review' ORDER BY ult."orderIndex" ASC`, [unitId]),
        ]);
        const learningTargets: UnitSectionPlanTargetRecord[] = rows(targetResult).map((row) => ({
            learningTargetId: String(value(row, "learningTargetId")),
            localRef: String(value(row, "localRef")),
            role: String(value(row, "role")),
            learningTarget: {
                title: String(value(row, "title")),
                explanation: String(value(row, "explanation") ?? ""),
                learningObjective: String(value(row, "learningObjective") ?? ""),
                importance: String(value(row, "importance")),
                difficulty: String(value(row, "difficulty")),
                targetCognitiveLevel: String(value(row, "targetCognitiveLevel")),
                definitionVersion: numberValue(row, "definitionVersion"),
            },
        }));
        return {
            id: String(value(source, "id")),
            title: String(value(source, "title")),
            contentSummary: String(value(source, "contentSummary") ?? ""),
            unitKind: String(value(source, "unitKind") ?? "lesson"),
            goal: {
                goalKind: String(value(source, "goalKind")),
                learningMode: String(value(source, "learningMode")),
                userId: nullableString(source, "userId"),
            },
            sq3rData: nullableString(source, "sq3rData"),
            hasLearningMaterial: numberValue(source, "hasLearningMaterial") === 1,
            existingSections: rows(sectionResult),
            learningTargets,
        };
    }
    async findMaterialSource(unitId: string) {
        const sectionRows = rows(await this.execute(this.em, `SELECT s."requiredForCompletion", s."generationStatus", s."contentKind", s."derivationFormat",
                m."introduction", m."blocks", m."keyTakeaways", m."contextSources",
                m."sectionId" AS "materialSectionId",
                d."documentJson" AS "derivationJson",
                td."documentJson" AS "teachingDerivationJson",
                td."derivedJson" AS "teachingDerivationDerivedJson"
           FROM ${table(this.em, "MainCourseSection")} s
           LEFT JOIN ${table(this.em, "UnitSectionMaterial")} m ON m."sectionId" = s."id"
           LEFT JOIN ${table(this.em, "UnitSectionDerivation")} d ON d."sectionId" = s."id"
           LEFT JOIN ${table(this.em, "UnitSectionTeachingDerivation")} td ON td."sectionId" = s."id"
          WHERE s."unitId" = ? ORDER BY s."orderIndex" ASC`, [unitId]));
        const legacyRow = rows(await this.execute(this.em, `SELECT "introduction", "sections", "keyTakeaways", "contextSources"
           FROM ${table(this.em, "LearningMaterial")} WHERE "unitId" = ? LIMIT 1`, [unitId]))[0];
        return {
            sections: sectionRows.map((row) => ({
                requiredForCompletion: value(row, "requiredForCompletion") === true ||
                    Number(value(row, "requiredForCompletion")) === 1,
                generationStatus: String(value(row, "generationStatus")),
                contentKind: String(value(row, "contentKind") ?? "standard"),
                derivationFormat: nullableString(row, "derivationFormat"),
                derivationJson: nullableString(row, "derivationJson"),
                teachingDerivationJson: nullableString(row, "teachingDerivationJson"),
                teachingDerivationDerivedJson: nullableString(row, "teachingDerivationDerivedJson"),
                material: value(row, "materialSectionId") == null
                    ? null
                    : {
                        introduction: String(value(row, "introduction") ?? ""),
                        blocks: String(value(row, "blocks") ?? "[]"),
                        keyTakeaways: String(value(row, "keyTakeaways") ?? "[]"),
                        contextSources: String(value(row, "contextSources") ?? "[]"),
                    },
            })),
            legacy: legacyRow
                ? {
                    introduction: String(value(legacyRow, "introduction") ?? ""),
                    sections: String(value(legacyRow, "sections") ?? "[]"),
                    keyTakeaways: String(value(legacyRow, "keyTakeaways") ?? "[]"),
                    contextSources: String(value(legacyRow, "contextSources") ?? "[]"),
                }
                : null,
        };
    }
    async findManifest(input: {
        userId: string;
        unitId: string;
        freshnessCutoff: Date;
    }) {
        const owner = rows(await this.execute(this.em, `SELECT u."id" FROM ${table(this.em, "LearningUnit")} u JOIN ${table(this.em, "LearningGoal")} g ON g."id" = u."goalId" WHERE u."id" = ? AND g."userId" = ? LIMIT 1`, [input.unitId, input.userId]))[0];
        if (!owner)
            return null;
        const [sectionResult, legacyResult, requirementResult] = await Promise.all([
            this.execute(this.em, `SELECT s.*, p."status" AS "progressStatus", p."activeSeconds", p."contentCompletedAt" FROM ${table(this.em, "MainCourseSection")} s LEFT JOIN ${table(this.em, "UnitSectionProgress")} p ON p."sectionId" = s."id" AND p."userId" = ? WHERE s."unitId" = ? ORDER BY s."orderIndex" ASC`, [input.userId, input.unitId]),
            this.execute(this.em, `SELECT "introduction","sections","keyTakeaways","contextSources" FROM ${table(this.em, "LearningMaterial")} WHERE "unitId" = ? LIMIT 1`, [input.unitId]),
            this.execute(this.em, `SELECT uslt."sectionId", ltr."id" AS "requirementId", ltr."threshold", lds."status", lds."estimate", lds."evidenceSufficiency", lds."lastObservedAt" FROM ${table(this.em, "UnitSectionLearningTarget")} uslt JOIN ${table(this.em, "LearningTargetRequirement")} ltr ON ltr."learningTargetId" = uslt."learningTargetId" AND ltr."required" = ? LEFT JOIN ${table(this.em, "LearnerEntityState")} les ON les."userId" = ? AND les."cognitiveEntityId" = ltr."cognitiveEntityId" LEFT JOIN ${table(this.em, "LearnerDimensionState")} lds ON lds."learnerEntityStateId" = les."id" AND lds."dimension" = ltr."dimension" WHERE uslt."sectionId" IN (SELECT "id" FROM ${table(this.em, "MainCourseSection")} WHERE "unitId" = ?)`, [true, input.userId, input.unitId]),
        ]);
        const requirements = new Map<string, Row[]>();
        for (const row of rows(requirementResult)) {
            const key = String(value(row, "sectionId"));
            requirements.set(key, [...(requirements.get(key) ?? []), row]);
        }
        const legacy = rows(legacyResult)[0];
        return {
            sections: rows(sectionResult).map(row => {
                const sectionRequirements = requirements.get(String(value(row, "id"))) ?? [];
                const skipRequirementsSatisfied = sectionRequirements.length > 0 && sectionRequirements.every(requirement => {
                    const observed = dateValue(requirement, "lastObservedAt");
                    return ["demonstrated", "robust"].includes(String(value(requirement, "status") ?? "")) && Number(value(requirement, "estimate")) >= Number(value(requirement, "threshold")) && Number(value(requirement, "evidenceSufficiency")) >= 0.5 && Boolean(observed && observed > input.freshnessCutoff);
                });
                return { id: String(value(row, "id")), stableKey: String(value(row, "stableKey")), orderIndex: numberValue(row, "orderIndex"), title: String(value(row, "title")), contentSummary: String(value(row, "contentSummary") ?? ""), requiredForCompletion: booleanValue(row, "requiredForCompletion"), baseEstimatedMinutes: numberValue(row, "baseEstimatedMinutes"), generationStatus: String(value(row, "generationStatus")), generationError: String(value(row, "generationError") ?? ""), testGenerationStatus: String(value(row, "testGenerationStatus")), testGenerationError: String(value(row, "testGenerationError") ?? ""), contentRevision: numberValue(row, "contentRevision"), assessmentAfter: booleanValue(row, "assessmentAfter"), componentPlan: value(row, "componentPlan"), contentKind: String(value(row, "contentKind") ?? "standard"), derivationFormat: nullableString(row, "derivationFormat"), progressStatus: nullableString(row, "progressStatus"), activeSeconds: numberValue(row, "activeSeconds"), contentCompletedAt: dateValue(row, "contentCompletedAt"), hasSkipRequirements: sectionRequirements.length > 0, skipRequirementsSatisfied };
            }),
            legacy: legacy ? { introduction: String(value(legacy, "introduction") ?? ""), sections: String(value(legacy, "sections") ?? "[]"), keyTakeaways: String(value(legacy, "keyTakeaways") ?? "[]"), contextSources: String(value(legacy, "contextSources") ?? "[]") } : null,
        };
    }
    async findSectionContent(input: {
        userId: string;
        unitId: string;
        sectionId: string;
    }) {
        const owner = rows(await this.execute(this.em, `SELECT u."id" FROM ${table(this.em, "LearningUnit")} u JOIN ${table(this.em, "LearningGoal")} g ON g."id" = u."goalId" WHERE u."id" = ? AND g."userId" = ? LIMIT 1`, [input.unitId, input.userId]))[0];
        if (!owner)
            return null;
        const legacy = rows(await this.execute(this.em, `SELECT "introduction","sections","keyTakeaways","contextSources" FROM ${table(this.em, "LearningMaterial")} WHERE "unitId" = ? LIMIT 1`, [input.unitId]))[0];
        const legacyValue = legacy ? { introduction: String(value(legacy, "introduction") ?? ""), sections: String(value(legacy, "sections") ?? "[]"), keyTakeaways: String(value(legacy, "keyTakeaways") ?? "[]"), contextSources: String(value(legacy, "contextSources") ?? "[]") } : null;
        const section = rows(await this.execute(this.em, `SELECT s."contentRevision",s."orderIndex",s."contentKind",s."derivationFormat",m."sectionId" AS "materialSectionId",m."introduction",m."blocks",m."keyTakeaways",m."contextSources", d."documentJson" AS "derivationJson", td."documentJson" AS "teachingDerivationJson", td."derivedJson" AS "teachingDerivationDerivedJson" FROM ${table(this.em, "MainCourseSection")} s LEFT JOIN ${table(this.em, "UnitSectionMaterial")} m ON m."sectionId" = s."id" LEFT JOIN ${table(this.em, "UnitSectionDerivation")} d ON d."sectionId" = s."id" LEFT JOIN ${table(this.em, "UnitSectionTeachingDerivation")} td ON td."sectionId" = s."id" WHERE s."id" = ? AND s."unitId" = ? LIMIT 1`, [input.sectionId, input.unitId]))[0];
        if (!section)
            return { sectionFound: false, contentRevision: 0, orderIndex: 0, contentKind: "standard", derivationFormat: null, material: null, derivationJson: null, teachingDerivationJson: null, teachingDerivationDerivedJson: null, priorMaterials: [], legacy: legacyValue };
        const prior = rows(await this.execute(this.em, `SELECT m."introduction",m."blocks",m."keyTakeaways",m."contextSources" FROM ${table(this.em, "MainCourseSection")} s JOIN ${table(this.em, "UnitSectionMaterial")} m ON m."sectionId" = s."id" WHERE s."unitId" = ? AND s."orderIndex" < ? AND s."generationStatus" = 'ready' ORDER BY s."orderIndex" ASC`, [input.unitId, value(section, "orderIndex")]));
        const material = (row: Row) => ({ introduction: String(value(row, "introduction") ?? ""), blocks: String(value(row, "blocks") ?? "[]"), keyTakeaways: String(value(row, "keyTakeaways") ?? "[]"), contextSources: String(value(row, "contextSources") ?? "[]") });
        return { sectionFound: true, contentRevision: numberValue(section, "contentRevision"), orderIndex: numberValue(section, "orderIndex"), contentKind: String(value(section, "contentKind") ?? "standard"), derivationFormat: nullableString(section, "derivationFormat"), material: value(section, "materialSectionId") == null ? null : material(section), derivationJson: nullableString(section, "derivationJson"), teachingDerivationJson: nullableString(section, "teachingDerivationJson"), teachingDerivationDerivedJson: nullableString(section, "teachingDerivationDerivedJson"), priorMaterials: prior.map(material), legacy: legacyValue };
    }
    async publishIfEmpty(unitId: string, drafts: readonly UnitSectionPlanDraft[]): Promise<readonly Readonly<Record<string, unknown>>[]> {
        return this.em.transactional(async (em) => {
            const existing = rows(await this.execute(em, `SELECT * FROM ${table(em, "MainCourseSection")} WHERE "unitId" = ? ORDER BY "orderIndex" ASC`, [unitId]));
            if (existing.length > 0)
                return existing;
            const now = new Date();
            for (const draft of drafts) {
                const sectionId = randomUUID();
                await this.execute(em, `INSERT INTO ${table(em, "UnitSection")}
            ("id", "unitId", "stableKey", "orderIndex", "title", "contentSummary", "assessmentAfter",
             "baseEstimatedMinutes", "componentPlan", "generationInputHash", "contentKind", "createdAt", "updatedAt")
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                    sectionId,
                    unitId,
                    draft.stableKey,
                    draft.orderIndex,
                    draft.title,
                    draft.contentSummary,
                    draft.assessmentAfter,
                    draft.baseEstimatedMinutes,
                    JSON.stringify(draft.componentPlan),
                    draft.generationInputHash,
                    draft.contentKind === "formal_derivation" ? "formal_derivation" : "standard",
                    now,
                    now,
                ]);
                for (const target of draft.targets) {
                    await this.execute(em, `INSERT INTO ${table(em, "UnitSectionLearningTarget")}
              ("sectionId", "learningTargetId", "role") VALUES (?, ?, ?)`, [sectionId, target.learningTargetId, target.role]);
                }
            }
            return rows(await this.execute(em, `SELECT * FROM ${table(em, "MainCourseSection")} WHERE "unitId" = ? ORDER BY "orderIndex" ASC`, [unitId]));
        });
    }
    async recoverInterruptedGenerations(error: string): Promise<number> {
        const now = new Date();
        return this.em.transactional(async (em) => {
            const content = await this.execute(em, `UPDATE ${table(em, "UnitSection")} SET "generationStatus"='failed', "generationError"=?, "generationStartedAt"=NULL, "generationToken"=NULL, "updatedAt"=? WHERE "generationStatus"='building'`, [error, now]);
            const miniTests = await this.execute(em, `UPDATE ${table(em, "UnitSection")} SET "testGenerationStatus"='failed', "testGenerationError"=?, "testGenerationStartedAt"=NULL, "testGenerationToken"=NULL, "updatedAt"=? WHERE "testGenerationStatus"='building'`, [error, now]);
            await this.execute(em, `UPDATE ${table(em, "FormalDerivationRun")} SET "status"='failed', "updatedAt"=? WHERE "status"='running'`, [now]);
            await this.execute(em, `UPDATE ${table(em, "TeachingDerivationRun")} SET "status"='failed', "updatedAt"=? WHERE "status"='running'`, [now]);
            return affected(content) + affected(miniTests);
        });
    }
}
