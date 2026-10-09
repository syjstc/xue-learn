import { createHash, randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { CompleteMaterialCheckBatchInput, MaterialCheckCompletionRepository, MaterialCheckCompletionResult, MaterialCheckTaskDefinition, MaterialCheckTaskRequirement, } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { CognitionPersistenceError } from "@xue-learn/core/source/libs/server/src/cognition/persistence/error.ts";
import { MikroOrmDomainEventOutboxRepository } from "./domain-event.repository.ts";
import { MikroOrmTaskAttemptRepository } from "./task-attempt.repository.ts";
import { MikroOrmVerifiedEvidenceAppendRepository } from "./verified-evidence-append.repository.ts";
import { nullableReferenceDateValue } from "./date-value.ts";
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
function jsonObject(value: unknown): Record<string, unknown> {
    const parsed = parseJson(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
}
function numberValue(value: unknown, fallback = 0): number {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}
function booleanValue(value: unknown): boolean {
    return value === true || value === 1 || value === "1" || value === "true";
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
function requirementRubric(requirement: MaterialCheckTaskRequirement): Record<string, unknown> {
    return {
        ...(requirement.rubricCriterion ?? {}),
        ref: requirement.criterionRef,
        definitionVersion: requirement.definitionVersion,
    };
}
function declaredRequirementSignature(requirement: MaterialCheckTaskRequirement): string {
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
    const rubric = jsonObject(rowValue(requirement, "rubricCriterion"));
    return stableJson({
        learningTargetId: rowValue(requirement, "learningTargetId") == null
            ? null
            : String(rowValue(requirement, "learningTargetId")),
        cognitiveEntityId: String(rowValue(requirement, "cognitiveEntityId")),
        dimension: String(rowValue(requirement, "dimension")),
        required: booleanValue(rowValue(requirement, "required")),
        weight: numberValue(rowValue(requirement, "weight"), 1),
        orderIndex: numberValue(rowValue(requirement, "orderIndex")),
        rubricCriterion: rubric,
    });
}
type StoredTask = Readonly<{
    id: string;
    goalId: string;
    unitId: string | null;
    stableKey: string;
    taskType: string;
    definitionVersion: number;
    status: string;
    context: Record<string, unknown>;
    requirements: readonly Row[];
}>;
type MaterialCheckTaskPublicationInput = Readonly<{
    userId: string;
    goalId: string;
    unitId: string;
    tasks: readonly MaterialCheckTaskDefinition[];
}>;
/** Raw-SQL adapter for the complete published material-check write set. */
export class MikroOrmMaterialCheckCompletionRepository implements MaterialCheckCompletionRepository {
    private readonly attempts: MikroOrmTaskAttemptRepository;
    private readonly evidence: MikroOrmVerifiedEvidenceAppendRepository;
    private readonly domainEvents: MikroOrmDomainEventOutboxRepository;
    constructor(private readonly em: EntityManager) {
        this.attempts = new MikroOrmTaskAttemptRepository(em);
        this.evidence = new MikroOrmVerifiedEvidenceAppendRepository(em);
        this.domainEvents = new MikroOrmDomainEventOutboxRepository(em);
    }
    private execute(sql: string, params: unknown[] = []) {
        return this.em
            .getConnection()
            .execute(sql, params, undefined, this.em.getTransactionContext());
    }
    private jsonType(): string {
        return "";
    }
    async listAttempts(input: {
        userId: string;
        unitId: string;
        checkIds?: readonly string[];
    }) {
        if (input.checkIds?.length === 0)
            return [];
        const stableKeys = input.checkIds?.map((checkId) => `assessment:material-check:${checkId}`);
        const clauses = stableKeys?.length
            ? ` AND (${stableKeys.map(() => `(t."stableKey" = ? OR t."stableKey" LIKE ?)`).join(" OR ")})`
            : "";
        const params = stableKeys?.flatMap((key) => [key, `${key}:v%`]) ?? [];
        return resultRows(await this.execute(`SELECT a."response", a."submittedAt"
           FROM ${qualifiedTable(this.em, "TaskAttempt")} a
           JOIN ${qualifiedTable(this.em, "LearningTask")} t ON t."id" = a."taskId"
          WHERE a."userId" = ? AND a."unitId" = ? AND a."status" = 'evaluated'
            AND t."origin" = 'material_check' AND t."status" = 'active'${clauses}
          ORDER BY a."submittedAt" ASC, a."id" ASC`, [input.userId, input.unitId, ...params])).map((row) => ({
            response: jsonObject(rowValue(row, "response")),
            submittedAt: nullableReferenceDateValue(rowValue(row, "submittedAt"), "material check submittedAt"),
        }));
    }
    async publishTasksIfMaterialMatches(input: {
        userId: string;
        goalId: string;
        unitId: string;
        expectedMaterial: Readonly<{
            introduction: string;
            sections: string;
            keyTakeaways: string;
        }>;
        tasks: readonly MaterialCheckTaskDefinition[];
    }): Promise<boolean> {
        const row = resultRows(await this.execute(`SELECT "introduction", "sections", "keyTakeaways"
           FROM ${qualifiedTable(this.em, "LearningMaterial")}
          WHERE "unitId" = ? LIMIT 1`, [input.unitId]))[0];
        if (!row ||
            String(rowValue(row, "introduction") ?? "") !== input.expectedMaterial.introduction ||
            String(rowValue(row, "sections") ?? "") !== input.expectedMaterial.sections ||
            String(rowValue(row, "keyTakeaways") ?? "") !== input.expectedMaterial.keyTakeaways)
            return false;
        await this.publishTasks(input);
        return true;
    }
    private async readTask(goalId: string, stableKey: string): Promise<StoredTask | null> {
        const taskRow = resultRows(await this.execute(`SELECT "id", "goalId", "unitId", "stableKey", "taskType", "status", "context", "definitionVersion"
           FROM ${qualifiedTable(this.em, "LearningTask")}
          WHERE "goalId" = ? AND "stableKey" = ?`, [goalId, stableKey]))[0];
        if (!taskRow)
            return null;
        const taskId = String(rowValue(taskRow, "id"));
        const requirements = resultRows(await this.execute(`SELECT "id", "learningTargetId", "cognitiveEntityId", "dimension",
                "required", "weight", "orderIndex", "rubricCriterion"
           FROM ${qualifiedTable(this.em, "TaskRequirement")}
          WHERE "taskId" = ? ORDER BY "orderIndex" ASC, "id" ASC`, [taskId]));
        return {
            id: taskId,
            goalId: String(rowValue(taskRow, "goalId")),
            unitId: rowValue(taskRow, "unitId") == null
                ? null
                : String(rowValue(taskRow, "unitId")),
            stableKey: String(rowValue(taskRow, "stableKey")),
            taskType: String(rowValue(taskRow, "taskType")),
            definitionVersion: numberValue(rowValue(taskRow, "definitionVersion"), 1),
            status: String(rowValue(taskRow, "status")),
            context: jsonObject(rowValue(taskRow, "context")),
            requirements,
        };
    }
    private async assertDeclarationScope(input: MaterialCheckTaskPublicationInput, definition: MaterialCheckTaskDefinition): Promise<void> {
        const goal = resultRows(await this.execute(`SELECT "userId" FROM ${qualifiedTable(this.em, "LearningGoal")} WHERE "id" = ?`, [definition.goalId]))[0];
        if (!goal || rowValue(goal, "userId") !== input.userId) {
            throw new CognitionPersistenceError("ownership_mismatch", "material-check task goal is not owned by the learner");
        }
        if (definition.goalId !== input.goalId ||
            definition.unitId !== input.unitId) {
            throw new CognitionPersistenceError("invalid_declaration", "material-check task scope does not match the completion request");
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
                throw new CognitionPersistenceError("invalid_declaration", `material-check entity ${requirement.cognitiveEntityId} is not active at the declared version`);
            }
            if (!requirement.learningTargetId)
                continue;
            const target = resultRows(await this.execute(`SELECT "goalId", "status"
             FROM ${qualifiedTable(this.em, "LearningTarget")}
            WHERE "id" = ?`, [requirement.learningTargetId]))[0];
            if (!target ||
                rowValue(target, "goalId") !== definition.goalId ||
                rowValue(target, "status") !== "active") {
                throw new CognitionPersistenceError("invalid_declaration", `material-check target ${requirement.learningTargetId} is not active`);
            }
            const targetRequirement = resultRows(await this.execute(`SELECT "id" FROM ${qualifiedTable(this.em, "LearningTargetRequirement")}
            WHERE "learningTargetId" = ? AND "cognitiveEntityId" = ? AND "dimension" = ?`, [
                requirement.learningTargetId,
                requirement.cognitiveEntityId,
                requirement.dimension,
            ]))[0];
            if (!targetRequirement) {
                throw new CognitionPersistenceError("invalid_declaration", `material-check target ${requirement.learningTargetId} does not declare the required entity and dimension`);
            }
        }
    }
    private assertExistingTask(existing: StoredTask, definition: MaterialCheckTaskDefinition): void {
        const requestedPolicy = definition.evidencePolicy;
        const storedPolicy = existing.context.evidencePolicy;
        const requestedRequirements = new Set(definition.requirements.map(declaredRequirementSignature));
        const storedRequirements = new Set(existing.requirements.map(storedRequirementSignature));
        const sameRequirements = requestedRequirements.size === storedRequirements.size &&
            [...requestedRequirements].every((signature) => storedRequirements.has(signature));
        if (existing.unitId !== definition.unitId ||
            existing.taskType !== definition.taskType ||
            existing.definitionVersion !== definition.definitionVersion ||
            !sameRequirements ||
            stableJson(storedPolicy) !== stableJson(requestedPolicy)) {
            throw new CognitionPersistenceError("immutable_declaration", "an existing material-check task evidence declaration cannot be mutated; publish a new version");
        }
    }
    private requirementId(taskId: string, orderIndex: number): string {
        return `material-check-requirement-${createHash("sha256")
            .update(`${taskId}:${orderIndex}`)
            .digest("hex")
            .slice(0, 32)}`;
    }
    private async ensureTask(input: MaterialCheckTaskPublicationInput, definition: MaterialCheckTaskDefinition): Promise<StoredTask> {
        const existing = await this.readTask(definition.goalId, definition.stableKey);
        if (existing) {
            await this.assertDeclarationScope(input, definition);
            this.assertExistingTask(existing, definition);
            if (existing.status !== "active") {
                await this.execute(`UPDATE ${qualifiedTable(this.em, "LearningTask")}
              SET "status" = 'active', "updatedAt" = ? WHERE "id" = ?`, [new Date(), existing.id]);
                return (await this.readTask(definition.goalId, definition.stableKey))!;
            }
            return existing;
        }
        await this.assertDeclarationScope(input, definition);
        const taskId = randomUUID();
        const now = new Date();
        const context = {
            ...definition.context,
            evidencePolicy: definition.evidencePolicy,
            definitionVersion: definition.definitionVersion,
        };
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
            JSON.stringify(context),
            JSON.stringify(definition.rubric),
            definition.difficulty,
            definition.definitionVersion,
            definition.origin,
            now,
            now,
        ]);
        let task = await this.readTask(definition.goalId, definition.stableKey);
        if (!task)
            throw new Error("Material-check task was not published");
        for (const requirement of definition.requirements) {
            const id = this.requirementId(task.id, requirement.orderIndex);
            const rubricCriterion = requirementRubric(requirement);
            await this.execute(`INSERT INTO ${qualifiedTable(this.em, "TaskRequirement")}
          ("id", "taskId", "learningTargetId", "cognitiveEntityId", "dimension",
           "role", "required", "weight", "orderIndex", "rubricCriterion", "createdAt")
         VALUES (?, ?, ?, ?, ?, 'primary', ?, ?, ?, ?${jsonType}, ?)
         ON CONFLICT ("id") DO NOTHING`, [
                id,
                task.id,
                requirement.learningTargetId,
                requirement.cognitiveEntityId,
                requirement.dimension,
                requirement.required,
                requirement.weight,
                requirement.orderIndex,
                JSON.stringify(rubricCriterion),
                now,
            ]);
        }
        task = await this.readTask(definition.goalId, definition.stableKey);
        if (!task)
            throw new Error("Material-check task disappeared after publish");
        this.assertExistingTask(task, definition);
        return task;
    }
    private async deprecateMissing(input: MaterialCheckTaskPublicationInput): Promise<void> {
        const stableKeys = input.tasks.map((task) => task.stableKey);
        const stableKeyPredicate = stableKeys.length
            ? ` AND "stableKey" NOT IN (${stableKeys.map(() => "?").join(", ")})`
            : "";
        await this.execute(`UPDATE ${qualifiedTable(this.em, "LearningTask")}
          SET "status" = 'deprecated', "updatedAt" = ?
        WHERE "goalId" = ? AND "unitId" = ? AND "origin" = 'material_check'
          AND "status" = 'active'${stableKeyPredicate}`, [new Date(), input.goalId, input.unitId, ...stableKeys]);
    }
    /** Publish immutable material-check task definitions in the caller transaction. */
    async publishTasks(input: MaterialCheckTaskPublicationInput): Promise<{
        publishedCheckIds: readonly string[];
        deprecatedCount: number;
    }> {
        const taskByKey = new Map<string, StoredTask>();
        for (const definition of input.tasks) {
            taskByKey.set(definition.stableKey, await this.ensureTask(input, definition));
        }
        const before = Number(rowValue(resultRows(await this.execute(`SELECT COUNT(*) AS "count"
               FROM ${qualifiedTable(this.em, "LearningTask")}
              WHERE "goalId" = ? AND "unitId" = ? AND "origin" = 'material_check'
                AND "status" = 'active'`, [input.goalId, input.unitId]))[0] ?? {}, "count"));
        await this.deprecateMissing(input);
        const after = Number(rowValue(resultRows(await this.execute(`SELECT COUNT(*) AS "count"
               FROM ${qualifiedTable(this.em, "LearningTask")}
              WHERE "goalId" = ? AND "unitId" = ? AND "origin" = 'material_check'
                AND "status" = 'active'`, [input.goalId, input.unitId]))[0] ?? {}, "count"));
        return {
            publishedCheckIds: input.tasks.map((task) => {
                const checkId = rowValue(task.context, "checkId");
                return typeof checkId === "string" ? checkId : task.stableKey;
            }),
            deprecatedCount: Math.max(0, before - after),
        };
    }
    async complete(input: CompleteMaterialCheckBatchInput): Promise<MaterialCheckCompletionResult> {
        if(input.expectedUnitRevision!==undefined||input.expectedSection){
          const unit=resultRows(await this.execute(`SELECT u."contentRevision" FROM ${qualifiedTable(this.em,"LearningUnit")} u JOIN ${qualifiedTable(this.em,"LearningGoal")} g ON g."id"=u."goalId" WHERE u."id"=? AND g."userId"=?`,[input.unitId,input.userId]))[0];
          if(!unit||input.expectedUnitRevision!==undefined&&Number(unit.contentRevision)!==input.expectedUnitRevision)throw new Error("LEARNING_CONTENT_CHANGED: Unit revision changed");
          if(input.expectedSection){const section=resultRows(await this.execute(`SELECT "contentRevision" FROM ${qualifiedTable(this.em,"MainCourseSection")} WHERE "id"=? AND "unitId"=?`,[input.expectedSection.id,input.unitId]))[0];
            if(!section||Number(section.contentRevision)!==input.expectedSection.revision)throw new Error("LEARNING_CONTENT_CHANGED: Section revision changed");}
        }
        if (input.tasks.length === 0 || input.completions.length === 0) {
            throw new CognitionPersistenceError("invalid_candidate", "material-check completion requires tasks and answers");
        }
        const taskByKey = new Map<string, StoredTask>();
        for (const definition of input.tasks) {
            taskByKey.set(definition.stableKey, await this.ensureTask(input, definition));
        }
        await this.deprecateMissing(input);
        const items: Array<MaterialCheckCompletionResult["items"][number]> = [];
        for (const completion of input.completions) {
            const task = taskByKey.get(completion.stableKey);
            if (!task || task.status !== "active") {
                throw new CognitionPersistenceError("not_found", "active material-check task not found");
            }
            const requirement = task.requirements[completion.requirementIndex];
            if (!requirement) {
                throw new CognitionPersistenceError("invalid_candidate", "material-check completion requirement does not exist");
            }
            const now = completion.completedAt;
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
                completedAt: now,
            });
            await this.execute(`UPDATE ${qualifiedTable(this.em, "TaskAttempt")}
            SET "status" = 'evaluated', "completedAt" = ?
          WHERE "id" = ? AND "userId" = ? AND "taskId" = ?`, [now, started.attempt.id, input.userId, task.id]);
            const evidence = await this.evidence.recordVerifiedObservation({
                userId: input.userId,
                attemptId: started.attempt.id,
                candidate: {
                    ...completion.candidate,
                    requirementId: String(rowValue(requirement, "id")),
                },
                evaluator: completion.evaluator,
            });
            items.push({
                attempt: {
                    ...started.attempt,
                    status: "evaluated",
                    completedAt: now,
                },
                evidence,
                replayed: started.replayed || evidence.replayed,
            });
        }
        const domainEvent = await this.domainEvents.append({
            id: randomUUID(),
            type: input.domainEvent.type,
            schemaVersion: input.domainEvent.schemaVersion ?? 1,
            idempotencyKey: input.domainEvent.idempotencyKey,
            userId: input.userId,
            goalId: input.goalId,
            unitId: input.unitId,
            threadId: null,
            payload: JSON.stringify(input.domainEvent.payload),
            occurredAt: input.completions[input.completions.length - 1]!.completedAt,
        });
        return {
            items,
            domainEvent,
            replayed: items.every((item) => item.replayed),
        };
    }
    async completeInteraction(input: {
        userId: string;
        goalId: string;
        unitId: string;
        task: MaterialCheckTaskDefinition;
        idempotencyKey: string;
        response: unknown;
        score: number;
        outcome: "correct" | "incorrect";
        evaluatorRunId: string;
    }) {
        const task = await this.ensureTask({ userId: input.userId, goalId: input.goalId, unitId: input.unitId, tasks: [input.task] }, input.task);
        const now = new Date();
        const started = await this.attempts.start({
            taskId: task.id,
            userId: input.userId,
            unitId: input.unitId,
            idempotencyKey: input.idempotencyKey,
            context: {
                evidenceAssistance: {
                    level: "independent",
                    hintCount: 0,
                    answerRevealed: false,
                },
                positiveEvidenceEligible: true,
            },
            response: { value: input.response },
            artifactRefs: [],
            artifactVersionRefs: [],
            processLog: [],
            assistanceTrace: [],
            assistanceLevel: 0,
            hintCount: 0,
            status: "evaluated",
            submittedAt: now,
            completedAt: now,
        });
        let observationCount = 0;
        let replayed = started.replayed;
        for (const requirement of task.requirements) {
            const evidence = await this.evidence.recordVerifiedObservation({
                userId: input.userId,
                attemptId: started.attempt.id,
                candidate: {
                    requirementId: String(rowValue(requirement, "id")),
                    score: input.score,
                    outcome: input.outcome,
                    evaluatorRunId: input.evaluatorRunId,
                },
                evaluator: {
                    source: input.task.evidencePolicy.source,
                    taskKind: input.task.evidencePolicy.taskKind,
                    contextKey: input.task.evidencePolicy.contextKey,
                    contextDistance: input.task.evidencePolicy.contextDistance,
                    rubricId: input.task.evidencePolicy.rubricId,
                    evaluatorType: "deterministic",
                    evaluatorReliability: 1,
                    groundingReliability: 1,
                    evidenceStrength: "moderate",
                },
            });
            replayed = replayed && evidence.replayed;
            observationCount += evidence.replayed ? 0 : 1;
        }
        return { observationCount, replayed };
    }
}
