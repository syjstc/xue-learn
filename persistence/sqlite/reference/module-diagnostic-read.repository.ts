import type { EntityManager } from "@mikro-orm/core";
import type {
  ModuleDiagnosticAttemptRecord,
  ModuleDiagnosticReadRecord,
  ModuleDiagnosticReadRepository,
  ModuleDiagnosticSubmissionRecord,
  ModuleDiagnosticTaskRecord,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import { referenceDateValue } from "./date-value.ts";

type Row = Readonly<Record<string, unknown>>;

function resultRows(result: unknown): readonly Row[] {
  if (Array.isArray(result)) return result as Row[];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    return Array.isArray(rows) ? (rows as Row[]) : [];
  }
  return [];
}

function rowValue(row: Row, key: string): unknown {
  return row[key] ?? row[key[0]?.toLowerCase() + key.slice(1)];
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`Module diagnostic row is missing ${label}`);
  }
  return value;
}

function jsonString(value: unknown, label: string): string {
  if (typeof value === "string") return value;
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error(`Module diagnostic row has invalid ${label}`);
  }
  return serialized;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function dateValue(value: unknown, label: string): Date {
  return referenceDateValue(value, `module diagnostic ${label}`);
}

function qualifiedTable(em: EntityManager, table: string): string {
  const schema = em.schema ?? em.config?.getSchema();
  const quoted = `"${table.replaceAll('"', '""')}"`;
  return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}

function toTask(row: Row, prefix = ""): ModuleDiagnosticTaskRecord {
  return {
    id: stringValue(rowValue(row, `${prefix}id`), "task id"),
    goalId: stringValue(rowValue(row, `${prefix}goalId`), "task goalId"),
    moduleId: stringValue(rowValue(row, `${prefix}moduleId`), "task moduleId"),
    context: jsonString(rowValue(row, `${prefix}context`), "task context"),
    createdAt: dateValue(rowValue(row, `${prefix}createdAt`), "task createdAt"),
  };
}

function toAttempt(row: Row, prefix = ""): ModuleDiagnosticAttemptRecord {
  return {
    id: stringValue(rowValue(row, `${prefix}id`), "attempt id"),
    taskId: stringValue(rowValue(row, `${prefix}taskId`), "attempt taskId"),
    userId: stringValue(rowValue(row, `${prefix}userId`), "attempt userId"),
    status: stringValue(rowValue(row, `${prefix}status`), "attempt status"),
    context: jsonString(rowValue(row, `${prefix}context`), "attempt context"),
    response: jsonString(
      rowValue(row, `${prefix}response`),
      "attempt response",
    ),
    startedAt: dateValue(
      rowValue(row, `${prefix}startedAt`),
      "attempt startedAt",
    ),
    submittedAt:
      rowValue(row, `${prefix}submittedAt`) == null
        ? null
        : dateValue(
            rowValue(row, `${prefix}submittedAt`),
            "attempt submittedAt",
          ),
  };
}

/** Raw SQL read adapter for learner-owned module diagnostic state. */
export class MikroOrmModuleDiagnosticReadRepository implements ModuleDiagnosticReadRepository {
  constructor(private readonly em: EntityManager) {}

  private execute(sql: string, params: unknown[] = []) {
    return this.em.getConnection().execute(sql, params);
  }

  private async findTask(input: {
    userId: string;
    goalId: string;
    moduleId: string;
    taskId: string;
  }): Promise<ModuleDiagnosticTaskRecord | null> {
    const rows = resultRows(
      await this.execute(
        `SELECT t."id", t."goalId", t."moduleId", t."context", t."createdAt"
           FROM ${qualifiedTable(this.em, "LearningTask")} t
           JOIN ${qualifiedTable(this.em, "LearningGoal")} g
             ON g."id" = t."goalId"
          WHERE t."id" = ? AND t."goalId" = ? AND t."moduleId" = ?
            AND t."taskType" = 'diagnostic' AND t."status" = 'active'
            AND g."userId" = ?`,
        [input.taskId, input.goalId, input.moduleId, input.userId],
      ),
    );
    return rows[0] ? toTask(rows[0]) : null;
  }

  async findModule(input: {
    userId: string;
    goalId: string;
    moduleId: string;
  }): Promise<ModuleDiagnosticReadRecord | null> {
    const moduleRows = resultRows(
      await this.execute(
        `SELECT m."id" AS "moduleId", m."goalId", m."title", m."curriculumKey",
                m."unlockStatus", m."generationStatus", m."completionMethod",
                g."title" AS "goalTitle", g."contentLanguage" AS "goalContentLanguage",
                g."level" AS "goalLevel", g."generationOptions" AS "goalGenerationOptions",
                g."goalKind", g."userId" AS "goalUserId"
           FROM ${qualifiedTable(this.em, "LearningModule")} m
           JOIN ${qualifiedTable(this.em, "LearningGoal")} g
             ON g."id" = m."goalId"
          WHERE m."id" = ? AND m."goalId" = ? AND g."userId" = ?`,
        [input.moduleId, input.goalId, input.userId],
      ),
    );
    const module = moduleRows[0];
    if (!module) return null;

    const taskRows = resultRows(
      await this.execute(
        `SELECT "id", "goalId", "moduleId", "context", "createdAt"
           FROM ${qualifiedTable(this.em, "LearningTask")}
          WHERE "goalId" = ? AND "moduleId" = ?
            AND "taskType" = 'diagnostic' AND "status" = 'active'
          ORDER BY "createdAt" DESC, "id" DESC
          LIMIT 1`,
        [input.goalId, input.moduleId],
      ),
    );
    const latestTask = taskRows[0] ? toTask(taskRows[0]) : null;
    let latestAttempt: ModuleDiagnosticAttemptRecord | null = null;
    if (latestTask) {
      const attemptRows = resultRows(
        await this.execute(
          `SELECT "id", "taskId", "userId", "status", "context", "response",
                  "startedAt", "submittedAt"
             FROM ${qualifiedTable(this.em, "TaskAttempt")}
            WHERE "taskId" = ? AND "userId" = ? AND "status" <> 'abandoned'
            ORDER BY "startedAt" DESC, "id" DESC
            LIMIT 1`,
          [latestTask.id, input.userId],
        ),
      );
      latestAttempt = attemptRows[0] ? toAttempt(attemptRows[0]) : null;
    }

    return {
      moduleId: stringValue(rowValue(module, "moduleId"), "moduleId"),
      goalId: stringValue(rowValue(module, "goalId"), "goalId"),
      title: stringValue(rowValue(module, "title"), "title"),
      curriculumKey: stringValue(
        rowValue(module, "curriculumKey"),
        "curriculumKey",
      ),
      goalTitle: stringValue(rowValue(module, "goalTitle"), "goalTitle"),
      goalContentLanguage: stringValue(
        rowValue(module, "goalContentLanguage"),
        "goalContentLanguage",
      ),
      goalLevel: stringValue(rowValue(module, "goalLevel"), "goalLevel"),
      goalGenerationOptions: stringValue(
        rowValue(module, "goalGenerationOptions"),
        "goalGenerationOptions",
      ),
      goalKind: stringValue(rowValue(module, "goalKind"), "goalKind"),
      goalUserId: stringValue(rowValue(module, "goalUserId"), "goalUserId"),
      unlockStatus: stringValue(
        rowValue(module, "unlockStatus"),
        "unlockStatus",
      ),
      generationStatus: stringValue(
        rowValue(module, "generationStatus"),
        "generationStatus",
      ),
      completionMethod: nullableString(rowValue(module, "completionMethod")),
      latestTask,
      latestAttempt,
    };
  }

  async findSubmission(input: {
    userId: string;
    goalId: string;
    moduleId: string;
    attemptId: string;
  }): Promise<ModuleDiagnosticSubmissionRecord | null> {
    let task = await this.findTask({
      userId: input.userId,
      goalId: input.goalId,
      moduleId: input.moduleId,
      taskId: input.attemptId,
    });
    let legacyAttempt: ModuleDiagnosticAttemptRecord | null = null;

    if (!task) {
      const rows = resultRows(
        await this.execute(
          `SELECT a."id" AS "attemptId", a."taskId" AS "attemptTaskId",
                  a."userId" AS "attemptUserId", a."status" AS "attemptStatus",
                  a."context" AS "attemptContext", a."response" AS "attemptResponse",
                  a."startedAt" AS "attemptStartedAt", a."submittedAt" AS "attemptSubmittedAt",
                  t."id" AS "taskId", t."goalId" AS "taskGoalId",
                  t."moduleId" AS "taskModuleId", t."context" AS "taskContext",
                  t."createdAt" AS "taskCreatedAt"
             FROM ${qualifiedTable(this.em, "TaskAttempt")} a
             JOIN ${qualifiedTable(this.em, "LearningTask")} t
               ON t."id" = a."taskId"
             JOIN ${qualifiedTable(this.em, "LearningGoal")} g
               ON g."id" = t."goalId"
            WHERE a."id" = ? AND a."userId" = ?
              AND t."goalId" = ? AND t."moduleId" = ?
              AND t."taskType" = 'diagnostic' AND t."status" = 'active'
              AND g."userId" = ?`,
          [
            input.attemptId,
            input.userId,
            input.goalId,
            input.moduleId,
            input.userId,
          ],
        ),
      );
      const row = rows[0];
      if (!row) return null;
      task = toTask({
        id: rowValue(row, "taskId"),
        goalId: rowValue(row, "taskGoalId"),
        moduleId: rowValue(row, "taskModuleId"),
        context: rowValue(row, "taskContext"),
        createdAt: rowValue(row, "taskCreatedAt"),
      });
      legacyAttempt = toAttempt({
        id: rowValue(row, "attemptId"),
        taskId: rowValue(row, "attemptTaskId"),
        userId: rowValue(row, "attemptUserId"),
        status: rowValue(row, "attemptStatus"),
        context: rowValue(row, "attemptContext"),
        response: rowValue(row, "attemptResponse"),
        startedAt: rowValue(row, "attemptStartedAt"),
        submittedAt: rowValue(row, "attemptSubmittedAt"),
      });
    }

    const evaluatedRows = resultRows(
      await this.execute(
        `SELECT "id"
           FROM ${qualifiedTable(this.em, "TaskAttempt")}
          WHERE "taskId" = ? AND "userId" = ?
            AND "status" IN ('submitted', 'evaluated')
          ORDER BY "startedAt" DESC, "id" DESC
          LIMIT 1`,
        [task.id, input.userId],
      ),
    );
    return {
      task,
      legacyAttempt,
      existingEvaluatedAttemptId: evaluatedRows[0]
        ? nullableString(rowValue(evaluatedRows[0], "id"))
        : null,
    };
  }
}
