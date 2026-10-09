import { createHash, randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { CompleteModuleDiagnosticInput, ModuleDiagnosticCompletionResult, ModuleDiagnosticCompletionRepository, ModuleDiagnosticFinalization, ModuleDiagnosticTaskRequirement, ModuleDiagnosticTaskDefinition, VerifiedEvidenceLearnerDimensionStateRecord, VerifiedEvidenceLearnerStateRecord, } from "@xue-learn/core/domain";
import { CognitionPersistenceError } from "@xue-learn/core/server/cognition/persistence/error";
import { MikroOrmTaskAttemptRepository } from "./task-attempt.repository.ts";
import { MikroOrmVerifiedEvidenceAppendRepository } from "./verified-evidence-append.repository.ts";
import { referenceDateValue } from "./date-value.ts";
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
        throw new CognitionPersistenceError("not_found", `module diagnostic row is missing ${key}`);
    }
    return value;
}
function numberValue(value: unknown, fallback = 0): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function booleanValue(value: unknown): boolean {
    return value === true || value === 1 || value === "1" || value === "true";
}
function dateValue(value: unknown): Date {
    return referenceDateValue(value);
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
function jsonObject(value: unknown): Record<string, unknown> {
    const parsed = parseJson(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
}
function stableJson(value: unknown): string {
    if (Array.isArray(value))
        return `[${value.map(stableJson).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
            .join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}
function qualifiedTable(em: EntityManager, table: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${table.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
function requirementRubric(requirement: ModuleDiagnosticTaskRequirement): Record<string, unknown> {
    return {
        ...(requirement.rubricCriterion ?? {}),
        ref: requirement.criterionRef,
        definitionVersion: requirement.definitionVersion,
    };
}
function requirementSignature(requirement: ModuleDiagnosticTaskRequirement): string {
    return stableJson({
        learningTargetId: requirement.learningTargetId,
        cognitiveEntityId: requirement.cognitiveEntityId,
        dimension: requirement.dimension,
        required: requirement.required,
        weight: requirement.weight,
        orderIndex: requirement.orderIndex,
        rubricCriterion: requirementRubric(requirement),
    });
}
function storedRequirementSignature(requirement: Row): string {
    return stableJson({
        learningTargetId: rowValue(requirement, "learningTargetId") == null
            ? null
            : String(rowValue(requirement, "learningTargetId")),
        cognitiveEntityId: String(rowValue(requirement, "cognitiveEntityId")),
        dimension: String(rowValue(requirement, "dimension")),
        required: booleanValue(rowValue(requirement, "required")),
        weight: numberValue(rowValue(requirement, "weight"), 1),
        orderIndex: numberValue(rowValue(requirement, "orderIndex")),
        rubricCriterion: jsonObject(rowValue(requirement, "rubricCriterion")),
    });
}
type StoredTask = Readonly<{
    id: string;
    goalId: string;
    moduleId: string | null;
    taskType: string;
    definitionVersion: number;
    status: string;
    context: Record<string, unknown>;
    requirements: readonly Row[];
}>;
/** Raw adapter for the complete module-diagnostic submission write set. */
export class MikroOrmModuleDiagnosticCompletionRepository implements ModuleDiagnosticCompletionRepository {
    private readonly attempts: MikroOrmTaskAttemptRepository;
    private readonly evidence: MikroOrmVerifiedEvidenceAppendRepository;
    constructor(private readonly em: EntityManager) {
        this.attempts = new MikroOrmTaskAttemptRepository(em);
        this.evidence = new MikroOrmVerifiedEvidenceAppendRepository(em);
    }
    private execute(sql: string, params: unknown[] = []) {
        return this.em
            .getConnection()
            .execute(sql, params, undefined, this.em.getTransactionContext());
    }
    private jsonType(): string {
        return "";
    }
    async publishMainTask(input: {
        userId: string;
        goalId: string;
        moduleId: string;
        stableKey: string;
        title: string;
        instructions: string;
        context: Record<string, unknown>;
        rubric: Record<string, unknown>;
    }): Promise<{
        id: string;
    }> {
        const owned = resultRows(await this.execute(`SELECT m."id" FROM ${qualifiedTable(this.em, "LearningModule")} m
          JOIN ${qualifiedTable(this.em, "LearningGoal")} g ON g."id" = m."goalId"
         WHERE m."id" = ? AND m."goalId" = ? AND g."userId" = ?`, [input.moduleId, input.goalId, input.userId]))[0];
        if (!owned)
            throw new Error("Module not found");
        const id = randomUUID();
        const jsonType = this.jsonType();
        await this.execute(`INSERT INTO ${qualifiedTable(this.em, "LearningTask")}
        ("id", "goalId", "moduleId", "stableKey", "taskType", "title",
         "instructions", "context", "rubric", "origin", "status")
       VALUES (?, ?, ?, ?, 'diagnostic', ?, ?, ?${jsonType}, ?${jsonType},
               'module_diagnostic', 'active')`, [
            id,
            input.goalId,
            input.moduleId,
            input.stableKey,
            input.title,
            input.instructions,
            JSON.stringify(input.context),
            JSON.stringify(input.rubric),
        ]);
        return { id };
    }
    private async hydrateTask(row: Row): Promise<StoredTask> {
        const id = requiredString(row, "id");
        return {
            id,
            goalId: requiredString(row, "goalId"),
            moduleId: rowValue(row, "moduleId") == null
                ? null
                : String(rowValue(row, "moduleId")),
            taskType: String(rowValue(row, "taskType")),
            definitionVersion: numberValue(rowValue(row, "definitionVersion"), 1),
            status: String(rowValue(row, "status")),
            context: jsonObject(rowValue(row, "context")),
            requirements: resultRows(await this.execute(`SELECT "id", "learningTargetId", "cognitiveEntityId", "dimension",
                  "required", "weight", "orderIndex", "rubricCriterion"
             FROM ${qualifiedTable(this.em, "TaskRequirement")}
            WHERE "taskId" = ? ORDER BY "orderIndex" ASC, "id" ASC`, [id])),
        };
    }
    private async readTaskById(taskId: string): Promise<StoredTask | null> {
        const row = resultRows(await this.execute(`SELECT "id", "goalId", "moduleId", "taskType", "status",
                "definitionVersion", "context"
           FROM ${qualifiedTable(this.em, "LearningTask")}
          WHERE "id" = ?`, [taskId]))[0];
        if (!row)
            return null;
        return this.hydrateTask(row);
    }
    private async readTaskByStableKey(goalId: string, stableKey: string): Promise<StoredTask | null> {
        const row = resultRows(await this.execute(`SELECT "id", "goalId", "moduleId", "taskType", "status",
                "definitionVersion", "context"
           FROM ${qualifiedTable(this.em, "LearningTask")}
          WHERE "goalId" = ? AND "stableKey" = ?`, [goalId, stableKey]))[0];
        return row ? this.hydrateTask(row) : null;
    }
    private async assertScope(input: CompleteModuleDiagnosticInput): Promise<StoredTask> {
        const row = resultRows(await this.execute(`SELECT t."id", t."goalId", t."moduleId", t."taskType", t."status",
                g."userId"
          FROM ${qualifiedTable(this.em, "LearningTask")} t
           JOIN ${qualifiedTable(this.em, "LearningGoal")} g ON g."id" = t."goalId"
          WHERE t."id" = ?${""}`, [input.mainTaskId]))[0];
        if (!row ||
            rowValue(row, "userId") !== input.userId ||
            rowValue(row, "goalId") !== input.goalId ||
            rowValue(row, "moduleId") !== input.moduleId ||
            rowValue(row, "taskType") !== "diagnostic" ||
            rowValue(row, "status") !== "active") {
            throw new CognitionPersistenceError("ownership_mismatch", "module diagnostic task is not owned by the learner and module");
        }
        const module = resultRows(await this.execute(`SELECT "goalId" FROM ${qualifiedTable(this.em, "LearningModule")}
          WHERE "id" = ?`, [input.moduleId]))[0];
        if (!module || rowValue(module, "goalId") !== input.goalId) {
            throw new CognitionPersistenceError("ownership_mismatch", "module diagnostic module is not owned by the goal");
        }
        const task = await this.readTaskById(input.mainTaskId);
        if (!task)
            throw new Error("Module diagnostic task disappeared");
        return task;
    }
    private async assertDefinitionScope(input: CompleteModuleDiagnosticInput, definition: ModuleDiagnosticTaskDefinition): Promise<void> {
        if (definition.goalId !== input.goalId ||
            definition.moduleId !== input.moduleId) {
            throw new CognitionPersistenceError("invalid_declaration", "module diagnostic task definition scope does not match the submission");
        }
        for (const requirement of definition.requirements) {
            const entity = resultRows(await this.execute(`SELECT "goalId", "definitionVersion", "status"
             FROM ${qualifiedTable(this.em, "CognitiveEntity")}
            WHERE "id" = ?`, [requirement.cognitiveEntityId]))[0];
            const target = resultRows(await this.execute(`SELECT "goalId", "status"
             FROM ${qualifiedTable(this.em, "LearningTarget")}
            WHERE "id" = ?`, [requirement.learningTargetId]))[0];
            const targetRequirement = resultRows(await this.execute(`SELECT "id" FROM ${qualifiedTable(this.em, "LearningTargetRequirement")}
            WHERE "learningTargetId" = ? AND "cognitiveEntityId" = ?
              AND "dimension" = ?`, [
                requirement.learningTargetId,
                requirement.cognitiveEntityId,
                requirement.dimension,
            ]))[0];
            const moduleTarget = resultRows(await this.execute(`SELECT "id" FROM ${qualifiedTable(this.em, "ModuleLearningTarget")}
            WHERE "moduleId" = ? AND "learningTargetId" = ?`, [input.moduleId, requirement.learningTargetId]))[0];
            if (!entity ||
                rowValue(entity, "goalId") !== input.goalId ||
                rowValue(entity, "status") !== "active" ||
                numberValue(rowValue(entity, "definitionVersion")) !==
                    requirement.definitionVersion ||
                !target ||
                rowValue(target, "goalId") !== input.goalId ||
                rowValue(target, "status") !== "active" ||
                !targetRequirement ||
                !moduleTarget) {
                throw new CognitionPersistenceError("invalid_declaration", `module diagnostic declaration is not active for ${requirement.learningTargetId}`);
            }
        }
    }
    private requirementId(taskId: string, orderIndex: number): string {
        return `module-diagnostic-requirement-${createHash("sha256")
            .update(`${taskId}:${orderIndex}`)
            .digest("hex")
            .slice(0, 32)}`;
    }
    private async assertExistingTask(existing: StoredTask, definition: ModuleDiagnosticTaskDefinition): Promise<void> {
        const requested = new Set(definition.requirements.map(requirementSignature));
        const stored = new Set(existing.requirements.map(storedRequirementSignature));
        if (existing.moduleId !== definition.moduleId ||
            existing.taskType !== definition.taskType ||
            existing.definitionVersion !== definition.definitionVersion ||
            requested.size !== stored.size ||
            [...requested].some((signature) => !stored.has(signature)) ||
            stableJson(existing.context.evidencePolicy) !==
                stableJson(definition.evidencePolicy)) {
            throw new CognitionPersistenceError("immutable_declaration", "module diagnostic task declaration cannot be mutated");
        }
    }
    private async ensureTask(input: CompleteModuleDiagnosticInput, definition: ModuleDiagnosticTaskDefinition): Promise<StoredTask> {
        const existing = await this.readTaskByStableKey(definition.goalId, definition.stableKey);
        if (existing) {
            await this.assertDefinitionScope(input, definition);
            await this.assertExistingTask(existing, definition);
            return existing;
        }
        await this.assertDefinitionScope(input, definition);
        const jsonType = this.jsonType();
        const now = new Date();
        await this.execute(`INSERT INTO ${qualifiedTable(this.em, "LearningTask")}
        ("id", "goalId", "moduleId", "stableKey", "taskType", "title",
         "instructions", "context", "rubric", "difficulty", "definitionVersion",
         "origin", "status", "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?${jsonType}, ?${jsonType}, ?, ?, ?, 'active', ?, ?)
       ON CONFLICT ("goalId", "stableKey") DO NOTHING`, [
            randomUUID(),
            definition.goalId,
            definition.moduleId,
            definition.stableKey,
            definition.taskType,
            definition.title,
            definition.instructions,
            JSON.stringify({
                ...definition.context,
                evidencePolicy: definition.evidencePolicy,
                definitionVersion: definition.definitionVersion,
            }),
            JSON.stringify(definition.rubric),
            definition.difficulty,
            definition.definitionVersion,
            definition.origin,
            now,
            now,
        ]);
        let task = await this.readTaskByStableKey(definition.goalId, definition.stableKey);
        if (!task)
            throw new Error("Module diagnostic task was not published");
        for (const requirement of definition.requirements) {
            await this.execute(`INSERT INTO ${qualifiedTable(this.em, "TaskRequirement")}
          ("id", "taskId", "learningTargetId", "cognitiveEntityId", "dimension",
           "role", "required", "weight", "orderIndex", "rubricCriterion", "createdAt")
         VALUES (?, ?, ?, ?, ?, 'primary', ?, ?, ?, ?${jsonType}, ?)
         ON CONFLICT ("id") DO NOTHING`, [
                this.requirementId(task.id, requirement.orderIndex),
                task.id,
                requirement.learningTargetId,
                requirement.cognitiveEntityId,
                requirement.dimension,
                requirement.required,
                requirement.weight,
                requirement.orderIndex,
                JSON.stringify(requirementRubric(requirement)),
                now,
            ]);
        }
        task = await this.readTaskByStableKey(definition.goalId, definition.stableKey);
        if (!task)
            throw new Error("Module diagnostic task disappeared");
        await this.assertExistingTask(task, definition);
        return task;
    }
    private async readState(userId: string, entityId: string): Promise<VerifiedEvidenceLearnerStateRecord | null> {
        const state = resultRows(await this.execute(`SELECT * FROM ${qualifiedTable(this.em, "LearnerEntityState")}
          WHERE "userId" = ? AND "cognitiveEntityId" = ?`, [userId, entityId]))[0];
        if (!state)
            return null;
        const stateId = requiredString(state, "id");
        const dimensions = resultRows(await this.execute(`SELECT * FROM ${qualifiedTable(this.em, "LearnerDimensionState")}
          WHERE "learnerEntityStateId" = ? ORDER BY "dimension"`, [stateId])).map((row): VerifiedEvidenceLearnerDimensionStateRecord => ({
            id: requiredString(row, "id"),
            learnerEntityStateId: stateId,
            dimension: String(rowValue(row, "dimension")) as never,
            estimate: rowValue(row, "estimate") == null
                ? null
                : numberValue(rowValue(row, "estimate")),
            evidenceSufficiency: numberValue(rowValue(row, "evidenceSufficiency")),
            evidenceSufficiencyReasons: Array.isArray(parseJson(rowValue(row, "evidenceSufficiencyReasons")))
                ? (parseJson(rowValue(row, "evidenceSufficiencyReasons")) as string[])
                : [],
            status: String(rowValue(row, "status")) as never,
            alpha: numberValue(rowValue(row, "alpha")),
            beta: numberValue(rowValue(row, "beta")),
            evidenceWeight: numberValue(rowValue(row, "evidenceWeight")),
            observationCount: numberValue(rowValue(row, "observationCount")),
            lastObservedAt: rowValue(row, "lastObservedAt") == null
                ? null
                : dateValue(rowValue(row, "lastObservedAt")),
            inferenceVersion: numberValue(rowValue(row, "inferenceVersion")),
            createdAt: dateValue(rowValue(row, "createdAt")),
            updatedAt: dateValue(rowValue(row, "updatedAt")),
        }));
        return {
            id: stateId,
            userId: requiredString(state, "userId"),
            cognitiveEntityId: requiredString(state, "cognitiveEntityId"),
            estimate: rowValue(state, "estimate") == null
                ? null
                : numberValue(rowValue(state, "estimate")),
            evidenceSufficiency: numberValue(rowValue(state, "evidenceSufficiency")),
            status: String(rowValue(state, "status")) as never,
            lastObservedAt: rowValue(state, "lastObservedAt") == null
                ? null
                : dateValue(rowValue(state, "lastObservedAt")),
            lastEvidenceClaimId: rowValue(state, "lastEvidenceClaimId") == null
                ? null
                : String(rowValue(state, "lastEvidenceClaimId")),
            inferenceVersion: numberValue(rowValue(state, "inferenceVersion")),
            createdAt: dateValue(rowValue(state, "createdAt")),
            updatedAt: dateValue(rowValue(state, "updatedAt")),
            dimensions,
        };
    }
    async complete(input: CompleteModuleDiagnosticInput): Promise<ModuleDiagnosticCompletionResult> {
        const mainTask = await this.assertScope(input);
        const questionTasks = new Map<string, StoredTask>();
        for (const definition of input.tasks) {
            questionTasks.set(definition.stableKey, await this.ensureTask(input, definition));
        }
        const evidence = [];
        const entityIds = new Set<string>();
        for (const definition of input.tasks) {
            for (const requirement of definition.requirements) {
                entityIds.add(requirement.cognitiveEntityId);
            }
        }
        for (const completion of input.completions) {
            const questionTask = questionTasks.get(completion.stableKey);
            if (!questionTask || questionTask.status !== "active") {
                throw new CognitionPersistenceError("not_found", "active module diagnostic question task not found");
            }
            const started = await this.attempts.start({
                taskId: questionTask.id,
                userId: input.userId,
                idempotencyKey: completion.idempotencyKey,
                context: {
                    moduleId: input.moduleId,
                    evidenceAssistance: {
                        level: "independent",
                        hintCount: 0,
                        answerRevealed: false,
                    },
                    positiveEvidenceEligible: true,
                },
                response: completion.response,
                artifactRefs: [],
                artifactVersionRefs: [],
                processLog: [],
                assistanceTrace: [],
                assistanceLevel: 0,
                hintCount: 0,
                status: "evaluated",
                submittedAt: completion.submittedAt,
                completedAt: completion.completedAt,
            });
            for (const candidate of completion.candidates) {
                const requirement = questionTask.requirements[candidate.requirementIndex];
                if (!requirement) {
                    throw new CognitionPersistenceError("invalid_candidate", "module diagnostic completion requirement does not exist");
                }
                evidence.push(await this.evidence.recordVerifiedObservation({
                    userId: input.userId,
                    attemptId: started.attempt.id,
                    candidate: {
                        ...candidate.candidate,
                        requirementId: requiredString(requirement, "id"),
                    },
                    evaluator: candidate.evaluator,
                }));
            }
        }
        const states = new Map<string, VerifiedEvidenceLearnerStateRecord | null>();
        for (const entityId of entityIds) {
            states.set(entityId, await this.readState(input.userId, entityId));
        }
        const finalization: ModuleDiagnosticFinalization = await input.finalize({
            states,
        });
        if (input.legacyAttemptId) {
            const legacy = resultRows(await this.execute(`SELECT "userId", "taskId", "status"
             FROM ${qualifiedTable(this.em, "TaskAttempt")}
            WHERE "id" = ?`, [input.legacyAttemptId]))[0];
            if (!legacy ||
                rowValue(legacy, "userId") !== input.userId ||
                rowValue(legacy, "taskId") !== mainTask.id ||
                rowValue(legacy, "status") !== "started") {
                throw new CognitionPersistenceError("invalid_candidate", "legacy module diagnostic attempt cannot be replaced");
            }
            await this.execute(`UPDATE ${qualifiedTable(this.em, "TaskAttempt")}
            SET "status" = 'abandoned', "completedAt" = ?
          WHERE "id" = ?`, [finalization.submittedAt, input.legacyAttemptId]);
        }
        const mainAttempt = await this.attempts.start({
            taskId: mainTask.id,
            userId: input.userId,
            idempotencyKey: input.mainAttemptIdempotencyKey,
            context: input.mainResponseContext,
            response: jsonObject(finalization.responseJson),
            artifactRefs: [],
            artifactVersionRefs: [],
            processLog: [],
            assistanceTrace: [],
            assistanceLevel: 0,
            hintCount: 0,
            status: "evaluated",
            startedAt: input.startedAt,
            submittedAt: finalization.submittedAt,
            completedAt: finalization.submittedAt,
        });
        return {
            attempt: {
                ...mainAttempt.attempt,
                status: "evaluated",
                response: parseJson(finalization.responseJson),
                submittedAt: finalization.submittedAt,
                completedAt: finalization.submittedAt,
            },
            evidence,
            finalization,
            replayed: mainAttempt.replayed || evidence.every((item) => item.replayed),
        };
    }
}
