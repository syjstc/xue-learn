import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { AdaptiveAssessmentSubmissionTask, StartTaskAttemptPersistenceInput, StartTaskAttemptPersistenceResult, TaskAttemptPersistenceRecord, TaskAttemptRepository, } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { nullableReferenceDateValue, referenceDateValue } from "./date-value.ts";
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
function parseJson(value: unknown): unknown {
    if (typeof value !== "string")
        return value;
    try {
        return JSON.parse(value);
    }
    catch {
        return value;
    }
}
function numberValue(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
function dateValue(value: unknown): Date {
    return referenceDateValue(value);
}
function nullableDateValue(value: unknown): Date | null {
    return nullableReferenceDateValue(value);
}
function mapAttempt(row: Row): TaskAttemptPersistenceRecord {
    return {
        id: String(rowValue(row, "id")),
        taskId: String(rowValue(row, "taskId")),
        userId: String(rowValue(row, "userId")),
        unitId: rowValue(row, "unitId") == null ? null : String(rowValue(row, "unitId")),
        attemptNumber: numberValue(rowValue(row, "attemptNumber")),
        status: String(rowValue(row, "status")),
        context: parseJson(rowValue(row, "context")),
        response: parseJson(rowValue(row, "response")),
        artifactRefs: parseJson(rowValue(row, "artifactRefs")),
        artifactVersionRefs: parseJson(rowValue(row, "artifactVersionRefs")),
        processLog: parseJson(rowValue(row, "processLog")),
        assistanceTrace: parseJson(rowValue(row, "assistanceTrace")),
        assistanceLevel: numberValue(rowValue(row, "assistanceLevel")),
        hintCount: numberValue(rowValue(row, "hintCount")),
        durationMs: rowValue(row, "durationMs") == null
            ? null
            : numberValue(rowValue(row, "durationMs")),
        idempotencyKey: rowValue(row, "idempotencyKey") == null
            ? null
            : String(rowValue(row, "idempotencyKey")),
        startedAt: dateValue(rowValue(row, "startedAt")),
        submittedAt: nullableDateValue(rowValue(row, "submittedAt")),
        completedAt: nullableDateValue(rowValue(row, "completedAt")),
    };
}
/** Transaction-neutral raw adapter; the runtime owns the transaction. */
export class MikroOrmTaskAttemptRepository implements TaskAttemptRepository {
    constructor(private readonly em: EntityManager) { }
    private execute(sql: string, params: unknown[] = []) {
        return this.em
            .getConnection()
            .execute(sql, params, undefined, this.em.getTransactionContext());
    }
    private jsonType(): string {
        return "";
    }
    async findAdaptiveAssessmentTask(input: {
        userId: string;
        taskId: string;
    }): Promise<AdaptiveAssessmentSubmissionTask | null> {
        const task = resultRows(await this.execute(`SELECT t."id", t."goalId", t."moduleId", t."unitId", t."title",
                t."instructions", t."context", t."rubric", g."title" AS "goalTitle"
           FROM ${qualifiedTable(this.em, "LearningTask")} t
           JOIN ${qualifiedTable(this.em, "LearningGoal")} g ON g."id" = t."goalId"
          WHERE t."id" = ? AND t."status" = 'active'
            AND t."origin" = 'adaptive_assessment_v2' AND g."userId" = ?`, [input.taskId, input.userId]))[0];
        if (!task)
            return null;
        const requirements = resultRows(await this.execute(`SELECT "id", "learningTargetId", "cognitiveEntityId", "dimension", "rubricCriterion"
           FROM ${qualifiedTable(this.em, "TaskRequirement")}
          WHERE "taskId" = ? ORDER BY "orderIndex" ASC, "id" ASC`, [input.taskId]));
        return {
            id: String(rowValue(task, "id")),
            goalId: String(rowValue(task, "goalId")),
            moduleId: rowValue(task, "moduleId") == null
                ? null
                : String(rowValue(task, "moduleId")),
            unitId: rowValue(task, "unitId") == null
                ? null
                : String(rowValue(task, "unitId")),
            title: String(rowValue(task, "title")),
            instructions: String(rowValue(task, "instructions") ?? ""),
            context: (parseJson(rowValue(task, "context")) ?? {}) as Record<string, unknown>,
            rubric: (parseJson(rowValue(task, "rubric")) ?? {}) as Record<string, unknown>,
            goalTitle: String(rowValue(task, "goalTitle")),
            requirements: requirements.map((requirement) => ({
                id: String(rowValue(requirement, "id")),
                learningTargetId: rowValue(requirement, "learningTargetId") == null
                    ? null
                    : String(rowValue(requirement, "learningTargetId")),
                cognitiveEntityId: String(rowValue(requirement, "cognitiveEntityId")),
                dimension: String(rowValue(requirement, "dimension")),
                rubricCriterion: (parseJson(rowValue(requirement, "rubricCriterion")) ?? {}) as Record<string, unknown>,
            })),
        };
    }
    async findObservation(input: {
        attemptId: string;
        requirementId: string;
    }): Promise<{
        score: number;
    } | null> {
        const row = resultRows(await this.execute(`SELECT "score" FROM ${qualifiedTable(this.em, "TaskObservation")}
          WHERE "attemptId" = ? AND "requirementId" = ?
          ORDER BY "observedAt" ASC, "id" ASC LIMIT 1`, [input.attemptId, input.requirementId]))[0];
        return row ? { score: numberValue(rowValue(row, "score")) } : null;
    }
    private async readAttempt(attemptTable: string, idempotencyKey: string): Promise<TaskAttemptPersistenceRecord | null> {
        const row = resultRows(await this.execute(`SELECT "id", "taskId", "userId", "unitId", "attemptNumber", "status",
                "context", "response", "artifactRefs", "artifactVersionRefs",
                "processLog", "assistanceTrace", "assistanceLevel", "hintCount",
                "durationMs", "idempotencyKey", "startedAt", "submittedAt", "completedAt"
           FROM ${attemptTable} WHERE "idempotencyKey" = ?`, [idempotencyKey]))[0];
        return row ? mapAttempt(row) : null;
    }
    async start(input: StartTaskAttemptPersistenceInput): Promise<StartTaskAttemptPersistenceResult> {
        const goalTable = qualifiedTable(this.em, "LearningGoal");
        const taskTable = qualifiedTable(this.em, "LearningTask");
        const attemptTable = qualifiedTable(this.em, "TaskAttempt");
        const lock = "";
        const existing = await this.readAttempt(attemptTable, input.idempotencyKey);
        if (existing) {
            if (existing.taskId !== input.taskId ||
                existing.userId !== input.userId) {
                throw new Error("Attempt idempotency key belongs to another task");
            }
            return { attempt: existing, replayed: true };
        }
        const task = resultRows(await this.execute(`SELECT t."id", t."unitId", t."status", g."userId"
           FROM ${taskTable} t
           JOIN ${goalTable} g ON g."id" = t."goalId"
          WHERE t."id" = ?${lock}`, [input.taskId]))[0];
        if (!task ||
            rowValue(task, "status") !== "active" ||
            rowValue(task, "userId") !== input.userId) {
            throw new Error("Active learning task not found");
        }
        const taskUnitId = rowValue(task, "unitId") == null
            ? undefined
            : String(rowValue(task, "unitId"));
        if (input.unitId && taskUnitId && input.unitId !== taskUnitId) {
            throw new Error("Attempt unit does not match the task unit");
        }
        const latest = resultRows(await this.execute(`SELECT MAX("attemptNumber") AS "attemptNumber"
           FROM ${attemptTable} WHERE "taskId" = ? AND "userId" = ?`, [input.taskId, input.userId]))[0];
        const attemptNumber = numberValue(rowValue(latest ?? {}, "attemptNumber")) + 1;
        const id = randomUUID();
        const now = new Date();
        const startedAt = input.startedAt ?? input.submittedAt ?? input.completedAt ?? now;
        const jsonType = this.jsonType();
        await this.execute(`INSERT INTO ${attemptTable}
        ("id", "taskId", "userId", "unitId", "attemptNumber", "status",
         "context", "response", "artifactRefs", "artifactVersionRefs", "processLog",
         "assistanceTrace", "assistanceLevel", "hintCount", "durationMs",
         "idempotencyKey", "startedAt", "submittedAt", "completedAt")
       VALUES (?, ?, ?, ?, ?, ?, ?${jsonType}, ?${jsonType}, ?${jsonType}, ?${jsonType},
               ?${jsonType}, ?${jsonType}, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT ("idempotencyKey") DO NOTHING`, [
            id,
            input.taskId,
            input.userId,
            input.unitId ?? taskUnitId ?? null,
            attemptNumber,
            input.status,
            JSON.stringify(input.context),
            JSON.stringify(input.response),
            JSON.stringify(input.artifactRefs),
            JSON.stringify(input.artifactVersionRefs),
            JSON.stringify(input.processLog),
            JSON.stringify(input.assistanceTrace),
            input.assistanceLevel,
            input.hintCount,
            input.durationMs ?? null,
            input.idempotencyKey,
            startedAt,
            input.submittedAt ?? null,
            input.completedAt ?? null,
        ]);
        const attempt = await this.readAttempt(attemptTable, input.idempotencyKey);
        if (!attempt)
            throw new Error("Task attempt was not persisted");
        if (attempt.taskId !== input.taskId || attempt.userId !== input.userId) {
            throw new Error("Attempt idempotency key belongs to another task");
        }
        return { attempt, replayed: attempt.id !== id };
    }
}
