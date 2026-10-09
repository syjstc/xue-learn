import { createHash, randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { CompleteUnitDiagnosticInput, UnitDiagnosticCompletionItem, UnitDiagnosticCompletionItemResult, UnitDiagnosticCompletionResult, UnitDiagnosticTaskDefinition, UnitDiagnosticTaskRequirement, UnitDiagnosticCompletionRepository, VerifiedEvidenceLearnerStateRecord, VerifiedEvidenceLearnerDimensionStateRecord, } from "@xue-learn/core/domain";
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
        throw new CognitionPersistenceError("not_found", `unit diagnostic row is missing ${key}`);
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
function requirementRubric(requirement: UnitDiagnosticTaskRequirement): Record<string, unknown> {
    return {
        ...(requirement.rubricCriterion ?? {}),
        ref: requirement.criterionRef,
        definitionVersion: requirement.definitionVersion,
    };
}
function requirementSignature(requirement: UnitDiagnosticTaskRequirement): string {
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
    unitId: string | null;
    taskType: string;
    definitionVersion: number;
    status: string;
    context: Record<string, unknown>;
    requirements: readonly Row[];
}>;
/** Raw adapter for the complete unit-diagnostic submission write set. */
export class MikroOrmUnitDiagnosticCompletionRepository implements UnitDiagnosticCompletionRepository {
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
    private async readTask(goalId: string, stableKey: string): Promise<StoredTask | null> {
        const row = resultRows(await this.execute(`SELECT "id", "goalId", "unitId", "taskType", "status", "context", "definitionVersion"
           FROM ${qualifiedTable(this.em, "LearningTask")}
          WHERE "goalId" = ? AND "stableKey" = ?`, [goalId, stableKey]))[0];
        if (!row)
            return null;
        const taskId = requiredString(row, "id");
        return {
            id: taskId,
            goalId: requiredString(row, "goalId"),
            unitId: rowValue(row, "unitId") == null
                ? null
                : String(rowValue(row, "unitId")),
            taskType: String(rowValue(row, "taskType")),
            definitionVersion: numberValue(rowValue(row, "definitionVersion"), 1),
            status: String(rowValue(row, "status")),
            context: jsonObject(rowValue(row, "context")),
            requirements: resultRows(await this.execute(`SELECT "id", "learningTargetId", "cognitiveEntityId", "dimension",
                  "required", "weight", "orderIndex", "rubricCriterion"
             FROM ${qualifiedTable(this.em, "TaskRequirement")}
            WHERE "taskId" = ? ORDER BY "orderIndex" ASC, "id" ASC`, [taskId])),
        };
    }
    private async assertScope(input: CompleteUnitDiagnosticInput, definition: UnitDiagnosticTaskDefinition): Promise<void> {
        const goal = resultRows(await this.execute(`SELECT "userId" FROM ${qualifiedTable(this.em, "LearningGoal")} WHERE "id" = ?`, [definition.goalId]))[0];
        if (!goal || rowValue(goal, "userId") !== input.userId) {
            throw new CognitionPersistenceError("ownership_mismatch", "unit diagnostic task goal is not owned by the learner");
        }
        if (definition.goalId !== input.goalId ||
            definition.unitId !== input.unitId) {
            throw new CognitionPersistenceError("invalid_declaration", "unit diagnostic task scope does not match the completion request");
        }
        for (const requirement of definition.requirements) {
            const entity = resultRows(await this.execute(`SELECT "goalId", "definitionVersion", "status"
             FROM ${qualifiedTable(this.em, "CognitiveEntity")}
            WHERE "id" = ?`, [requirement.cognitiveEntityId]))[0];
            if (!entity ||
                rowValue(entity, "goalId") !== definition.goalId ||
                rowValue(entity, "status") !== "active" ||
                numberValue(rowValue(entity, "definitionVersion")) !==
                    requirement.definitionVersion) {
                throw new CognitionPersistenceError("invalid_declaration", `unit diagnostic entity ${requirement.cognitiveEntityId} is not active at the declared version`);
            }
            const target = resultRows(await this.execute(`SELECT "goalId", "status"
             FROM ${qualifiedTable(this.em, "LearningTarget")}
            WHERE "id" = ?`, [requirement.learningTargetId]))[0];
            const targetRequirement = resultRows(await this.execute(`SELECT "id" FROM ${qualifiedTable(this.em, "LearningTargetRequirement")}
            WHERE "learningTargetId" = ? AND "cognitiveEntityId" = ? AND "dimension" = ?`, [
                requirement.learningTargetId,
                requirement.cognitiveEntityId,
                requirement.dimension,
            ]))[0];
            const unitTarget = resultRows(await this.execute(`SELECT "id" FROM ${qualifiedTable(this.em, "UnitLearningTarget")}
            WHERE "unitId" = ? AND "learningTargetId" = ?`, [definition.unitId, requirement.learningTargetId]))[0];
            if (!target ||
                rowValue(target, "goalId") !== definition.goalId ||
                rowValue(target, "status") !== "active" ||
                !targetRequirement ||
                !unitTarget) {
                throw new CognitionPersistenceError("invalid_declaration", `unit diagnostic target ${requirement.learningTargetId} does not declare the required entity and dimension`);
            }
        }
    }
    private assertExistingTask(existing: StoredTask, definition: UnitDiagnosticTaskDefinition): void {
        const requested = new Set(definition.requirements.map(requirementSignature));
        const stored = new Set(existing.requirements.map(storedRequirementSignature));
        const sameRequirements = requested.size === stored.size &&
            [...requested].every((signature) => stored.has(signature));
        if (existing.unitId !== definition.unitId ||
            existing.taskType !== definition.taskType ||
            existing.definitionVersion !== definition.definitionVersion ||
            !sameRequirements ||
            stableJson(existing.context.evidencePolicy) !==
                stableJson(definition.evidencePolicy)) {
            throw new CognitionPersistenceError("immutable_declaration", "an existing unit diagnostic task evidence declaration cannot be mutated");
        }
    }
    private requirementId(taskId: string, orderIndex: number): string {
        return `unit-diagnostic-requirement-${createHash("sha256")
            .update(`${taskId}:${orderIndex}`)
            .digest("hex")
            .slice(0, 32)}`;
    }
    private async ensureTask(input: CompleteUnitDiagnosticInput, definition: UnitDiagnosticTaskDefinition): Promise<StoredTask> {
        const existing = await this.readTask(definition.goalId, definition.stableKey);
        if (existing) {
            this.assertExistingTask(existing, definition);
            if (existing.status !== "active") {
                await this.execute(`UPDATE ${qualifiedTable(this.em, "LearningTask")}
              SET "status" = 'active', "updatedAt" = ? WHERE "id" = ?`, [new Date(), existing.id]);
                return (await this.readTask(definition.goalId, definition.stableKey))!;
            }
            return existing;
        }
        await this.assertScope(input, definition);
        const taskId = randomUUID();
        const now = new Date();
        const jsonType = this.jsonType();
        await this.execute(`INSERT INTO ${qualifiedTable(this.em, "LearningTask")}
        ("id", "goalId", "unitId", "stableKey", "taskType", "title",
         "instructions", "context", "rubric", "difficulty", "definitionVersion",
         "origin", "status", "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?${jsonType}, ?${jsonType}, ?, ?, ?, 'active', ?, ?)
       ON CONFLICT ("goalId", "stableKey") DO NOTHING`, [
            taskId,
            definition.goalId,
            definition.unitId,
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
        let task = await this.readTask(definition.goalId, definition.stableKey);
        if (!task)
            throw new Error("Unit diagnostic task was not published");
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
        task = await this.readTask(definition.goalId, definition.stableKey);
        if (!task)
            throw new Error("Unit diagnostic task disappeared after publish");
        this.assertExistingTask(task, definition);
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
    async complete(input: CompleteUnitDiagnosticInput): Promise<UnitDiagnosticCompletionResult> {
        const diagnostic = resultRows(await this.execute(`SELECT "userId", "unitId", "status"
           FROM ${qualifiedTable(this.em, "DiagnosticAttempt")}
          WHERE "id" = ?${""}`, [input.diagnosticAttemptId]))[0];
        if (!diagnostic ||
            rowValue(diagnostic, "userId") !== input.userId ||
            rowValue(diagnostic, "unitId") !== input.unitId) {
            throw new CognitionPersistenceError("ownership_mismatch", "diagnostic attempt is not owned by the learner and unit");
        }
        if (rowValue(diagnostic, "status") === "submitted") {
            throw new CognitionPersistenceError("invalid_candidate", "diagnostic attempt has already been submitted");
        }
        const taskByKey = new Map<string, StoredTask>();
        for (const definition of input.tasks) {
            taskByKey.set(definition.stableKey, await this.ensureTask(input, definition));
        }
        const items: UnitDiagnosticCompletionItemResult[] = [];
        for (const completion of input.completions) {
            const task = taskByKey.get(completion.stableKey);
            if (!task || task.status !== "active") {
                throw new CognitionPersistenceError("not_found", "active unit diagnostic task not found");
            }
            const started = await this.attempts.start({
                taskId: task.id,
                userId: input.userId,
                unitId: input.unitId,
                idempotencyKey: completion.idempotencyKey,
                context: {
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
            await this.execute(`UPDATE ${qualifiedTable(this.em, "TaskAttempt")}
            SET "status" = 'evaluated', "completedAt" = ?
          WHERE "id" = ? AND "userId" = ? AND "taskId" = ?`, [completion.completedAt, started.attempt.id, input.userId, task.id]);
            const evidence = [];
            for (const candidate of completion.candidates) {
                const requirement = task.requirements[candidate.requirementIndex];
                if (!requirement) {
                    throw new CognitionPersistenceError("invalid_candidate", "unit diagnostic completion requirement does not exist");
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
            items.push({
                attempt: {
                    ...started.attempt,
                    status: "evaluated",
                    completedAt: completion.completedAt,
                },
                evidence,
                replayed: started.replayed || evidence.every((item) => item.replayed),
            });
        }
        const states = new Map<string, VerifiedEvidenceLearnerStateRecord | null>();
        for (const entityId of input.entityIds) {
            states.set(entityId, await this.readState(input.userId, entityId));
        }
        const finalization = await input.finalize({ states });
        await this.execute(`UPDATE ${qualifiedTable(this.em, "DiagnosticAttempt")}
          SET "answers" = ?, "results" = ?,
              "perLearningTargetResults" = ?, "overallScore" = ?,
              "passed" = ?, "status" = 'submitted', "submittedAt" = ?
        WHERE "id" = ? AND "userId" = ? AND "unitId" = ?
          AND "status" <> 'submitted'`, [
            finalization.answersJson,
            finalization.resultsJson,
            finalization.perLearningTargetResultsJson,
            finalization.overallScore,
            finalization.passed,
            finalization.submittedAt,
            input.diagnosticAttemptId,
            input.userId,
            input.unitId,
        ]);
        return {
            attemptId: input.diagnosticAttemptId,
            finalization,
            items,
            replayed: items.every((item) => item.replayed),
        };
    }
}
