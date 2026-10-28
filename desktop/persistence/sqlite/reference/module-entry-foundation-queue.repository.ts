import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { ModuleEntryFoundationQueueRepository } from "@xue-learn/core/domain";
import { safeReferenceDateValue } from "./date-value.ts";
type Row = Readonly<Record<string, unknown>>;
const rows = (result: unknown): readonly Row[] => Array.isArray(result) ? result as Row[] : result && typeof result === "object" && "rows" in result && Array.isArray((result as {
    rows?: unknown;
}).rows) ? (result as {
    rows: Row[];
}).rows : [];
const value = (row: Row, key: string) => row[key] ?? row[key[0]!.toLowerCase() + key.slice(1)];
const table = (em: EntityManager, name: string) => { const schema = em.schema ?? em.config?.getSchema(); const quoted = `"${name.replaceAll('"', '""')}"`; return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted; };
const affected = (result: unknown) => typeof result === "number" ? result : result && typeof result === "object" ? Number((result as {
    affectedRows?: unknown;
    rowCount?: unknown;
}).affectedRows ?? (result as {
    rowCount?: unknown;
}).rowCount ?? 0) : 0;
type Brief = {
    ref: string;
    title: string;
    rationale: string;
    criticality: "critical" | "recommended";
    verificationDimensions: Array<"memory" | "understanding" | "application">;
};
const briefs = (raw: unknown): Brief[] => { try {
    const source = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(source))
        return [];
    return source.flatMap((item, index) => { if (!item || typeof item !== "object" || Array.isArray(item))
        return []; const row = item as Record<string, unknown>; const title = typeof row.title === "string" ? row.title.trim() : ""; if (!title)
        return []; const dimensions = Array.isArray(row.verificationDimensions) ? row.verificationDimensions.filter((dimension): dimension is Brief["verificationDimensions"][number] => dimension === "memory" || dimension === "understanding" || dimension === "application") : []; return [{ ref: typeof row.ref === "string" ? row.ref : `entry_${index + 1}`, title, rationale: typeof row.rationale === "string" && row.rationale.trim() ? row.rationale.trim() : title, criticality: row.criticality === "critical" ? "critical" : "recommended", verificationDimensions: dimensions.length ? dimensions : ["understanding"] }]; });
}
catch {
    return [];
} };
export class MikroOrmModuleEntryFoundationQueueRepository implements ModuleEntryFoundationQueueRepository {
    constructor(private readonly em: EntityManager) { }
    private execute(em: EntityManager, sql: string, params: unknown[] = []) { return em.getConnection().execute(sql, params, undefined, em.getTransactionContext()); }
    async findOwnedContext(input: {
        userId: string;
        goalId: string;
        moduleId: string;
    }) {
        const row = rows(await this.execute(this.em, `SELECT m."id",m."orderIndex",m."entryFoundationBriefs",m."entryFoundationStatus",g."mapPlanJson",EXISTS(SELECT 1 FROM ${table(this.em, "ModuleLearningTarget")} t WHERE t."moduleId"=m."id" AND t."role"='entry') AS "hasEntryTargets" FROM ${table(this.em, "LearningModule")} m JOIN ${table(this.em, "LearningGoal")} g ON g."id"=m."goalId" WHERE m."id"=? AND m."goalId"=? AND g."userId"=? LIMIT 1`, [input.moduleId, input.goalId, input.userId]))[0];
        return row ? { moduleId: String(value(row, "id")), orderIndex: Number(value(row, "orderIndex")), entryFoundationBriefs: value(row, "entryFoundationBriefs"), entryFoundationStatus: String(value(row, "entryFoundationStatus")), mapPlanJson: String(value(row, "mapPlanJson") ?? ""), hasEntryTargets: Boolean(value(row, "hasEntryTargets")) } : null;
    }
    async markNotApplicable(moduleId: string) { return affected(await this.execute(this.em, `UPDATE ${table(this.em, "LearningModule")} SET "entryFoundationStatus"='not_applicable',"entryFoundationError"='',"updatedAt"=? WHERE "id"=? AND "entryFoundationStatus" IN ('pending','failed','building')`, [new Date(), moduleId])) > 0; }
    async claim(input: {
        userId: string;
        goalId: string;
        moduleId: string;
        briefs: unknown;
        token: string;
        now: Date;
        leaseMs: number;
        eventType: string;
    }) {
        return this.em.transactional(async (em) => {
            const lock = "";
            const current = rows(await this.execute(em, `SELECT "entryFoundationStatus","entryFoundationBuildStartedAt" FROM ${table(em, "LearningModule")} WHERE "id"=?${lock}`, [input.moduleId]))[0];
            if (!current)
                return false;
            const started = value(current, "entryFoundationBuildStartedAt");
            if (value(current, "entryFoundationStatus") === "building" && input.now.getTime() - (safeReferenceDateValue(started)?.getTime() ?? 0) < input.leaseMs)
                return false;
            const live = rows(await this.execute(em, `SELECT "id" FROM ${table(em, "EventOutbox")} WHERE "type"=? AND "publishedAt" IS NULL AND "deadLetteredAt" IS NULL AND "payload" LIKE ? LIMIT 1`, [input.eventType, `%"moduleId":"${input.moduleId}"%`]))[0];
            if (live)
                return false;
            await this.execute(em, `UPDATE ${table(em, "LearningModule")} SET "entryFoundationBriefs"=?,"entryFoundationStatus"='building',"entryFoundationError"='',"entryFoundationBuildStartedAt"=?,"entryFoundationBuildToken"=?,"updatedAt"=? WHERE "id"=?`, [JSON.stringify(input.briefs), input.now, input.token, input.now, input.moduleId]);
            await this.execute(em, `INSERT INTO ${table(em, "EventOutbox")} ("id","type","payload","createdAt","attemptCount") VALUES (?, ?, ?, ?, 0)`, [randomUUID(), input.eventType, JSON.stringify({ userId: input.userId, goalId: input.goalId, moduleId: input.moduleId, token: input.token }), input.now]);
            return true;
        });
    }
    async publish(input: Parameters<ModuleEntryFoundationQueueRepository["publish"]>[0]) {
        return this.em.transactional(async (em) => {
            const lock = "";
            const module = rows(await this.execute(em, `SELECT m."id",m."goalId",m."curriculumKey",m."entryFoundationBriefs",m."entryFoundationBuildToken",g."contentLanguage",(SELECT u."curriculumKey" FROM ${table(em, "LearningUnit")} u WHERE u."moduleId"=m."id" AND u."unitKind"='lesson' ORDER BY u."orderIndex" ASC LIMIT 1) AS "ownerCurriculumKey" FROM ${table(em, "LearningModule")} m JOIN ${table(em, "LearningGoal")} g ON g."id"=m."goalId" WHERE m."id"=? AND m."goalId"=?${lock}`, [input.moduleId, input.goalId]))[0];
            if (!module || String(value(module, "entryFoundationBuildToken") ?? "") !== input.token)
                return { goalId: input.goalId, status: "superseded" as const };
            const ownerCurriculumKey = String(value(module, "ownerCurriculumKey") ?? "");
            const now = new Date();
            const foundationBriefs = briefs(value(module, "entryFoundationBriefs"));
            if (foundationBriefs.length === 0 || !ownerCurriculumKey) {
                await this.execute(em, `UPDATE ${table(em, "LearningModule")} SET "entryFoundationStatus"='not_applicable',"entryFoundationBuildToken"=NULL,"entryFoundationBuildStartedAt"=NULL,"updatedAt"=? WHERE "id"=?`, [now, input.moduleId]);
                return { goalId: input.goalId, status: "not_applicable" as const };
            }
            const capabilityEntityIds = rows(await this.execute(em, `SELECT DISTINCT r."cognitiveEntityId" FROM ${table(em, "ModuleLearningTarget")} m JOIN ${table(em, "LearningTargetRequirement")} r ON r."learningTargetId"=m."learningTargetId" WHERE m."moduleId"=? AND m."role"='exit'`, [input.moduleId])).map(row => String(value(row, "cognitiveEntityId")));
            for (const [index, brief] of foundationBriefs.entries()) {
                const entityStableKey = `module:${String(value(module, "curriculumKey"))}:entry:${index + 1}`;
                const targetStableKey = `module:${String(value(module, "curriculumKey"))}:entry-target:${index + 1}`;
                const entityRow = rows(await this.execute(em, `SELECT "id" FROM ${table(em, "CognitiveEntity")} WHERE "goalId"=? AND "stableKey"=? LIMIT 1`, [input.goalId, entityStableKey]))[0];
                const entityId = entityRow ? String(value(entityRow, "id")) : randomUUID();
                if (entityRow)
                    await this.execute(em, `UPDATE ${table(em, "CognitiveEntity")} SET "title"=?,"description"=?,"status"='active',"updatedAt"=? WHERE "id"=?`, [brief.title, brief.rationale, now, entityId]);
                else
                    await this.execute(em, `INSERT INTO ${table(em, "CognitiveEntity")} ("id","stableKey","scopeKey","kind","scope","goalId","title","description","language","definitionVersion","status","provenance","createdAt","updatedAt") VALUES (?,?,?,'atom','goal',?,?,?,?,1,'active',?,?,?)`, [entityId, entityStableKey, `goal:${input.goalId}`, input.goalId, brief.title, brief.rationale, String(value(module, "contentLanguage") || "zh-Hans"), JSON.stringify({ source: "module.entry_foundation.legacy_contract", planningRef: brief.ref, unverifiedPlanningAssumption: true }), now, now]);
                const atom = rows(await this.execute(em, `SELECT "entityId" FROM ${table(em, "KnowledgeAtom")} WHERE "entityId"=?`, [entityId]))[0];
                if (atom)
                    await this.execute(em, `UPDATE ${table(em, "KnowledgeAtom")} SET "statement"=?,"explanation"=?,"assessmentHints"=? WHERE "entityId"=?`, [brief.title, brief.rationale, JSON.stringify([`Verify ${brief.verificationDimensions.join(", ")}`]), entityId]);
                else
                    await this.execute(em, `INSERT INTO ${table(em, "KnowledgeAtom")} ("entityId","atomType","statement","explanation","boundary","assessmentHints") VALUES (?,'conditional',?,?,'{}',?)`, [entityId, brief.title, brief.rationale, JSON.stringify([`Verify ${brief.verificationDimensions.join(", ")}`])]);
                const targetRow = rows(await this.execute(em, `SELECT "id" FROM ${table(em, "LearningTarget")} WHERE "goalId"=? AND "stableKey"=? LIMIT 1`, [input.goalId, targetStableKey]))[0];
                const targetId = targetRow ? String(value(targetRow, "id")) : randomUUID();
                const objective = `Independently demonstrate the entry foundation: ${brief.title}`;
                const criteria = JSON.stringify([{ ref: `entry_${index + 1}:c1`, text: brief.rationale }]);
                const important = brief.criticality === "critical";
                const level = brief.verificationDimensions.includes("application") ? "apply" : brief.verificationDimensions.includes("understanding") ? "understand" : "remember";
                if (targetRow)
                    await this.execute(em, `UPDATE ${table(em, "LearningTarget")} SET "title"=?,"explanation"=?,"learningObjective"=?,"assessmentCriteria"=?,"status"='active',"updatedAt"=? WHERE "id"=?`, [brief.title, brief.rationale, objective, criteria, now, targetId]);
                else
                    await this.execute(em, `INSERT INTO ${table(em, "LearningTarget")} ("id","goalId","stableKey","title","explanation","learningObjective","assessmentCriteria","language","definitionVersion","importance","importanceWeight","difficulty","targetCognitiveLevel","rationale","planningOutcomeRefs","origin","status","introducedModelVersion","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,1,?,?,'medium',?,?, '[]','curated','active',1,?,?)`, [targetId, input.goalId, targetStableKey, brief.title, brief.rationale, objective, criteria, String(value(module, "contentLanguage") || "zh-Hans"), important ? "core" : "supporting", important ? 5 : 2, level, brief.rationale, now, now]);
                await this.execute(em, `DELETE FROM ${table(em, "LearningTargetRequirement")} WHERE "learningTargetId"=?`, [targetId]);
                for (const [orderIndex, dimension] of brief.verificationDimensions.entries())
                    await this.execute(em, `INSERT INTO ${table(em, "LearningTargetRequirement")} ("id","learningTargetId","cognitiveEntityId","requirementType","dimension","required","threshold","gate","weight","orderIndex","rationale","createdAt") VALUES (?,?,?,'requires',?,?,?,?,1,?,?,?)`, [randomUUID(), targetId, entityId, dimension, important, 0.7, important, orderIndex, brief.rationale, now]);
                const mapping = rows(await this.execute(em, `SELECT "id" FROM ${table(em, "ModuleLearningTarget")} WHERE "moduleId"=? AND "learningTargetId"=?`, [input.moduleId, targetId]))[0];
                if (mapping)
                    await this.execute(em, `UPDATE ${table(em, "ModuleLearningTarget")} SET "required"=?,"weight"=?,"orderIndex"=?,"role"='entry' WHERE "id"=?`, [important, important ? 1 : 0.5, index, String(value(mapping, "id"))]);
                else
                    await this.execute(em, `INSERT INTO ${table(em, "ModuleLearningTarget")} ("id","moduleId","learningTargetId","localRef","required","weight","orderIndex","role") VALUES (?,?,?,?,?,?,?,'entry')`, [randomUUID(), input.moduleId, targetId, `entry_${index + 1}`, important, important ? 1 : 0.5, index]);
                for (const targetEntityId of capabilityEntityIds) {
                    const relation = rows(await this.execute(em, `SELECT "id" FROM ${table(em, "CognitiveRelation")} WHERE "sourceEntityId"=? AND "targetEntityId"=? AND "relationType"='prerequisite'`, [entityId, targetEntityId]))[0];
                    if (relation)
                        await this.execute(em, `UPDATE ${table(em, "CognitiveRelation")} SET "ownerCurriculumKey"=?,"status"='active',"required"=?,"updatedAt"=? WHERE "id"=?`, [ownerCurriculumKey, important, now, String(value(relation, "id"))]);
                    else
                        await this.execute(em, `INSERT INTO ${table(em, "CognitiveRelation")} ("id","ownerCurriculumKey","sourceEntityId","targetEntityId","relationType","strength","required","rationale","status","introducedModelVersion","createdAt","updatedAt") VALUES (?,?,?,?,'prerequisite',?,?,'Unverified module entry foundation','active',1,?,?)`, [randomUUID(), ownerCurriculumKey, entityId, targetEntityId, important ? 1 : 0.6, important, now, now]);
                }
            }
            await this.execute(em, `UPDATE ${table(em, "LearningModule")} SET "entryFoundationStatus"='ready',"entryFoundationError"='',"entryFoundationBuildToken"=NULL,"entryFoundationBuildStartedAt"=NULL,"updatedAt"=? WHERE "id"=?`, [now, input.moduleId]);
            return { goalId: input.goalId, status: "ready" as const };
        });
    }
    async markFailed(input: {
        moduleId: string;
        token: string;
        message: string;
    }) { await this.execute(this.em, `UPDATE ${table(this.em, "LearningModule")} SET "entryFoundationStatus"='failed',"entryFoundationError"=?,"entryFoundationBuildToken"=NULL,"entryFoundationBuildStartedAt"=NULL,"updatedAt"=? WHERE "id"=? AND "entryFoundationBuildToken"=?`, [input.message, new Date(), input.moduleId, input.token]); }
}
