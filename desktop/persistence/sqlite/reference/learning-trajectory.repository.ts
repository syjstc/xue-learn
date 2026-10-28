import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { LearningBranch, LearningBranchDraft, LearningTrajectoryContext, LearningTrajectoryEvent, LearningTrajectoryRepository, LearningVisit, } from "@xue-learn/core/domain";
import { ensurePersonalSyncCapture } from "@xue-learn/core/server/personal-sync/capture";
type Row = Record<string, unknown>;
const rows = (v: unknown): Row[] => Array.isArray(v) ? v : ((v as {
    rows?: Row[];
})?.rows ?? []);
const json = <T>(v: unknown, fallback: T): T => {
    try {
        return typeof v === "string" ? JSON.parse(v) : ((v ?? fallback) as T);
    }
    catch {
        return fallback;
    }
};
const str = (v: unknown): string => (v == null ? "" : String(v));
const nullable = (v: unknown): string | null => (v == null ? null : str(v));
function branch(r: Row): LearningBranch {
    return {
        id: str(r.id),
        unitId: str(r.unitId),
        goalId: str(r.goalId),
        sectionId: nullable(r.sectionId),
        sourceThreadId: nullable(r.sourceThreadId),
        sourceEventId: str(r.sourceEventId),
        origin: json(r.originJson, {} as LearningBranch["origin"]),
        purpose: r.purpose as LearningBranch["purpose"],
        kind: r.kind as LearningBranch["kind"],
        title: str(r.title),
        reason: str(r.reason),
        returnGoal: str(r.returnGoal),
        topics: json(r.topicsJson, []),
        status: r.status as LearningBranch["status"],
        deferred: Number(r.deferred) === 1,
        revision: Number(r.revision),
        generationToken: nullable(r.generationToken),
        transcript: json(r.transcriptJson, []),
        plannedGoalId: nullable(r.plannedGoalId),
        error: str(r.error),
        createdAt: str(r.createdAt),
        updatedAt: str(r.updatedAt),
    };
}
function visit(r: Row): LearningVisit {
    return {
        id: str(r.id),
        unitId: str(r.unitId),
        branchId: str(r.branchId),
        sessionId: str(r.sessionId),
        state: r.state as LearningVisit["state"],
        returnPosition: json(r.returnPositionJson, {} as LearningVisit["returnPosition"]),
        position: json(r.positionJson, null),
        revision: Number(r.revision),
        createdAt: str(r.createdAt),
        updatedAt: str(r.updatedAt),
    };
}
function event(r: Row): LearningTrajectoryEvent {
    return {
        id: str(r.id),
        unitId: str(r.unitId),
        branchId: nullable(r.branchId),
        visitId: nullable(r.visitId),
        threadId: nullable(r.threadId),
        kind: r.kind as LearningTrajectoryEvent["kind"],
        text: str(r.text),
        evidence: json(r.evidenceJson, null),
        position: json(r.positionJson, null),
        createdAt: str(r.createdAt),
    };
}
export class MikroOrmLearningTrajectoryRepository implements LearningTrajectoryRepository {
    constructor(private readonly em: EntityManager) { }
    private table(name: string) {
        const schema = this.em.schema ?? this.em.config?.getSchema();
        return schema ? `"${schema.replaceAll('"', '""')}"."${name}"` : `"${name}"`;
    }
    private async query(sql: string, params: unknown[] = []) {
        return rows(await this.em
            .getConnection()
            .execute(sql, params, undefined, this.em.getTransactionContext()));
    }
    private write<T>(fn: (r: MikroOrmLearningTrajectoryRepository) => Promise<T>): Promise<T> {
        return ensurePersonalSyncCapture(() => this.em.transactional((tx) => fn(new MikroOrmLearningTrajectoryRepository(tx))));
    }
    private async lockUnit(userId: string, unitId: string) {
        const pg = false;
        const found = await this.query(`SELECT u."id" FROM ${this.table("LearningUnit")} u JOIN ${this.table("LearningGoal")} g ON g."id"=u."goalId" WHERE u."id"=? AND g."userId"=?${""}`, [unitId, userId]);
        if (!found.length)
            throw new Error("Learning unit unavailable");
    }
    async context(userId: string, unitId: string): Promise<LearningTrajectoryContext | null> {
        const u = (await this.query(`SELECT u."id",u."goalId",u."title",u."unitKind",u."contentRevision",g."title" AS "goalTitle",g."contentLanguage" FROM ${this.table("LearningUnit")} u JOIN ${this.table("LearningGoal")} g ON g."id"=u."goalId" WHERE u."id"=? AND g."userId"=?`, [unitId, userId]))[0];
        if (!u)
            return null;
        const sections = await this.query(`SELECT s."id",s."title",s."courseRole",s."contentRevision",m."blocks",m."introduction" FROM ${this.table("UnitSection")} s LEFT JOIN ${this.table("UnitSectionMaterial")} m ON m."sectionId"=s."id" WHERE s."unitId"=? ORDER BY s."orderIndex"`, [unitId]);
        const legacy = (await this.query(`SELECT "introduction","sections" FROM ${this.table("LearningMaterial")} WHERE "unitId"=?`, [unitId]))[0];
        return {
            unitId,
            goalId: str(u.goalId),
            unitTitle: str(u.title),
            goalTitle: str(u.goalTitle),
            locale: str(u.contentLanguage) || "zh-Hans",
            unitKind: str(u.unitKind),
            contentRevision: Number(u.contentRevision),
            sections: sections.map((s) => ({
                id: str(s.id),
                title: str(s.title),
                courseRole: str(s.courseRole),
                revision: Number(s.contentRevision),
                blocks: json(s.blocks, []),
                introduction: str(s.introduction),
            })),
            legacy: legacy
                ? {
                    introduction: str(legacy.introduction),
                    blocks: json(legacy.sections, []),
                }
                : null,
        };
    }
    async snapshot(input: Parameters<LearningTrajectoryRepository["snapshot"]>[0]) {
        const scope = input.unitId ? ' AND "unitId"=?' : "";
        const params = input.unitId ? [input.userId, input.unitId] : [input.userId];
        const branches = await this.query(`SELECT * FROM ${this.table("LearningBranch")} WHERE "userId"=?${scope} ORDER BY "createdAt" DESC LIMIT 100`, params);
        const visits = await this.query(`SELECT * FROM ${this.table("LearningVisit")} WHERE "userId"=?${scope} ORDER BY "updatedAt" DESC LIMIT 100`, params);
        const cursor = input.cursor?.split("|");
        const ev = await this.query(`SELECT * FROM ${this.table("LearningTrajectoryEvent")} WHERE "userId"=?${scope}${cursor?.length === 2 ? ' AND ("createdAt" < ? OR ("createdAt" = ? AND "id" < ?))' : ""} ORDER BY "createdAt" DESC,"id" DESC LIMIT ?`, [
            ...params,
            ...(cursor?.length === 2 ? [cursor[0], cursor[0], cursor[1]] : []),
            input.limit + 1,
        ]);
        const page = ev.slice(0, input.limit);
        const last = page.at(-1);
        return {
            branches: branches.map(branch),
            visits: visits.map(visit),
            events: page.map(event),
            nextCursor: ev.length > input.limit && last ? `${last.createdAt}|${last.id}` : null,
        };
    }
    async branch(userId: string, id: string) {
        const r = (await this.query(`SELECT * FROM ${this.table("LearningBranch")} WHERE "id"=? AND "userId"=?`, [id, userId]))[0];
        return r ? branch(r) : null;
    }
    async reserve(userId: string, draft: LearningBranchDraft) {
        return this.write(async (r) => {
            await r.lockUnit(userId, draft.origin.unitId);
            const existing = (await r.query(`SELECT * FROM ${r.table("LearningBranch")} WHERE "userId"=? AND ("sourceEventId"=? OR ("unitId"=? AND "purpose"=? AND "title"=? AND "status" IN ('preparing','ready','proposed'))) ORDER BY "createdAt" DESC LIMIT 1`, [
                userId,
                draft.sourceEventId,
                draft.origin.unitId,
                draft.purpose,
                draft.title,
            ]))[0];
            if (existing)
                return { branch: branch(existing), created: false };
            const context = await r.context(userId, draft.origin.unitId);
            if (!context)
                throw new Error("Learning unit unavailable");
            const now = new Date().toISOString();
            const token = draft.kind === "goal" ? null : randomUUID();
            await r.query(`INSERT INTO ${r.table("LearningBranch")} ("id","userId","goalId","unitId","sourceThreadId","sourceEventId","originJson","purpose","kind","title","reason","returnGoal","topicsJson","status","generationToken","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
                draft.id,
                userId,
                context.goalId,
                context.unitId,
                draft.sourceThreadId,
                draft.sourceEventId,
                JSON.stringify(draft.origin),
                draft.purpose,
                draft.kind,
                draft.title,
                draft.reason,
                draft.returnGoal,
                JSON.stringify(draft.topics),
                draft.kind === "goal" ? "proposed" : "preparing",
                token,
                now,
                now,
            ]);
            await r.appendEventRow(userId, {
                id: `suggestion:${draft.id}`,
                unitId: context.unitId,
                branchId: draft.id,
                visitId: null,
                threadId: draft.sourceThreadId,
                kind: "suggestion",
                text: draft.reason,
                evidence: null,
                position: draft.origin,
            });
            return { branch: (await r.branch(userId, draft.id))!, created: true };
        });
    }
    async claim(userId: string, id: string, revision: number) {
        return this.write(async (r) => {
            const changed = await r.query(`UPDATE ${r.table("LearningBranch")} SET "status"='preparing',"generationToken"=?,"revision"="revision"+1,"error"='',"updatedAt"=? WHERE "id"=? AND "userId"=? AND "revision"=? AND "status" IN ('failed','cancelled') RETURNING *`, [randomUUID(), new Date().toISOString(), id, userId, revision]);
            return changed[0] ? branch(changed[0]) : null;
        });
    }
    async checkpoint(userId: string, id: string, token: string, transcript: unknown[]) {
        return this.write(async (r) => (await r.query(`UPDATE ${r.table("LearningBranch")} SET "transcriptJson"=?,"updatedAt"=? WHERE "id"=? AND "userId"=? AND "generationToken"=? AND "status"='preparing' RETURNING "id"`, [
            JSON.stringify(transcript),
            new Date().toISOString(),
            id,
            userId,
            token,
        ])).length === 1);
    }
    async publish(input: Parameters<LearningTrajectoryRepository["publish"]>[0]) {
        return this.write(async (r) => {
            const b = await r.branch(input.userId, input.id);
            if (!b || b.status !== "preparing" || b.generationToken !== input.token)
                return false;
            await r.lockUnit(input.userId, b.unitId);
            // Claim before writing any material so cancellation wins atomically.
            const changed = await r.query(`UPDATE ${r.table("LearningBranch")} SET "status"='ready',"generationToken"=NULL,"revision"="revision"+1,"transcriptJson"=?,"updatedAt"=? WHERE "id"=? AND "userId"=? AND "generationToken"=? AND "status"='preparing' RETURNING "id"`, [
                JSON.stringify(input.transcript),
                new Date().toISOString(),
                b.id,
                input.userId,
                input.token,
            ]);
            if (!changed.length)
                return false;
            const sectionId = randomUUID(), now = new Date().toISOString();
            const order = (await r.query(`SELECT MIN("orderIndex") AS "minimum" FROM ${r.table("UnitSection")} WHERE "unitId"=?`, [b.unitId]))[0];
            const index = Math.min(0, Number(order?.minimum) || 0) - 1;
            const pg = false;
            await r.query(`INSERT INTO ${r.table("UnitSection")} ("id","unitId","stableKey","orderIndex","title","contentSummary","requiredForCompletion","assessmentAfter","courseRole","generationStatus","testGenerationStatus","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,'ready','skipped',?,?)`, [
                sectionId,
                b.unitId,
                `supplement:${b.id}`,
                index,
                b.title,
                b.returnGoal,
                0,
                0,
                "supplemental",
                now,
                now,
            ]);
            await r.query(`INSERT INTO ${r.table("UnitSectionMaterial")} ("id","sectionId","introduction","blocks","keyTakeaways","contextSources","sourceItems","createdAt","updatedAt") VALUES (?,?,?,?,'[]','[]','[]',?,?)`, [
                randomUUID(),
                sectionId,
                input.introduction,
                JSON.stringify(input.blocks),
                now,
                now,
            ]);
            await r.query(`UPDATE ${r.table("LearningBranch")} SET "sectionId"=? WHERE "id"=?`, [sectionId, b.id]);
            return true;
        });
    }
    async changeBranch(input: Parameters<LearningTrajectoryRepository["changeBranch"]>[0]) {
        return this.write(async (r) => {
            const status = input.action === "cancel"
                ? "cancelled"
                : input.action === "dismiss"
                    ? "dismissed"
                    : null;
            const changed = await r.query(`UPDATE ${r.table("LearningBranch")} SET ${status ? '"status"=?,"generationToken"=NULL,' : ""}"deferred"=?,"revision"="revision"+1,"updatedAt"=? WHERE "id"=? AND "userId"=? AND "revision"=?${input.action === "cancel" ? ` AND "status"='preparing'` : ""} RETURNING *`, [
                ...(status ? [status] : []),
                input.action === "defer" ? 1 : 0,
                new Date().toISOString(),
                input.id,
                input.userId,
                input.revision,
            ]);
            if (!changed[0])
                return null;
            const b = branch(changed[0]);
            if (input.action === "defer" || input.action === "dismiss")
                await r.appendEventRow(input.userId, {
                    id: randomUUID(),
                    unitId: b.unitId,
                    branchId: b.id,
                    visitId: null,
                    threadId: b.sourceThreadId,
                    kind: input.action === "defer" ? "deferred" : "dismissed",
                    text: b.title,
                    evidence: null,
                    position: b.origin,
                });
            return b;
        });
    }
    async fail(userId: string, id: string, token: string, error: string) {
        await this.write(async (r) => {
            await r.query(`UPDATE ${r.table("LearningBranch")} SET "status"='failed',"generationToken"=NULL,"error"=?,"revision"="revision"+1,"updatedAt"=? WHERE "id"=? AND "userId"=? AND "generationToken"=? AND "status"='preparing'`, [error.slice(0, 500), new Date().toISOString(), id, userId, token]);
        });
    }
    async linkPlannedGoal(userId: string, id: string, plannedGoalId: string) {
        return this.write(async (r) => (await r.query(`UPDATE ${r.table("LearningBranch")} SET "plannedGoalId"=?,"revision"="revision"+1,"updatedAt"=? WHERE "id"=? AND "userId"=? AND "kind"='goal' AND "plannedGoalId" IS NULL RETURNING "id"`, [plannedGoalId, new Date().toISOString(), id, userId])).length === 1);
    }
    async visit(userId: string, id: string) {
        const row = (await this.query(`SELECT v.* FROM ${this.table("LearningVisit")} v JOIN ${this.table("LearningUnit")} u ON u."id"=v."unitId" JOIN ${this.table("LearningGoal")} g ON g."id"=u."goalId" WHERE v."id"=? AND v."userId"=? AND g."userId"=?`, [id, userId, userId]))[0];
        return row ? visit(row) : null;
    }
    async enter(input: Parameters<LearningTrajectoryRepository["enter"]>[0]) {
        return this.write(async (r) => {
            const b = await r.branch(input.userId, input.branchId);
            if (!b || b.status !== "ready" || !b.sectionId)
                throw new Error("Supplement unavailable");
            await r.lockUnit(input.userId, b.unitId);
            if (!(await r.context(input.userId, input.returnPosition.unitId)))
                throw new Error("Return position unavailable");
            const existing = (await r.query(`SELECT * FROM ${r.table("LearningVisit")} WHERE "id"=? AND "userId"=?`, [input.visitId, input.userId]))[0];
            if (existing) {
                if (existing.branchId !== b.id)
                    throw new Error("Visit identity conflict");
                return visit(existing);
            }
            const returnContext = await r.context(input.userId, input.returnPosition.unitId);
            if (input.returnPosition.unitId !== b.unitId)
                throw new Error("Return unit does not match supplement");
            const sourceSection = returnContext?.sections.find((s) => s.id === input.returnPosition.sectionId);
            let returnPosition = input.returnPosition;
            if (sourceSection?.courseRole === "supplemental") {
                const sourceVisit = (await r.query(`SELECT * FROM ${r.table("LearningVisit")} WHERE "userId"=? AND "sessionId"=? AND "state"!='returned' ORDER BY "updatedAt" DESC`, [input.userId, input.sessionId]))[0];
                returnPosition = sourceVisit
                    ? visit(sourceVisit).returnPosition
                    : b.origin;
            }
            const previous = (await r.query(`SELECT * FROM ${r.table("LearningVisit")} WHERE "userId"=? AND "branchId"=? ORDER BY "updatedAt" DESC LIMIT 1`, [input.userId, b.id]))[0];
            const now = new Date().toISOString();
            const paused = await r.query(`UPDATE ${r.table("LearningVisit")} SET "state"='paused',"revision"="revision"+1,"updatedAt"=? WHERE "userId"=? AND "sessionId"=? AND "state"='active' RETURNING *`, [now, input.userId, input.sessionId]);
            for (const p of paused)
                await r.appendEventRow(input.userId, {
                    id: randomUUID(),
                    unitId: str(p.unitId),
                    branchId: str(p.branchId),
                    visitId: str(p.id),
                    threadId: null,
                    kind: "paused",
                    text: "",
                    evidence: null,
                    position: json(p.positionJson, null),
                });
            await r.query(`INSERT INTO ${r.table("LearningVisit")} ("id","userId","unitId","branchId","sessionId","state","returnPositionJson","positionJson","createdAt","updatedAt") VALUES (?,?,?,?,?,'active',?,?,?,?)`, [
                input.visitId,
                input.userId,
                b.unitId,
                b.id,
                input.sessionId,
                JSON.stringify(returnPosition),
                previous?.positionJson ?? null,
                now,
                now,
            ]);
            await r.appendEventRow(input.userId, {
                id: `entered:${input.visitId}`,
                unitId: b.unitId,
                branchId: b.id,
                visitId: input.visitId,
                threadId: b.sourceThreadId,
                kind: "entered",
                text: b.title,
                evidence: null,
                position: input.returnPosition,
            });
            return visit((await r.query(`SELECT * FROM ${r.table("LearningVisit")} WHERE "id"=?`, [input.visitId]))[0]);
        });
    }
    async updateVisit(input: Parameters<LearningTrajectoryRepository["updateVisit"]>[0]) {
        return this.write(async (r) => {
            const current = await r.visit(input.userId, input.id);
            if (!current)
                return null;
            if (current.state === "returned" && input.action === "return")
                return current;
            if (input.position) {
                const b = await r.branch(input.userId, current.branchId);
                if (input.position.unitId !== current.unitId ||
                    input.position.sectionId !== b?.sectionId)
                    throw new Error("Position must belong to the visited supplement");
            }
            const state = input.action === "return"
                ? "returned"
                : input.action === "pause"
                    ? "paused"
                    : null;
            const result = await r.query(`UPDATE ${r.table("LearningVisit")} SET ${state ? '"state"=?,' : ""}${input.position ? '"positionJson"=?,' : ""}"revision"="revision"+1,"updatedAt"=? WHERE "id"=? AND "userId"=? AND "revision"=? AND "state" != 'returned' RETURNING *`, [
                ...(state ? [state] : []),
                ...(input.position ? [JSON.stringify(input.position)] : []),
                new Date().toISOString(),
                input.id,
                input.userId,
                input.revision,
            ]);
            if (!result[0])
                return null;
            const v = visit(result[0]);
            if (state)
                await r.appendEventRow(input.userId, {
                    id: `${state}:${v.id}:${v.revision}`,
                    unitId: v.unitId,
                    branchId: v.branchId,
                    visitId: v.id,
                    threadId: null,
                    kind: state === "returned" ? "returned" : "paused",
                    text: "",
                    evidence: null,
                    position: state === "returned" ? v.returnPosition : v.position,
                });
            return v;
        });
    }
    private async appendEventRow(userId: string, e: Omit<LearningTrajectoryEvent, "createdAt">) {
        return ((await this.query(`INSERT INTO ${this.table("LearningTrajectoryEvent")} ("id","userId","unitId","branchId","visitId","threadId","kind","text","evidenceJson","positionJson","createdAt") SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM ${this.table("LearningTrajectoryEvent")} WHERE "id"=?) RETURNING "id"`, [
            e.id,
            userId,
            e.unitId,
            e.branchId,
            e.visitId,
            e.threadId,
            e.kind,
            e.text.slice(0, 4000),
            e.evidence ? JSON.stringify(e.evidence) : null,
            e.position ? JSON.stringify(e.position) : null,
            new Date().toISOString(),
            e.id,
        ])).length === 1);
    }
    async appendEvent(userId: string, e: Omit<LearningTrajectoryEvent, "createdAt">) {
        return this.write(async (r) => {
            await r.lockUnit(userId, e.unitId);
            return r.appendEventRow(userId, e);
        });
    }
    async recoverInterrupted() {
        await this.write(async (r) => {
            await r.query(`UPDATE ${r.table("LearningBranch")} SET "status"='failed',"generationToken"=NULL,"revision"="revision"+1,"updatedAt"=? WHERE "status"='preparing'`, [new Date().toISOString()]);
        });
    }
}
