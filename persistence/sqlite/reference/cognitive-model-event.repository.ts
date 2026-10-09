import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { CognitiveModelEventRepository, EnqueueCognitiveModelExpansionInput, EnqueueCognitiveModelExpansionResult, RecoverFailedCognitiveModelUnitInput, RecoverFailedCognitiveModelUnitResult, } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { sqlTimestampParameter } from "./date-value.ts";
type Row = Readonly<Record<string, unknown>>;
const COGNITIVE_MODEL_EXPAND_NEXT_EVENT = "cognitive.model.expand_next";
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
function stringValue(value: unknown): string | null {
    return typeof value === "string"
        ? value
        : value == null
            ? null
            : String(value);
}
function qualifiedTable(em: EntityManager, table: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${table.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
/** Transaction-neutral cognitive-model event and recovery adapter. */
export class MikroOrmCognitiveModelEventRepository implements CognitiveModelEventRepository {
    constructor(private readonly em: EntityManager) { }
    private execute(sql: string, params: unknown[] = []) {
        return this.em
            .getConnection()
            .execute(sql, params, undefined, this.em.getTransactionContext());
    }
    private async acquireGoalLock(goalId: string): Promise<void> {
    }
    private async appendNextEvent(goalId: string, inputHash: string | null, baseModelVersion: number, reason?: string): Promise<string> {
        const eventId = randomUUID();
        const createdAt = new Date();
        const dueAt = sqlTimestampParameter(false, createdAt);
        const payload = JSON.stringify({
            goalId,
            inputHash,
            baseModelVersion,
            ...(reason ? { reason } : {}),
        });
        await this.execute(`INSERT INTO ${qualifiedTable(this.em, "EventOutbox")}
        ("id", "type", "payload", "createdAt", "nextAttemptAt")
       VALUES (?, ?, ?, ?, ?)`, [
            eventId,
            COGNITIVE_MODEL_EXPAND_NEXT_EVENT,
            payload,
            dueAt,
            dueAt,
        ]);
        return eventId;
    }
    async inspectGoal(goalId: string) {
        const goal = resultRows(await this.execute(`SELECT "goalKind","learningMode","learningModeTransitionStatus","learningModeTransitionToken","learningModeTransitionArtifacts","userId","cognitiveModelInputHash","cognitiveModelPublishedHash","cognitiveModelVersion","cognitiveModelStatus" FROM ${qualifiedTable(this.em, "LearningGoal")} WHERE "id"=? LIMIT 1`, [goalId]))[0];
        if (!goal)
            return null;
        const units = resultRows(await this.execute(`SELECT u."id",u."curriculumKey",u."unitKind",u."orderIndex",u."prerequisites",u."cognitiveModelStatus",u."cognitiveModelBuildInputHash",m."orderIndex" AS "moduleOrderIndex",m."unlockStatus",(SELECT COUNT(*) FROM ${qualifiedTable(this.em, "UnitLearningTarget")} t WHERE t."unitId"=u."id") AS "targetCount" FROM ${qualifiedTable(this.em, "LearningUnit")} u LEFT JOIN ${qualifiedTable(this.em, "LearningModule")} m ON m."id"=u."moduleId" WHERE u."goalId"=? AND u."unitKind"<>'overview' ORDER BY COALESCE(m."orderIndex",0),u."orderIndex",u."curriculumKey"`, [goalId]));
        const inputHash = String(rowValue(goal, "cognitiveModelInputHash") ?? "");
        const expanded = new Set(units.filter(unit => String(rowValue(unit, "unitKind")) !== "lesson" || (String(rowValue(unit, "cognitiveModelStatus")) === "expanded" && String(rowValue(unit, "cognitiveModelBuildInputHash") ?? "") === inputHash && Number(rowValue(unit, "targetCount") ?? 0) > 0)).map(unit => String(rowValue(unit, "id"))));
        const prerequisites = (raw: unknown): string[] => { try {
            const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
            return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
        }
        catch {
            return [];
        } };
        const next = units.find(unit => String(rowValue(unit, "unitKind")) === "lesson" && String(rowValue(unit, "unlockStatus") ?? "") !== "locked" && !expanded.has(String(rowValue(unit, "id"))) && prerequisites(rowValue(unit, "prerequisites")).every(id => expanded.has(id)));
        let frozenKeys: string[] = [];
        try {
            const raw = rowValue(goal, "learningModeTransitionArtifacts");
            const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
            frozenKeys = parsed && typeof parsed === "object" && Array.isArray((parsed as {
                curriculumKeys?: unknown;
            }).curriculumKeys) ? (parsed as {
                curriculumKeys: string[];
            }).curriculumKeys.filter(value => typeof value === "string") : [];
        }
        catch { }
        const lessonUnits = units.filter(unit => String(rowValue(unit, "unitKind")) === "lesson");
        const currentKeys = lessonUnits.map(unit => String(rowValue(unit, "curriculumKey")));
        const transitionReady = ["building", "ready"].includes(String(rowValue(goal, "cognitiveModelStatus"))) && inputHash.length > 0 && String(rowValue(goal, "cognitiveModelPublishedHash") ?? "") === inputHash && frozenKeys.length === currentKeys.length && frozenKeys.every((key, index) => key === currentKeys[index]) && lessonUnits.every(unit => String(rowValue(unit, "cognitiveModelStatus")) === "expanded" && String(rowValue(unit, "cognitiveModelBuildInputHash") ?? "") === inputHash && Number(rowValue(unit, "targetCount") ?? 0) > 0);
        return { goalKind: String(rowValue(goal, "goalKind")), learningMode: String(rowValue(goal, "learningMode")), learningModeTransitionStatus: String(rowValue(goal, "learningModeTransitionStatus")), learningModeTransitionToken: stringValue(rowValue(goal, "learningModeTransitionToken")), userId: stringValue(rowValue(goal, "userId")), cognitiveModelInputHash: inputHash, cognitiveModelPublishedHash: stringValue(rowValue(goal, "cognitiveModelPublishedHash")), cognitiveModelVersion: Number(rowValue(goal, "cognitiveModelVersion") ?? 0), cognitiveModelStatus: String(rowValue(goal, "cognitiveModelStatus")), nextExpandableUnitId: next ? String(rowValue(next, "id")) : null, transitionReady };
    }
    async enqueueNext(input: EnqueueCognitiveModelExpansionInput): Promise<EnqueueCognitiveModelExpansionResult | null> {
        await this.acquireGoalLock(input.goalId);
        const goal = resultRows(await this.execute(`SELECT "cognitiveModelInputHash", "cognitiveModelVersion"
           FROM ${qualifiedTable(this.em, "LearningGoal")}
          WHERE "id" = ?${""}`, [input.goalId]))[0];
        if (!goal)
            return null;
        const eventId = await this.appendNextEvent(input.goalId, stringValue(rowValue(goal, "cognitiveModelInputHash")), Number(rowValue(goal, "cognitiveModelVersion") ?? 0));
        return { eventId };
    }
    async recoverFailedUnit(input: RecoverFailedCognitiveModelUnitInput): Promise<RecoverFailedCognitiveModelUnitResult> {
        await this.acquireGoalLock(input.goalId);
        const goalTable = qualifiedTable(this.em, "LearningGoal");
        const unitTable = qualifiedTable(this.em, "LearningUnit");
        const lock = "";
        const [goal, unit] = await Promise.all([
            resultRows(await this.execute(`SELECT "cognitiveModelInputHash", "cognitiveModelPublishedHash",
                  "cognitiveModelVersion"
             FROM ${goalTable}
            WHERE "id" = ?${lock}`, [input.goalId]))[0],
            resultRows(await this.execute(`SELECT "goalId", "cognitiveModelStatus"
             FROM ${unitTable}
            WHERE "id" = ?${lock}`, [input.unitId]))[0],
        ]);
        if (!goal ||
            !unit ||
            stringValue(rowValue(unit, "goalId")) !== input.goalId ||
            stringValue(rowValue(unit, "cognitiveModelStatus")) !== "failed") {
            return { triggered: false, goalStatus: null, eventId: null };
        }
        const inputHash = stringValue(rowValue(goal, "cognitiveModelInputHash"));
        const publishedHash = stringValue(rowValue(goal, "cognitiveModelPublishedHash"));
        const goalStatus = publishedHash === inputHash ? "building" : "needs_reconciliation";
        await this.execute(`UPDATE ${unitTable}
          SET "cognitiveModelStatus" = 'pending',
              "cognitiveModelBuildStartedAt" = NULL,
              "cognitiveModelBuildToken" = NULL,
              "cognitiveModelBuildInputHash" = NULL
        WHERE "id" = ? AND "goalId" = ? AND "cognitiveModelStatus" = 'failed'`, [input.unitId, input.goalId]);
        await this.execute(`UPDATE ${goalTable}
          SET "cognitiveModelStatus" = ?, "updatedAt" = ?
        WHERE "id" = ?`, [goalStatus, new Date(), input.goalId]);
        const eventId = await this.appendNextEvent(input.goalId, inputHash, Number(rowValue(goal, "cognitiveModelVersion") ?? 0), "learner_returned_to_failed_unit");
        return { triggered: true, goalStatus, eventId };
    }
}
