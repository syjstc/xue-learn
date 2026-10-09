import { createHash } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { FeynmanEvidenceRepository, FeynmanEvidenceRequirement, FeynmanEvidenceTask, RecordFeynmanEvidenceInput, RecordFeynmanEvidenceResult, TaskAttemptPersistenceRecord, } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { CognitionPersistenceError } from "@xue-learn/core/source/libs/server/src/cognition/persistence/error.ts";
import { MikroOrmTaskAttemptRepository } from "./task-attempt.repository.ts";
import { MikroOrmVerifiedEvidenceAppendRepository } from "./verified-evidence-append.repository.ts";
type Row = Readonly<Record<string, unknown>>;
type StoredRequirement = Readonly<{
    id: string;
    cognitiveEntityId: string;
    learningTargetId: string | null;
    dimension: string;
    criterionRef: string;
    definitionVersion: number;
    required: boolean;
    weight: number;
    orderIndex: number;
}>;
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
    if (typeof value !== "string" || value.length === 0) {
        throw new CognitionPersistenceError("not_found", `Feynman evidence row is missing ${key}`);
    }
    return value;
}
function numberValue(value: unknown, fallback = 0): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function parseJson(value: unknown): unknown {
    if (typeof value !== "string")
        return value;
    try {
        return JSON.parse(value) as unknown;
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
function stableHash(value: unknown): string {
    return createHash("sha256")
        .update(JSON.stringify(value))
        .digest("hex")
        .slice(0, 32);
}
function qualifiedTable(em: EntityManager, table: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${table.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
function requirementSignature(requirement: {
    cognitiveEntityId: string;
    learningTargetId: string;
    dimension: string;
    criterionRef: string;
    definitionVersion: number;
    required: boolean;
    weight: number;
    orderIndex: number;
}): string {
    return JSON.stringify(requirement);
}
function storedRequirementSignature(requirement: StoredRequirement & {
    required: boolean;
    weight: number;
    orderIndex: number;
}): string {
    return requirementSignature({
        cognitiveEntityId: requirement.cognitiveEntityId,
        learningTargetId: requirement.learningTargetId ?? "",
        dimension: requirement.dimension,
        criterionRef: requirement.criterionRef,
        definitionVersion: requirement.definitionVersion,
        required: requirement.required,
        weight: requirement.weight,
        orderIndex: requirement.orderIndex,
    });
}
function taskContext(input: RecordFeynmanEvidenceInput, task: FeynmanEvidenceTask) {
    const criterionRef = task.requirements[0]?.criterionRef ?? "";
    return {
        evidencePolicy: {
            source: "feynman" as const,
            taskKind: "explanation" as const,
            contextKey: `unit:${input.unitId}:feynman:${task.targetId}`,
            contextDistance: "same" as const,
            rubricId: criterionRef,
        },
    };
}
/** Transaction-neutral raw adapter; the runtime owns the transaction. */
export class MikroOrmFeynmanEvidenceRepository implements FeynmanEvidenceRepository {
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
    private async assertUnitScope(input: RecordFeynmanEvidenceInput) {
        const row = resultRows(await this.execute(`SELECT u."id", u."goalId", g."userId"
           FROM ${qualifiedTable(this.em, "LearningUnit")} u
           JOIN ${qualifiedTable(this.em, "LearningGoal")} g
             ON g."id" = u."goalId"
          WHERE u."id" = ? AND u."goalId" = ?`, [input.unitId, input.goalId]))[0];
        if (!row || rowValue(row, "userId") !== input.userId) {
            throw new CognitionPersistenceError("ownership_mismatch", "Feynman unit is not owned by the learner");
        }
    }
    private async readRequirements(taskId: string): Promise<StoredRequirement[]> {
        return resultRows(await this.execute(`SELECT "id", "cognitiveEntityId", "learningTargetId", "dimension",
                "rubricCriterion", "required", "weight", "orderIndex"
           FROM ${qualifiedTable(this.em, "TaskRequirement")}
          WHERE "taskId" = ? ORDER BY "orderIndex" ASC, "id" ASC`, [taskId])).map((row) => {
            const rubric = jsonObject(rowValue(row, "rubricCriterion"));
            return {
                id: requiredString(row, "id"),
                cognitiveEntityId: requiredString(row, "cognitiveEntityId"),
                learningTargetId: rowValue(row, "learningTargetId") == null
                    ? null
                    : String(rowValue(row, "learningTargetId")),
                dimension: requiredString(row, "dimension"),
                criterionRef: typeof rubric.ref === "string" ? rubric.ref : "",
                definitionVersion: numberValue(rubric.definitionVersion ?? rowValue(row, "definitionVersion"), 1),
                required: rowValue(row, "required") === true || rowValue(row, "required") === 1,
                weight: numberValue(rowValue(row, "weight"), 1),
                orderIndex: numberValue(rowValue(row, "orderIndex")),
            };
        });
    }
    private async ensureTask(input: RecordFeynmanEvidenceInput, task: FeynmanEvidenceTask): Promise<{
        id: string;
        requirements: StoredRequirement[];
    }> {
        const taskTable = qualifiedTable(this.em, "LearningTask");
        const existing = resultRows(await this.execute(`SELECT "id", "unitId", "taskType", "title", "instructions",
                "context", "definitionVersion", "status"
           FROM ${taskTable}
          WHERE "goalId" = ? AND "stableKey" = ?`, [input.goalId, task.stableKey]))[0];
        const context = taskContext(input, task);
        if (existing) {
            const storedRequirements = await this.readRequirements(requiredString(existing, "id"));
            const requested = task.requirements.map((requirement) => requirementSignature({
                ...requirement,
                learningTargetId: requirement.learningTargetId,
                dimension: requirement.dimension,
            }));
            const stored = storedRequirements.map((requirement) => storedRequirementSignature(requirement));
            const storedContext = jsonObject(rowValue(existing, "context"));
            if (rowValue(existing, "unitId") !== input.unitId ||
                rowValue(existing, "taskType") !== "explanation" ||
                rowValue(existing, "title") !== task.title ||
                rowValue(existing, "instructions") !== task.instructions ||
                numberValue(rowValue(existing, "definitionVersion"), 1) !==
                    task.definitionVersion ||
                rowValue(existing, "status") !== "active" ||
                JSON.stringify(storedContext) !== JSON.stringify(context) ||
                requested.length !== stored.length ||
                requested.some((signature) => !stored.includes(signature))) {
                throw new CognitionPersistenceError("immutable_declaration", "an existing Feynman task evidence declaration cannot be mutated");
            }
            return {
                id: requiredString(existing, "id"),
                requirements: storedRequirements,
            };
        }
        const target = resultRows(await this.execute(`SELECT "id", "goalId", "status"
           FROM ${qualifiedTable(this.em, "LearningTarget")}
          WHERE "id" = ?`, [task.targetId]))[0];
        if (!target ||
            rowValue(target, "goalId") !== input.goalId ||
            rowValue(target, "status") !== "active") {
            throw new CognitionPersistenceError("invalid_declaration", "Feynman target is not active in the learner goal");
        }
        for (const requirement of task.requirements) {
            const entity = resultRows(await this.execute(`SELECT "goalId", "status", "definitionVersion"
             FROM ${qualifiedTable(this.em, "CognitiveEntity")}
            WHERE "id" = ?`, [requirement.cognitiveEntityId]))[0];
            if (!entity ||
                rowValue(entity, "goalId") !== input.goalId ||
                rowValue(entity, "status") !== "active" ||
                numberValue(rowValue(entity, "definitionVersion")) !==
                    requirement.definitionVersion) {
                throw new CognitionPersistenceError("invalid_declaration", `Feynman entity ${requirement.cognitiveEntityId} is not active at the declared version`);
            }
        }
        const id = `task_${stableHash([input.goalId, task.stableKey])}`;
        const now = new Date();
        const jsonType = this.jsonType();
        await this.execute(`INSERT INTO ${taskTable}
        ("id", "goalId", "moduleId", "unitId", "stableKey", "taskType",
         "title", "instructions", "context", "rubric", "difficulty",
         "definitionVersion", "origin", "status", "createdAt", "updatedAt")
       VALUES (?, ?, NULL, ?, ?, 'explanation', ?, ?, ?${jsonType}, ?${jsonType},
               'medium', ?, 'feynman', 'active', ?, ?)
       ON CONFLICT ("goalId", "stableKey") DO NOTHING`, [
            id,
            input.goalId,
            input.unitId,
            task.stableKey,
            task.title,
            task.instructions,
            JSON.stringify(context),
            JSON.stringify({
                criterionRef: task.requirements[0]?.criterionRef ?? "",
            }),
            task.definitionVersion,
            now,
            now,
        ]);
        const persisted = resultRows(await this.execute(`SELECT "id" FROM ${taskTable} WHERE "goalId" = ? AND "stableKey" = ?`, [input.goalId, task.stableKey]))[0];
        if (!persisted)
            throw new Error("Feynman task was not persisted");
        const taskId = requiredString(persisted, "id");
        const requirementTable = qualifiedTable(this.em, "TaskRequirement");
        for (const requirement of task.requirements) {
            await this.execute(`INSERT INTO ${requirementTable}
          ("id", "taskId", "learningTargetId", "cognitiveEntityId", "dimension",
           "role", "required", "weight", "orderIndex", "rubricCriterion", "createdAt")
         VALUES (?, ?, ?, ?, ?, 'primary', ?, ?, ?, ?${jsonType}, ?)`, [
                `requirement_${stableHash([taskId, requirement.orderIndex, requirement.cognitiveEntityId])}`,
                taskId,
                requirement.learningTargetId,
                requirement.cognitiveEntityId,
                requirement.dimension,
                requirement.required,
                requirement.weight,
                requirement.orderIndex,
                JSON.stringify(requirement.rubricCriterion),
                now,
            ]);
        }
        return { id: taskId, requirements: await this.readRequirements(taskId) };
    }
    private async startAttempt(input: RecordFeynmanEvidenceInput, sessionId: string, taskId: string): Promise<TaskAttemptPersistenceRecord> {
        const result = await this.attempts.start({
            taskId,
            userId: input.userId,
            unitId: input.unitId,
            idempotencyKey: `assessment:feynman:${sessionId}:${taskId}`,
            context: {
                evidenceAssistance: {
                    level: "independent",
                    hintCount: 0,
                    answerRevealed: false,
                },
                positiveEvidenceEligible: true,
            },
            response: { explanation: input.userText },
            artifactRefs: [],
            artifactVersionRefs: [],
            processLog: [],
            assistanceTrace: [],
            assistanceLevel: 0,
            hintCount: 0,
            status: "evaluated",
            submittedAt: new Date(),
            completedAt: new Date(),
        });
        return result.attempt;
    }
    async record(input: RecordFeynmanEvidenceInput): Promise<RecordFeynmanEvidenceResult> {
        await this.assertUnitScope(input);
        const sessionId = `feynman_${stableHash([
            input.userId,
            input.unitId,
            input.userText,
            input.feedback,
            input.passed,
            input.observations,
        ])}`;
        const sessionTable = qualifiedTable(this.em, "FeynmanSession");
        const jsonType = this.jsonType();
        await this.execute(`INSERT INTO ${sessionTable}
        ("id", "unitId", "userText", "feedback", "passed", "createdAt")
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT ("id") DO NOTHING`, [
            sessionId,
            input.unitId,
            input.userText,
            JSON.stringify(input.feedback),
            input.passed,
            new Date(),
        ]);
        let observationCount = 0;
        for (const observation of input.observations) {
            const task = await this.ensureTask(input, observation.task);
            const attempt = await this.startAttempt(input, sessionId, task.id);
            for (const requirement of task.requirements) {
                if (requirement.criterionRef !== observation.criterionRef) {
                    throw new CognitionPersistenceError("invalid_declaration", `Feynman criterion ${observation.criterionRef} does not match task requirement`);
                }
                await this.evidence.recordVerifiedObservation({
                    userId: input.userId,
                    attemptId: attempt.id,
                    candidate: {
                        requirementId: requirement.id,
                        score: observation.score,
                        outcome: observation.score >= 0.7 ? "meets" : "does_not_meet",
                        evaluatorRunId: `feynman:${sessionId}:${observation.task.targetId}:${observation.criterionRef}`,
                        rawResult: { rationale: observation.rationale },
                    },
                    evaluator: {
                        source: "feynman",
                        taskKind: "explanation",
                        contextKey: `unit:${input.unitId}:feynman:${observation.task.targetId}`,
                        contextDistance: "same",
                        rubricId: observation.criterionRef,
                        evaluatorType: "llm",
                        evaluatorReliability: 0.8,
                        groundingReliability: 0.8,
                        evidenceStrength: "moderate",
                    },
                });
                observationCount += 1;
            }
        }
        return { feynmanSessionId: sessionId, observationCount };
    }
}
