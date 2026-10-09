import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { BeginOwnedFoundationMasteryTransitionInput, BeginOwnedFoundationMasteryTransitionResult, FailFoundationMasteryTransitionInput, MarkBuildingFoundationMasteryTransitionInput, FinalizeOwnedFoundationMasteryTransitionInput, FoundationMasteryTransitionRepository, } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { FoundationMasteryTransitionPersistenceError as TransitionError } from "@xue-learn/core/source/libs/domain/src/index.ts";
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
function affectedRows(result: unknown): number {
    if (typeof result === "number")
        return result;
    if (!result || typeof result !== "object")
        return 0;
    const row = result as Record<string, unknown>;
    for (const key of [
        "affectedRows",
        "rowCount",
        "changes",
        "numAffectedRows",
        "numInsertedOrUpdatedRows",
    ]) {
        const value = row[key];
        if (typeof value === "number")
            return value;
        if (typeof value === "bigint")
            return Number(value);
    }
    return 0;
}
function transitionStatus(value: unknown): "queued" | "building" | "idle" | "failed" {
    const status = stringValue(value, "idle");
    if (status === "queued" || status === "building" || status === "failed") {
        return status;
    }
    return "idle";
}
/**
 * Transaction-neutral readiness/fencing adapter. KACOM invalidation and event
 * publication remain application-owned; this slice only freezes the prepared
 * curriculum and re-arms lesson cognitive fields atomically.
 */
export class MikroOrmFoundationMasteryTransitionRepository implements FoundationMasteryTransitionRepository {
    constructor(private readonly em: EntityManager) { }
    async detachKacom(goalId: string) {
        const execute = (sql: string, params: unknown[] = []) => this.em.getConnection().execute(sql, params, undefined, this.em.getTransactionContext());
        const goal = resultRows(await execute(`SELECT "userId","goalKind","learningMode","cognitiveModelEnabled","cognitiveModelVersion","shareVisibility" FROM ${qualifiedTable(this.em, "LearningGoal")} WHERE "id"=? LIMIT 1`, [goalId]))[0];
        if (!goal)
            throw new TransitionError("目标不存在", "not_found");
        if (stringValue(rowValue(goal, "goalKind")) === "micro")
            throw new TransitionError("只有已启用 KACOM 的完整目标可以解除关联", "not_full_goal");
        if (stringValue(rowValue(goal, "shareVisibility"), "off") !== "off")
            throw new TransitionError("请先取消发布或发布申请，再解除 KACOM", "share_active");
        const version = Number(rowValue(goal, "cognitiveModelVersion") ?? 0);
        const exploration = stringValue(rowValue(goal, "learningMode")) === "exploration";
        if ((exploration && version === 0) || (!exploration && !Boolean(rowValue(goal, "cognitiveModelEnabled"))))
            throw new TransitionError("只有已启用 KACOM 的完整目标可以解除关联", "not_full_goal");
        if (!exploration)
            await execute(`UPDATE ${qualifiedTable(this.em, "LearningGoal")} SET "learningMode"='exploration',"cognitiveModelEnabled"=?,"learningModeTransitionStatus"='idle',"learningModeTransitionToken"=NULL,"learningModeTransitionStartedAt"=NULL,"learningModeTransitionError"='',"learningModeTransitionArtifacts"=?,"updatedAt"=? WHERE "id"=?`, [false, JSON.stringify({}), new Date(), goalId]);
        return { userId: rowValue(goal, "userId") == null ? null : String(rowValue(goal, "userId")), cognitiveModelVersion: version, alreadyDetached: exploration };
    }
    async markCurrentFailed(goalId: string, message: string) {
        await this.em.getConnection().execute(`UPDATE ${qualifiedTable(this.em, "LearningGoal")} SET "learningModeTransitionStatus"='failed',"learningModeTransitionToken"=NULL,"learningModeTransitionError"=?,"updatedAt"=? WHERE "id"=? AND "learningMode"='exploration' AND "learningModeTransitionStatus" IN ('queued','building')`, [message.slice(0, 1000), new Date(), goalId], undefined, this.em.getTransactionContext());
    }
    async beginOwned(input: BeginOwnedFoundationMasteryTransitionInput): Promise<BeginOwnedFoundationMasteryTransitionResult> {
        const connection = this.em.getConnection();
        const transactionContext = this.em.getTransactionContext();
        const execute = (sql: string, params: unknown[] = []) => connection.execute(sql, params, undefined, transactionContext);
        const goalTable = qualifiedTable(this.em, "LearningGoal");
        const moduleTable = qualifiedTable(this.em, "LearningModule");
        const unitTable = qualifiedTable(this.em, "LearningUnit");
        const lock = "";
        const goal = resultRows(await execute(`SELECT "id", "userId", "goalKind", "learningMode",
                "learningModeTransitionStatus", "learningModeTransitionToken",
                "learningModeTransitionError", "mapPlanStatus",
                "detailedPlanStatus", "shareVisibility"
           FROM ${goalTable}
          WHERE "id" = ? AND "userId" = ?${lock}`, [input.goalId, input.userId]))[0];
        if (!goal) {
            throw new TransitionError("目标不存在", "not_found");
        }
        if (stringValue(rowValue(goal, "goalKind")) === "micro") {
            throw new TransitionError("微课程不支持系统掌握模式", "not_full_goal");
        }
        if (stringValue(rowValue(goal, "learningMode")) === "mastery") {
            throw new TransitionError("该目标已经是系统掌握模式", "not_exploration");
        }
        const currentStatus = transitionStatus(rowValue(goal, "learningModeTransitionStatus"));
        const currentToken = stringValue(rowValue(goal, "learningModeTransitionToken"));
        if (currentStatus === "queued" || currentStatus === "building") {
            if (!currentToken) {
                throw new TransitionError("系统掌握转换缺少防重令牌", "transition_conflict");
            }
            return {
                goalId: input.goalId,
                learningMode: "exploration",
                transitionStatus: currentStatus,
                transitionError: stringValue(rowValue(goal, "learningModeTransitionError")),
                token: currentToken,
                curriculumKeys: [],
                started: false,
            };
        }
        if (stringValue(rowValue(goal, "shareVisibility"), "off") !== "off") {
            throw new TransitionError("请先取消发布或发布申请，再转换学习模式", "share_active");
        }
        const modules = resultRows(await execute(`SELECT "id", "generationStatus"
           FROM ${moduleTable}
          WHERE "goalId" = ?
          ORDER BY "orderIndex" ASC, "id" ASC`, [input.goalId]));
        const units = resultRows(await execute(`SELECT "id", "curriculumKey"
           FROM ${unitTable}
          WHERE "goalId" = ? AND "unitKind" = 'lesson'
          ORDER BY "orderIndex" ASC, "id" ASC`, [input.goalId]));
        if (stringValue(rowValue(goal, "mapPlanStatus")) !== "approved" ||
            stringValue(rowValue(goal, "detailedPlanStatus")) !== "ready" ||
            units.length === 0 ||
            modules.some((module) => ["building", "failed"].includes(stringValue(rowValue(module, "generationStatus"))))) {
            throw new TransitionError("请等待课程准备完成后再转换", "curriculum_not_ready");
        }
        const curriculumKeys = units.flatMap((unit) => {
            const key = rowValue(unit, "curriculumKey");
            return typeof key === "string" && key.length > 0 ? [key] : [];
        });
        if (curriculumKeys.length !== units.length) {
            throw new TransitionError("课程单元缺少稳定顺序标识", "curriculum_not_ready");
        }
        const token = randomUUID();
        const startedAt = new Date();
        const updated = await execute(`UPDATE ${goalTable}
          SET "learningModeTransitionStatus" = 'queued',
              "learningModeTransitionToken" = ?,
              "learningModeTransitionStartedAt" = ?,
              "learningModeTransitionError" = '',
              "learningModeTransitionArtifacts" = ?,
              "updatedAt" = ?
        WHERE "id" = ? AND "userId" = ?
          AND "learningMode" = 'exploration'
          AND "learningModeTransitionStatus" IN ('idle', 'failed')
        RETURNING "id"`, [
            token,
            startedAt,
            JSON.stringify({ curriculumKeys }),
            startedAt,
            input.goalId,
            input.userId,
        ]);
        if (resultRows(updated).length !== 1 && affectedRows(updated) !== 1) {
            throw new TransitionError("系统掌握转换已被其他请求接管", "transition_conflict");
        }
        await execute(`UPDATE ${unitTable}
          SET "cognitiveModelStatus" = 'pending',
              "cognitiveModelBuildStartedAt" = NULL,
              "cognitiveModelBuildToken" = NULL,
              "cognitiveModelBuildInputHash" = NULL
        WHERE "goalId" = ? AND "unitKind" = 'lesson'`, [input.goalId]);
        return {
            goalId: input.goalId,
            learningMode: "exploration",
            transitionStatus: "queued",
            transitionError: "",
            token,
            curriculumKeys,
            started: true,
        };
    }
    async markFailed(input: FailFoundationMasteryTransitionInput): Promise<boolean> {
        const table = qualifiedTable(this.em, "LearningGoal");
        const result = await this.em.getConnection().execute(`UPDATE ${table}
          SET "learningModeTransitionStatus" = 'failed',
              "learningModeTransitionToken" = NULL,
              "learningModeTransitionError" = ?,
              "updatedAt" = ?
        WHERE "id" = ? AND "learningMode" = 'exploration'
          AND "learningModeTransitionStatus" IN ('queued', 'building')
          AND "learningModeTransitionToken" = ?
        RETURNING "id"`, [input.message.slice(0, 1000), new Date(), input.goalId, input.token], undefined, this.em.getTransactionContext());
        return resultRows(result).length === 1 || affectedRows(result) === 1;
    }
    async markBuilding(input: MarkBuildingFoundationMasteryTransitionInput): Promise<boolean> {
        const table = qualifiedTable(this.em, "LearningGoal");
        const result = await this.em.getConnection().execute(`UPDATE ${table}
          SET "learningModeTransitionStatus" = 'building',
              "updatedAt" = ?
        WHERE "id" = ? AND "learningMode" = 'exploration'
          AND "learningModeTransitionStatus" = 'queued'
          AND "learningModeTransitionToken" = ?
        RETURNING "id"`, [new Date(), input.goalId, input.token], undefined, this.em.getTransactionContext());
        return resultRows(result).length === 1 || affectedRows(result) === 1;
    }
    async finalizeOwned(input: FinalizeOwnedFoundationMasteryTransitionInput): Promise<boolean> {
        const table = qualifiedTable(this.em, "LearningGoal");
        const result = await this.em.getConnection().execute(`UPDATE ${table}
          SET "learningMode" = 'mastery',
              "learningModeTransitionStatus" = 'idle',
              "learningModeTransitionToken" = NULL,
              "learningModeTransitionStartedAt" = NULL,
              "learningModeTransitionError" = '',
              "learningModeTransitionArtifacts" = ?,
              "updatedAt" = ?
        WHERE "id" = ? AND "userId" = ?
          AND "learningMode" = 'exploration'
          AND "learningModeTransitionStatus" = 'building'
          AND "learningModeTransitionToken" = ?
          AND "cognitiveModelInputHash" = ?
          AND "cognitiveModelPublishedHash" = ?
        RETURNING "id"`, [
            JSON.stringify({}),
            new Date(),
            input.goalId,
            input.userId,
            input.token,
            input.inputHash,
            input.inputHash,
        ], undefined, this.em.getTransactionContext());
        return resultRows(result).length === 1 || affectedRows(result) === 1;
    }
}
