import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { AdaptiveAssessmentTaskDeclaration, AdaptiveAssessmentTaskRecord, AdaptiveAssessmentTaskRepository, } from "@xue-learn/core/source/libs/domain/src/index.ts";
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
function stringValue(value: unknown): string {
    return String(value ?? "");
}
function numberValue(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
function booleanValue(value: unknown): boolean {
    return value === true || value === 1 || value === "1" || value === "true";
}
function decodeJson(value: unknown): unknown {
    if (typeof value !== "string")
        return value;
    try {
        return JSON.parse(value);
    }
    catch {
        return value;
    }
}
function stableJson(value: unknown): string {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value))
        return `[${value.map(stableJson).join(",")}]`;
    return `{${Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
        .join(",")}}`;
}
function qualifiedTable(em: EntityManager, table: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${table.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
function json(value: unknown): string {
    return JSON.stringify(value);
}
function requirementSignature(requirement: {
    learningTargetId: string | null;
    cognitiveEntityId: string;
    dimension: string;
    role: string;
    required: boolean;
    weight: number;
    orderIndex: number;
    rubricCriterion: unknown;
}): string {
    return stableJson({
        learningTargetId: requirement.learningTargetId,
        cognitiveEntityId: requirement.cognitiveEntityId,
        dimension: requirement.dimension,
        role: requirement.role,
        required: requirement.required,
        weight: requirement.weight,
        orderIndex: requirement.orderIndex,
        rubricCriterion: decodeJson(requirement.rubricCriterion),
    });
}
function expectedRequirementSignature(requirement: AdaptiveAssessmentTaskDeclaration["requirements"][number]): string {
    return requirementSignature({
        learningTargetId: requirement.learningTargetId,
        cognitiveEntityId: requirement.cognitiveEntityId,
        dimension: requirement.dimension,
        role: requirement.role ?? "primary",
        required: requirement.required,
        weight: requirement.weight,
        orderIndex: requirement.orderIndex,
        rubricCriterion: {
            ...requirement.rubricCriterion,
            ref: requirement.criterionRef,
            definitionVersion: requirement.definitionVersion,
        },
    });
}
function taskRecord(slotId: string, row: Row): AdaptiveAssessmentTaskRecord {
    return { slotId, taskId: stringValue(rowValue(row, "id")) };
}
/** Raw SQL adapter for the all-or-nothing adaptive task materialization batch. */
export class MikroOrmAdaptiveAssessmentTaskRepository implements AdaptiveAssessmentTaskRepository {
    constructor(private readonly em: EntityManager) { }
    private execute(sql: string, params: unknown[] = []) {
        return this.em
            .getConnection()
            .execute(sql, params, undefined, this.em.getTransactionContext());
    }
    private jsonType(): string {
        return "";
    }
    private async lockGoal(goalId: string): Promise<void> {
        return;
    }
    private async assertScope(input: {
        userId: string;
        goalId: string;
        moduleId?: string;
        unitId?: string;
    }): Promise<void> {
        const goal = resultRows(await this.execute(`SELECT "userId" FROM ${qualifiedTable(this.em, "LearningGoal")} WHERE "id" = ?`, [input.goalId]))[0];
        if (!goal || stringValue(rowValue(goal, "userId")) !== input.userId) {
            throw new Error("Adaptive assessment scope is not learner-owned");
        }
        if (input.moduleId) {
            const module = resultRows(await this.execute(`SELECT "id" FROM ${qualifiedTable(this.em, "LearningModule")}
            WHERE "id" = ? AND "goalId" = ?`, [input.moduleId, input.goalId]))[0];
            if (!module)
                throw new Error("Adaptive assessment module is not in scope");
        }
        if (input.unitId) {
            const unit = resultRows(await this.execute(`SELECT "id" FROM ${qualifiedTable(this.em, "LearningUnit")}
            WHERE "id" = ? AND "goalId" = ?`, [input.unitId, input.goalId]))[0];
            if (!unit)
                throw new Error("Adaptive assessment unit is not in scope");
        }
    }
    private async findTask(goalId: string, stableKey: string): Promise<Row | null> {
        const lock = "";
        return (resultRows(await this.execute(`SELECT "id", "goalId", "moduleId", "unitId", "stableKey", "taskType",
                  "title", "instructions", "context", "rubric", "difficulty",
                  "definitionVersion", "origin", "status"
             FROM ${qualifiedTable(this.em, "LearningTask")}
            WHERE "goalId" = ? AND "stableKey" = ?${lock}`, [goalId, stableKey]))[0] ?? null);
    }
    private async findRequirements(taskId: string): Promise<readonly Row[]> {
        return resultRows(await this.execute(`SELECT "learningTargetId", "cognitiveEntityId", "dimension", "role",
                "required", "weight", "orderIndex", "rubricCriterion"
           FROM ${qualifiedTable(this.em, "TaskRequirement")}
          WHERE "taskId" = ? ORDER BY "orderIndex" ASC, "id" ASC`, [taskId]));
    }
    private async assertEntitiesAndTargets(goalId: string, requirements: AdaptiveAssessmentTaskDeclaration["requirements"]): Promise<void> {
        const entityIds = [
            ...new Set(requirements.map((item) => item.cognitiveEntityId)),
        ];
        const entities = resultRows(await this.execute(`SELECT "id", "goalId", "definitionVersion", "status"
           FROM ${qualifiedTable(this.em, "CognitiveEntity")}
          WHERE "id" IN (${entityIds.map(() => "?").join(", ")})`, entityIds));
        const entityById = new Map(entities.map((row) => [stringValue(rowValue(row, "id")), row]));
        for (const requirement of requirements) {
            const entity = entityById.get(requirement.cognitiveEntityId);
            if (!entity ||
                stringValue(rowValue(entity, "goalId")) !== goalId ||
                stringValue(rowValue(entity, "status")) !== "active" ||
                numberValue(rowValue(entity, "definitionVersion")) !==
                    requirement.definitionVersion) {
                throw new Error(`Adaptive assessment entity ${requirement.cognitiveEntityId} is not active at the declared version`);
            }
        }
        const targetIds = [
            ...new Set(requirements.map((item) => item.learningTargetId)),
        ];
        const targets = resultRows(await this.execute(`SELECT "id", "goalId", "status"
           FROM ${qualifiedTable(this.em, "LearningTarget")}
          WHERE "id" IN (${targetIds.map(() => "?").join(", ")})`, targetIds));
        const targetById = new Map(targets.map((row) => [stringValue(rowValue(row, "id")), row]));
        const declared = resultRows(await this.execute(`SELECT "learningTargetId", "cognitiveEntityId", "dimension"
           FROM ${qualifiedTable(this.em, "LearningTargetRequirement")}
          WHERE "learningTargetId" IN (${targetIds.map(() => "?").join(", ")})`, targetIds));
        const declaredPairs = new Set(declared.map((row) => `${rowValue(row, "learningTargetId")}\u001f${rowValue(row, "cognitiveEntityId")}\u001f${rowValue(row, "dimension")}`));
        for (const requirement of requirements) {
            const target = targetById.get(requirement.learningTargetId);
            if (!target ||
                stringValue(rowValue(target, "goalId")) !== goalId ||
                stringValue(rowValue(target, "status")) !== "active" ||
                !declaredPairs.has(`${requirement.learningTargetId}\u001f${requirement.cognitiveEntityId}\u001f${requirement.dimension}`)) {
                throw new Error(`Adaptive assessment target ${requirement.learningTargetId} does not declare the requested entity and dimension`);
            }
        }
    }
    private async ensureTask(declaration: AdaptiveAssessmentTaskDeclaration): Promise<AdaptiveAssessmentTaskRecord> {
        const existing = await this.findTask(declaration.goalId, declaration.stableKey);
        if (existing) {
            const stored = await this.findRequirements(stringValue(rowValue(existing, "id")));
            const expected = declaration.requirements.map(expectedRequirementSignature);
            const actual = stored.map((row) => requirementSignature({
                learningTargetId: rowValue(row, "learningTargetId") == null
                    ? null
                    : stringValue(rowValue(row, "learningTargetId")),
                cognitiveEntityId: stringValue(rowValue(row, "cognitiveEntityId")),
                dimension: stringValue(rowValue(row, "dimension")),
                role: stringValue(rowValue(row, "role")),
                required: booleanValue(rowValue(row, "required")),
                weight: numberValue(rowValue(row, "weight")),
                orderIndex: numberValue(rowValue(row, "orderIndex")),
                rubricCriterion: rowValue(row, "rubricCriterion"),
            }));
            const storedContext = decodeJson(rowValue(existing, "context"));
            const expectedContext = {
                ...declaration.context,
                evidencePolicy: declaration.evidencePolicy,
            };
            if (stringValue(rowValue(existing, "goalId")) !== declaration.goalId ||
                stringValue(rowValue(existing, "moduleId")) !==
                    (declaration.moduleId ?? "") ||
                stringValue(rowValue(existing, "unitId")) !==
                    (declaration.unitId ?? "") ||
                stringValue(rowValue(existing, "stableKey")) !==
                    declaration.stableKey ||
                stringValue(rowValue(existing, "taskType")) !== declaration.taskType ||
                numberValue(rowValue(existing, "definitionVersion")) !==
                    declaration.definitionVersion ||
                stringValue(rowValue(existing, "title")) !== declaration.title ||
                stringValue(rowValue(existing, "instructions")) !==
                    declaration.instructions ||
                stableJson(storedContext) !== stableJson(expectedContext) ||
                stableJson(decodeJson(rowValue(existing, "rubric"))) !==
                    stableJson(declaration.rubric) ||
                stringValue(rowValue(existing, "difficulty")) !==
                    declaration.difficulty ||
                stringValue(rowValue(existing, "origin")) !== declaration.origin ||
                stringValue(rowValue(existing, "status")) !== "active" ||
                stableJson([...actual].sort()) !== stableJson([...expected].sort())) {
                throw new Error(`Adaptive assessment task ${declaration.stableKey} has an immutable mismatch`);
            }
            return taskRecord(declaration.slotId, existing);
        }
        await this.assertEntitiesAndTargets(declaration.goalId, declaration.requirements);
        const taskId = randomUUID();
        const jsonType = this.jsonType();
        await this.execute(`INSERT INTO ${qualifiedTable(this.em, "LearningTask")}
        ("id", "goalId", "moduleId", "unitId", "stableKey", "taskType",
         "title", "instructions", "context", "rubric", "difficulty",
         "definitionVersion", "origin", "status")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?${jsonType}, ?${jsonType}, ?, ?, ?, 'active')`, [
            taskId,
            declaration.goalId,
            declaration.moduleId ?? null,
            declaration.unitId ?? null,
            declaration.stableKey,
            declaration.taskType,
            declaration.title,
            declaration.instructions,
            json({
                ...declaration.context,
                evidencePolicy: declaration.evidencePolicy,
            }),
            json(declaration.rubric),
            declaration.difficulty,
            declaration.definitionVersion,
            declaration.origin,
        ]);
        for (const requirement of declaration.requirements) {
            await this.execute(`INSERT INTO ${qualifiedTable(this.em, "TaskRequirement")}
          ("id", "taskId", "learningTargetId", "cognitiveEntityId", "dimension",
           "role", "required", "weight", "orderIndex", "rubricCriterion")
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?${jsonType})`, [
                randomUUID(),
                taskId,
                requirement.learningTargetId,
                requirement.cognitiveEntityId,
                requirement.dimension,
                requirement.role ?? "primary",
                requirement.required,
                requirement.weight,
                requirement.orderIndex,
                json({
                    ...requirement.rubricCriterion,
                    ref: requirement.criterionRef,
                    definitionVersion: requirement.definitionVersion,
                }),
            ]);
        }
        return { slotId: declaration.slotId, taskId };
    }
    async publishTasks(input: {
        userId: string;
        goalId: string;
        moduleId?: string;
        unitId?: string;
        purpose: "mastery" | "readiness";
        tasks: readonly AdaptiveAssessmentTaskDeclaration[];
    }): Promise<readonly AdaptiveAssessmentTaskRecord[]> {
        await this.lockGoal(input.goalId);
        await this.assertScope(input);
        for (const declaration of input.tasks) {
            if (declaration.goalId !== input.goalId ||
                declaration.moduleId !== input.moduleId ||
                declaration.unitId !== input.unitId) {
                throw new Error("Adaptive assessment task scope does not match the batch");
            }
        }
        const records: AdaptiveAssessmentTaskRecord[] = [];
        for (const declaration of input.tasks) {
            records.push(await this.ensureTask(declaration));
        }
        return records;
    }
}
