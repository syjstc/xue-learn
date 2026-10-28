import { createHash } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { QuizSubmissionItem, QuizSubmissionJsonObject, QuizSubmissionTask, QuizSubmissionTaskRequirement, RecordQuizSubmissionInput, RecordQuizSubmissionResult, QuizSubmissionRepository, } from "@xue-learn/core/domain";
import { CognitionPersistenceError } from "@xue-learn/core/server/cognition/persistence/error";
import { MikroOrmTaskAttemptRepository } from "./task-attempt.repository.ts";
import { MikroOrmVerifiedEvidenceAppendRepository } from "./verified-evidence-append.repository.ts";
type Row = Readonly<Record<string, unknown>>;
type StoredRequirement = Readonly<{
    id: string;
    learningTargetId: string | null;
    cognitiveEntityId: string;
    dimension: string;
    required: boolean;
    weight: number;
    orderIndex: number;
    rubricCriterion: Record<string, unknown>;
}>;
type StoredTask = Readonly<{
    id: string;
    goalId: string;
    unitId: string | null;
    taskType: string;
    title: string;
    instructions: string;
    context: Record<string, unknown>;
    rubric: Record<string, unknown>;
    difficulty: string;
    definitionVersion: number;
    origin: string;
    status: string;
    requirements: readonly StoredRequirement[];
}>;
type LockedSession = Readonly<{
    id: string;
    graphState: Record<string, unknown>;
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
        throw new CognitionPersistenceError("not_found", `quiz submission row is missing ${key}`);
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
function parseJsonObject(value: unknown, label: string): Record<string, unknown> {
    const parsed = parseJson(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new CognitionPersistenceError("invalid_candidate", `${label} must be a JSON object`);
    }
    return parsed as Record<string, unknown>;
}
function parseJsonString(value: string, label: string): unknown {
    try {
        return JSON.parse(value) as unknown;
    }
    catch {
        throw new CognitionPersistenceError("invalid_candidate", `${label} must contain valid JSON`);
    }
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
function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function requirementRubric(requirement: QuizSubmissionTaskRequirement): Record<string, unknown> {
    return {
        ...requirement.rubricCriterion,
        ref: requirement.criterionRef,
        definitionVersion: requirement.definitionVersion,
    };
}
function requirementSignature(requirement: QuizSubmissionTaskRequirement): string {
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
function storedRequirementSignature(requirement: StoredRequirement): string {
    return stableJson({
        learningTargetId: requirement.learningTargetId,
        cognitiveEntityId: requirement.cognitiveEntityId,
        dimension: requirement.dimension,
        required: requirement.required,
        weight: requirement.weight,
        orderIndex: requirement.orderIndex,
        rubricCriterion: requirement.rubricCriterion,
    });
}
function taskContext(task: QuizSubmissionTask): Record<string, unknown> {
    return {
        ...task.context,
        evidencePolicy: task.evidencePolicy,
    };
}
function questionCount(questionsJson: string): number {
    const parsed = JSON.parse(questionsJson) as unknown;
    if (Array.isArray(parsed))
        return parsed.length;
    if (isRecord(parsed)) {
        const questions = Array.isArray(parsed.questions) ? parsed.questions : [];
        const interleaved = Array.isArray(parsed.interleaved)
            ? parsed.interleaved
            : [];
        return questions.length + interleaved.length;
    }
    return 0;
}
function validateJsonObject(value: unknown, label: string): asserts value is QuizSubmissionJsonObject {
    if (!isRecord(value)) {
        throw new CognitionPersistenceError("invalid_candidate", `${label} must be a JSON object`);
    }
}
function validateInput(input: RecordQuizSubmissionInput): void {
    const ids = [
        ["userId", input.userId],
        ["goalId", input.goalId],
        ["unitId", input.unitId],
        ["quizSetId", input.quizSetId],
        ["activityAttemptId", input.activityAttemptId],
        ["nextStep", input.nextStep],
    ] as const;
    if (ids.some(([, value]) => !nonEmpty(value))) {
        throw new CognitionPersistenceError("invalid_candidate", "quiz submission requires learner, goal, unit, quiz set, activity, and next-step identity");
    }
    if (input.purpose !== "learning" && input.purpose !== "review") {
        throw new CognitionPersistenceError("invalid_candidate", "quiz submission purpose is invalid");
    }
    if (!Number.isFinite(input.score) || input.score < 0 || input.score > 1) {
        throw new CognitionPersistenceError("invalid_candidate", "quiz submission score must be between zero and one");
    }
    for (const [label, value] of [
        ["questionsJson", input.questionsJson],
        ["answersJson", input.answersJson],
        ["resultsJson", input.resultsJson],
        ["weakTagsJson", input.weakTagsJson],
        ["perLearningTargetResultsJson", input.perLearningTargetResultsJson],
        ["nextGraphStateJson", input.nextGraphStateJson],
    ] as const) {
        parseJsonString(value, label);
    }
    parseJsonObject(input.nextGraphStateJson, "nextGraphStateJson");
    const indexes = new Set<number>();
    const idempotencyKeys = new Set<string>();
    for (const item of input.items) {
        if (!Number.isInteger(item.index) ||
            item.index < 0 ||
            indexes.has(item.index) ||
            !nonEmpty(item.idempotencyKey) ||
            idempotencyKeys.has(item.idempotencyKey) ||
            !nonEmpty(item.evaluatorRunId) ||
            !Number.isFinite(item.score) ||
            item.score < 0 ||
            item.score > 1 ||
            !nonEmpty(item.outcome)) {
            throw new CognitionPersistenceError("invalid_candidate", "quiz submission items require unique indexes, idempotency keys, evaluator runs, outcomes, and scores");
        }
        indexes.add(item.index);
        idempotencyKeys.add(item.idempotencyKey);
        validateJsonObject(item.response, "quiz response");
        validateJsonObject(item.rawResult, "quiz raw result");
        validateTask(item.task, input.purpose);
    }
}
function validateTask(task: QuizSubmissionTask, purpose: "learning" | "review"): void {
    if (!nonEmpty(task.stableKey) ||
        !nonEmpty(task.title) ||
        !nonEmpty(task.instructions) ||
        !nonEmpty(task.difficulty) ||
        !Number.isInteger(task.definitionVersion) ||
        task.definitionVersion < 1 ||
        task.origin !== "generated_quiz" ||
        task.taskType !== (purpose === "review" ? "review" : "quiz") ||
        task.evidencePolicy.source !==
            (purpose === "review" ? "review_quiz" : "quiz") ||
        !nonEmpty(task.evidencePolicy.contextKey) ||
        !nonEmpty(task.evidencePolicy.rubricId) ||
        (task.evidencePolicy.taskKind !== "recall" &&
            task.evidencePolicy.taskKind !== "explanation") ||
        (task.evidencePolicy.contextDistance !== "same" &&
            task.evidencePolicy.contextDistance !== "near" &&
            task.evidencePolicy.contextDistance !== "far") ||
        !["mcq", "mcq_multi", "true_false"].includes(task.evidencePolicy.assessmentFormat)) {
        throw new CognitionPersistenceError("invalid_declaration", "quiz task declaration has an invalid immutable identity or evidence policy");
    }
    validateJsonObject(task.context, "quiz task context");
    validateJsonObject(task.rubric, "quiz task rubric");
    if (task.requirements.length === 0) {
        throw new CognitionPersistenceError("invalid_declaration", "quiz task declaration requires at least one evidence requirement");
    }
    const signatures = new Set<string>();
    for (const requirement of task.requirements) {
        if (!nonEmpty(requirement.learningTargetId) ||
            !nonEmpty(requirement.cognitiveEntityId) ||
            (requirement.dimension !== "memory" &&
                requirement.dimension !== "understanding") ||
            !nonEmpty(requirement.criterionRef) ||
            !Number.isInteger(requirement.definitionVersion) ||
            requirement.definitionVersion < 1 ||
            typeof requirement.required !== "boolean" ||
            !Number.isFinite(requirement.weight) ||
            requirement.weight <= 0 ||
            !Number.isInteger(requirement.orderIndex) ||
            requirement.orderIndex < 0) {
            throw new CognitionPersistenceError("invalid_declaration", "quiz task requirements need active target/entity declarations, versions, and positive weights");
        }
        validateJsonObject(requirement.rubricCriterion, "quiz rubric criterion");
        const signature = requirementSignature(requirement);
        if (signatures.has(signature)) {
            throw new CognitionPersistenceError("invalid_declaration", "quiz task requirements cannot contain duplicate declarations");
        }
        signatures.add(signature);
    }
}
function quizAttemptId(input: RecordQuizSubmissionInput): string {
    return `quiz_attempt_${stableHash([
        input.userId,
        input.unitId,
        input.quizSetId,
        input.activityAttemptId,
    ])}`;
}
function sameJson(left: unknown, right: string): boolean {
    return stableJson(parseJson(left)) === stableJson(JSON.parse(right));
}
/** Transaction-neutral raw adapter; the runtime owns the transaction. */
export class MikroOrmQuizSubmissionRepository implements QuizSubmissionRepository {
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
    private async assertUnitScope(input: RecordQuizSubmissionInput): Promise<void> {
        const row = resultRows(await this.execute(`SELECT u."id", u."goalId", g."userId"
           FROM ${qualifiedTable(this.em, "LearningUnit")} u
           JOIN ${qualifiedTable(this.em, "LearningGoal")} g
             ON g."id" = u."goalId"
          WHERE u."id" = ? AND u."goalId" = ?`, [input.unitId, input.goalId]))[0];
        if (!row || rowValue(row, "userId") !== input.userId) {
            throw new CognitionPersistenceError("ownership_mismatch", "quiz submission unit is not owned by the learner and goal");
        }
    }
    private async assertQuizSetScope(input: RecordQuizSubmissionInput): Promise<void> {
        const row = resultRows(await this.execute(`SELECT "id", "unitId"
           FROM ${qualifiedTable(this.em, "QuizSet")}
          WHERE "id" = ? AND "unitId" = ?`, [input.quizSetId, input.unitId]))[0];
        if (!row) {
            throw new CognitionPersistenceError("ownership_mismatch", "quiz set is not scoped to the submitted unit");
        }
    }
    private async lockSession(input: RecordQuizSubmissionInput): Promise<LockedSession> {
        const lock = "";
        const row = resultRows(await this.execute(`SELECT "id", "graphState"
           FROM ${qualifiedTable(this.em, "UnitSessionState")}
          WHERE "unitId" = ?${lock}`, [input.unitId]))[0];
        if (!row) {
            throw new CognitionPersistenceError("not_found", "unit session state was not found");
        }
        return {
            id: requiredString(row, "id"),
            graphState: parseJsonObject(rowValue(row, "graphState"), "graphState"),
        };
    }
    private async readQuizAttempt(id: string): Promise<Row | null> {
        return (resultRows(await this.execute(`SELECT "id", "unitId", "quizSetId", "questions", "answers",
                  "results", "weakTags", "perLearningTargetResults",
                  "purpose", "passed", "score"
             FROM ${qualifiedTable(this.em, "QuizAttempt")}
            WHERE "id" = ?`, [id]))[0] ?? null);
    }
    private assertQuizAttemptMatches(row: Row, input: RecordQuizSubmissionInput): void {
        const passed = input.passed ?? null;
        if (rowValue(row, "unitId") !== input.unitId ||
            rowValue(row, "quizSetId") !== input.quizSetId ||
            rowValue(row, "purpose") !== input.purpose ||
            numberValue(rowValue(row, "score")) !== input.score ||
            (rowValue(row, "passed") == null
                ? null
                : booleanValue(rowValue(row, "passed"))) !== passed ||
            !sameJson(rowValue(row, "questions"), input.questionsJson) ||
            !sameJson(rowValue(row, "answers"), input.answersJson) ||
            !sameJson(rowValue(row, "results"), input.resultsJson) ||
            !sameJson(rowValue(row, "weakTags"), input.weakTagsJson) ||
            !sameJson(rowValue(row, "perLearningTargetResults"), input.perLearningTargetResultsJson)) {
            throw new CognitionPersistenceError("idempotency_conflict", "quiz activity idempotency key was reused with different submission data");
        }
    }
    private async ensureQuizAttempt(input: RecordQuizSubmissionInput, id: string): Promise<void> {
        const json = jsonSuffix(this.em);
        await this.execute(`INSERT INTO ${qualifiedTable(this.em, "QuizAttempt")}
        ("id", "unitId", "quizSetId", "questions", "answers", "results",
         "explanations", "score", "weakTags", "perLearningTargetResults",
         "purpose", "passed", "createdAt")
       VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?, ?)
       ON CONFLICT ("id") DO NOTHING`, [
            id,
            input.unitId,
            input.quizSetId,
            input.questionsJson,
            input.answersJson,
            input.resultsJson,
            input.score,
            input.weakTagsJson,
            input.perLearningTargetResultsJson,
            input.purpose,
            input.passed ?? null,
            new Date(),
        ]);
        void json;
        const row = await this.readQuizAttempt(id);
        if (!row)
            throw new Error("Quiz attempt was not persisted");
        this.assertQuizAttemptMatches(row, input);
    }
    private async readTask(goalId: string, stableKey: string): Promise<StoredTask | null> {
        const row = resultRows(await this.execute(`SELECT "id", "goalId", "unitId", "taskType", "title",
                "instructions", "context", "rubric", "difficulty",
                "definitionVersion", "origin", "status"
           FROM ${qualifiedTable(this.em, "LearningTask")}
          WHERE "goalId" = ? AND "stableKey" = ?`, [goalId, stableKey]))[0];
        if (!row)
            return null;
        const id = requiredString(row, "id");
        const requirements = resultRows(await this.execute(`SELECT "id", "learningTargetId", "cognitiveEntityId", "dimension",
                "required", "weight", "orderIndex", "rubricCriterion"
           FROM ${qualifiedTable(this.em, "TaskRequirement")}
          WHERE "taskId" = ? ORDER BY "orderIndex" ASC, "id" ASC`, [id])).map((requirement) => ({
            id: requiredString(requirement, "id"),
            learningTargetId: rowValue(requirement, "learningTargetId") == null
                ? null
                : String(rowValue(requirement, "learningTargetId")),
            cognitiveEntityId: requiredString(requirement, "cognitiveEntityId"),
            dimension: requiredString(requirement, "dimension"),
            required: booleanValue(rowValue(requirement, "required")),
            weight: numberValue(rowValue(requirement, "weight"), 1),
            orderIndex: numberValue(rowValue(requirement, "orderIndex")),
            rubricCriterion: parseJsonObject(rowValue(requirement, "rubricCriterion"), "rubricCriterion"),
        }));
        return {
            id,
            goalId: requiredString(row, "goalId"),
            unitId: rowValue(row, "unitId") == null
                ? null
                : String(rowValue(row, "unitId")),
            taskType: requiredString(row, "taskType"),
            title: requiredString(row, "title"),
            instructions: String(rowValue(row, "instructions") ?? ""),
            context: parseJsonObject(rowValue(row, "context"), "task context"),
            rubric: parseJsonObject(rowValue(row, "rubric"), "task rubric"),
            difficulty: String(rowValue(row, "difficulty") ?? "medium"),
            definitionVersion: numberValue(rowValue(row, "definitionVersion"), 1),
            origin: requiredString(row, "origin"),
            status: requiredString(row, "status"),
            requirements,
        };
    }
    private async validateTaskScope(input: RecordQuizSubmissionInput, task: QuizSubmissionTask): Promise<void> {
        for (const requirement of task.requirements) {
            const entity = resultRows(await this.execute(`SELECT "goalId", "status", "definitionVersion"
             FROM ${qualifiedTable(this.em, "CognitiveEntity")}
            WHERE "id" = ?`, [requirement.cognitiveEntityId]))[0];
            if (!entity ||
                rowValue(entity, "goalId") !== input.goalId ||
                rowValue(entity, "status") !== "active" ||
                numberValue(rowValue(entity, "definitionVersion")) !==
                    requirement.definitionVersion) {
                throw new CognitionPersistenceError("invalid_declaration", `quiz entity ${requirement.cognitiveEntityId} is not active at the declared version`);
            }
            const target = resultRows(await this.execute(`SELECT "id", "goalId", "status"
             FROM ${qualifiedTable(this.em, "LearningTarget")}
            WHERE "id" = ?`, [requirement.learningTargetId]))[0];
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
            if (!target ||
                rowValue(target, "goalId") !== input.goalId ||
                rowValue(target, "status") !== "active" ||
                !binding) {
                throw new CognitionPersistenceError("invalid_declaration", `quiz target ${requirement.learningTargetId} does not declare its entity and dimension`);
            }
        }
    }
    private assertExistingTask(existing: StoredTask, input: RecordQuizSubmissionInput, task: QuizSubmissionTask): void {
        const requested = new Set(task.requirements.map(requirementSignature));
        const stored = new Set(existing.requirements.map(storedRequirementSignature));
        if (existing.goalId !== input.goalId ||
            existing.unitId !== input.unitId ||
            existing.taskType !== task.taskType ||
            existing.title !== task.title ||
            existing.instructions !== task.instructions ||
            stableJson(existing.context) !== stableJson(taskContext(task)) ||
            stableJson(existing.rubric) !== stableJson(task.rubric) ||
            existing.difficulty !== task.difficulty ||
            existing.definitionVersion !== task.definitionVersion ||
            existing.origin !== task.origin ||
            existing.status !== "active" ||
            requested.size !== stored.size ||
            [...requested].some((signature) => !stored.has(signature))) {
            throw new CognitionPersistenceError("immutable_declaration", "an existing quiz task evidence declaration cannot be mutated");
        }
    }
    private requirementId(taskId: string, requirement: QuizSubmissionTaskRequirement): string {
        return `quiz_requirement_${stableHash([
            taskId,
            requirement.orderIndex,
            requirement.cognitiveEntityId,
            requirement.learningTargetId,
        ])}`;
    }
    private async ensureTask(input: RecordQuizSubmissionInput, task: QuizSubmissionTask): Promise<StoredTask> {
        await this.validateTaskScope(input, task);
        const existing = await this.readTask(input.goalId, task.stableKey);
        if (existing) {
            this.assertExistingTask(existing, input, task);
            return existing;
        }
        const now = new Date();
        const json = jsonSuffix(this.em);
        const taskId = `quiz_task_${stableHash([input.goalId, task.stableKey])}`;
        await this.execute(`INSERT INTO ${qualifiedTable(this.em, "LearningTask")}
        ("id", "goalId", "moduleId", "unitId", "stableKey", "taskType",
         "title", "instructions", "context", "rubric", "difficulty",
         "definitionVersion", "origin", "status", "createdAt", "updatedAt")
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?${json}, ?${json}, ?, ?, ?, 'active', ?, ?)
       ON CONFLICT ("goalId", "stableKey") DO NOTHING`, [
            taskId,
            input.goalId,
            input.unitId,
            task.stableKey,
            task.taskType,
            task.title,
            task.instructions,
            JSON.stringify(taskContext(task)),
            JSON.stringify(task.rubric),
            task.difficulty,
            task.definitionVersion,
            task.origin,
            now,
            now,
        ]);
        let persisted = await this.readTask(input.goalId, task.stableKey);
        if (!persisted)
            throw new Error("Quiz task was not persisted");
        for (const requirement of task.requirements) {
            await this.execute(`INSERT INTO ${qualifiedTable(this.em, "TaskRequirement")}
          ("id", "taskId", "learningTargetId", "cognitiveEntityId", "dimension",
           "role", "required", "weight", "orderIndex", "rubricCriterion", "createdAt")
         VALUES (?, ?, ?, ?, ?, 'primary', ?, ?, ?, ?${json}, ?)
         ON CONFLICT ("id") DO NOTHING`, [
                this.requirementId(persisted.id, requirement),
                persisted.id,
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
        persisted = await this.readTask(input.goalId, task.stableKey);
        if (!persisted)
            throw new Error("Quiz task disappeared after publication");
        this.assertExistingTask(persisted, input, task);
        return persisted;
    }
    private async startAttempt(input: RecordQuizSubmissionInput, item: QuizSubmissionItem, taskId: string, submittedAt: Date) {
        const result = await this.attempts.start({
            taskId,
            userId: input.userId,
            unitId: input.unitId,
            idempotencyKey: item.idempotencyKey,
            context: {
                evidenceAssistance: {
                    level: "independent",
                    hintCount: 0,
                    answerRevealed: false,
                },
                positiveEvidenceEligible: true,
            },
            response: item.response,
            artifactRefs: [],
            artifactVersionRefs: [],
            processLog: [],
            assistanceTrace: [],
            assistanceLevel: 0,
            hintCount: 0,
            status: "evaluated",
            submittedAt,
            completedAt: submittedAt,
        });
        return result.attempt;
    }
    private async replayResult(input: RecordQuizSubmissionInput, attemptId: string): Promise<RecordQuizSubmissionResult> {
        const row = await this.readQuizAttempt(attemptId);
        if (!row) {
            throw new CognitionPersistenceError("idempotency_conflict", "quiz session points to a missing submission snapshot");
        }
        this.assertQuizAttemptMatches(row, input);
        return {
            quizAttemptId: attemptId,
            observationCount: input.items.reduce((count, item) => count + item.task.requirements.length, 0),
            skippedQuestionCount: Math.max(0, questionCount(input.questionsJson) - input.items.length),
        };
    }
    async record(input: RecordQuizSubmissionInput): Promise<RecordQuizSubmissionResult> {
        validateInput(input);
        await this.assertUnitScope(input);
        await this.assertQuizSetScope(input);
        const session = await this.lockSession(input);
        const attemptId = quizAttemptId(input);
        const currentAttemptId = session.graphState.quizAttemptId;
        if (currentAttemptId != null) {
            if (currentAttemptId !== attemptId) {
                throw new CognitionPersistenceError("invalid_candidate", "quiz has already been submitted for this unit session");
            }
            return this.replayResult(input, attemptId);
        }
        const currentQuizSetId = session.graphState.quizSetId;
        if (currentQuizSetId != null && currentQuizSetId !== input.quizSetId) {
            throw new CognitionPersistenceError("invalid_candidate", "quiz set changed while the active quiz was open");
        }
        const nextGraphState = parseJsonObject(input.nextGraphStateJson, "nextGraphStateJson");
        if (nextGraphState.quizSetId != null &&
            nextGraphState.quizSetId !== input.quizSetId) {
            throw new CognitionPersistenceError("invalid_candidate", "next quiz graph state refers to a different quiz set");
        }
        if (nextGraphState.quizAttemptId != null &&
            nextGraphState.quizAttemptId !== attemptId) {
            throw new CognitionPersistenceError("idempotency_conflict", "next quiz graph state refers to a different quiz attempt");
        }
        const taskByStableKey = new Map<string, StoredTask>();
        for (const item of input.items) {
            const existing = taskByStableKey.get(item.task.stableKey);
            if (existing) {
                this.assertExistingTask(existing, input, item.task);
            }
            else {
                taskByStableKey.set(item.task.stableKey, await this.ensureTask(input, item.task));
            }
        }
        await this.ensureQuizAttempt(input, attemptId);
        const submittedAt = new Date();
        let observationCount = 0;
        for (const item of input.items) {
            const task = taskByStableKey.get(item.task.stableKey);
            if (!task)
                throw new Error("Quiz task lookup failed");
            const attempt = await this.startAttempt(input, item, task.id, submittedAt);
            for (const requirement of task.requirements) {
                await this.evidence.recordVerifiedObservation({
                    userId: input.userId,
                    attemptId: attempt.id,
                    candidate: {
                        requirementId: requirement.id,
                        score: item.score,
                        outcome: item.outcome,
                        evaluatorRunId: item.evaluatorRunId,
                        rawResult: item.rawResult,
                        assertedCognitiveEntityId: requirement.cognitiveEntityId,
                        assertedLearningTargetId: requirement.learningTargetId ?? undefined,
                        assertedDimension: requirement.dimension as "memory" | "understanding",
                        assertedCriterionRef: typeof requirement.rubricCriterion.ref === "string"
                            ? requirement.rubricCriterion.ref
                            : undefined,
                        assertedDefinitionVersion: numberValue(requirement.rubricCriterion.definitionVersion),
                    },
                    evaluator: {
                        source: item.task.evidencePolicy.source,
                        taskKind: item.task.evidencePolicy.taskKind,
                        contextKey: item.task.evidencePolicy.contextKey,
                        contextDistance: item.task.evidencePolicy.contextDistance,
                        rubricId: item.task.evidencePolicy.rubricId,
                        evaluatorType: "deterministic",
                        evaluatorReliability: 1,
                        groundingReliability: 1,
                        evidenceStrength: item.evidenceStrength,
                    },
                });
                observationCount += 1;
            }
        }
        await this.execute(`UPDATE ${qualifiedTable(this.em, "UnitSessionState")}
          SET "graphState" = ?, "currentStep" = ?, "socraticTurn" = ?, "updatedAt" = ?
        WHERE "unitId" = ?`, [
            JSON.stringify({
                ...nextGraphState,
                quizSetId: input.quizSetId,
                quizAttemptId: attemptId,
            }),
            input.nextStep,
            0,
            new Date(),
            input.unitId,
        ]);
        return {
            quizAttemptId: attemptId,
            observationCount,
            skippedQuestionCount: Math.max(0, questionCount(input.questionsJson) - input.items.length),
        };
    }
}
