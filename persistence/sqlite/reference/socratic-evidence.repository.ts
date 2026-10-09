import { createHash } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { RecordSocraticEvidenceInput, RecordSocraticEvidenceResult, SocraticEvidenceRepository, SocraticEvidenceRequirement, SocraticEvidenceTask, TaskAttemptPersistenceRecord, } from "@xue-learn/core/domain";
import { CognitionPersistenceError } from "@xue-learn/core/server/cognition/persistence/error";
import { MikroOrmTaskAttemptRepository } from "./task-attempt.repository.ts";
import { MikroOrmVerifiedEvidenceAppendRepository } from "./verified-evidence-append.repository.ts";
type Row = Readonly<Record<string, unknown>>;
type StoredRequirement = Readonly<{
    id: string;
    cognitiveEntityId: string;
    learningTargetId: string | null;
    dimension: "understanding" | "independence";
    criterionRef: string;
    definitionVersion: number;
    required: boolean;
    weight: number;
    orderIndex: number;
    rubricCriterion: Record<string, unknown>;
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
        throw new CognitionPersistenceError("not_found", `Socratic evidence row is missing ${key}`);
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
function stableJson(value: unknown): string {
    const normalize = (item: unknown): unknown => {
        if (Array.isArray(item))
            return item.map(normalize);
        if (item && typeof item === "object") {
            return Object.fromEntries(Object.entries(item as Record<string, unknown>)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, child]) => [key, normalize(child)]));
        }
        return item;
    };
    return JSON.stringify(normalize(value));
}
function stableHash(value: unknown): string {
    return createHash("sha256")
        .update(stableJson(value))
        .digest("hex")
        .slice(0, 32);
}
function qualifiedTable(em: EntityManager, table: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${table.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
function jsonSuffix(em: EntityManager): string {
    return "";
}
function nonEmpty(value: string): boolean {
    return value.trim().length > 0;
}
function rubricCriterion(requirement: SocraticEvidenceRequirement): Record<string, unknown> {
    return {
        ...(requirement.rubricCriterion ?? {}),
        ref: requirement.criterionRef,
        definitionVersion: requirement.definitionVersion,
    };
}
function requirementSignature(requirement: SocraticEvidenceRequirement): string {
    return stableJson({
        cognitiveEntityId: requirement.cognitiveEntityId,
        learningTargetId: requirement.learningTargetId ?? "",
        dimension: requirement.dimension,
        criterionRef: requirement.criterionRef,
        definitionVersion: requirement.definitionVersion,
        required: requirement.required,
        weight: requirement.weight,
        orderIndex: requirement.orderIndex,
        rubricCriterion: rubricCriterion(requirement),
    });
}
function storedRequirementSignature(requirement: StoredRequirement): string {
    return stableJson({
        cognitiveEntityId: requirement.cognitiveEntityId,
        learningTargetId: requirement.learningTargetId ?? "",
        dimension: requirement.dimension,
        criterionRef: requirement.criterionRef,
        definitionVersion: requirement.definitionVersion,
        required: requirement.required,
        weight: requirement.weight,
        orderIndex: requirement.orderIndex,
        rubricCriterion: requirement.rubricCriterion,
    });
}
function validateInput(input: RecordSocraticEvidenceInput): void {
    const task = input.task;
    if (!nonEmpty(input.userId) ||
        !nonEmpty(input.goalId) ||
        !nonEmpty(input.unitId) ||
        !nonEmpty(input.threadId) ||
        !Number.isInteger(input.turn) ||
        input.turn < 0 ||
        !nonEmpty(task.stableKey) ||
        !nonEmpty(task.targetId) ||
        !nonEmpty(task.title) ||
        !Number.isInteger(task.definitionVersion) ||
        task.definitionVersion < 1 ||
        task.requirements.length === 0) {
        throw new CognitionPersistenceError("invalid_declaration", "Socratic evidence requires scoped identity and a versioned task declaration");
    }
    if (!task.requirements.some((requirement) => requirement.dimension === "understanding")) {
        throw new CognitionPersistenceError("invalid_declaration", "Socratic evidence requires at least one understanding requirement");
    }
    const signatures = new Set<string>();
    for (const requirement of task.requirements) {
        if (!nonEmpty(requirement.cognitiveEntityId) ||
            !nonEmpty(requirement.criterionRef) ||
            !Number.isInteger(requirement.definitionVersion) ||
            requirement.definitionVersion < 1 ||
            !Number.isInteger(requirement.orderIndex) ||
            requirement.orderIndex < 0 ||
            !Number.isFinite(requirement.weight) ||
            requirement.weight <= 0) {
            throw new CognitionPersistenceError("invalid_declaration", "each Socratic requirement needs an entity, criterion, version, and positive weight");
        }
        const signature = requirementSignature(requirement);
        if (signatures.has(signature)) {
            throw new CognitionPersistenceError("invalid_declaration", "Socratic requirements cannot contain duplicate declarations");
        }
        signatures.add(signature);
    }
}
function taskContext(input: RecordSocraticEvidenceInput) {
    const criterionRef = input.task.requirements.find((requirement) => requirement.dimension === "understanding")?.criterionRef ?? "";
    return {
        evidencePolicy: {
            source: "socratic" as const,
            taskKind: "explanation" as const,
            contextKey: `unit:${input.unitId}:socratic:${input.task.targetId}:${criterionRef}`,
            contextDistance: "same" as const,
            rubricId: criterionRef,
        },
    };
}
/** Transaction-neutral raw adapter; the runtime owns the transaction. */
export class MikroOrmSocraticEvidenceRepository implements SocraticEvidenceRepository {
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
    private async assertUnitScope(input: RecordSocraticEvidenceInput): Promise<void> {
        const row = resultRows(await this.execute(`SELECT u."id", u."goalId", g."userId"
           FROM ${qualifiedTable(this.em, "LearningUnit")} u
           JOIN ${qualifiedTable(this.em, "LearningGoal")} g
             ON g."id" = u."goalId"
          WHERE u."id" = ? AND u."goalId" = ?`, [input.unitId, input.goalId]))[0];
        if (!row || rowValue(row, "userId") !== input.userId) {
            throw new CognitionPersistenceError("ownership_mismatch", "Socratic unit is not owned by the learner");
        }
    }
    private async assertTargetScope(input: RecordSocraticEvidenceInput): Promise<void> {
        const target = resultRows(await this.execute(`SELECT "id", "goalId", "status"
           FROM ${qualifiedTable(this.em, "LearningTarget")}
          WHERE "id" = ?`, [input.task.targetId]))[0];
        if (!target ||
            rowValue(target, "goalId") !== input.goalId ||
            rowValue(target, "status") !== "active") {
            throw new CognitionPersistenceError("invalid_declaration", "Socratic target is not active in the learner goal");
        }
    }
    private async readRequirements(taskId: string): Promise<StoredRequirement[]> {
        return resultRows(await this.execute(`SELECT "id", "cognitiveEntityId", "learningTargetId", "dimension",
                "rubricCriterion", "required", "weight", "orderIndex"
           FROM ${qualifiedTable(this.em, "TaskRequirement")}
          WHERE "taskId" = ? ORDER BY "orderIndex" ASC, "id" ASC`, [taskId])).map((row) => {
            const rubric = jsonObject(rowValue(row, "rubricCriterion"));
            const dimension = rowValue(row, "dimension");
            if (dimension !== "understanding" && dimension !== "independence") {
                throw new CognitionPersistenceError("immutable_declaration", "an existing Socratic task contains an unsupported dimension");
            }
            const criterionRef = rubric.ref;
            if (typeof criterionRef !== "string" || !criterionRef) {
                throw new CognitionPersistenceError("immutable_declaration", "an existing Socratic requirement is missing its criterion reference");
            }
            return {
                id: requiredString(row, "id"),
                cognitiveEntityId: requiredString(row, "cognitiveEntityId"),
                learningTargetId: rowValue(row, "learningTargetId") == null
                    ? null
                    : String(rowValue(row, "learningTargetId")),
                dimension,
                criterionRef,
                definitionVersion: numberValue(rubric.definitionVersion, 0),
                required: rowValue(row, "required") === true || rowValue(row, "required") === 1,
                weight: numberValue(rowValue(row, "weight")),
                orderIndex: numberValue(rowValue(row, "orderIndex")),
                rubricCriterion: rubric,
            };
        });
    }
    private async validateTargetBinding(input: RecordSocraticEvidenceInput, requirement: SocraticEvidenceRequirement): Promise<void> {
        if (!requirement.learningTargetId)
            return;
        const target = resultRows(await this.execute(`SELECT "id", "goalId", "status"
           FROM ${qualifiedTable(this.em, "LearningTarget")}
          WHERE "id" = ?`, [requirement.learningTargetId]))[0];
        if (!target ||
            rowValue(target, "goalId") !== input.goalId ||
            rowValue(target, "status") !== "active" ||
            rowValue(target, "id") !== input.task.targetId) {
            throw new CognitionPersistenceError("invalid_declaration", "Socratic requirement target is outside the task target scope");
        }
        const binding = resultRows(await this.execute(`SELECT "id"
           FROM ${qualifiedTable(this.em, "LearningTargetRequirement")}
          WHERE "learningTargetId" = ?
            AND "cognitiveEntityId" = ?
            AND "dimension" = ?
          LIMIT 1`, [
            requirement.learningTargetId,
            requirement.cognitiveEntityId,
            requirement.dimension,
        ]))[0];
        if (!binding) {
            throw new CognitionPersistenceError("invalid_declaration", "Socratic requirement is not declared by its learning target");
        }
    }
    private async validateEntity(input: RecordSocraticEvidenceInput, requirement: SocraticEvidenceRequirement): Promise<void> {
        const entity = resultRows(await this.execute(`SELECT "goalId", "status", "definitionVersion"
           FROM ${qualifiedTable(this.em, "CognitiveEntity")}
          WHERE "id" = ?`, [requirement.cognitiveEntityId]))[0];
        if (!entity ||
            rowValue(entity, "goalId") !== input.goalId ||
            rowValue(entity, "status") !== "active" ||
            numberValue(rowValue(entity, "definitionVersion")) !==
                requirement.definitionVersion) {
            throw new CognitionPersistenceError("invalid_declaration", `Socratic entity ${requirement.cognitiveEntityId} is not active at the declared version`);
        }
    }
    private async ensureTask(input: RecordSocraticEvidenceInput): Promise<{
        id: string;
        requirements: StoredRequirement[];
    }> {
        const task = input.task;
        await this.assertTargetScope(input);
        for (const requirement of task.requirements) {
            await this.validateEntity(input, requirement);
            await this.validateTargetBinding(input, requirement);
        }
        const taskTable = qualifiedTable(this.em, "LearningTask");
        const existing = resultRows(await this.execute(`SELECT "id", "unitId", "taskType", "title", "instructions",
                "context", "definitionVersion", "origin", "status"
           FROM ${taskTable}
          WHERE "goalId" = ? AND "stableKey" = ?`, [input.goalId, task.stableKey]))[0];
        const context = taskContext(input);
        const requested = task.requirements.map(requirementSignature);
        if (existing) {
            const storedRequirements = await this.readRequirements(requiredString(existing, "id"));
            const stored = storedRequirements.map(storedRequirementSignature);
            if (rowValue(existing, "unitId") !== input.unitId ||
                rowValue(existing, "taskType") !== "explanation" ||
                rowValue(existing, "title") !== task.title ||
                rowValue(existing, "instructions") !== task.instructions ||
                numberValue(rowValue(existing, "definitionVersion"), 1) !==
                    task.definitionVersion ||
                rowValue(existing, "origin") !== "socratic" ||
                rowValue(existing, "status") !== "active" ||
                stableJson(jsonObject(rowValue(existing, "context"))) !==
                    stableJson(context) ||
                requested.length !== stored.length ||
                requested.some((signature) => !stored.includes(signature))) {
                throw new CognitionPersistenceError("immutable_declaration", "an existing Socratic task evidence declaration cannot be mutated");
            }
            return {
                id: requiredString(existing, "id"),
                requirements: storedRequirements,
            };
        }
        const now = new Date();
        const json = jsonSuffix(this.em);
        const id = `task_${stableHash([input.goalId, task.stableKey])}`;
        await this.execute(`INSERT INTO ${taskTable}
        ("id", "goalId", "moduleId", "unitId", "stableKey", "taskType",
         "title", "instructions", "context", "rubric", "difficulty",
         "definitionVersion", "origin", "status", "createdAt", "updatedAt")
       VALUES (?, ?, NULL, ?, ?, 'explanation', ?, ?, ?${json}, ?${json},
               'medium', ?, 'socratic', 'active', ?, ?)
       ON CONFLICT ("goalId", "stableKey") DO NOTHING`, [
            id,
            input.goalId,
            input.unitId,
            task.stableKey,
            task.title,
            task.instructions,
            JSON.stringify(context),
            JSON.stringify({
                criterionRef: task.requirements.find((requirement) => requirement.dimension === "understanding")?.criterionRef ?? "",
            }),
            task.definitionVersion,
            now,
            now,
        ]);
        const persisted = resultRows(await this.execute(`SELECT "id", "unitId", "taskType", "title", "instructions",
                "context", "definitionVersion", "origin", "status"
           FROM ${taskTable}
          WHERE "goalId" = ? AND "stableKey" = ?`, [input.goalId, task.stableKey]))[0];
        if (!persisted)
            throw new Error("Socratic task was not persisted");
        const taskId = requiredString(persisted, "id");
        const existingRequirements = await this.readRequirements(taskId);
        if (existingRequirements.length > 0) {
            const stored = existingRequirements.map(storedRequirementSignature);
            if (requested.length !== stored.length ||
                requested.some((signature) => !stored.includes(signature))) {
                throw new CognitionPersistenceError("immutable_declaration", "an existing Socratic task evidence declaration cannot be mutated");
            }
            return { id: taskId, requirements: existingRequirements };
        }
        const requirementTable = qualifiedTable(this.em, "TaskRequirement");
        for (const requirement of task.requirements) {
            await this.execute(`INSERT INTO ${requirementTable}
          ("id", "taskId", "learningTargetId", "cognitiveEntityId", "dimension",
           "role", "required", "weight", "orderIndex", "rubricCriterion", "createdAt")
         VALUES (?, ?, ?, ?, ?, 'primary', ?, ?, ?, ?${json}, ?)`, [
                `requirement_${stableHash([
                    taskId,
                    requirement.orderIndex,
                    requirement.cognitiveEntityId,
                ])}`,
                taskId,
                requirement.learningTargetId ?? null,
                requirement.cognitiveEntityId,
                requirement.dimension,
                requirement.required,
                requirement.weight,
                requirement.orderIndex,
                JSON.stringify(rubricCriterion(requirement)),
                now,
            ]);
        }
        return { id: taskId, requirements: await this.readRequirements(taskId) };
    }
    private async startAttempt(input: RecordSocraticEvidenceInput, taskId: string): Promise<TaskAttemptPersistenceRecord> {
        const now = new Date();
        const result = await this.attempts.start({
            taskId,
            userId: input.userId,
            unitId: input.unitId,
            idempotencyKey: `assessment:socratic:${input.threadId}:${input.turn}`,
            context: {
                evidenceAssistance: {
                    level: "guided",
                    hintCount: Math.max(1, input.turn),
                    answerRevealed: false,
                },
                positiveEvidenceEligible: !input.terminatedByLimit,
            },
            response: { answer: input.answer },
            artifactRefs: [],
            artifactVersionRefs: [],
            processLog: [],
            assistanceTrace: [],
            assistanceLevel: 0.55,
            hintCount: Math.max(1, input.turn),
            status: "evaluated",
            startedAt: now,
            submittedAt: now,
            completedAt: now,
        });
        return result.attempt;
    }
    async record(input: RecordSocraticEvidenceInput): Promise<RecordSocraticEvidenceResult> {
        validateInput(input);
        await this.assertUnitScope(input);
        const task = await this.ensureTask(input);
        const attempt = await this.startAttempt(input, task.id);
        const criterionRef = input.task.requirements.find((requirement) => requirement.dimension === "understanding")?.criterionRef ?? "";
        const evaluatorRunId = `socratic:${input.threadId}:${input.turn}`;
        let observationCount = 0;
        for (const requirement of task.requirements) {
            const score = requirement.dimension === "independence"
                ? 0.3
                : input.resolved && !input.terminatedByLimit
                    ? 0.8
                    : 0.3;
            await this.evidence.recordVerifiedObservation({
                userId: input.userId,
                attemptId: attempt.id,
                candidate: {
                    requirementId: requirement.id,
                    score,
                    outcome: input.resolved ? "resolved" : "unresolved",
                    evaluatorRunId,
                    rawResult: {
                        resolved: input.resolved,
                        terminatedByLimit: input.terminatedByLimit,
                        turn: input.turn,
                    },
                    assertedCognitiveEntityId: requirement.cognitiveEntityId,
                    assertedLearningTargetId: requirement.learningTargetId ?? undefined,
                    assertedDimension: requirement.dimension,
                    assertedCriterionRef: requirement.criterionRef,
                    assertedDefinitionVersion: requirement.definitionVersion,
                },
                evaluator: {
                    source: "socratic",
                    taskKind: "explanation",
                    contextKey: `unit:${input.unitId}:socratic:${input.task.targetId}:${criterionRef}`,
                    contextDistance: "same",
                    rubricId: criterionRef,
                    evaluatorType: "llm",
                    evaluatorReliability: 0.75,
                    groundingReliability: 0.75,
                    evidenceStrength: "weak",
                },
            });
            observationCount += 1;
        }
        return { observationCount };
    }
}
