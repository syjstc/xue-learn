import type { EntityManager } from "@mikro-orm/core";
import { MaterialReplacementStaleRevisionError, type SectionMaterialReplacementInput, type SectionMaterialReplacementRepository, type MaterialReplacementResult, } from "@xue-learn/core/domain";
import { CognitionPersistenceError } from "@xue-learn/core/server/cognition/persistence/error";
import { graphStateForReplacement, MikroOrmMaterialReplacementRepository, } from "./material-replacement.repository.ts";
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
function qualifiedTable(em: EntityManager, table: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${table.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
/** Raw adapter for atomic first-class section material replacement. */
export class MikroOrmSectionMaterialReplacementRepository extends MikroOrmMaterialReplacementRepository implements SectionMaterialReplacementRepository {
    constructor(em: EntityManager) {
        super(em);
    }
    async replaceSection(input: SectionMaterialReplacementInput): Promise<MaterialReplacementResult> {
        const now = new Date();
        await this.acquireUnitResetLock(input.unitId);
        const { contentRevision } = await this.readOwnedUnit(input);
        const section = resultRows(await this.execute(`SELECT "unitId", "contentRevision"
           FROM ${qualifiedTable(this.em, "MainCourseSection")}
          WHERE "id" = ? AND "unitId" = ?${""}`, [input.sectionId, input.unitId]))[0];
        if (!section) {
            throw new CognitionPersistenceError("ownership_mismatch", "material replacement section is not part of the learner unit");
        }
        const sectionContentRevision = Number(rowValue(section, "contentRevision"));
        if (sectionContentRevision !== input.expectedSectionContentRevision) {
            throw new MaterialReplacementStaleRevisionError(input.expectedSectionContentRevision, sectionContentRevision);
        }
        const reset = input.resetProgress
            ? await this.reset.resetOwned({ unitId: input.unitId })
            : { reset: false, userId: null, affectedEntityIds: [] };
        if (input.clearDownstream) {
            if (await this.tableExists("CornellNote")) {
                await this.execute(`DELETE FROM ${qualifiedTable(this.em, "CornellNote")} WHERE "unitId" = ?`, [input.unitId]);
            }
        }
        const sectionTable = qualifiedTable(this.em, "UnitSectionMaterial");
        const jsonType = "";
        await this.execute(`INSERT INTO ${sectionTable}
        ("id", "sectionId", "introduction", "blocks", "keyTakeaways",
         "contextSources", "sourceItems", "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, ?, ?, ?${jsonType}, ?, ?)
       ON CONFLICT ("sectionId") DO UPDATE SET
         "introduction" = ?, "blocks" = ?, "keyTakeaways" = ?,
         "contextSources" = ?, "sourceItems" = ?${jsonType}, "updatedAt" = ?`, [
            `${input.sectionId}:${now.getTime()}`,
            input.sectionId,
            input.sectionMaterial.introduction,
            input.sectionMaterial.sections,
            input.sectionMaterial.keyTakeaways,
            input.sectionMaterial.contextSources,
            input.sectionMaterial.sourceItemsJson,
            now,
            now,
            input.sectionMaterial.introduction,
            input.sectionMaterial.sections,
            input.sectionMaterial.keyTakeaways,
            input.sectionMaterial.contextSources,
            input.sectionMaterial.sourceItemsJson,
            now,
        ]);
        if (input.publishChecks) {
            await this.materialChecks.publishTasks({
                userId: input.userId,
                goalId: input.goalId,
                unitId: input.unitId,
                tasks: input.materialCheckTasks,
            });
        }
        const sessionTable = qualifiedTable(this.em, "UnitSessionState");
        const storedGraph = resultRows(await this.execute(`SELECT "graphState" FROM ${sessionTable}
          WHERE "unitId" = ?${""}`, [input.unitId]))[0];
        await this.upsertSessionState({ unitId: input.unitId }, graphStateForReplacement(rowValue(storedGraph ?? {}, "graphState"), input.aggregatedMaterial.sourceItemsJson), now);
        await this.execute(`DELETE FROM ${qualifiedTable(this.em, "MaterialFollowUp")}
        WHERE "id" = ? AND "unitId" = ?`, [input.deleteFollowUpThreadId, input.unitId]);
        await this.execute(`UPDATE ${qualifiedTable(this.em, "LearningUnit")}
          SET "contentRevision" = "contentRevision" + 1
        WHERE "id" = ? AND "contentRevision" = ?`, [input.unitId, input.expectedContentRevision]);
        await this.execute(`UPDATE ${qualifiedTable(this.em, "UnitSection")}
          SET "contentRevision" = "contentRevision" + 1
        WHERE "id" = ? AND "unitId" = ? AND "contentRevision" = ?`, [input.sectionId, input.unitId, input.expectedSectionContentRevision]);
        const revisions = resultRows(await this.execute(`SELECT u."contentRevision" AS "unitRevision",
                s."contentRevision" AS "sectionRevision"
           FROM ${qualifiedTable(this.em, "LearningUnit")} u
           JOIN ${qualifiedTable(this.em, "MainCourseSection")} s ON s."unitId" = u."id"
          WHERE u."id" = ? AND s."id" = ?`, [input.unitId, input.sectionId]))[0];
        const updatedUnitRevision = Number(rowValue(revisions ?? {}, "unitRevision"));
        const updatedSectionRevision = Number(rowValue(revisions ?? {}, "sectionRevision"));
        if (updatedUnitRevision !== input.expectedContentRevision + 1 ||
            updatedSectionRevision !== input.expectedSectionContentRevision + 1) {
            throw new MaterialReplacementStaleRevisionError(input.expectedContentRevision, Number.isFinite(updatedUnitRevision) ? updatedUnitRevision : undefined);
        }
        return { contentRevision: updatedUnitRevision, reset };
    }
}
