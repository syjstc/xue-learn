import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { ProjectBlueprintRepository, ProjectBlueprintRequirementInput, ProjectBlueprintStageInput, ProjectBlueprintTaskRecord, PublishProjectBlueprintInput, PublishProjectBlueprintResult, } from "@xue-learn/core/source/libs/domain/src/index.ts";
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
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(stableJson).join(",")}]`;
    return `{${Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
        .join(",")}}`;
}
function json(value: unknown): string {
    return JSON.stringify(value);
}
function booleanValue(value: unknown): boolean {
    return value === true || value === 1 || value === "1" || value === "true";
}
function numberValue(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
function stringValue(value: unknown): string {
    return String(value ?? "");
}
function record(value: Row): ProjectBlueprintTaskRecord {
    return {
        id: stringValue(rowValue(value, "id")),
        stableKey: stringValue(rowValue(value, "stableKey")),
        title: stringValue(rowValue(value, "title")),
        projectRole: stringValue(rowValue(value, "projectRole")) as "root" | "milestone",
        parentTaskId: rowValue(value, "parentTaskId") == null
            ? null
            : stringValue(rowValue(value, "parentTaskId")),
        milestoneOrder: rowValue(value, "milestoneOrder") == null
            ? null
            : numberValue(rowValue(value, "milestoneOrder")),
        projectBlueprintHash: stringValue(rowValue(value, "projectBlueprintHash")),
    };
}
function requirementSignature(requirement: {
    learningTargetId: string | null;
    cognitiveEntityId: string;
    entityDefinitionVersion: number;
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
        entityDefinitionVersion: requirement.entityDefinitionVersion,
        dimension: requirement.dimension,
        role: requirement.role,
        required: requirement.required,
        weight: requirement.weight,
        orderIndex: requirement.orderIndex,
        rubricCriterion: decodeJson(requirement.rubricCriterion),
    });
}
function expectedRequirementSignature(requirement: ProjectBlueprintRequirementInput): string {
    return requirementSignature({
        learningTargetId: requirement.learningTargetId ?? null,
        cognitiveEntityId: requirement.cognitiveEntityId,
        entityDefinitionVersion: requirement.entityDefinitionVersion,
        dimension: requirement.dimension,
        role: requirement.role,
        required: requirement.required,
        weight: requirement.weight,
        orderIndex: requirement.orderIndex,
        rubricCriterion: requirement.rubricCriterion,
    });
}
/** Raw SQL adapter for immutable project blueprint publication. */
export class MikroOrmProjectBlueprintRepository implements ProjectBlueprintRepository {
    constructor(private readonly em: EntityManager) { }
    private execute(sql: string, params: unknown[] = []) {
        return this.em
            .getConnection()
            .execute(sql, params, undefined, this.em.getTransactionContext());
    }
    private jsonType(): string {
        return "";
    }
    async findCurrentPublication(goalId: string) {
        const goal = resultRows(await this.execute(`SELECT "cognitiveModelStatus", "cognitiveModelVersion",
                "cognitiveModelInputHash", "cognitiveModelPublishedHash"
           FROM ${qualifiedTable(this.em, "LearningGoal")}
          WHERE "id" = ? LIMIT 1`, [goalId]))[0];
        if (!goal)
            return null;
        const version = numberValue(rowValue(goal, "cognitiveModelVersion"));
        const revision = resultRows(await this.execute(`SELECT "version", "inputHash", "snapshotJson", "publishedAt"
           FROM ${qualifiedTable(this.em, "CognitiveModelRevision")}
          WHERE "goalId" = ? AND "version" = ? AND "status" = 'published'
            AND "scope" = 'full' AND "isFullSnapshot" = ${"1"}
          ORDER BY "version" DESC LIMIT 1`, [goalId, version]))[0];
        return {
            goalStatus: stringValue(rowValue(goal, "cognitiveModelStatus")),
            goalVersion: version,
            inputHash: stringValue(rowValue(goal, "cognitiveModelInputHash")),
            publishedHash: stringValue(rowValue(goal, "cognitiveModelPublishedHash")),
            revision: revision
                ? {
                    version: numberValue(rowValue(revision, "version")),
                    inputHash: stringValue(rowValue(revision, "inputHash")),
                    snapshotJson: decodeJson(rowValue(revision, "snapshotJson")),
                    publishedAt: nullableReferenceDateValue(rowValue(revision, "publishedAt"), "project blueprint publishedAt"),
                }
                : null,
        };
    }
    private lockGoal(goalId: string): Promise<unknown> {
        return Promise.resolve();
    }
    private async findTask(goalId: string, stableKey: string): Promise<Row | null> {
        const taskTable = qualifiedTable(this.em, "LearningTask");
        const lock = "";
        return (resultRows(await this.execute(`SELECT "id", "goalId", "unitId", "stableKey", "taskType",
                  "projectRole", "parentTaskId", "milestoneOrder",
                  "projectBlueprintHash", "constraintDefinitions",
                  "deliverableDefinitions", "title", "instructions",
                  "context", "rubric", "difficulty", "definitionVersion",
                  "origin", "status"
             FROM ${taskTable}
            WHERE "goalId" = ? AND "stableKey" = ?${lock}`, [goalId, stableKey]))[0] ?? null);
    }
    private async findRequirements(taskId: string): Promise<readonly Row[]> {
        const table = qualifiedTable(this.em, "TaskRequirement");
        return resultRows(await this.execute(`SELECT "learningTargetId", "cognitiveEntityId", "dimension", "role",
                "required", "weight", "orderIndex", "rubricCriterion"
           FROM ${table}
          WHERE "taskId" = ?
          ORDER BY "orderIndex" ASC, "id" ASC`, [taskId]));
    }
    private async assertEntitiesAndTargets(goalId: string, requirements: readonly ProjectBlueprintRequirementInput[]): Promise<void> {
        const entityIds = [
            ...new Set(requirements.map((item) => item.cognitiveEntityId)),
        ];
        const entityTable = qualifiedTable(this.em, "CognitiveEntity");
        if (entityIds.length > 0) {
            const entities = resultRows(await this.execute(`SELECT "id", "goalId", "definitionVersion", "status"
             FROM ${entityTable}
            WHERE "id" IN (${entityIds.map(() => "?").join(", ")})`, entityIds));
            const byId = new Map(entities.map((row) => [stringValue(rowValue(row, "id")), row]));
            for (const requirement of requirements) {
                const entity = byId.get(requirement.cognitiveEntityId);
                if (!entity ||
                    stringValue(rowValue(entity, "goalId")) !== goalId ||
                    stringValue(rowValue(entity, "status")) !== "active" ||
                    numberValue(rowValue(entity, "definitionVersion")) !==
                        requirement.entityDefinitionVersion) {
                    throw new Error(`project blueprint entity ${requirement.cognitiveEntityId} is not active or version-matched`);
                }
            }
        }
        const targetIds = [
            ...new Set(requirements.flatMap((item) => item.learningTargetId ? [item.learningTargetId] : [])),
        ];
        if (targetIds.length === 0)
            return;
        const targetTable = qualifiedTable(this.em, "LearningTarget");
        const targetRequirementTable = qualifiedTable(this.em, "LearningTargetRequirement");
        const targets = resultRows(await this.execute(`SELECT "id", "goalId", "status"
           FROM ${targetTable}
          WHERE "id" IN (${targetIds.map(() => "?").join(", ")})`, targetIds));
        const targetById = new Map(targets.map((row) => [stringValue(rowValue(row, "id")), row]));
        const declared = resultRows(await this.execute(`SELECT "learningTargetId", "cognitiveEntityId", "dimension"
           FROM ${targetRequirementTable}
          WHERE "learningTargetId" IN (${targetIds.map(() => "?").join(", ")})`, targetIds));
        const declaredPairs = new Set(declared.map((row) => `${stringValue(rowValue(row, "learningTargetId"))}\u001f${stringValue(rowValue(row, "cognitiveEntityId"))}\u001f${stringValue(rowValue(row, "dimension"))}`));
        for (const requirement of requirements) {
            if (!requirement.learningTargetId)
                continue;
            const target = targetById.get(requirement.learningTargetId);
            if (!target ||
                stringValue(rowValue(target, "goalId")) !== goalId ||
                stringValue(rowValue(target, "status")) !== "active" ||
                !declaredPairs.has(`${requirement.learningTargetId}\u001f${requirement.cognitiveEntityId}\u001f${requirement.dimension}`)) {
                throw new Error(`project blueprint target ${requirement.learningTargetId} does not declare the requested entity and dimension`);
            }
        }
    }
    private async assertImmutableTask(existing: Row, stage: ProjectBlueprintStageInput, parentTaskId: string | null): Promise<ProjectBlueprintTaskRecord> {
        const scalarMismatch = stringValue(rowValue(existing, "taskType")) !== "project" ||
            stringValue(rowValue(existing, "projectRole")) !== stage.projectRole ||
            (rowValue(existing, "parentTaskId") == null
                ? null
                : stringValue(rowValue(existing, "parentTaskId"))) !== parentTaskId ||
            (rowValue(existing, "milestoneOrder") == null
                ? null
                : numberValue(rowValue(existing, "milestoneOrder"))) !==
                stage.milestoneOrder ||
            stringValue(rowValue(existing, "projectBlueprintHash")) !==
                stage.projectBlueprintHash ||
            stringValue(rowValue(existing, "title")) !== stage.title ||
            stringValue(rowValue(existing, "instructions")) !== stage.instructions ||
            stringValue(rowValue(existing, "difficulty")) !== stage.difficulty ||
            numberValue(rowValue(existing, "definitionVersion")) !==
                stage.definitionVersion ||
            stringValue(rowValue(existing, "origin")) !== stage.origin ||
            stableJson(decodeJson(rowValue(existing, "constraintDefinitions"))) !==
                stableJson(stage.constraintDefinitions) ||
            stableJson(decodeJson(rowValue(existing, "deliverableDefinitions"))) !==
                stableJson(stage.deliverableDefinitions) ||
            stableJson(decodeJson(rowValue(existing, "rubric"))) !==
                stableJson(stage.rubric);
        const storedContext = decodeJson(rowValue(existing, "context"));
        const storedPolicy = storedContext && typeof storedContext === "object"
            ? (storedContext as Record<string, unknown>).evidencePolicy
            : undefined;
        if (scalarMismatch ||
            stableJson(storedPolicy) !== stableJson(stage.evidencePolicy)) {
            throw new Error(`project task ${stage.stableKey} conflicts with its immutable blueprint`);
        }
        const requirements = await this.findRequirements(stringValue(rowValue(existing, "id")));
        const stored = requirements.map((requirement) => requirementSignature({
            learningTargetId: rowValue(requirement, "learningTargetId") == null
                ? null
                : stringValue(rowValue(requirement, "learningTargetId")),
            cognitiveEntityId: stringValue(rowValue(requirement, "cognitiveEntityId")),
            entityDefinitionVersion: numberValue((() => {
                const criterion = decodeJson(rowValue(requirement, "rubricCriterion"));
                return criterion && typeof criterion === "object"
                    ? (criterion as Record<string, unknown>).definitionVersion
                    : undefined;
            })()),
            dimension: stringValue(rowValue(requirement, "dimension")),
            role: stringValue(rowValue(requirement, "role")),
            required: booleanValue(rowValue(requirement, "required")),
            weight: numberValue(rowValue(requirement, "weight")),
            orderIndex: numberValue(rowValue(requirement, "orderIndex")),
            rubricCriterion: rowValue(requirement, "rubricCriterion"),
        }));
        const expected = stage.requirements.map(expectedRequirementSignature);
        if (stableJson([...stored].sort()) !== stableJson([...expected].sort())) {
            throw new Error(`project task ${stage.stableKey} has a changed evidence declaration`);
        }
        return record(existing);
    }
    private async ensureStage(stage: ProjectBlueprintStageInput, parentTaskId: string | null): Promise<ProjectBlueprintTaskRecord> {
        const existing = await this.findTask(stage.goalId, stage.stableKey);
        if (existing)
            return this.assertImmutableTask(existing, stage, parentTaskId);
        await this.assertEntitiesAndTargets(stage.goalId, stage.requirements);
        const taskTable = qualifiedTable(this.em, "LearningTask");
        const taskId = randomUUID();
        const jsonType = this.jsonType();
        await this.execute(`INSERT INTO ${taskTable}
        ("id", "goalId", "moduleId", "unitId", "stableKey", "taskType",
         "projectRole", "parentTaskId", "milestoneOrder", "projectBlueprintHash",
         "constraintDefinitions", "deliverableDefinitions", "title", "instructions",
         "context", "rubric", "difficulty", "definitionVersion", "origin", "status")
       VALUES (?, ?, NULL, ?, ?, 'project', ?, ?, ?, ?, ?${jsonType}, ?${jsonType},
               ?, ?, ?${jsonType}, ?${jsonType}, ?, ?, ?, 'active')`, [
            taskId,
            stage.goalId,
            stage.unitId ?? null,
            stage.stableKey,
            stage.projectRole,
            parentTaskId,
            stage.milestoneOrder,
            stage.projectBlueprintHash,
            json(stage.constraintDefinitions),
            json(stage.deliverableDefinitions),
            stage.title,
            stage.instructions,
            json(stage.context),
            json(stage.rubric),
            stage.difficulty,
            stage.definitionVersion,
            stage.origin,
        ]);
        const requirementTable = qualifiedTable(this.em, "TaskRequirement");
        for (const requirement of stage.requirements) {
            const criterion = decodeJson(requirement.rubricCriterion);
            await this.execute(`INSERT INTO ${requirementTable}
          ("id", "taskId", "learningTargetId", "cognitiveEntityId", "dimension",
           "role", "required", "weight", "orderIndex", "rubricCriterion")
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?${jsonType})`, [
                randomUUID(),
                taskId,
                requirement.learningTargetId ?? null,
                requirement.cognitiveEntityId,
                requirement.dimension,
                requirement.role,
                requirement.required,
                requirement.weight,
                requirement.orderIndex,
                json(criterion),
            ]);
        }
        return {
            id: taskId,
            stableKey: stage.stableKey,
            title: stage.title,
            projectRole: stage.projectRole,
            parentTaskId,
            milestoneOrder: stage.milestoneOrder,
            projectBlueprintHash: stage.projectBlueprintHash,
        };
    }
    async deprecateStale(input: {
        goalId: string;
        blueprintHash?: string;
    }): Promise<number> {
        await this.lockGoal(input.goalId);
        const taskTable = qualifiedTable(this.em, "LearningTask");
        const params: unknown[] = [input.goalId];
        const hashClause = input.blueprintHash
            ? ` AND "projectBlueprintHash" <> ?`
            : "";
        if (input.blueprintHash)
            params.push(input.blueprintHash);
        const staleRows = resultRows(await this.execute(`SELECT "id"
           FROM ${taskTable}
          WHERE "goalId" = ? AND "taskType" = 'project'
            AND "origin" = 'generated:goal-capstone'
            AND "status" = 'active'${hashClause}`, params));
        if (staleRows.length === 0)
            return 0;
        await this.execute(`UPDATE ${taskTable}
          SET "status" = 'deprecated', "updatedAt" = CURRENT_TIMESTAMP
        WHERE "goalId" = ? AND "taskType" = 'project'
          AND "origin" = 'generated:goal-capstone'
          AND "status" = 'active'${hashClause}`, params);
        return staleRows.length;
    }
    async publish(input: PublishProjectBlueprintInput): Promise<PublishProjectBlueprintResult> {
        await this.lockGoal(input.goalId);
        const rootStage = input.stages[0];
        if (!rootStage ||
            rootStage.projectRole !== "root" ||
            input.stages.length < 2 ||
            input.stages.filter((stage) => stage.projectRole === "root").length !== 1) {
            throw new Error("project blueprint must start with one root stage");
        }
        const byStableKey = new Map<string, ProjectBlueprintTaskRecord>();
        const stableKeys = new Set<string>();
        const records: ProjectBlueprintTaskRecord[] = [];
        for (const [stageIndex, stage] of input.stages.entries()) {
            if (stage.goalId !== input.goalId) {
                throw new Error("project blueprint stages must belong to one goal");
            }
            if (stage.projectBlueprintHash !== input.blueprintHash) {
                throw new Error("project blueprint stage hashes must match the publication hash");
            }
            if (stableKeys.has(stage.stableKey)) {
                throw new Error(`project blueprint stable key ${stage.stableKey} is duplicated`);
            }
            stableKeys.add(stage.stableKey);
            if (stageIndex === 0 &&
                (stage.parentStableKey !== null || stage.milestoneOrder !== null)) {
                throw new Error("project blueprint root cannot have a parent or milestone order");
            }
            if (stageIndex > 0 &&
                (stage.projectRole !== "milestone" ||
                    stage.parentStableKey !== rootStage.stableKey ||
                    stage.milestoneOrder !== stageIndex - 1)) {
                throw new Error("project blueprint milestone order must be contiguous under the root");
            }
            const parentTaskId = stage.parentStableKey
                ? (byStableKey.get(stage.parentStableKey)?.id ?? null)
                : null;
            if (stage.projectRole === "milestone" && !parentTaskId) {
                throw new Error(`project milestone ${stage.stableKey} has no root parent`);
            }
            const task = await this.ensureStage(stage, parentTaskId);
            byStableKey.set(task.stableKey, task);
            records.push(task);
        }
        const milestoneTable = qualifiedTable(this.em, "LearningTask");
        const storedMilestones = resultRows(await this.execute(`SELECT "stableKey", "milestoneOrder"
           FROM ${milestoneTable}
          WHERE "parentTaskId" = ? AND "projectRole" = 'milestone'
          ORDER BY "milestoneOrder" ASC, "id" ASC`, [records[0]!.id])).map((row) => ({
            stableKey: stringValue(rowValue(row, "stableKey")),
            milestoneOrder: numberValue(rowValue(row, "milestoneOrder")),
        }));
        const expectedMilestones = records.slice(1).map((stage) => ({
            stableKey: stage.stableKey,
            milestoneOrder: stage.milestoneOrder,
        }));
        if (stableJson(storedMilestones) !== stableJson(expectedMilestones)) {
            throw new Error("project blueprint milestones are not an exact ordered set");
        }
        const deprecatedTaskCount = await this.deprecateStale({
            goalId: input.goalId,
            blueprintHash: input.blueprintHash,
        });
        return {
            blueprintHash: input.blueprintHash,
            root: records[0]!,
            milestones: records.slice(1),
            deprecatedTaskCount,
        };
    }
}
