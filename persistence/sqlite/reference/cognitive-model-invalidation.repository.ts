import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { CognitiveModelInvalidationRepository, InvalidateCognitiveModelInput, InvalidateCognitiveModelResult, } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { computeCognitiveModelInputHash } from "@xue-learn/core/source/libs/server/src/cognitive-model/pure.ts";
import { sqlTimestampParameter } from "./date-value.ts";
type Row = Readonly<Record<string, unknown>>;
const COGNITIVE_MODEL_SKELETON_EVENT = "cognitive.model.skeleton";
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
function stringValue(value: unknown, fallback = ""): string {
    return typeof value === "string" ? value : fallback;
}
function numberValue(value: unknown, fallback = 0): number {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function jsonValue(value: unknown): unknown {
    if (typeof value !== "string")
        return value;
    try {
        return JSON.parse(value);
    }
    catch {
        return value;
    }
}
function qualifiedTable(em: EntityManager, table: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${table.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
/** Transaction-neutral fingerprint and invalidation adapter. */
export class MikroOrmCognitiveModelInvalidationRepository implements CognitiveModelInvalidationRepository {
    constructor(private readonly em: EntityManager) { }
    private execute(sql: string, params: unknown[] = []) {
        return this.em
            .getConnection()
            .execute(sql, params, undefined, this.em.getTransactionContext());
    }
    async invalidate(input: InvalidateCognitiveModelInput): Promise<InvalidateCognitiveModelResult> {
        const goalTable = qualifiedTable(this.em, "LearningGoal");
        const unitTable = qualifiedTable(this.em, "LearningUnit");
        const eventTable = qualifiedTable(this.em, "EventOutbox");
        const lock = "";
        const goal = resultRows(await this.execute(`SELECT "id", "goalKind", "learningMode",
                "learningModeTransitionStatus", "title", "level",
                "domainTag", "topicCategory", "contentLanguage", "pathSource",
                "curriculumVersion", "mapPlanJson", "mapPlanStatus",
                "cognitiveModelInputHash", "cognitiveModelVersion"
           FROM ${goalTable}
          WHERE "id" = ?${lock}`, [input.goalId]))[0];
        if (!goal)
            throw new Error("Goal not found");
        const goalKind = stringValue(rowValue(goal, "goalKind"));
        const learningMode = stringValue(rowValue(goal, "learningMode"));
        const transitionStatus = stringValue(rowValue(goal, "learningModeTransitionStatus"));
        const currentHash = stringValue(rowValue(goal, "cognitiveModelInputHash"));
        if (goalKind === "micro" ||
            (learningMode === "exploration" &&
                transitionStatus !== "queued" &&
                transitionStatus !== "building")) {
            return {
                goalId: input.goalId,
                inputHash: currentHash,
                changed: false,
                eventId: null,
            };
        }
        const units = resultRows(await this.execute(`SELECT "id", "curriculumKey", "parentUnitId", "unitKind", "title",
                "contentSummary", "orderIndex", "difficulty", "prerequisites",
                "planAreaRef", "planningOutcomeRefs"
           FROM ${unitTable}
          WHERE "goalId" = ? AND "unitKind" <> 'overview'${""}`, [input.goalId])).map((unit) => ({
            id: stringValue(rowValue(unit, "id")),
            curriculumKey: stringValue(rowValue(unit, "curriculumKey")),
            parentUnitId: stringValue(rowValue(unit, "parentUnitId"), "") || null,
            unitKind: stringValue(rowValue(unit, "unitKind")),
            title: stringValue(rowValue(unit, "title")),
            contentSummary: stringValue(rowValue(unit, "contentSummary")),
            orderIndex: numberValue(rowValue(unit, "orderIndex")),
            difficulty: stringValue(rowValue(unit, "difficulty")),
            prerequisites: stringValue(rowValue(unit, "prerequisites")),
            planAreaRef: stringValue(rowValue(unit, "planAreaRef")) || undefined,
            planningOutcomeRefs: jsonValue(rowValue(unit, "planningOutcomeRefs")),
        }));
        const inputHash = computeCognitiveModelInputHash({
            title: stringValue(rowValue(goal, "title")),
            level: stringValue(rowValue(goal, "level")),
            domainTag: stringValue(rowValue(goal, "domainTag")),
            topicCategory: stringValue(rowValue(goal, "topicCategory")),
            contentLanguage: stringValue(rowValue(goal, "contentLanguage")),
            pathSource: stringValue(rowValue(goal, "pathSource")),
            curriculumVersion: numberValue(rowValue(goal, "curriculumVersion")),
            mapPlanJson: stringValue(rowValue(goal, "mapPlanJson")),
            mapPlanStatus: stringValue(rowValue(goal, "mapPlanStatus")),
        }, units);
        const changed = input.force === true || inputHash !== currentHash;
        let eventId: string | null = null;
        if (changed) {
            const curriculumVersion = numberValue(rowValue(goal, "curriculumVersion"));
            if (curriculumVersion === 2) {
                await this.execute(`UPDATE ${unitTable}
              SET "cognitiveModelBuildInputHash" = ?
            WHERE "goalId" = ? AND "unitKind" = 'lesson'
              AND "cognitiveModelStatus" = 'expanded'`, [inputHash, input.goalId]);
                await this.execute(`UPDATE ${unitTable}
              SET "cognitiveModelStatus" = 'pending',
                  "cognitiveModelBuildStartedAt" = NULL,
                  "cognitiveModelBuildToken" = NULL,
                  "cognitiveModelBuildInputHash" = NULL
            WHERE "goalId" = ? AND "unitKind" = 'lesson'
              AND "cognitiveModelStatus" <> 'expanded'`, [input.goalId]);
            }
            else {
                await this.execute(`UPDATE ${unitTable}
              SET "cognitiveModelStatus" = 'pending',
                  "cognitiveModelBuildStartedAt" = NULL,
                  "cognitiveModelBuildToken" = NULL,
                  "cognitiveModelBuildInputHash" = NULL
            WHERE "goalId" = ? AND "unitKind" = 'lesson'`, [input.goalId]);
            }
            const goalStatus = curriculumVersion === 2 &&
                numberValue(rowValue(goal, "cognitiveModelVersion")) > 0
                ? "building"
                : numberValue(rowValue(goal, "cognitiveModelVersion")) > 0
                    ? "needs_reconciliation"
                    : "pending";
            await this.execute(`UPDATE ${goalTable}
            SET "cognitiveModelEnabled" = ${"1"},
                "cognitiveModelInputHash" = ?,
                "cognitiveModelStatus" = ?,
                "updatedAt" = ?
          WHERE "id" = ?`, [inputHash, goalStatus, new Date(), input.goalId]);
        }
        if (changed && (input.enqueue ?? true)) {
            eventId = randomUUID();
            const createdAt = new Date();
            const dueAt = sqlTimestampParameter(false, createdAt);
            await this.execute(`INSERT INTO ${eventTable}
          ("id", "type", "payload", "createdAt", "nextAttemptAt")
         VALUES (?, ?, ?, ?, ?)`, [
                eventId,
                COGNITIVE_MODEL_SKELETON_EVENT,
                JSON.stringify({
                    goalId: input.goalId,
                    inputHash,
                    baseModelVersion: numberValue(rowValue(goal, "cognitiveModelVersion")),
                    reason: input.reason ?? "curriculum_changed",
                    force: input.force === true,
                }),
                dueAt,
                dueAt,
            ]);
        }
        return { goalId: input.goalId, inputHash, changed, eventId };
    }
}
