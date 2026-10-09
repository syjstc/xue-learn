import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { PreparedModulePublicationRepository, PublishPreparedModuleInput, PublishPreparedModuleResult, } from "@xue-learn/core/domain";
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
function stringValue(value: unknown, fallback = ""): string {
    return typeof value === "string" ? value : fallback;
}
function qualifiedTable(em: EntityManager, table: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${table.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
/**
 * Transaction-neutral publication of the prepared, pre-navigation module
 * structure. The caller-owned transaction stops before KACOM publication.
 */
export class MikroOrmPreparedModulePublicationRepository implements PreparedModulePublicationRepository {
    constructor(private readonly em: EntityManager) { }
    async publish(input: PublishPreparedModuleInput): Promise<PublishPreparedModuleResult> {
        const connection = this.em.getConnection();
        const execute = (sql: string, params: unknown[] = []) => connection.execute(sql, params, undefined, this.em.getTransactionContext());
        const goalTable = qualifiedTable(this.em, "LearningGoal");
        const moduleTable = qualifiedTable(this.em, "LearningModule");
        const unitTable = qualifiedTable(this.em, "LearningUnit");
        const lock = "";
        const goalRows = resultRows(await execute(`SELECT "id"
           FROM ${goalTable}
          WHERE "id" = ? AND "userId" = ?${lock}`, [input.goalId, input.userId]));
        if (goalRows.length === 0)
            throw new Error("Goal not found");
        const module = resultRows(await execute(`SELECT "id", "goalId", "orderIndex", "generationBuildToken",
                "generationVersion", "unitPlanningBrief"
           FROM ${moduleTable}
          WHERE "id" = ? AND "goalId" = ?${lock}`, [input.moduleId, input.goalId]))[0];
        if (!module)
            throw new Error("Module not found");
        if (stringValue(rowValue(module, "generationBuildToken")) !==
            input.generationBuildToken) {
            throw new Error("Module generation lease was superseded");
        }
        const existingUnits = resultRows(await execute(`SELECT "id"
           FROM ${unitTable}
          WHERE "moduleId" = ?
          ORDER BY "orderIndex" ASC, "id" ASC`, [input.moduleId]));
        let createdUnitCount = 0;
        let previousUnitId: string | null = null;
        if (existingUnits.length === 0) {
            const orderIndex = Number(rowValue(module, "orderIndex") ?? 0);
            for (const [index, unit] of input.structure.units.entries()) {
                const unitId = randomUUID();
                await execute(`INSERT INTO ${unitTable}
            ("id", "curriculumKey", "goalId", "moduleId", "parentUnitId",
             "unitKind", "title", "orderIndex", "difficulty", "prerequisites",
             "contentSummary", "planAreaRef", "planningOutcomeRefs",
             "moduleCapabilityRefs", "moduleMilestoneRole", "status",
             "cognitiveModelStatus", "requiredForModuleCompletion")
           VALUES (?, ?, ?, ?, NULL, 'lesson', ?, ?, ?, ?, ?, ?, ?, ?, ?,
                   'available', 'pending', true)`, [
                    unitId,
                    randomUUID(),
                    input.goalId,
                    input.moduleId,
                    unit.title,
                    index,
                    unit.difficulty,
                    JSON.stringify(previousUnitId ? [previousUnitId] : []),
                    unit.contentSummary,
                    `a_${orderIndex + 1}`,
                    JSON.stringify([]),
                    JSON.stringify(unit.capabilityRefs),
                    unit.milestoneRole,
                ]);
                previousUnitId = unitId;
                createdUnitCount += 1;
            }
        }
        const preparedBrief = {
            ...input.baseUnitPlanningBrief,
            preparedMasteryModule: {
                capabilities: input.capabilities,
                structure: input.structure,
            },
        };
        const nextVersion = Number(rowValue(module, "generationVersion") ?? 0) + 1;
        const updated = await execute(`UPDATE ${moduleTable}
          SET "unitPlanningBrief" = ?,
              "generationStatus" = 'pending',
              "generationVersion" = ?,
              "generationBuildToken" = NULL,
              "generationBuildStartedAt" = NULL,
              "generationError" = '',
              "generatedAt" = ?,
              "updatedAt" = ?
        WHERE "id" = ? AND "goalId" = ?
          AND "generationBuildToken" = ?
        RETURNING "generationVersion"`, [
            JSON.stringify(preparedBrief),
            nextVersion,
            input.publishedAt,
            input.publishedAt,
            input.moduleId,
            input.goalId,
            input.generationBuildToken,
        ]);
        const updatedRows = resultRows(updated);
        if (updatedRows.length === 0) {
            throw new Error("Module generation lease was superseded");
        }
        const generationVersion = Number(rowValue(updatedRows[0]!, "generationVersion") ?? nextVersion);
        return {
            moduleId: input.moduleId,
            published: true,
            createdUnitCount,
            generationVersion,
        };
    }
    async publishMastery(input: Parameters<PreparedModulePublicationRepository["publishMastery"]>[0]) {
        const connection = this.em.getConnection();
        const execute = (sql: string, params: unknown[] = []) => connection.execute(sql, params, undefined, this.em.getTransactionContext());
        const now = input.publishedAt;
        const moduleTable = qualifiedTable(this.em, "LearningModule");
        const lock = "";
        const module = resultRows(await execute(`SELECT "generationBuildToken" FROM ${moduleTable} WHERE "id"=? AND "goalId"=?${lock}`, [input.moduleId, input.goalId]))[0];
        if (!module || stringValue(rowValue(module, "generationBuildToken")) !== input.generationBuildToken)
            throw new Error("Module generation lease was superseded");
        const unitTable = qualifiedTable(this.em, "LearningUnit");
        const existing = resultRows(await execute(`SELECT "id","curriculumKey" FROM ${unitTable} WHERE "moduleId"=? AND "unitKind"='lesson' ORDER BY "orderIndex"`, [input.moduleId]));
        if (existing.length > 0 && !input.preparedExisting)
            throw new Error("Module retry requires candidate cleanup");
        const entityTable = qualifiedTable(this.em, "CognitiveEntity"), atomTable = qualifiedTable(this.em, "KnowledgeAtom"), constructTable = qualifiedTable(this.em, "CognitiveConstruct"), targetTable = qualifiedTable(this.em, "LearningTarget"), requirementTable = qualifiedTable(this.em, "LearningTargetRequirement"), mappingTable = qualifiedTable(this.em, "ModuleLearningTarget"), relationTable = qualifiedTable(this.em, "CognitiveRelation");
        const ensureEntity = async (item: any, kind: "atom" | "competency") => { const authority = item.entityAuthority; const found = resultRows(await execute(`SELECT "id" FROM ${entityTable} WHERE "goalId"=? AND "stableKey"=? LIMIT 1`, [input.goalId, authority.stableKey]))[0]; const id = found ? String(rowValue(found, "id")) : randomUUID(); if (found)
            await execute(`UPDATE ${entityTable} SET "title"=?,"description"=?,"status"='active',"updatedAt"=? WHERE "id"=?`, [item.title, item.objective ?? item.rationale, now, id]);
        else
            await execute(`INSERT INTO ${entityTable} ("id","stableKey","scopeKey","kind","scope","goalId","title","description","language","definitionVersion","status","provenance","createdAt","updatedAt") VALUES (?,?,?,?,'goal',?,?,?,?,1,'active',?,?,?)`, [id, authority.stableKey, `goal:${input.goalId}`, kind, input.goalId, item.title, item.objective ?? item.rationale, input.contentLanguage, JSON.stringify(item.provenance ?? {}), now, now]); return id; };
        const ensureTarget = async (item: any, entityId: string) => { const authority = item.targetAuthority; const found = resultRows(await execute(`SELECT "id" FROM ${targetTable} WHERE "goalId"=? AND "stableKey"=? LIMIT 1`, [input.goalId, authority.stableKey]))[0]; const id = found ? String(rowValue(found, "id")) : randomUUID(); const criteria = JSON.stringify(item.criteria); if (found)
            await execute(`UPDATE ${targetTable} SET "title"=?,"explanation"=?,"learningObjective"=?,"assessmentCriteria"=?,"status"='active',"updatedAt"=? WHERE "id"=?`, [item.title, item.objective, item.objective, criteria, now, id]);
        else
            await execute(`INSERT INTO ${targetTable} ("id","goalId","stableKey","title","explanation","learningObjective","assessmentCriteria","language","definitionVersion","importance","importanceWeight","difficulty","targetCognitiveLevel","rationale","planningOutcomeRefs","origin","status","introducedModelVersion","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,1,?,?,?,?,?,'[]',?,'active',1,?,?)`, [id, input.goalId, authority.stableKey, item.title, item.objective, item.objective, criteria, input.contentLanguage, item.importance, item.importanceWeight, item.difficulty, item.cognitiveLevel, item.rationale, item.origin ?? "canonical", now, now]); await execute(`DELETE FROM ${requirementTable} WHERE "learningTargetId"=?`, [id]); for (const [index, requirement] of authority.requirements.entries())
            await execute(`INSERT INTO ${requirementTable} ("id","learningTargetId","cognitiveEntityId","requirementType","dimension","required","threshold","gate","weight","orderIndex","rationale","createdAt") VALUES (?,?,?,'requires',?,?,?,?,?,?,?,?)`, [randomUUID(), id, entityId, requirement.dimension, requirement.required, requirement.threshold, requirement.gate, requirement.weight, index, requirement.rationale, now]); return id; };
        const foundationTargets: any[] = [];
        for (const item of input.foundations) {
            const entityId = await ensureEntity(item, "atom");
            const atom = resultRows(await execute(`SELECT "entityId" FROM ${atomTable} WHERE "entityId"=?`, [entityId]))[0];
            if (atom)
                await execute(`UPDATE ${atomTable} SET "statement"=?,"explanation"=?,"assessmentHints"=? WHERE "entityId"=?`, [item.title, item.rationale, JSON.stringify(item.assessmentHints), entityId]);
            else
                await execute(`INSERT INTO ${atomTable} ("entityId","atomType","statement","explanation","boundary","assessmentHints") VALUES (?,'conditional',?,?,'{}',?)`, [entityId, item.title, item.rationale, JSON.stringify(item.assessmentHints)]);
            foundationTargets.push({ ...item, entityId, targetId: await ensureTarget(item, entityId) });
        }
        const capabilityTargets: any[] = [];
        for (const item of input.capabilities) {
            const entityId = await ensureEntity(item, "competency");
            const construct = resultRows(await execute(`SELECT "entityId" FROM ${constructTable} WHERE "entityId"=?`, [entityId]))[0];
            const criteria = JSON.stringify(item.criteria);
            if (construct)
                await execute(`UPDATE ${constructTable} SET "objective"=?,"performanceCriteria"=?,"outputs"=?,"qualityCriteria"=? WHERE "entityId"=?`, [item.objective, criteria, JSON.stringify([item.objective]), criteria, entityId]);
            else
                await execute(`INSERT INTO ${constructTable} ("entityId","constructType","objective","performanceCriteria","contextSchema","inputs","outputs","qualityCriteria","compositionStrategy") VALUES (?,'competency',?,?,'{}','[]',?,?,?)`, [entityId, item.objective, criteria, JSON.stringify([item.objective]), criteria, JSON.stringify({ source: "module_exit_capability" })]);
            capabilityTargets.push({ ...item, entityId, targetId: await ensureTarget(item, entityId) });
        }
        await execute(`DELETE FROM ${mappingTable} WHERE "moduleId"=?`, [input.moduleId]);
        for (const item of [...foundationTargets, ...capabilityTargets]) {
            const m = item.mapping;
            await execute(`INSERT INTO ${mappingTable} ("id","moduleId","learningTargetId","localRef","required","weight","orderIndex","role") VALUES (?,?,?,?,?,?,?,?)`, [randomUUID(), input.moduleId, item.targetId, m.localRef, m.required, m.weight, m.orderIndex, m.role]);
        }
        let previous: string | null = null;
        let firstKey = existing[0] ? String(rowValue(existing[0], "curriculumKey")) : null;
        let created = 0;
        if (existing.length === 0) {
            for (const [index, unit] of input.units.entries()) {
                const id = randomUUID(), key = randomUUID();
                firstKey ??= key;
                await execute(`INSERT INTO ${unitTable} ("id","curriculumKey","goalId","moduleId","parentUnitId","unitKind","title","orderIndex","difficulty","contentSummary","planAreaRef","planningOutcomeRefs","moduleCapabilityRefs","moduleMilestoneRole","prerequisites","status","cognitiveModelStatus","requiredForModuleCompletion") VALUES (?,?,?, ?,NULL,'lesson',?,?,?,?,?,?,?,?,?,'available','pending',true)`, [id, key, input.goalId, input.moduleId, unit.title, index, unit.difficulty, unit.contentSummary, `a_${input.orderIndex + 1}`, JSON.stringify([`o_${Math.min(input.orderIndex + 1, Math.max(1, input.mapOutcomeCount))}`]), JSON.stringify(unit.capabilityRefs), unit.milestoneRole, JSON.stringify(previous ? [previous] : [])]);
                previous = id;
                created++;
            }
        }
        if (firstKey)
            for (const foundation of foundationTargets)
                for (const capability of capabilityTargets) {
                    const found = resultRows(await execute(`SELECT "id" FROM ${relationTable} WHERE "sourceEntityId"=? AND "targetEntityId"=? AND "relationType"='prerequisite'`, [foundation.entityId, capability.entityId]))[0];
                    if (found)
                        await execute(`UPDATE ${relationTable} SET "ownerCurriculumKey"=?,"status"='active',"required"=?,"strength"=?,"updatedAt"=? WHERE "id"=?`, [firstKey, foundation.critical, foundation.critical ? 1 : 0.6, now, String(rowValue(found, "id"))]);
                    else
                        await execute(`INSERT INTO ${relationTable} ("id","ownerCurriculumKey","sourceEntityId","targetEntityId","relationType","strength","required","rationale","status","introducedModelVersion","createdAt","updatedAt") VALUES (?,?,?,?,'prerequisite',?,?,'Verified entry readiness for the module capability','active',1,?,?)`, [randomUUID(), firstKey, foundation.entityId, capability.entityId, foundation.critical ? 1 : 0.6, foundation.critical, now, now]);
                }
        await execute(`UPDATE ${moduleTable} SET "generationVersion"="generationVersion"+1,"entryFoundationStatus"=?,"entryFoundationError"='',"generationBuildStartedAt"=?,"generationError"='',"updatedAt"=? WHERE "id"=? AND "generationBuildToken"=?`, [foundationTargets.length ? "ready" : "not_applicable", now, now, input.moduleId, input.generationBuildToken]);
        return { moduleId: input.moduleId, createdUnitCount: created };
    }
}
