import { createHash, randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { AppendVerifiedEvidenceInput, VerifiedEvidenceAppendRepository, VerifiedEvidenceAppendResult, VerifiedEvidenceClaimRecord, VerifiedEvidenceJsonObject, VerifiedEvidenceLearnerDimensionStateRecord, VerifiedEvidenceLearnerStateRecord, VerifiedEvidenceLearnerStateRevisionRecord, VerifiedObservationRecord, } from "@xue-learn/core/source/libs/domain/src/index.ts";
import type { AttemptDeclarationRecord, RequirementRecord, } from "@xue-learn/core/source/libs/server/src/cognition/persistence/types.ts";
import { validateObservationAgainstDeclaration } from "@xue-learn/core/source/libs/server/src/cognition/persistence/observations.ts";
import { claimToDomain, type ClaimForInference, } from "@xue-learn/core/source/libs/server/src/cognition/persistence/state.ts";
import { buildLearnerEntityProjection } from "@xue-learn/core/source/libs/server/src/cognition/persistence/projection.ts";
import { evidenceClaimIsActive } from "@xue-learn/core/source/libs/server/src/cognition/persistence/lifecycle.ts";
import { taskPolicyFromContext, transferDistanceValue, } from "@xue-learn/core/source/libs/server/src/cognition/persistence/shared.ts";
import { deriveDeterministicMisconceptionPattern } from "@xue-learn/core/source/libs/server/src/cognition/misconceptions.ts";
import { type CognitiveDimension, type CognitiveEntityKind, type EvidenceStrength, } from "@xue-learn/core/source/libs/server/src/cognition/types.ts";
import { CognitionPersistenceError, COGNITION_INFERENCE_VERSION, } from "@xue-learn/core/source/libs/server/src/cognition/persistence/error.ts";
import { nullableReferenceDateValue, referenceDateValue } from "./date-value.ts";
type Row = Readonly<Record<string, unknown>>;
type ClaimWithObservation = Readonly<{
    claim: Row;
    observation: Row;
    lifecycleEvents: readonly Row[];
}>;
type StateProjection = Readonly<{
    state: VerifiedEvidenceLearnerStateRecord;
    revision: VerifiedEvidenceLearnerStateRevisionRecord;
}>;
const STRENGTH_VALUE: Readonly<Record<EvidenceStrength, number>> = {
    weak: 0.5,
    moderate: 1,
    strong: 1.5,
    decisive: 2,
};
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
        throw new CognitionPersistenceError("not_found", `verified evidence row is missing ${key}`);
    }
    return value;
}
function numberValue(value: unknown): number {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}
function dateValue(value: unknown): Date {
    return referenceDateValue(value);
}
function nullableDateValue(value: unknown): Date | null {
    return nullableReferenceDateValue(value);
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
function jsonObject(value: unknown): VerifiedEvidenceJsonObject {
    const parsed = parseJson(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as VerifiedEvidenceJsonObject)
        : {};
}
function jsonArray(value: unknown): readonly unknown[] {
    const parsed = parseJson(value);
    return Array.isArray(parsed) ? parsed : [];
}
function qualifiedTable(em: EntityManager, table: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${table.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
function jsonSuffix(em: EntityManager): string {
    return "";
}
function stableJsonStringify(value: unknown): string {
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
function evidenceKey(input: AppendVerifiedEvidenceInput): string {
    const digest = createHash("sha256")
        .update([
        input.attemptId,
        input.candidate.requirementId,
        input.candidate.evaluatorRunId,
    ].join("\u001f"))
        .digest("hex");
    return `evidence:${digest}`;
}
function idempotentId(prefix: string, key: string): string {
    return `${prefix}_${createHash("sha256").update(key).digest("hex")}`;
}
function recordDate(value: unknown): Date {
    return dateValue(value);
}
function recordObservation(row: Row): VerifiedObservationRecord {
    return {
        id: requiredString(row, "id"),
        attemptId: requiredString(row, "attemptId"),
        requirementId: requiredString(row, "requirementId"),
        learningTargetId: rowValue(row, "learningTargetId") == null
            ? null
            : String(rowValue(row, "learningTargetId")),
        cognitiveEntityId: requiredString(row, "cognitiveEntityId"),
        dimension: rowValue(row, "dimension") as CognitiveDimension,
        outcome: requiredString(row, "outcome"),
        score: numberValue(rowValue(row, "score")),
        evaluatorReliability: numberValue(rowValue(row, "evaluatorReliability")),
        groundingReliability: numberValue(rowValue(row, "groundingReliability")),
        independence: numberValue(rowValue(row, "independence")),
        transferDistance: numberValue(rowValue(row, "transferDistance")),
        subjectDefinitionVersion: numberValue(rowValue(row, "subjectDefinitionVersion")),
        evaluatorType: rowValue(row, "evaluatorType") as VerifiedObservationRecord["evaluatorType"],
        evaluatorRef: rowValue(row, "evaluatorRef") == null
            ? null
            : String(rowValue(row, "evaluatorRef")),
        rawResult: jsonObject(rowValue(row, "rawResult")),
        metadata: jsonObject(rowValue(row, "metadata")),
        observedAt: recordDate(rowValue(row, "observedAt")),
    };
}
function recordClaim(row: Row): VerifiedEvidenceClaimRecord {
    return {
        id: requiredString(row, "id"),
        userId: requiredString(row, "userId"),
        observationId: requiredString(row, "observationId"),
        cognitiveEntityId: requiredString(row, "cognitiveEntityId"),
        learningTargetId: rowValue(row, "learningTargetId") == null
            ? null
            : String(rowValue(row, "learningTargetId")),
        misconceptionPatternId: rowValue(row, "misconceptionPatternId") == null
            ? null
            : String(rowValue(row, "misconceptionPatternId")),
        dimension: rowValue(row, "dimension") as CognitiveDimension,
        criterionRef: requiredString(row, "criterionRef"),
        polarity: rowValue(row, "polarity") as "supports" | "refutes",
        score: numberValue(rowValue(row, "score")),
        strength: numberValue(rowValue(row, "strength")),
        evaluatorReliability: numberValue(rowValue(row, "evaluatorReliability")),
        groundingReliability: numberValue(rowValue(row, "groundingReliability")),
        definitionVersion: numberValue(rowValue(row, "definitionVersion")),
        contextKey: requiredString(row, "contextKey"),
        status: "active",
        idempotencyKey: requiredString(row, "idempotencyKey"),
        validFrom: recordDate(rowValue(row, "validFrom")),
        validUntil: null,
        createdAt: recordDate(rowValue(row, "createdAt")),
    };
}
function recordLifecycle(row: Row) {
    return {
        id: requiredString(row, "id"),
        evidenceClaimId: requiredString(row, "evidenceClaimId"),
        eventType: "created" as const,
        reason: String(rowValue(row, "reason") ?? ""),
        actorUserId: rowValue(row, "actorUserId") == null
            ? null
            : String(rowValue(row, "actorUserId")),
        replacementClaimId: null,
        payload: jsonObject(rowValue(row, "payload")),
        createdAt: recordDate(rowValue(row, "createdAt")),
    };
}
function inferenceClaim(claimRow: Row, observationRow: Row, lifecycleRows: readonly Row[]): ClaimForInference {
    const taskContext = jsonObject(rowValue(observationRow, "taskContext"));
    return {
        ...claimRow,
        cognitiveEntity: {
            id: requiredString(claimRow, "cognitiveEntityId"),
            kind: rowValue(claimRow, "entityKind"),
        },
        observation: {
            ...observationRow,
            metadata: parseJson(rowValue(observationRow, "metadata")),
            evaluatorType: rowValue(observationRow, "evaluatorType"),
            observedAt: recordDate(rowValue(observationRow, "observedAt")),
            attempt: {
                ...observationRow,
                artifactRefs: parseJson(rowValue(observationRow, "artifactRefs")),
                assistanceLevel: numberValue(rowValue(observationRow, "assistanceLevel")),
                hintCount: numberValue(rowValue(observationRow, "hintCount")),
                durationMs: rowValue(observationRow, "durationMs") == null
                    ? null
                    : numberValue(rowValue(observationRow, "durationMs")),
                taskId: requiredString(observationRow, "taskId"),
                task: {
                    id: requiredString(observationRow, "taskId"),
                    taskType: rowValue(observationRow, "taskType"),
                    context: taskContext,
                },
            },
        },
        lifecycleEvents: lifecycleRows.map((row) => ({
            id: requiredString(row, "id"),
            eventType: String(rowValue(row, "eventType")),
            createdAt: recordDate(rowValue(row, "createdAt")),
            reason: String(rowValue(row, "reason") ?? ""),
            replacementClaimId: rowValue(row, "replacementClaimId") as string | null,
        })),
    } as unknown as ClaimForInference;
}
/** Raw adapter for the complete verified-evidence transaction. */
export class MikroOrmVerifiedEvidenceAppendRepository implements VerifiedEvidenceAppendRepository {
    constructor(private readonly em: EntityManager) { }
    private execute(sql: string, params: unknown[] = []) {
        return this.em
            .getConnection()
            .execute(sql, params, undefined, this.em.getTransactionContext());
    }
    private async lockEntity(userId: string, entityId: string): Promise<void> {
        return;
    }
    private async readClaimByKey(claimTable: string, observationTable: string, lifecycleTable: string, key: string): Promise<ClaimWithObservation | null> {
        const row = resultRows(await this.execute(`SELECT ec.*, o."attemptId" AS "observationAttemptId",
                o."requirementId" AS "observationRequirementId",
                o."learningTargetId" AS "observationLearningTargetId",
                o."cognitiveEntityId" AS "observationEntityId",
                o."dimension" AS "observationDimension",
                o."outcome" AS "observationOutcome",
                o."score" AS "observationScore",
                o."evaluatorReliability" AS "observationEvaluatorReliability",
                o."groundingReliability" AS "observationGroundingReliability",
                o."independence" AS "observationIndependence",
                o."transferDistance" AS "observationTransferDistance",
                o."subjectDefinitionVersion" AS "observationDefinitionVersion",
                o."evaluatorType" AS "observationEvaluatorType",
                o."evaluatorRef" AS "observationEvaluatorRef",
                o."rawResult" AS "observationRawResult",
                o."metadata" AS "observationMetadata",
                o."observedAt" AS "observationObservedAt"
           FROM ${claimTable} ec
           JOIN ${observationTable} o ON o."id" = ec."observationId"
          WHERE ec."idempotencyKey" = ?`, [key]))[0];
        if (!row)
            return null;
        const observation = {
            id: rowValue(row, "observationId"),
            attemptId: rowValue(row, "observationAttemptId"),
            requirementId: rowValue(row, "observationRequirementId"),
            learningTargetId: rowValue(row, "observationLearningTargetId"),
            cognitiveEntityId: rowValue(row, "observationEntityId"),
            dimension: rowValue(row, "observationDimension"),
            outcome: rowValue(row, "observationOutcome"),
            score: rowValue(row, "observationScore"),
            evaluatorReliability: rowValue(row, "observationEvaluatorReliability"),
            groundingReliability: rowValue(row, "observationGroundingReliability"),
            independence: rowValue(row, "observationIndependence"),
            transferDistance: rowValue(row, "observationTransferDistance"),
            subjectDefinitionVersion: rowValue(row, "observationDefinitionVersion"),
            evaluatorType: rowValue(row, "observationEvaluatorType"),
            evaluatorRef: rowValue(row, "observationEvaluatorRef"),
            rawResult: rowValue(row, "observationRawResult"),
            metadata: rowValue(row, "observationMetadata"),
            observedAt: rowValue(row, "observationObservedAt"),
        };
        const lifecycleRows = resultRows(await this.execute(`SELECT * FROM ${lifecycleTable}
          WHERE "evidenceClaimId" = ?
          ORDER BY "createdAt" ASC, "id" ASC`, [requiredString(row, "id")]));
        return { claim: row, observation, lifecycleEvents: lifecycleRows };
    }
    private async loadDeclaration(attemptTable: string, taskTable: string, goalTable: string, requirementTable: string, entityTable: string, targetTable: string, input: AppendVerifiedEvidenceInput): Promise<{
        attempt: AttemptDeclarationRecord;
        requirement: RequirementRecord;
        taskPolicy: ReturnType<typeof taskPolicyFromContext>;
    }> {
        const row = resultRows(await this.execute(`SELECT a.*, t."id" AS "taskId", t."goalId" AS "taskGoalId",
                t."taskType", t."status" AS "taskStatus",
                t."context" AS "taskContext", t."rubric" AS "taskRubric",
                t."definitionVersion" AS "taskDefinitionVersion",
                g."userId" AS "goalUserId",
                r."id" AS "requirementId", r."taskId" AS "requirementTaskId",
                r."learningTargetId" AS "requirementTargetId",
                r."cognitiveEntityId" AS "requirementEntityId",
                r."dimension" AS "requirementDimension",
                r."rubricCriterion" AS "requirementRubricCriterion",
                ce."id" AS "entityId", ce."goalId" AS "entityGoalId",
                ce."kind" AS "entityKind", ce."title" AS "entityTitle",
                ce."definitionVersion" AS "entityDefinitionVersion",
                ce."status" AS "entityStatus",
                lt."id" AS "targetId", lt."goalId" AS "targetGoalId",
                lt."definitionVersion" AS "targetDefinitionVersion",
                lt."status" AS "targetStatus"
           FROM ${attemptTable} a
           JOIN ${taskTable} t ON t."id" = a."taskId"
           JOIN ${goalTable} g ON g."id" = t."goalId"
           JOIN ${requirementTable} r ON r."id" = ?
           JOIN ${entityTable} ce ON ce."id" = r."cognitiveEntityId"
      LEFT JOIN ${targetTable} lt ON lt."id" = r."learningTargetId"
          WHERE a."id" = ?`, [input.candidate.requirementId, input.attemptId]))[0];
        if (!row) {
            throw new CognitionPersistenceError("not_found", "task attempt or declared evidence requirement not found");
        }
        const taskContext = parseJson(rowValue(row, "taskContext"));
        const taskPolicy = taskPolicyFromContext(taskContext);
        const attempt: AttemptDeclarationRecord = {
            id: requiredString(row, "id"),
            taskId: requiredString(row, "taskId"),
            userId: requiredString(row, "userId"),
            status: requiredString(row, "status"),
            context: taskContext,
            artifactRefs: parseJson(rowValue(row, "artifactRefs")),
            assistanceLevel: numberValue(rowValue(row, "assistanceLevel")),
            hintCount: numberValue(rowValue(row, "hintCount")),
            durationMs: rowValue(row, "durationMs") == null
                ? null
                : numberValue(rowValue(row, "durationMs")),
            startedAt: dateValue(rowValue(row, "startedAt")),
            submittedAt: nullableDateValue(rowValue(row, "submittedAt")),
            task: {
                id: requiredString(row, "taskId"),
                goalId: requiredString(row, "taskGoalId"),
                taskType: requiredString(row, "taskType"),
                status: requiredString(row, "taskStatus"),
                context: taskContext,
                rubric: parseJson(rowValue(row, "taskRubric")),
                definitionVersion: numberValue(rowValue(row, "taskDefinitionVersion")),
                goal: { userId: String(rowValue(row, "goalUserId")) },
            },
        };
        const requirement: RequirementRecord = {
            id: requiredString(row, "requirementId"),
            taskId: requiredString(row, "requirementTaskId"),
            learningTargetId: rowValue(row, "requirementTargetId") == null
                ? null
                : String(rowValue(row, "requirementTargetId")),
            cognitiveEntityId: requiredString(row, "requirementEntityId"),
            dimension: requiredString(row, "requirementDimension"),
            rubricCriterion: parseJson(rowValue(row, "requirementRubricCriterion")),
            cognitiveEntity: {
                id: requiredString(row, "entityId"),
                goalId: rowValue(row, "entityGoalId") == null
                    ? null
                    : String(rowValue(row, "entityGoalId")),
                kind: requiredString(row, "entityKind"),
                title: requiredString(row, "entityTitle"),
                definitionVersion: numberValue(rowValue(row, "entityDefinitionVersion")),
                status: requiredString(row, "entityStatus"),
            },
            learningTarget: rowValue(row, "targetId") == null
                ? null
                : {
                    id: requiredString(row, "targetId"),
                    goalId: requiredString(row, "targetGoalId"),
                    definitionVersion: numberValue(rowValue(row, "targetDefinitionVersion")),
                    status: requiredString(row, "targetStatus"),
                },
        };
        if (attempt.userId !== input.userId) {
            throw new CognitionPersistenceError("ownership_mismatch", "task attempt belongs to a different learner");
        }
        return { attempt, requirement, taskPolicy };
    }
    private async readInferenceClaims(claimTable: string, observationTable: string, attemptTable: string, taskTable: string, entityTable: string, lifecycleTable: string, userId: string, entityId: string, definitionVersion: number, asOf: Date): Promise<{
        rows: readonly ClaimWithObservation[];
        entityKind: CognitiveEntityKind;
    }> {
        const rows = resultRows(await this.execute(`SELECT ec.*, ce."kind" AS "entityKind",
                o."attemptId" AS "observationAttemptId",
                o."requirementId" AS "observationRequirementId",
                o."learningTargetId" AS "observationLearningTargetId",
                o."cognitiveEntityId" AS "observationEntityId",
                o."dimension" AS "observationDimension",
                o."outcome" AS "observationOutcome",
                o."score" AS "observationScore",
                o."evaluatorReliability" AS "observationEvaluatorReliability",
                o."groundingReliability" AS "observationGroundingReliability",
                o."independence" AS "observationIndependence",
                o."transferDistance" AS "observationTransferDistance",
                o."subjectDefinitionVersion" AS "observationDefinitionVersion",
                o."evaluatorType" AS "observationEvaluatorType",
                o."evaluatorRef" AS "observationEvaluatorRef",
                o."rawResult" AS "observationRawResult",
                o."metadata" AS "observationMetadata",
                o."observedAt" AS "observationObservedAt",
                a."taskId", a."artifactRefs", a."assistanceLevel",
                a."hintCount", a."durationMs",
                t."taskType", t."context" AS "taskContext"
           FROM ${claimTable} ec
           JOIN ${observationTable} o ON o."id" = ec."observationId"
           JOIN ${attemptTable} a ON a."id" = o."attemptId"
           JOIN ${taskTable} t ON t."id" = a."taskId"
           JOIN ${entityTable} ce ON ce."id" = ec."cognitiveEntityId"
          WHERE ec."userId" = ?
            AND ec."cognitiveEntityId" = ?
            AND ec."definitionVersion" = ?
            AND ec."validFrom" <= ?
          ORDER BY ec."createdAt" ASC, ec."id" ASC`, [userId, entityId, definitionVersion, asOf]));
        const grouped: ClaimWithObservation[] = [];
        for (const row of rows) {
            const claimId = requiredString(row, "id");
            const lifecycleRows = resultRows(await this.execute(`SELECT * FROM ${lifecycleTable}
            WHERE "evidenceClaimId" = ?
            ORDER BY "createdAt" ASC, "id" ASC`, [claimId]));
            grouped.push({
                claim: row,
                observation: {
                    ...row,
                    id: rowValue(row, "observationId"),
                    attemptId: rowValue(row, "observationAttemptId"),
                    requirementId: rowValue(row, "observationRequirementId"),
                    learningTargetId: rowValue(row, "observationLearningTargetId"),
                    cognitiveEntityId: rowValue(row, "observationEntityId"),
                    dimension: rowValue(row, "observationDimension"),
                    outcome: rowValue(row, "observationOutcome"),
                    score: rowValue(row, "observationScore"),
                    evaluatorReliability: rowValue(row, "observationEvaluatorReliability"),
                    groundingReliability: rowValue(row, "observationGroundingReliability"),
                    independence: rowValue(row, "observationIndependence"),
                    transferDistance: rowValue(row, "observationTransferDistance"),
                    subjectDefinitionVersion: rowValue(row, "observationDefinitionVersion"),
                    evaluatorType: rowValue(row, "observationEvaluatorType"),
                    evaluatorRef: rowValue(row, "observationEvaluatorRef"),
                    rawResult: rowValue(row, "observationRawResult"),
                    metadata: rowValue(row, "observationMetadata"),
                    observedAt: rowValue(row, "observationObservedAt"),
                },
                lifecycleEvents: lifecycleRows,
            });
        }
        const entityKind = rows[0]?.entityKind;
        if (!entityKind || typeof entityKind !== "string") {
            throw new CognitionPersistenceError("not_found", "active cognitive entity not found");
        }
        return { rows: grouped, entityKind: entityKind as CognitiveEntityKind };
    }
    private async refreshState(tables: Readonly<Record<string, string>>, userId: string, entityId: string, definitionVersion: number, asOf = new Date()): Promise<StateProjection> {
        const { rows, entityKind } = await this.readInferenceClaims(tables.claim, tables.observation, tables.attempt, tables.task, tables.entity, tables.lifecycle, userId, entityId, definitionVersion, asOf);
        const active = rows.filter((row) => evidenceClaimIsActive({
            status: String(rowValue(row.claim, "status")),
            validFrom: dateValue(rowValue(row.claim, "validFrom")),
            lifecycleEvents: row.lifecycleEvents.map((event) => ({
                id: requiredString(event, "id"),
                eventType: String(rowValue(event, "eventType")),
                createdAt: dateValue(rowValue(event, "createdAt")),
            })),
        }));
        const domainClaims = active.map((row) => claimToDomain(inferenceClaim(row.claim, row.observation, row.lifecycleEvents)));
        const projection = buildLearnerEntityProjection(userId, entityId, entityKind, definitionVersion, domainClaims, asOf);
        const stateId = idempotentId("learner", `${userId}:${entityId}`);
        const json = jsonSuffix(this.em);
        await this.execute(`INSERT INTO ${tables.state}
        ("id", "userId", "cognitiveEntityId", "estimate",
         "evidenceSufficiency", "status", "lastObservedAt",
         "lastEvidenceClaimId", "inferenceVersion", "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT ("userId", "cognitiveEntityId") DO UPDATE SET
         "estimate" = excluded."estimate",
         "evidenceSufficiency" = excluded."evidenceSufficiency",
         "status" = excluded."status",
         "lastObservedAt" = excluded."lastObservedAt",
         "lastEvidenceClaimId" = excluded."lastEvidenceClaimId",
         "inferenceVersion" = excluded."inferenceVersion",
         "updatedAt" = excluded."updatedAt"`, [
            stateId,
            userId,
            entityId,
            projection.estimate,
            projection.evidenceSufficiency,
            projection.status,
            projection.lastObservedAt,
            [...active].sort((left, right) => dateValue(rowValue(right.observation, "observedAt")).getTime() -
                dateValue(rowValue(left.observation, "observedAt")).getTime())[0]
                ? requiredString([...active].sort((left, right) => dateValue(rowValue(right.observation, "observedAt")).getTime() -
                    dateValue(rowValue(left.observation, "observedAt")).getTime())[0]!.claim, "id")
                : null,
            COGNITION_INFERENCE_VERSION,
            asOf,
            asOf,
        ]);
        const state = resultRows(await this.execute(`SELECT * FROM ${tables.state}
          WHERE "userId" = ? AND "cognitiveEntityId" = ?`, [userId, entityId]))[0];
        if (!state)
            throw new Error("Learner state was not persisted");
        for (const dimension of projection.dimensions) {
            await this.execute(`INSERT INTO ${tables.dimension}
          ("id", "learnerEntityStateId", "dimension", "estimate",
           "evidenceSufficiency", "evidenceSufficiencyReasons", "status",
           "alpha", "beta", "evidenceWeight", "observationCount",
           "lastObservedAt", "inferenceVersion", "createdAt", "updatedAt")
         VALUES (?, ?, ?, ?, ?, ?${json}, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT ("learnerEntityStateId", "dimension") DO UPDATE SET
           "estimate" = excluded."estimate",
           "evidenceSufficiency" = excluded."evidenceSufficiency",
           "evidenceSufficiencyReasons" = excluded."evidenceSufficiencyReasons",
           "status" = excluded."status",
           "alpha" = excluded."alpha", "beta" = excluded."beta",
           "evidenceWeight" = excluded."evidenceWeight",
           "observationCount" = excluded."observationCount",
           "lastObservedAt" = excluded."lastObservedAt",
           "inferenceVersion" = excluded."inferenceVersion",
           "updatedAt" = excluded."updatedAt"`, [
                idempotentId("dimension", `${userId}:${entityId}:${dimension.dimension}`),
                requiredString(state, "id"),
                dimension.dimension,
                dimension.estimate,
                dimension.evidenceSufficiency,
                JSON.stringify(dimension.evidenceSufficiencyReasons),
                dimension.status,
                dimension.alpha,
                dimension.beta,
                dimension.effectiveEvidenceWeight,
                dimension.observationCount,
                dimension.lastObservedAt,
                COGNITION_INFERENCE_VERSION,
                asOf,
                asOf,
            ]);
        }
        const dimensionRows = resultRows(await this.execute(`SELECT * FROM ${tables.dimension}
          WHERE "learnerEntityStateId" = ? ORDER BY "dimension"`, [requiredString(state, "id")]));
        const stateRecord: VerifiedEvidenceLearnerStateRecord = {
            id: requiredString(state, "id"),
            userId: requiredString(state, "userId"),
            cognitiveEntityId: requiredString(state, "cognitiveEntityId"),
            estimate: rowValue(state, "estimate") == null
                ? null
                : numberValue(rowValue(state, "estimate")),
            evidenceSufficiency: numberValue(rowValue(state, "evidenceSufficiency")),
            status: rowValue(state, "status") as VerifiedEvidenceLearnerStateRecord["status"],
            lastObservedAt: nullableDateValue(rowValue(state, "lastObservedAt")),
            lastEvidenceClaimId: rowValue(state, "lastEvidenceClaimId") == null
                ? null
                : String(rowValue(state, "lastEvidenceClaimId")),
            inferenceVersion: numberValue(rowValue(state, "inferenceVersion")),
            createdAt: dateValue(rowValue(state, "createdAt")),
            updatedAt: dateValue(rowValue(state, "updatedAt")),
            dimensions: dimensionRows.map((row): VerifiedEvidenceLearnerDimensionStateRecord => ({
                id: requiredString(row, "id"),
                learnerEntityStateId: requiredString(row, "learnerEntityStateId"),
                dimension: rowValue(row, "dimension") as CognitiveDimension,
                estimate: rowValue(row, "estimate") == null
                    ? null
                    : numberValue(rowValue(row, "estimate")),
                evidenceSufficiency: numberValue(rowValue(row, "evidenceSufficiency")),
                evidenceSufficiencyReasons: jsonArray(rowValue(row, "evidenceSufficiencyReasons")).filter((item): item is string => typeof item === "string"),
                status: rowValue(row, "status") as VerifiedEvidenceLearnerDimensionStateRecord["status"],
                alpha: numberValue(rowValue(row, "alpha")),
                beta: numberValue(rowValue(row, "beta")),
                evidenceWeight: numberValue(rowValue(row, "evidenceWeight")),
                observationCount: numberValue(rowValue(row, "observationCount")),
                lastObservedAt: nullableDateValue(rowValue(row, "lastObservedAt")),
                inferenceVersion: numberValue(rowValue(row, "inferenceVersion")),
                createdAt: dateValue(rowValue(row, "createdAt")),
                updatedAt: dateValue(rowValue(row, "updatedAt")),
            })),
        };
        const previous = resultRows(await this.execute(`SELECT * FROM ${tables.revision}
          WHERE "userId" = ? AND "cognitiveEntityId" = ?
          ORDER BY "revision" DESC LIMIT 1`, [userId, entityId]))[0];
        const latestClaim = [...rows]
            .filter((row) => dateValue(row.claim.createdAt ?? rowValue(row.claim, "createdAt")) <=
            asOf)
            .sort((left, right) => dateValue(rowValue(right.observation, "observedAt")).getTime() -
            dateValue(rowValue(left.observation, "observedAt")).getTime() ||
            dateValue(rowValue(right.claim, "createdAt")).getTime() -
                dateValue(rowValue(left.claim, "createdAt")).getTime() ||
            String(rowValue(right.claim, "id")).localeCompare(String(rowValue(left.claim, "id"))))[0];
        const evidenceCutoffAt = latestClaim
            ? dateValue(rowValue(latestClaim.claim, "createdAt"))
            : null;
        const lifecycleCutoffAt = rows
            .flatMap((row) => row.lifecycleEvents)
            .map((row) => dateValue(rowValue(row, "createdAt")))
            .filter((date) => date <= asOf)
            .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
        const summarySnapshot = {
            estimate: projection.estimate,
            evidenceSufficiency: projection.evidenceSufficiency,
            status: projection.status,
            lastObservedAt: projection.lastObservedAt?.toISOString() ?? null,
        };
        const dimensionSnapshot = projection.dimensions.map((dimension) => ({
            dimension: dimension.dimension,
            estimate: dimension.estimate,
            evidenceSufficiency: dimension.evidenceSufficiency,
            evidenceSufficiencyReasons: dimension.evidenceSufficiencyReasons,
            status: dimension.status,
            alpha: dimension.alpha,
            beta: dimension.beta,
            effectiveEvidenceWeight: dimension.effectiveEvidenceWeight,
            observationCount: dimension.observationCount,
            lastObservedAt: dimension.lastObservedAt,
        }));
        const unchanged = Boolean(previous &&
            stableJsonStringify(parseJson(rowValue(previous, "summarySnapshot"))) ===
                stableJsonStringify(summarySnapshot) &&
            stableJsonStringify(parseJson(rowValue(previous, "dimensionSnapshot"))) === stableJsonStringify(dimensionSnapshot));
        let revisionRow = previous;
        if (!unchanged) {
            await this.execute(`INSERT INTO ${tables.revision}
          ("id", "userId", "cognitiveEntityId", "revision",
           "evidenceCutoffAt", "evidenceCutoffClaimId", "lifecycleCutoffAt",
           "inferenceVersion", "estimate", "evidenceSufficiency", "status",
           "summarySnapshot", "dimensionSnapshot", "createdAt")
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${json}, ?${json}, ?)`, [
                randomUUID(),
                userId,
                entityId,
                numberValue(rowValue(previous ?? {}, "revision")) + 1,
                evidenceCutoffAt,
                latestClaim ? requiredString(latestClaim.claim, "id") : null,
                lifecycleCutoffAt,
                COGNITION_INFERENCE_VERSION,
                projection.estimate,
                projection.evidenceSufficiency,
                projection.status,
                JSON.stringify(summarySnapshot),
                JSON.stringify(dimensionSnapshot),
                asOf,
            ]);
            revisionRow = resultRows(await this.execute(`SELECT * FROM ${tables.revision}
            WHERE "userId" = ? AND "cognitiveEntityId" = ?
            ORDER BY "revision" DESC LIMIT 1`, [userId, entityId]))[0];
        }
        if (!revisionRow)
            throw new Error("Learner state revision was not persisted");
        const revision: VerifiedEvidenceLearnerStateRevisionRecord = {
            id: requiredString(revisionRow, "id"),
            userId: requiredString(revisionRow, "userId"),
            cognitiveEntityId: requiredString(revisionRow, "cognitiveEntityId"),
            revision: numberValue(rowValue(revisionRow, "revision")),
            evidenceCutoffAt: nullableDateValue(rowValue(revisionRow, "evidenceCutoffAt")),
            evidenceCutoffClaimId: rowValue(revisionRow, "evidenceCutoffClaimId") == null
                ? null
                : String(rowValue(revisionRow, "evidenceCutoffClaimId")),
            lifecycleCutoffAt: nullableDateValue(rowValue(revisionRow, "lifecycleCutoffAt")),
            inferenceVersion: numberValue(rowValue(revisionRow, "inferenceVersion")),
            estimate: rowValue(revisionRow, "estimate") == null
                ? null
                : numberValue(rowValue(revisionRow, "estimate")),
            evidenceSufficiency: numberValue(rowValue(revisionRow, "evidenceSufficiency")),
            status: rowValue(revisionRow, "status") as VerifiedEvidenceLearnerStateRevisionRecord["status"],
            summarySnapshot: parseJson(rowValue(revisionRow, "summarySnapshot")),
            dimensionSnapshot: parseJson(rowValue(revisionRow, "dimensionSnapshot")),
            createdAt: dateValue(rowValue(revisionRow, "createdAt")),
        };
        return { state: stateRecord, revision };
    }
    /** Rebuild a state projection after an append-only lifecycle mutation. */
    async replayEntityState(userId: string, entityId: string, asOf = new Date()): Promise<void> {
        const tables = {
            attempt: qualifiedTable(this.em, "TaskAttempt"),
            task: qualifiedTable(this.em, "LearningTask"),
            entity: qualifiedTable(this.em, "CognitiveEntity"),
            observation: qualifiedTable(this.em, "TaskObservation"),
            claim: qualifiedTable(this.em, "EvidenceClaim"),
            lifecycle: qualifiedTable(this.em, "EvidenceLifecycleEvent"),
            state: qualifiedTable(this.em, "LearnerEntityState"),
            dimension: qualifiedTable(this.em, "LearnerDimensionState"),
            revision: qualifiedTable(this.em, "LearnerStateRevision"),
        };
        const entity = resultRows(await this.execute(`SELECT "definitionVersion" FROM ${tables.entity}
          WHERE "id" = ?`, [entityId]))[0];
        if (!entity) {
            throw new CognitionPersistenceError("not_found", "active cognitive entity not found");
        }
        await this.lockEntity(userId, entityId);
        await this.refreshState(tables, userId, entityId, numberValue(rowValue(entity, "definitionVersion")), asOf);
    }
    async recordVerifiedObservation(input: AppendVerifiedEvidenceInput): Promise<VerifiedEvidenceAppendResult> {
        const tables = {
            attempt: qualifiedTable(this.em, "TaskAttempt"),
            task: qualifiedTable(this.em, "LearningTask"),
            goal: qualifiedTable(this.em, "LearningGoal"),
            requirement: qualifiedTable(this.em, "TaskRequirement"),
            entity: qualifiedTable(this.em, "CognitiveEntity"),
            target: qualifiedTable(this.em, "LearningTarget"),
            observation: qualifiedTable(this.em, "TaskObservation"),
            claim: qualifiedTable(this.em, "EvidenceClaim"),
            lifecycle: qualifiedTable(this.em, "EvidenceLifecycleEvent"),
            misconception: qualifiedTable(this.em, "MisconceptionPattern"),
            state: qualifiedTable(this.em, "LearnerEntityState"),
            dimension: qualifiedTable(this.em, "LearnerDimensionState"),
            revision: qualifiedTable(this.em, "LearnerStateRevision"),
        };
        const key = evidenceKey(input);
        const existing = await this.readClaimByKey(tables.claim, tables.observation, tables.lifecycle, key);
        if (existing) {
            if (rowValue(existing.claim, "userId") !== input.userId ||
                rowValue(existing.observation, "attemptId") !== input.attemptId) {
                throw new CognitionPersistenceError("idempotency_conflict", "evidence idempotency key belongs to a different learner or attempt");
            }
            await this.lockEntity(input.userId, requiredString(existing.claim, "cognitiveEntityId"));
            const state = await this.refreshState(tables, input.userId, requiredString(existing.claim, "cognitiveEntityId"), numberValue(rowValue(existing.claim, "definitionVersion")));
            return {
                observation: recordObservation(existing.observation),
                claim: recordClaim(existing.claim),
                lifecycleEvent: recordLifecycle(existing.lifecycleEvents[0]!),
                state: state.state,
                revision: state.revision,
                replayed: true,
            };
        }
        const declaration = await this.loadDeclaration(tables.attempt, tables.task, tables.goal, tables.requirement, tables.entity, tables.target, input);
        const persistedPolicy = declaration.taskPolicy;
        if (persistedPolicy.source !== input.evaluator.source ||
            persistedPolicy.taskKind !== input.evaluator.taskKind ||
            persistedPolicy.contextKey !== input.evaluator.contextKey ||
            persistedPolicy.contextDistance !== input.evaluator.contextDistance ||
            (input.evaluator.rubricId !== undefined &&
                persistedPolicy.rubricId !== input.evaluator.rubricId)) {
            throw new CognitionPersistenceError("invalid_declaration", "verified evaluator policy does not match the immutable task declaration");
        }
        const validated = validateObservationAgainstDeclaration(declaration.attempt, declaration.requirement, input.candidate as never, {
            evaluatorType: input.evaluator.evaluatorType,
            evaluatorRef: input.evaluator.evaluatorRef,
            contextLineageKey: input.evaluator.contextLineageKey,
            evaluatorReliability: input.evaluator.evaluatorReliability,
            groundingReliability: input.evaluator.groundingReliability,
            evidenceStrength: input.evaluator.evidenceStrength,
        });
        const entityId = declaration.requirement.cognitiveEntity!.id;
        const entityTitle = declaration.requirement.cognitiveEntity!.title;
        const misconception = deriveDeterministicMisconceptionPattern({
            goalId: declaration.attempt.task.goalId,
            cognitiveEntityId: entityId,
            cognitiveEntityTitle: entityTitle,
            definitionVersion: validated.definitionVersion,
            criterionRef: validated.criterionRef,
            source: validated.policy.source,
            evaluator: input.evaluator.evaluatorType,
            score: validated.domainClaim.score,
            rawResult: input.candidate.rawResult,
        });
        await this.lockEntity(input.userId, entityId);
        const suffix = jsonSuffix(this.em);
        const now = new Date();
        const observedAt = input.candidate.observedAt ?? now;
        const observationId = idempotentId("observation", key);
        const claimId = idempotentId("claim", key);
        const lifecycleId = idempotentId("lifecycle", `${claimId}:created`);
        let misconceptionId: string | null = null;
        if (misconception) {
            await this.execute(`INSERT INTO ${tables.misconception}
          ("id", "stableKey", "scope", "goalId", "primaryEntityId",
           "title", "description", "errorSignature", "remediationGuidance",
           "definitionVersion", "status", "createdAt", "updatedAt")
         VALUES (?, ?, 'goal', ?, ?, ?, ?, ?${suffix}, ?${suffix}, ?, 'active', ?, ?)
         ON CONFLICT ("stableKey") DO UPDATE SET
           "status" = 'active', "updatedAt" = excluded."updatedAt"`, [
                randomUUID(),
                misconception.stableKey,
                declaration.attempt.task.goalId,
                entityId,
                misconception.title,
                misconception.description,
                JSON.stringify(misconception.errorSignature),
                JSON.stringify(misconception.remediationGuidance),
                validated.definitionVersion,
                now,
                now,
            ]);
            const misconceptionRow = resultRows(await this.execute(`SELECT "id" FROM ${tables.misconception} WHERE "stableKey" = ?`, [misconception.stableKey]))[0];
            misconceptionId = misconceptionRow
                ? requiredString(misconceptionRow, "id")
                : null;
        }
        const metadata = {
            ...(input.candidate.metadata ?? {}),
            evidenceSource: validated.policy.source,
            evidenceTaskKind: validated.policy.taskKind,
            contextDistance: validated.policy.contextDistance,
            contextKey: validated.domainClaim.task.contextId,
            delayedDays: validated.policy.delayedDays,
            rubricId: validated.policy.rubricId,
            rubricCriterion: declaration.requirement.rubricCriterion,
            criterionRef: validated.criterionRef,
            criterionDefinitionVersion: validated.definitionVersion,
            evidenceStrength: validated.domainClaim.strength,
            assistance: validated.assistance,
        };
        await this.execute(`INSERT INTO ${tables.observation}
        ("id", "attemptId", "requirementId", "learningTargetId",
         "cognitiveEntityId", "dimension", "outcome", "score",
         "evaluatorReliability", "groundingReliability", "independence",
         "transferDistance", "subjectDefinitionVersion", "evaluatorType",
         "evaluatorRef", "rawResult", "metadata", "observedAt")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${suffix}, ?${suffix}, ?)
       ON CONFLICT ("id") DO NOTHING`, [
            observationId,
            input.attemptId,
            input.candidate.requirementId,
            declaration.requirement.learningTargetId ?? null,
            entityId,
            validated.domainClaim.dimension,
            input.candidate.outcome ?? "observed",
            validated.domainClaim.score,
            input.evaluator.evaluatorReliability,
            input.evaluator.groundingReliability,
            validated.independence,
            transferDistanceValue(validated.policy.contextDistance),
            validated.definitionVersion,
            input.evaluator.evaluatorType,
            input.evaluator.evaluatorRef ?? null,
            JSON.stringify(input.candidate.rawResult ?? {}),
            JSON.stringify(metadata),
            observedAt,
        ]);
        await this.execute(`INSERT INTO ${tables.claim}
        ("id", "userId", "observationId", "cognitiveEntityId",
         "learningTargetId", "misconceptionPatternId", "dimension",
         "criterionRef", "polarity", "score", "strength",
         "evaluatorReliability", "groundingReliability", "definitionVersion",
         "contextKey", "status", "idempotencyKey", "validFrom",
         "validUntil", "createdAt")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL, ?)
       ON CONFLICT ("idempotencyKey") DO NOTHING`, [
            claimId,
            input.userId,
            observationId,
            entityId,
            declaration.requirement.learningTargetId ?? null,
            misconceptionId,
            validated.domainClaim.dimension,
            validated.criterionRef,
            validated.domainClaim.score >= 0.5 ? "supports" : "refutes",
            validated.domainClaim.score,
            STRENGTH_VALUE[validated.domainClaim.strength],
            input.evaluator.evaluatorReliability,
            input.evaluator.groundingReliability,
            validated.definitionVersion,
            validated.domainClaim.task.contextId,
            key,
            now,
            now,
        ]);
        const canonicalClaim = await this.readClaimByKey(tables.claim, tables.observation, tables.lifecycle, key);
        if (!canonicalClaim)
            throw new Error("Verified evidence claim was not persisted");
        await this.execute(`INSERT INTO ${tables.lifecycle}
        ("id", "evidenceClaimId", "eventType", "reason",
         "actorUserId", "replacementClaimId", "payload", "createdAt")
       VALUES (?, ?, 'created', ?, NULL, NULL, ?${suffix}, ?)
       ON CONFLICT ("id") DO NOTHING`, [
            lifecycleId,
            requiredString(canonicalClaim.claim, "id"),
            "validated_task_observation",
            JSON.stringify({ source: validated.policy.source }),
            now,
        ]);
        const finalClaim = await this.readClaimByKey(tables.claim, tables.observation, tables.lifecycle, key);
        if (!finalClaim || finalClaim.lifecycleEvents.length === 0) {
            throw new Error("Verified evidence lifecycle event was not persisted");
        }
        const state = await this.refreshState(tables, input.userId, entityId, validated.definitionVersion);
        return {
            observation: recordObservation(finalClaim.observation),
            claim: recordClaim(finalClaim.claim),
            lifecycleEvent: recordLifecycle(finalClaim.lifecycleEvents[0]!),
            state: state.state,
            revision: state.revision,
            replayed: false,
        };
    }
}
