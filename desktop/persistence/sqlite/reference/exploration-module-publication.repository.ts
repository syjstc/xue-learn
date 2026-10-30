import { reconcilePathPrerequisites } from "./prepared-module-publication.repository.js";
import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { ExplorationModulePublicationRepository, PublishExplorationModuleInput, PublishExplorationModuleResult, } from "@xue-learn/core/domain";
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
/** Transaction-neutral publication of an exploration module's lesson rows. */
export class MikroOrmExplorationModulePublicationRepository implements ExplorationModulePublicationRepository {
    constructor(private readonly em: EntityManager) { }
    async publish(input: PublishExplorationModuleInput): Promise<PublishExplorationModuleResult> {
        const connection = this.em.getConnection();
        const execute = (sql: string, params: unknown[] = []) => connection.execute(sql, params, undefined, this.em.getTransactionContext());
        const goalTable = qualifiedTable(this.em, "LearningGoal");
        const moduleTable = qualifiedTable(this.em, "LearningModule");
        const unitTable = qualifiedTable(this.em, "LearningUnit");
        const lock = "";
        const goal = resultRows(await execute(`SELECT "id", "learningMode"
           FROM ${goalTable}
          WHERE "id" = ? AND "userId" = ?${lock}`, [input.goalId, input.userId]))[0];
        if (!goal)
            throw new Error("Goal not found");
        if (rowValue(goal, "learningMode") !== "exploration") {
            throw new Error("Module is not an exploration goal");
        }
        const module = resultRows(await execute(`SELECT "id", "goalId", "generationBuildToken",
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
        if (existingUnits.length > 0) {
            throw new Error("Module retry requires candidate cleanup");
        }
        let previousUnitId: string | null = null;
        for (const [index, unit] of input.units.entries()) {
            const unitId = randomUUID();
            await execute(`INSERT INTO ${unitTable}
          ("id", "curriculumKey", "goalId", "moduleId", "parentUnitId",
           "unitKind", "title", "orderIndex", "difficulty", "prerequisites",
           "contentSummary", "planAreaRef", "planningOutcomeRefs",
           "moduleCapabilityRefs", "moduleMilestoneRole", "status",
           "cognitiveModelStatus", "requiredForModuleCompletion")
         VALUES (?, ?, ?, ?, NULL, 'lesson', ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 'available', 'expanded', true)`, [
                unitId,
                randomUUID(),
                input.goalId,
                input.moduleId,
                unit.title,
                index,
                unit.difficulty,
                JSON.stringify(JSON.stringify(rowValue(module, "unitPlanningBrief") ?? "").includes("pathContract") ? [] : previousUnitId ? [previousUnitId] : []),
                unit.contentSummary,
                `a_${input.orderIndex + 1}`,
                JSON.stringify([]),
                JSON.stringify([]),
                unit.milestoneRole,
            ]);
            previousUnitId = unitId;
        }
        const nextVersion = Number(rowValue(module, "generationVersion") ?? 0) + 1;
        const updated = await execute(`UPDATE ${moduleTable}
          SET "generationStatus" = 'ready',
              "generationVersion" = ?,
              "entryFoundationStatus" = 'not_applicable',
              "entryFoundationError" = '',
              "generationBuildToken" = NULL,
              "generationBuildStartedAt" = NULL,
              "generationError" = '',
              "generatedAt" = ?,
              "updatedAt" = ?
        WHERE "id" = ? AND "goalId" = ?
          AND "generationBuildToken" = ?
        RETURNING "generationVersion"`, [
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
        if (JSON.stringify(rowValue(module, "unitPlanningBrief") ?? "").includes("pathContract")) await reconcilePathPrerequisites(execute, unitTable, moduleTable, input.goalId);
        return {
            moduleId: input.moduleId,
            published: true,
            createdUnitCount: input.units.length,
            generationVersion: Number(rowValue(updatedRows[0]!, "generationVersion") ?? nextVersion),
        };
    }
}
