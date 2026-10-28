import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { UnitLearningProgressReset, UnitLearningProgressResetRepository, ResetUnitLearningProgressInput, } from "@xue-learn/core/domain";
import { evidenceClaimIsActive } from "@xue-learn/core/server/cognition/persistence/lifecycle";
import { isUnitLearningDone } from "@xue-learn/core/domain";
import { MikroOrmVerifiedEvidenceAppendRepository } from "./verified-evidence-append.repository.ts";
import { referenceDateValue } from "./date-value.ts";
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
function requiredString(row: Row, key: string): string {
    const value = rowValue(row, key);
    if (typeof value !== "string" || !value) {
        throw new Error(`unit reset row is missing ${key}`);
    }
    return value;
}
function dateValue(value: unknown): Date {
    return referenceDateValue(value);
}
function qualifiedTable(em: EntityManager, table: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${table.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
/** Raw adapter for the append-only completed-unit reset write set. */
export class MikroOrmUnitLearningProgressResetRepository implements UnitLearningProgressResetRepository {
    private readonly evidence: MikroOrmVerifiedEvidenceAppendRepository;
    constructor(private readonly em: EntityManager) {
        this.evidence = new MikroOrmVerifiedEvidenceAppendRepository(em);
    }
    private execute(sql: string, params: unknown[] = []) {
        return this.em
            .getConnection()
            .execute(sql, params, undefined, this.em.getTransactionContext());
    }
    private async tableExists(tableName: string): Promise<boolean> {
        return (resultRows(await this.execute(`SELECT 1 FROM "sqlite_master"
            WHERE "type" = 'table' AND "name" = ?
            LIMIT 1`, [tableName])).length > 0);
    }
    async resetOwned(input: ResetUnitLearningProgressInput): Promise<UnitLearningProgressReset> {
        const unitTable = qualifiedTable(this.em, "LearningUnit");
        const goalTable = qualifiedTable(this.em, "LearningGoal");
        const claimTable = qualifiedTable(this.em, "EvidenceClaim");
        const observationTable = qualifiedTable(this.em, "TaskObservation");
        const attemptTable = qualifiedTable(this.em, "TaskAttempt");
        const lifecycleTable = qualifiedTable(this.em, "EvidenceLifecycleEvent");
        const reviewCardTable = qualifiedTable(this.em, "ReviewCard");
        const sessionTable = qualifiedTable(this.em, "UnitSessionState");
        const now = new Date();
        const unit = resultRows(await this.execute(`SELECT u."status", g."userId"
           FROM ${unitTable} u
           JOIN ${goalTable} g ON g."id" = u."goalId"
          WHERE u."id" = ?
          LIMIT 1`, [input.unitId]))[0];
        const userId = unit ? requiredString(unit, "userId") : null;
        if (!unit ||
            !userId ||
            !isUnitLearningDone(String(rowValue(unit, "status")))) {
            return { reset: false, userId: null, affectedEntityIds: [] };
        }
        const claims = resultRows(await this.execute(`SELECT ec."id", ec."cognitiveEntityId", ec."status", ec."validFrom"
           FROM ${claimTable} ec
           JOIN ${observationTable} o ON o."id" = ec."observationId"
           JOIN ${attemptTable} a ON a."id" = o."attemptId"
          WHERE ec."userId" = ? AND a."unitId" = ?
          ORDER BY ec."createdAt" ASC, ec."id" ASC`, [userId, input.unitId]));
        const activeClaims: Row[] = [];
        for (const claim of claims) {
            const lifecycleEvents = resultRows(await this.execute(`SELECT "id", "eventType", "createdAt"
             FROM ${lifecycleTable}
            WHERE "evidenceClaimId" = ?
            ORDER BY "createdAt" ASC, "id" ASC`, [requiredString(claim, "id")])).map((event) => ({
                id: requiredString(event, "id"),
                eventType: String(rowValue(event, "eventType")),
                createdAt: dateValue(rowValue(event, "createdAt")),
            }));
            if (evidenceClaimIsActive({
                status: String(rowValue(claim, "status")),
                validFrom: dateValue(rowValue(claim, "validFrom")),
                lifecycleEvents,
            })) {
                activeClaims.push(claim);
            }
        }
        for (const claim of activeClaims) {
            await this.execute(`INSERT INTO ${lifecycleTable}
          ("id", "evidenceClaimId", "eventType", "reason",
           "actorUserId", "replacementClaimId", "payload", "createdAt")
         VALUES (?, ?, 'retracted', ?, ?, NULL, ?${""}, ?)`, [
                randomUUID(),
                requiredString(claim, "id"),
                "unit_learning_reset",
                userId,
                JSON.stringify({ unitId: input.unitId }),
                now,
            ]);
            await this.execute(`UPDATE ${claimTable}
            SET "status" = 'retracted', "validUntil" = ?
          WHERE "id" = ? AND "userId" = ?`, [now, requiredString(claim, "id"), userId]);
        }
        if (await this.tableExists("ReviewCard")) {
            await this.execute(`DELETE FROM ${reviewCardTable} WHERE "unitId" = ?`, [
                input.unitId,
            ]);
        }
        await this.execute(`UPDATE ${unitTable}
          SET "status" = 'in_progress', "completionMethod" = NULL,
              "completionAttemptId" = NULL, "completedAt" = NULL
        WHERE "id" = ?`, [input.unitId]);
        await this.execute(`INSERT INTO ${sessionTable}
        ("id", "unitId", "currentStep", "graphState", "socraticTurn", "updatedAt")
       VALUES (?, ?, 'structured_input', '{}', 0, ?)
       ON CONFLICT ("unitId") DO UPDATE SET
         "currentStep" = 'structured_input', "graphState" = '{}',
         "socraticTurn" = 0, "updatedAt" = ?`, [randomUUID(), input.unitId, now, now]);
        const affectedEntityIds = [
            ...new Set(activeClaims.map((claim) => requiredString(claim, "cognitiveEntityId"))),
        ];
        for (const entityId of affectedEntityIds) {
            await this.evidence.replayEntityState(userId, entityId, now);
        }
        // Gap hypotheses are a rebuildable learner-state projection. A reset can
        // invalidate both primary and supporting entities, so clear the learner's
        // projection atomically instead of serving a stale causal explanation.
        if (affectedEntityIds.length > 0 && await this.tableExists("LearnerGapHypothesis")) {
            await this.execute(`DELETE FROM ${qualifiedTable(this.em, "LearnerGapHypothesis")} WHERE "userId" = ?`, [userId]);
        }
        return { reset: true, userId, affectedEntityIds };
    }
}
