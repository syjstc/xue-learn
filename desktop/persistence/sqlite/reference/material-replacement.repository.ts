import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import { MaterialReplacementStaleRevisionError, type MaterialReplacementInput, type MaterialReplacementRepository, type MaterialReplacementResult, } from "@xue-learn/core/domain";
import { CognitionPersistenceError } from "@xue-learn/core/server/cognition/persistence/error";
import { MikroOrmMaterialCheckCompletionRepository } from "./material-check-completion.repository.ts";
import { MikroOrmUnitLearningProgressResetRepository } from "./unit-learning-progress-reset.repository.ts";
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
    if (typeof value !== "string" || !value) {
        throw new CognitionPersistenceError("not_found", `material replacement row is missing ${key}`);
    }
    return value;
}
function qualifiedTable(em: EntityManager, table: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${table.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
function parseJson(value: unknown): unknown {
    if (typeof value !== "string")
        return value;
    try {
        return JSON.parse(value);
    }
    catch {
        return {};
    }
}
function jsonObject(value: unknown): Record<string, unknown> {
    const parsed = parseJson(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
}
const MATERIAL_DERIVED_GRAPH_KEYS = [
    "reviewMode",
    "quiz",
    "quizSetId",
    "quizAttemptId",
    "score",
    "weakTags",
    "weakLearningTargetIds",
    "quizResults",
    "feynmanFeedback",
    "socraticQuestion",
    "socraticThreads",
    "activeSocraticThreadId",
    "drills",
    "materialPresentation",
    "sqQuestionAnswers",
    "materialDslText",
    "materialDslParseError",
    "materialSourceItems",
] as const;
export function graphStateForReplacement(storedGraph: unknown, sourceItemsJson: string): Record<string, unknown> {
    const state = jsonObject(storedGraph);
    for (const key of MATERIAL_DERIVED_GRAPH_KEYS)
        delete state[key];
    const sourceItems = parseJson(sourceItemsJson);
    state.materialSourceItems = Array.isArray(sourceItems) ? sourceItems : [];
    return state;
}
/** Raw adapter for full-unit material replacement and its reset composition. */
export class MikroOrmMaterialReplacementRepository implements MaterialReplacementRepository {
    protected readonly reset: MikroOrmUnitLearningProgressResetRepository;
    protected readonly materialChecks: MikroOrmMaterialCheckCompletionRepository;
    constructor(protected readonly em: EntityManager) {
        this.reset = new MikroOrmUnitLearningProgressResetRepository(em);
        this.materialChecks = new MikroOrmMaterialCheckCompletionRepository(em);
    }
    protected execute(sql: string, params: unknown[] = []) {
        return this.em
            .getConnection()
            .execute(sql, params, undefined, this.em.getTransactionContext());
    }
    protected async tableExists(tableName: string): Promise<boolean> {
        return (resultRows(await this.execute(`SELECT 1 FROM "sqlite_master"
            WHERE "type" = 'table' AND "name" = ? LIMIT 1`, [tableName])).length > 0);
    }
    protected async acquireUnitResetLock(unitId: string): Promise<void> {
        return;
    }
    protected async readOwnedUnit(input: {
        userId: string;
        goalId: string;
        unitId: string;
        expectedContentRevision?: number;
    }): Promise<{
        contentRevision: number;
    }> {
        const unit = resultRows(await this.execute(`SELECT u."goalId", u."contentRevision", g."userId"
           FROM ${qualifiedTable(this.em, "LearningUnit")} u
           JOIN ${qualifiedTable(this.em, "LearningGoal")} g ON g."id" = u."goalId"
          WHERE u."id" = ?${""}`, [input.unitId]))[0];
        if (!unit ||
            rowValue(unit, "goalId") !== input.goalId ||
            rowValue(unit, "userId") !== input.userId) {
            throw new CognitionPersistenceError("ownership_mismatch", "material replacement unit is not owned by the learner and goal");
        }
        const contentRevision = Number(rowValue(unit, "contentRevision"));
        if (input.expectedContentRevision !== undefined &&
            contentRevision !== input.expectedContentRevision) {
            throw new MaterialReplacementStaleRevisionError(input.expectedContentRevision, contentRevision);
        }
        return { contentRevision };
    }
    protected async upsertSessionState(input: {
        unitId: string;
        sq3rData?: string;
    }, graphState: Record<string, unknown>, now: Date): Promise<void> {
        const sessionTable = qualifiedTable(this.em, "UnitSessionState");
        await this.execute(`INSERT INTO ${sessionTable} AS session
        ("id", "unitId", "currentStep", "structuredSubStep", "graphState",
         "sq3rData", "socraticTurn", "updatedAt")
       VALUES (?, ?, 'structured_input', 'material', ?, ?, 0, ?)
       ON CONFLICT ("unitId") DO UPDATE SET
         "currentStep" = 'structured_input',
         "structuredSubStep" = 'material',
         "graphState" = ?,
         "sq3rData" = COALESCE(?, session."sq3rData"),
         "socraticTurn" = 0,
         "updatedAt" = ?`, [
            randomUUID(),
            input.unitId,
            JSON.stringify(graphState),
            input.sq3rData ?? "{}",
            now,
            JSON.stringify(graphState),
            input.sq3rData ?? null,
            now,
        ]);
    }
    async replace(input: MaterialReplacementInput): Promise<MaterialReplacementResult> {
        const now = new Date();
        await this.acquireUnitResetLock(input.unitId);
        const { contentRevision } = await this.readOwnedUnit(input);
        const reset = input.resetProgress
            ? await this.reset.resetOwned({ unitId: input.unitId })
            : { reset: false, userId: null, affectedEntityIds: [] };
        if (input.clearDownstream) {
            if (await this.tableExists("CornellNote")) {
                await this.execute(`DELETE FROM ${qualifiedTable(this.em, "CornellNote")} WHERE "unitId" = ?`, [input.unitId]);
            }
        }
        const materialTable = qualifiedTable(this.em, "LearningMaterial");
        await this.execute(`INSERT INTO ${materialTable}
        ("id", "unitId", "introduction", "sections", "keyTakeaways",
         "contextSources", "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT ("unitId") DO UPDATE SET
         "introduction" = ?, "sections" = ?, "keyTakeaways" = ?,
         "contextSources" = ?, "updatedAt" = ?`, [
            randomUUID(),
            input.unitId,
            input.material.introduction,
            input.material.sections,
            input.material.keyTakeaways,
            input.material.contextSources,
            now,
            now,
            input.material.introduction,
            input.material.sections,
            input.material.keyTakeaways,
            input.material.contextSources,
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
        await this.upsertSessionState(input, graphStateForReplacement(rowValue(storedGraph ?? {}, "graphState"), input.material.sourceItemsJson), now);
        if (input.deleteFollowUpThreadId &&
            (await this.tableExists("MaterialFollowUp"))) {
            await this.execute(`DELETE FROM ${qualifiedTable(this.em, "MaterialFollowUp")}
          WHERE "id" = ? AND "unitId" = ?`, [input.deleteFollowUpThreadId, input.unitId]);
        }
        let nextContentRevision: number;
        if (input.expectedContentRevision === undefined) {
            await this.execute(`UPDATE ${qualifiedTable(this.em, "LearningUnit")}
            SET "contentRevision" = "contentRevision" + 1
          WHERE "id" = ?`, [input.unitId]);
            nextContentRevision = contentRevision + 1;
        }
        else {
            await this.execute(`UPDATE ${qualifiedTable(this.em, "LearningUnit")}
            SET "contentRevision" = "contentRevision" + 1
          WHERE "id" = ? AND "contentRevision" = ?`, [input.unitId, input.expectedContentRevision]);
            const updated = resultRows(await this.execute(`SELECT "contentRevision"
             FROM ${qualifiedTable(this.em, "LearningUnit")}
            WHERE "id" = ?`, [input.unitId]))[0];
            const updatedRevision = Number(rowValue(updated ?? {}, "contentRevision"));
            if (updatedRevision !== input.expectedContentRevision + 1) {
                throw new MaterialReplacementStaleRevisionError(input.expectedContentRevision, Number.isFinite(updatedRevision) ? updatedRevision : undefined);
            }
            nextContentRevision = updatedRevision;
        }
        return { contentRevision: nextContentRevision, reset };
    }
}
