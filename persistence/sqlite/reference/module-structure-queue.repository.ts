import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { ModuleStructureQueueInput, ModuleStructureQueueRecord, ModuleStructureQueueRepository, } from "@xue-learn/core/domain/persistence/module-structure-queue-port";
type ValueRow = Readonly<Record<string, unknown>>;
const COURSE_MODULE_GENERATE_EVENT = "course.module.generate";
const COGNITIVE_MODEL_SKELETON_EVENT = "cognitive.model.skeleton";
const COGNITIVE_MODEL_EXPAND_NEXT_EVENT = "cognitive.model.expand_next";
function resultRows(result: unknown): readonly ValueRow[] {
    if (Array.isArray(result))
        return result as ValueRow[];
    if (result && typeof result === "object" && "rows" in result) {
        const rows = (result as {
            rows?: unknown;
        }).rows;
        return Array.isArray(rows) ? (rows as ValueRow[]) : [];
    }
    return [];
}
function qualifiedTable(em: EntityManager, table: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${table.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
/** Atomic owner-scoped queueing of all sequential module structures. */
export class MikroOrmModuleStructureQueueRepository implements ModuleStructureQueueRepository {
    constructor(private readonly em: EntityManager) { }
    async enqueueOwned(input: ModuleStructureQueueInput): Promise<ModuleStructureQueueRecord> {
        return this.em.transactional((tx) => this.enqueueInTransaction(tx, input));
    }
    async enqueueInitialKacom(goalId: string) {
        return this.em.transactional(async (em) => {
            const connection = em.getConnection();
            const execute = (sql: string, params: unknown[] = []) => connection.execute(sql, params, undefined, em.getTransactionContext());
            const goal = resultRows(await execute(`SELECT "learningMode" FROM ${qualifiedTable(em, "LearningGoal")} WHERE "id"=? ${""}`, [goalId]))[0];
            if (!goal || goal["learningMode"] === "exploration")
                return { enqueued: false as const };
            const module = resultRows(await execute(`SELECT m."id",m."generationStatus" FROM ${qualifiedTable(em, "LearningModule")} m WHERE m."goalId"=? AND m."unlockStatus"='unlocked' ORDER BY m."orderIndex" ASC LIMIT 1`, [goalId]))[0];
            if (!module || !["pending", "building"].includes(String(module["generationStatus"])))
                return { enqueued: false as const };
            const moduleId = String(module["id"]);
            // Agentic publication already writes ModuleLearningTarget capability
            // contracts. That is not unit-KACOM authorization; only expansion
            // progress or a live outbox row should suppress the journey-open queue.
            const started = resultRows(await execute(`SELECT "id" FROM ${qualifiedTable(em, "LearningUnit")} WHERE "moduleId"=? AND "unitKind"='lesson' AND "cognitiveModelStatus"<>'pending' LIMIT 1`, [moduleId]))[0];
            if (started)
                return { enqueued: false as const };
            const liveKacom = resultRows(await execute(`SELECT "id" FROM ${qualifiedTable(em, "EventOutbox")} WHERE "type" IN (?, ?) AND "publishedAt" IS NULL AND "deadLetteredAt" IS NULL AND "payload" LIKE ? LIMIT 1`, [COGNITIVE_MODEL_SKELETON_EVENT, COGNITIVE_MODEL_EXPAND_NEXT_EVENT, `%"goalId":"${goalId}"%`]))[0];
            if (liveKacom)
                return { enqueued: false as const };
            const listed = resultRows(await execute(`SELECT "id" FROM ${qualifiedTable(em, "LearningUnit")} WHERE "moduleId"=? AND "unitKind"='lesson' LIMIT 1`, [moduleId]))[0];
            if (listed) {
                // Structure is already published. Do not wait on course.module.generate:
                // a leftover publication lease keeps generationStatus=building and
                // swallows goal_page_open for 15 minutes with no LLM work.
                await execute(`UPDATE ${qualifiedTable(em, "LearningModule")} SET "generationBuildToken"=NULL,"generationBuildStartedAt"=NULL,"updatedAt"=? WHERE "id"=?`, [new Date(), moduleId]);
                return { enqueued: true as const, moduleId, authorizeExpansion: true as const };
            }
            const queued = resultRows(await execute(`SELECT "id" FROM ${qualifiedTable(em, "EventOutbox")} WHERE "type"=? AND "publishedAt" IS NULL AND "deadLetteredAt" IS NULL AND "payload" LIKE ? LIMIT 1`, [COURSE_MODULE_GENERATE_EVENT, `%"moduleId":"${moduleId}","reason":"goal_page_open"%`]))[0];
            if (queued)
                return { enqueued: false as const };
            await execute(`INSERT INTO ${qualifiedTable(em, "EventOutbox")} ("id","type","payload","createdAt","attemptCount") VALUES (?, ?, ?, ?, 0)`, [randomUUID(), COURSE_MODULE_GENERATE_EVENT, JSON.stringify({ goalId, moduleId, reason: "goal_page_open" }), new Date()]);
            return { enqueued: true as const, moduleId };
        });
    }
    private async enqueueInTransaction(em: EntityManager, input: ModuleStructureQueueInput): Promise<ModuleStructureQueueRecord> {
        const goalTable = qualifiedTable(em, "LearningGoal");
        const moduleTable = qualifiedTable(em, "LearningModule");
        const eventTable = qualifiedTable(em, "EventOutbox");
        const connection = em.getConnection();
        const execute = (sql: string, params: unknown[] = []) => connection.execute(sql, params, undefined, em.getTransactionContext());
        const ownedGoal = resultRows(await execute(`SELECT "id"
           FROM ${goalTable}
          WHERE "id" = ? AND "userId" = ?
          ${""}`, [input.goalId, input.userId]));
        if (ownedGoal.length === 0)
            throw new Error("Goal not found");
        const modules = resultRows(await execute(`SELECT "id"
           FROM ${moduleTable}
          WHERE "goalId" = ?
          ORDER BY "orderIndex" ASC`, [input.goalId]));
        if (modules.length === 0)
            return { enqueuedCount: 0 };
        const values: string[] = [];
        const params: unknown[] = [];
        for (const module of modules) {
            const moduleId = module["id"];
            values.push("(?, ?, ?)");
            params.push(randomUUID(), COURSE_MODULE_GENERATE_EVENT, JSON.stringify({
                goalId: input.goalId,
                moduleId,
                reason: "pre_goal_structure",
            }));
        }
        await execute(`INSERT INTO ${eventTable} ("id", "type", "payload")
       VALUES ${values.join(", ")}`, params);
        return { enqueuedCount: modules.length };
    }
}
