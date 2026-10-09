import type { EntityManager } from "@mikro-orm/core";
import type { MasterySummaryReadRepository } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { nullableReferenceDateValue } from "./date-value.ts";

type Row = Record<string, any>;
const rows = (result: unknown): Row[] => Array.isArray(result) ? result as Row[] : result && typeof result === "object" && "rows" in result && Array.isArray((result as { rows?: unknown }).rows) ? (result as { rows: Row[] }).rows : [];
const table = (em: EntityManager, name: string) => { const schema = em.schema ?? em.config?.getSchema(); const quoted = `"${name.replaceAll('"', '""')}"`; return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted; };
const json = (value: unknown) => typeof value === "string" ? (() => { try { return JSON.parse(value); } catch { return value; } })() : value;
const date = (value: unknown) => nullableReferenceDateValue(value);

export class MikroOrmMasterySummaryReadRepository implements MasterySummaryReadRepository {
  constructor(private readonly em: EntityManager) {}
  private execute(sql: string, params: unknown[] = []) { return this.em.getConnection().execute(sql, params, undefined, this.em.getTransactionContext()); }
  async load(input: { userId: string; goalId: string; moduleId?: string }) {
    const goal = rows(await this.execute(`SELECT "cognitiveModelVersion" FROM ${table(this.em, "LearningGoal")} WHERE "id"=? LIMIT 1`, [input.goalId]))[0]; if (!goal) return null;
    const targetRows = input.moduleId
      ? rows(await this.execute(`SELECT t.*,m."required" AS "mappingRequired",m."weight" AS "mappingWeight" FROM ${table(this.em, "ModuleLearningTarget")} m JOIN ${table(this.em, "LearningTarget")} t ON t."id"=m."learningTargetId" WHERE m."moduleId"=? AND m."role"='exit' ORDER BY m."orderIndex" ASC`, [input.moduleId]))
      : rows(await this.execute(`SELECT t.*,CASE WHEN t."importance"='core' THEN 1 ELSE 0 END AS "mappingRequired",1 AS "mappingWeight" FROM ${table(this.em, "LearningTarget")} t WHERE t."goalId"=? AND t."status"='active' ORDER BY t."stableKey" ASC`, [input.goalId]));
    const targets: any[] = [];
    for (const target of targetRows) {
      const requirements = rows(await this.execute(`SELECT r.*,e."kind",s."id" AS "stateId",s."inferenceVersion" FROM ${table(this.em, "LearningTargetRequirement")} r JOIN ${table(this.em, "CognitiveEntity")} e ON e."id"=r."cognitiveEntityId" LEFT JOIN ${table(this.em, "LearnerEntityState")} s ON s."cognitiveEntityId"=e."id" AND s."userId"=? WHERE r."learningTargetId"=? ORDER BY r."orderIndex" ASC`, [input.userId, target.id]));
      for (const requirement of requirements) { const dimensions = requirement.stateId ? rows(await this.execute(`SELECT "dimension","estimate","evidenceSufficiency","status","lastObservedAt" FROM ${table(this.em, "LearnerDimensionState")} WHERE "learnerEntityStateId"=?`, [requirement.stateId])).map(row => ({ ...row, lastObservedAt: date(row.lastObservedAt) })) : []; requirement.cognitiveEntity = { kind: requirement.kind, learnerStates: requirement.stateId ? [{ inferenceVersion: Number(requirement.inferenceVersion), dimensions }] : [] }; }
      targets.push({ ...target, assessmentCriteria: json(target.assessmentCriteria), required: Boolean(target.mappingRequired), mappingWeight: Number(target.mappingWeight), requirements });
    }
    const ids = targets.map(target => target.id);
    if (!ids.length) return { modelVersion: Number(goal.cognitiveModelVersion), targets, evidenceCutoffAt: null, lifecycleCutoffAt: null, claims: [] };
    const placeholders = ids.map(() => "?").join(",");
    const cutoff = rows(await this.execute(`SELECT MAX("createdAt") AS "createdAt" FROM ${table(this.em, "EvidenceClaim")} WHERE "userId"=? AND "learningTargetId" IN (${placeholders})`, [input.userId, ...ids]))[0];
    const lifecycle = rows(await this.execute(`SELECT MAX(l."createdAt") AS "createdAt" FROM ${table(this.em, "EvidenceLifecycleEvent")} l JOIN ${table(this.em, "EvidenceClaim")} c ON c."id"=l."evidenceClaimId" WHERE c."userId"=? AND c."learningTargetId" IN (${placeholders})`, [input.userId, ...ids]))[0];
    const now = new Date();
    const claims = rows(await this.execute(`SELECT c."learningTargetId",c."cognitiveEntityId",c."dimension",c."contextKey",c."evaluatorReliability",c."groundingReliability",c."createdAt",o."observedAt",o."metadata",a."assistanceLevel",t."taskType",t."origin" FROM ${table(this.em, "EvidenceClaim")} c JOIN ${table(this.em, "TaskObservation")} o ON o."id"=c."observationId" JOIN ${table(this.em, "TaskAttempt")} a ON a."id"=o."attemptId" JOIN ${table(this.em, "LearningTask")} t ON t."id"=a."taskId" WHERE c."userId"=? AND c."learningTargetId" IN (${placeholders}) AND c."status"='active' AND (c."validUntil" IS NULL OR c."validUntil">?)`, [input.userId, ...ids, now])).map(row => ({ learningTargetId: row.learningTargetId, cognitiveEntityId: row.cognitiveEntityId, dimension: row.dimension, contextKey: row.contextKey, evaluatorReliability: Number(row.evaluatorReliability), groundingReliability: Number(row.groundingReliability), createdAt: date(row.createdAt)!, observation: { observedAt: date(row.observedAt)!, metadata: json(row.metadata), attempt: { assistanceLevel: Number(row.assistanceLevel), task: { taskType: row.taskType, origin: row.origin } } } }));
    return { modelVersion: Number(goal.cognitiveModelVersion), targets, evidenceCutoffAt: date(cutoff?.createdAt), lifecycleCutoffAt: date(lifecycle?.createdAt), claims };
  }
}
