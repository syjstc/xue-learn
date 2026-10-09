import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { PrerequisiteBridgeRepository } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { MikroOrmCognitiveModelPublicationRepository } from "./cognitive-model-publication.repository.ts";
type Row = Readonly<Record<string, unknown>>;
function rows(result: unknown): readonly Row[] {
    if (Array.isArray(result))
        return result as Row[];
    if (result && typeof result === "object" && "rows" in result) {
        const value = (result as {
            rows?: unknown;
        }).rows;
        return Array.isArray(value) ? (value as Row[]) : [];
    }
    return [];
}
function value(row: Row, key: string): unknown {
    return row[key] ?? row[key[0]?.toLowerCase() + key.slice(1)];
}
function table(em: EntityManager, name: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${name.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
function bool(raw: unknown): boolean {
    return raw === true || raw === 1 || raw === "1";
}
/** Atomic prerequisite-support synchronization after verified readiness evidence. */
export class MikroOrmPrerequisiteBridgeRepository implements PrerequisiteBridgeRepository {
    constructor(private readonly em: EntityManager) { }
    private execute(sql: string, params: unknown[] = []) {
        return this.em
            .getConnection()
            .execute(sql, params, undefined, this.em.getTransactionContext());
    }
    async sync(input: {
        userId: string;
        goalId: string;
        moduleId: string;
        triggerAttemptId?: string;
    }): Promise<string | null> {
        const lock = "";
        const jsonType = "";
        const module = rows(await this.execute(`SELECT m."id", m."title" FROM ${table(this.em, "LearningModule")} m
          JOIN ${table(this.em, "LearningGoal")} g ON g."id" = m."goalId"
         WHERE m."id" = ? AND m."goalId" = ? AND g."userId" = ?${lock}`, [input.moduleId, input.goalId, input.userId]))[0];
        if (!module)
            return null;
        const existing = rows(await this.execute(`SELECT "id", "status" FROM ${table(this.em, "LearningUnit")}
          WHERE "moduleId" = ? AND "supportKind" = 'prerequisite_bridge'
          ORDER BY "orderIndex", "id" LIMIT 1${lock}`, [input.moduleId]))[0];
        const requirementRows = rows(await this.execute(`SELECT mt."learningTargetId", mt."required" AS "mappingRequired",
                lt."title", mt."weight", mt."orderIndex", r."required",
                r."gate", r."threshold", d."estimate", d."evidenceSufficiency", d."status"
           FROM ${table(this.em, "ModuleLearningTarget")} mt
           JOIN ${table(this.em, "LearningTarget")} lt ON lt."id" = mt."learningTargetId"
           JOIN ${table(this.em, "LearningTargetRequirement")} r ON r."learningTargetId" = lt."id"
           LEFT JOIN ${table(this.em, "LearnerEntityState")} s
             ON s."cognitiveEntityId" = r."cognitiveEntityId" AND s."userId" = ?
           LEFT JOIN ${table(this.em, "LearnerDimensionState")} d
             ON d."learnerEntityStateId" = s."id" AND d."dimension" = r."dimension"
          WHERE mt."moduleId" = ? AND mt."role" = 'entry' AND lt."status" = 'active'
          ORDER BY mt."orderIndex", r."orderIndex"`, [input.userId, input.moduleId]));
        const weakTargetIds = new Set<string>();
        let allReady = requirementRows.length > 0;
        for (const row of requirementRows) {
            if (!bool(value(row, "required")) && !bool(value(row, "gate")))
                continue;
            const estimate = value(row, "estimate");
            const sufficiency = Number(value(row, "evidenceSufficiency") ?? 0);
            const status = value(row, "status");
            if (status === "revalidate" || estimate == null || sufficiency < 0.5) {
                allReady = false;
                continue;
            }
            if (Number(estimate) < Number(value(row, "threshold"))) {
                allReady = false;
                if (bool(value(row, "mappingRequired"))) {
                    weakTargetIds.add(String(value(row, "learningTargetId")));
                }
            }
        }
        if (weakTargetIds.size === 0) {
            if (allReady && existing && value(existing, "status") !== "completed") {
                const now = new Date();
                await this.execute(`UPDATE ${table(this.em, "LearningUnit")}
              SET "status" = 'completed', "completionMethod" = 'test_out',
                  "completedAt" = ?, "skippedAt" = ? WHERE "id" = ?`, [now, now, value(existing, "id")]);
            }
            return existing ? String(value(existing, "id")) : null;
        }
        const source = rows(await this.execute(`SELECT "id", "orderIndex", "prerequisites"
           FROM ${table(this.em, "LearningUnit")}
          WHERE "moduleId" = ? AND "unitKind" = 'lesson'
            AND "requiredForModuleCompletion" = true AND "supportKind" IS NULL
          ORDER BY "orderIndex", "id" LIMIT 1`, [input.moduleId]))[0];
        if (!source)
            return null;
        const weak = requirementRows.filter((row, index, all) => {
            const id = String(value(row, "learningTargetId"));
            return weakTargetIds.has(id) && all.findIndex((item) => value(item, "learningTargetId") === id) === index;
        });
        const title = `准备学习 · ${String(value(module, "title"))}`;
        const summary = `针对进入“${String(value(module, "title"))}”前已由直接证据确认需要加强的基础：${weak.map((row) => String(value(row, "title"))).join("、")}。完成针对性解释与应用练习后再回到主课程。`;
        const evidenceIds = input.triggerAttemptId
            ? rows(await this.execute(`SELECT c."id" FROM ${table(this.em, "EvidenceClaim")} c
              JOIN ${table(this.em, "TaskObservation")} o ON o."id" = c."observationId"
             WHERE c."userId" = ? AND o."attemptId" = ?`, [input.userId, input.triggerAttemptId])).map((row) => String(value(row, "id")))
            : [];
        let bridgeId = existing ? String(value(existing, "id")) : null;
        if (!bridgeId) {
            await this.execute(`UPDATE ${table(this.em, "LearningUnit")}
            SET "orderIndex" = "orderIndex" + 1
          WHERE "moduleId" = ? AND "orderIndex" >= ?`, [input.moduleId, Number(value(source, "orderIndex"))]);
            bridgeId = `bridge_${randomUUID().replaceAll("-", "")}`;
            await this.execute(`INSERT INTO ${table(this.em, "LearningUnit")}
          ("id", "curriculumKey", "goalId", "moduleId", "parentUnitId", "unitKind",
           "title", "orderIndex", "difficulty", "prerequisites", "contentSummary",
           "mapOrigin", "status", "cognitiveModelStatus", "requiredForModuleCompletion",
           "supportKind", "supportForUnitId", "supportTriggerAttemptId",
           "supportTriggerEvidenceClaimIds")
         VALUES (?, ?, ?, ?, NULL, 'lesson', ?, ?, 'medium', ?, ?, 'adaptive',
                 'available', 'expanded', false, 'prerequisite_bridge', ?, ?, ?${jsonType})`, [
                bridgeId,
                `prerequisite_bridge:${input.moduleId}`,
                input.goalId,
                input.moduleId,
                title,
                Number(value(source, "orderIndex")),
                String(value(source, "prerequisites") ?? "[]"),
                summary,
                String(value(source, "id")),
                input.triggerAttemptId ?? null,
                JSON.stringify(evidenceIds),
            ]);
        }
        else {
            await this.execute(`UPDATE ${table(this.em, "LearningUnit")}
            SET "title" = ?, "contentSummary" = ?, "status" = 'available',
                "completionMethod" = NULL, "completedAt" = NULL, "skippedAt" = NULL,
                "supportForUnitId" = ?, "supportTriggerAttemptId" = ?,
                "supportTriggerEvidenceClaimIds" = ?${jsonType},
                "requiredForModuleCompletion" = false,
                "contentRevision" = "contentRevision" + 1 WHERE "id" = ?`, [
                title,
                summary,
                String(value(source, "id")),
                input.triggerAttemptId ?? null,
                JSON.stringify(evidenceIds),
                bridgeId,
            ]);
        }
        await this.execute(`DELETE FROM ${table(this.em, "UnitLearningTarget")} WHERE "unitId" = ?`, [bridgeId]);
        for (const [index, mapping] of weak.entries()) {
            await this.execute(`INSERT INTO ${table(this.em, "UnitLearningTarget")}
          ("id", "unitId", "learningTargetId", "localRef", "required", "weight",
           "orderIndex", "role", "isEntry", "isExit", "moduleRole", "moduleCapabilityRefs")
         VALUES (?, ?, ?, ?, true, ?, ?, 'review', ?, ?, 'support', '[]'${jsonType})`, [
                randomUUID(),
                bridgeId,
                String(value(mapping, "learningTargetId")),
                `lt_${index + 1}`,
                Number(value(mapping, "weight")),
                index,
                index === 0,
                index === weak.length - 1,
            ]);
        }
        await new MikroOrmCognitiveModelPublicationRepository(this.em).publishMappingOnlyRevision({
            goalId: input.goalId,
            reason: "prerequisite_bridge_mapping_changed",
        });
        return bridgeId;
    }
}
