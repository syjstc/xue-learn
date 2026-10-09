import type { EntityManager } from "@mikro-orm/core";
import type { ModuleGenerationLeaseClaimInput, ModuleGenerationLeaseClaimRecord, ModuleGenerationLeaseFailureInput, ModuleGenerationLeaseFailureRecord, ModuleGenerationLeaseReleaseInput, ModuleGenerationLeaseReleaseRecord, ModuleGenerationLeaseRepository, } from "@xue-learn/core/domain";
import { safeReferenceDateValue } from "./date-value.ts";
type ValueRow = Readonly<Record<string, unknown>>;
const MODULE_BUILD_LEASE_MS = 15 * 60 * 1000;
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
function timeValue(value: unknown): number {
    return safeReferenceDateValue(value)?.getTime() ?? 0;
}
function jsonValue(value: unknown) {
    if (typeof value !== "string")
        return value;
    try {
        return JSON.parse(value);
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
/** Atomic internal claim of a sequential module generation lease. */
export class MikroOrmModuleGenerationLeaseRepository implements ModuleGenerationLeaseRepository {
    constructor(private readonly em: EntityManager) { }
    async claim(input: ModuleGenerationLeaseClaimInput): Promise<ModuleGenerationLeaseClaimRecord> {
        return this.em.transactional((tx) => this.claimInTransaction(tx, input));
    }
    async fail(input: ModuleGenerationLeaseFailureInput): Promise<ModuleGenerationLeaseFailureRecord> {
        return this.em.transactional(async (em) => {
            const moduleTable = qualifiedTable(em, "LearningModule");
            const connection = em.getConnection();
            const execute = (sql: string, params: unknown[] = []) => connection.execute(sql, params, undefined, em.getTransactionContext());
            const updated = await execute(`UPDATE ${moduleTable}
            SET "generationStatus" = 'failed',
                "generationBuildToken" = NULL,
                "generationBuildStartedAt" = NULL,
                "generationError" = ?,
                "updatedAt" = ?
          WHERE "id" = ? AND "goalId" = ?
            AND "generationBuildToken" = ?
          RETURNING "id"`, [input.message, new Date(), input.moduleId, input.goalId, input.token]);
            return { applied: resultRows(updated).length > 0 };
        });
    }
    async release(input: ModuleGenerationLeaseReleaseInput): Promise<ModuleGenerationLeaseReleaseRecord> {
        return this.em.transactional(async (em) => {
            const moduleTable = qualifiedTable(em, "LearningModule");
            const connection = em.getConnection();
            const execute = (sql: string, params: unknown[] = []) => connection.execute(sql, params, undefined, em.getTransactionContext());
            const updated = await execute(`UPDATE ${moduleTable}
            SET "generationBuildToken" = NULL,
                "generationBuildStartedAt" = NULL,
                "updatedAt" = ?
          WHERE "id" = ? AND "goalId" = ?
            AND "generationBuildToken" = ?
          RETURNING "id"`, [new Date(), input.moduleId, input.goalId, input.token]);
            return { applied: resultRows(updated).length > 0 };
        });
    }
    async loadContext(input: Parameters<ModuleGenerationLeaseRepository["loadContext"]>[0]) {
        const module = resultRows(await this.em.getConnection().execute(`SELECT m.*,g."userId" AS "goalUserId",g."title" AS "goalTitle",g."level" AS "goalLevel",g."learningMode",g."planningMode",g."generationOptions",g."contentLanguage",g."mapPlanJson" FROM ${qualifiedTable(this.em, "LearningModule")} m JOIN ${qualifiedTable(this.em, "LearningGoal")} g ON g."id"=m."goalId" WHERE m."id"=? AND m."goalId"=? LIMIT 1`, [input.moduleId, input.goalId], undefined, this.em.getTransactionContext()))[0];
        if (!module)
            return null;
        const execute = (sql: string, params: unknown[] = []) => this.em.getConnection().execute(sql, params, undefined, this.em.getTransactionContext());
        const units = resultRows(await execute(`SELECT "id","unitKind","cognitiveModelStatus" FROM ${qualifiedTable(this.em, "LearningUnit")} WHERE "moduleId"=?`, [input.moduleId]));
        const targetCount = Number(rowValue(resultRows(await execute(`SELECT COUNT(*) AS "count" FROM ${qualifiedTable(this.em, "ModuleLearningTarget")} WHERE "moduleId"=?`, [input.moduleId]))[0] ?? {}, "count") ?? 0);
        const priorModules = resultRows(await execute(`SELECT "title","summary","objective" FROM ${qualifiedTable(this.em, "LearningModule")} WHERE "goalId"=? AND "orderIndex"<? ORDER BY "orderIndex"`, [input.goalId, Number(rowValue(module, "orderIndex") ?? 0)]));
        const priorEntities = String(rowValue(module, "learningMode")) === "exploration" ? [] : resultRows(await execute(`SELECT "stableKey","kind","title","description" FROM ${qualifiedTable(this.em, "CognitiveEntity")} WHERE "goalId"=? AND "status"='active' ORDER BY "kind","title" LIMIT ?`, [input.goalId, input.priorEntityLimit]));
        return { ...module, plannedOutcomes: jsonValue(rowValue(module, "plannedOutcomes")), entryFoundationBriefs: jsonValue(rowValue(module, "entryFoundationBriefs")), exitCapabilityBriefs: jsonValue(rowValue(module, "exitCapabilityBriefs")), unitPlanningBrief: jsonValue(rowValue(module, "unitPlanningBrief")), goal: { userId: rowValue(module, "goalUserId"), title: rowValue(module, "goalTitle"), level: rowValue(module, "goalLevel"), learningMode: rowValue(module, "learningMode"), planningMode: rowValue(module, "planningMode"), generationOptions: jsonValue(rowValue(module, "generationOptions")), contentLanguage: rowValue(module, "contentLanguage"), mapPlanJson: String(rowValue(module, "mapPlanJson") ?? "") }, existingUnitCount: units.length, moduleTargetCount: targetCount, priorModules, priorEntities };
    }
    async markExistingExplorationReady(moduleId: string) { const now = new Date(); const execute = (sql: string, params: unknown[] = []) => this.em.getConnection().execute(sql, params, undefined, this.em.getTransactionContext()); await execute(`UPDATE ${qualifiedTable(this.em, "LearningUnit")} SET "cognitiveModelStatus"='expanded',"cognitiveModelBuildStartedAt"=NULL,"cognitiveModelBuildToken"=NULL,"cognitiveModelBuildInputHash"=NULL WHERE "moduleId"=? AND "unitKind"='lesson'`, [moduleId]); await execute(`UPDATE ${qualifiedTable(this.em, "LearningModule")} SET "generationStatus"='ready',"generationBuildToken"=NULL,"generationBuildStartedAt"=NULL,"generationError"='',"generatedAt"=?,"updatedAt"=? WHERE "id"=?`, [now, now, moduleId]); }
    async rearmFailedUnits(moduleId: string) { await this.em.getConnection().execute(`UPDATE ${qualifiedTable(this.em, "LearningUnit")} SET "cognitiveModelStatus"='pending',"cognitiveModelBuildStartedAt"=NULL,"cognitiveModelBuildToken"=NULL,"cognitiveModelBuildInputHash"=NULL WHERE "moduleId"=? AND "cognitiveModelStatus"='failed'`, [moduleId], undefined, this.em.getTransactionContext()); }
    async setGenerationInputHash(moduleId: string, inputHash: string) { await this.em.getConnection().execute(`UPDATE ${qualifiedTable(this.em, "LearningModule")} SET "generationInputHash"=?,"generationError"='',"updatedAt"=? WHERE "id"=?`, [inputHash, new Date(), moduleId], undefined, this.em.getTransactionContext()); }
    async loadGenerationHashContexts(goalId: string): Promise<readonly any[]> {
        const execute = (sql: string, params: unknown[] = []) => this.em.getConnection().execute(sql, params, undefined, this.em.getTransactionContext());
        const modules = resultRows(await execute(`SELECT * FROM ${qualifiedTable(this.em, "LearningModule")} WHERE "goalId"=? ORDER BY "orderIndex"`, [goalId]));
        return Promise.all(modules.map(async (module) => {
            const moduleId = String(rowValue(module, "id"));
            const learningTargets = resultRows(await execute(`SELECT m."localRef",m."learningTargetId",m."required",m."weight",m."orderIndex",t."definitionVersion" FROM ${qualifiedTable(this.em, "ModuleLearningTarget")} m JOIN ${qualifiedTable(this.em, "LearningTarget")} t ON t."id"=m."learningTargetId" WHERE m."moduleId"=? ORDER BY m."orderIndex"`, [moduleId]));
            const mappedTargets = await Promise.all(learningTargets.map(async (mapping) => ({
                localRef: rowValue(mapping, "localRef"), learningTargetId: rowValue(mapping, "learningTargetId"), required: rowValue(mapping, "required"), weight: rowValue(mapping, "weight"),
                learningTarget: { definitionVersion: rowValue(mapping, "definitionVersion"), requirements: resultRows(await execute(`SELECT r."cognitiveEntityId",r."dimension",r."required",r."gate",r."threshold",e."definitionVersion" AS "entityDefinitionVersion" FROM ${qualifiedTable(this.em, "LearningTargetRequirement")} r JOIN ${qualifiedTable(this.em, "CognitiveEntity")} e ON e."id"=r."cognitiveEntityId" WHERE r."learningTargetId"=? ORDER BY r."orderIndex"`, [rowValue(mapping, "learningTargetId")])).map(requirement => ({ cognitiveEntityId: rowValue(requirement, "cognitiveEntityId"), dimension: rowValue(requirement, "dimension"), required: rowValue(requirement, "required"), gate: rowValue(requirement, "gate"), threshold: rowValue(requirement, "threshold"), cognitiveEntity: { definitionVersion: rowValue(requirement, "entityDefinitionVersion") } })) }
            })));
            const units = await Promise.all(resultRows(await execute(`SELECT "id", "curriculumKey"
               FROM ${qualifiedTable(this.em, "LearningUnit")}
              WHERE "moduleId" = ? AND "unitKind" = 'lesson'
              ORDER BY "orderIndex"`, [moduleId])).map(async (unit) => ({
                curriculumKey: rowValue(unit, "curriculumKey"),
                learningTargets: resultRows(await execute(`SELECT "localRef", "learningTargetId", "required", "weight", "role"
                 FROM ${qualifiedTable(this.em, "UnitLearningTarget")}
                WHERE "unitId" = ?
                ORDER BY "orderIndex"`, [rowValue(unit, "id")])),
            })));
            return { ...module, plannedOutcomes: jsonValue(rowValue(module, "plannedOutcomes")), unitPlanningBrief: jsonValue(rowValue(module, "unitPlanningBrief")), entryFoundationBriefs: jsonValue(rowValue(module, "entryFoundationBriefs")), exitCapabilityBriefs: jsonValue(rowValue(module, "exitCapabilityBriefs")), learningTargets: mappedTargets, units };
        }));
    }
    private async claimInTransaction(em: EntityManager, input: ModuleGenerationLeaseClaimInput): Promise<ModuleGenerationLeaseClaimRecord> {
        const moduleTable = qualifiedTable(em, "LearningModule");
        const connection = em.getConnection();
        const execute = (sql: string, params: unknown[] = []) => connection.execute(sql, params, undefined, em.getTransactionContext());
        const moduleRows = resultRows(await execute(`SELECT "id", "goalId", "unlockStatus", "generationStatus",
                "generationBuildStartedAt"
           FROM ${moduleTable}
          WHERE "id" = ?
          ${""}`, [input.moduleId]));
        const module = moduleRows[0];
        if (!module || rowValue(module, "goalId") !== input.goalId) {
            throw new Error("Module not found");
        }
        const unlockStatus = rowValue(module, "unlockStatus");
        const generationStatus = rowValue(module, "generationStatus");
        if ((unlockStatus === "locked" && !input.allowLockedBeforeNavigation) ||
            unlockStatus === "completed" ||
            generationStatus === "ready") {
            return { claimed: false };
        }
        const buildStartedAt = timeValue(rowValue(module, "generationBuildStartedAt"));
        if (generationStatus === "building" &&
            buildStartedAt > 0 &&
            input.startedAt.getTime() - buildStartedAt < MODULE_BUILD_LEASE_MS) {
            return { claimed: false };
        }
        await execute(`UPDATE ${moduleTable}
          SET "generationStatus" = 'building',
              "generationBuildStartedAt" = ?,
              "generationBuildToken" = ?,
              "generationError" = '',
              "updatedAt" = ?
        WHERE "id" = ? AND "goalId" = ?`, [
            input.startedAt,
            input.token,
            input.startedAt,
            input.moduleId,
            input.goalId,
        ]);
        return { claimed: true };
    }
}
