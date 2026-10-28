import { resolveLearningPositionInContext } from "@xue-learn/core/server/learning-trajectory/resolve-position";
import type { MainlineResolvedPosition } from "@xue-learn/core/domain";
import { referenceDateValue } from "./date-value.ts";
import { DESKTOP_LOCAL_CAPABILITIES } from "@xue-learn/core/runtime-contracts";
import { deriveLearningAccess } from "@xue-learn/core/server/cognitive-model/learning-access";
import { MainlineConflict, MainlineUnavailable, } from "@xue-learn/core/server/learning-mainline/errors";
import { createHash, randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import { MAINLINE_POLICY, MAINLINE_POLICY_VERSION, selectMainline, parsePrereqs, isUnitJourneyResolved, type LearningMainlineRepository, type LearningPosition, type MainlineActivity, type MainlineCandidate, type MainlineCommand, type MainlineDecisionRequest, type MainlineFocus, type MainlinePreference, type MainlineSnapshot, } from "@xue-learn/core/domain";
import { ensurePersonalSyncCapture } from "@xue-learn/core/server/personal-sync/capture";
import { MikroOrmLearningTrajectoryRepository } from "./learning-trajectory.repository.ts";
type Row = Record<string, unknown>;
const decode = <T>(row: Row): T => JSON.parse(String(row.payload));
export { MainlineConflict, MainlineUnavailable, } from "@xue-learn/core/server/learning-mainline/errors";
export class MikroOrmLearningMainlineRepository implements LearningMainlineRepository {
    constructor(private readonly em: EntityManager) { }
    private table(name: string) {
        const schema = this.em.schema ?? this.em.config?.getSchema();
        return schema ? `"${schema.replaceAll('"', '""')}"."${name}"` : `"${name}"`;
    }
    private async query(sql: string, params: unknown[] = []): Promise<Row[]> {
        const result = await this.em
            .getConnection()
            .execute(sql, params, undefined, this.em.getTransactionContext());
        return Array.isArray(result) ? result : (result?.rows ?? []);
    }
    private key(...parts: string[]) {
        return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
    }
    async resolve(userId: string, activityId: string): Promise<MainlineResolvedPosition | null> {
        const activity = await this.activity(userId, activityId);
        if (!activity)
            return null;
        const owned = (await this.query(`SELECT "id" FROM ${this.table("LearningGoal")} WHERE "id"=? AND "userId"=?`, [activity.goalId, userId])).length > 0;
        const fallback: MainlineResolvedPosition = {
            activityId,
            goalId: owned ? activity.goalId : null,
            position: null,
            exact: false,
            fallback: owned ? "goal" : "goals",
        };
        if (!owned)
            return fallback;
        const context = await new MikroOrmLearningTrajectoryRepository(this.em).context(userId, activity.unitId);
        if (!context)
            return fallback;
        if (activity.kind === "supplement" &&
            !context.sections.some((s) => s.id === activity.position.sectionId))
            return fallback;
        const resolved = resolveLearningPositionInContext(context, activity.position);
        return {
            activityId,
            goalId: activity.goalId,
            position: resolved.position,
            exact: resolved.exact,
            fallback: "position",
        };
    }
    async snapshot(userId: string, sessionId: string): Promise<MainlineSnapshot> {
        const focus = (await this.query(`SELECT * FROM ${this.table("LearningFocus")} WHERE "userId"=? AND "sessionId"=?`, [userId, sessionId]))[0];
        const activities = await this.query(`WITH ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY "goalId" ORDER BY "updatedAt" DESC,"id" DESC) AS goal_rank, ROW_NUMBER() OVER (ORDER BY "updatedAt" DESC,"id" DESC) AS recent_rank FROM ${this.table("LearningActivity")} a WHERE "userId"=? AND EXISTS (SELECT 1 FROM ${this.table("LearningGoal")} g WHERE g."id"=a."goalId" AND g."userId"=a."userId")) SELECT * FROM ranked WHERE recent_rank<=200 OR goal_rank=1 OR "id"=?`, [userId, focus?.activityId ?? ""]);
        const preferences = await this.query(`SELECT * FROM ${this.table("LearningGoalPreference")} WHERE "userId"=?`, [userId]);
        return {
            focus: {
                sessionId,
                // History can outlive a deleted goal; it must not remain resumable.
                activityId: activities.some((a) => a.id === focus?.activityId)
                    ? String(focus!.activityId)
                    : null,
                revision: Number(focus?.revision ?? 0),
            },
            activities: activities
                .map(decode<MainlineActivity>)
                .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) ||
                b.createdAt.localeCompare(a.createdAt) ||
                Number(b.state === "active") - Number(a.state === "active") ||
                b.id.localeCompare(a.id)),
            preferences: preferences.map(decode<MainlinePreference>),
        };
    }
    private async activity(userId: string, id?: string | null) {
        if (!id)
            return null;
        const row = (await this.query(`SELECT * FROM ${this.table("LearningActivity")} WHERE "id"=? AND "userId"=?`, [id, userId]))[0];
        return row ? decode<MainlineActivity>(row) : null;
    }
    private async putActivity(userId: string, activity: MainlineActivity) {
        await this.query(`INSERT INTO ${this.table("LearningActivity")} ("id","userId","goalId","sessionId","payload","updatedAt") VALUES (?,?,?,?,?,?) ON CONFLICT ("id") DO UPDATE SET "payload"=excluded."payload","updatedAt"=excluded."updatedAt"`, [
            activity.id,
            userId,
            activity.goalId,
            activity.sessionId,
            JSON.stringify(activity),
            activity.updatedAt,
        ]);
    }
    private async reconcilePosition(userId: string, activity: MainlineActivity, position: LearningPosition): Promise<LearningPosition> {
        if (position.unitId !== activity.unitId)
            throw new MainlineUnavailable();
        const context = await new MikroOrmLearningTrajectoryRepository(this.em).context(userId, activity.unitId);
        if (!context)
            throw new MainlineUnavailable();
        if (activity.kind === "supplement" &&
            position.sectionId !== activity.position.sectionId)
            throw new MainlineUnavailable();
        if (!position.sectionId ||
            position.sectionId === "legacy-material" ||
            context.sections.some((section) => section.id === position.sectionId))
            return position;
        // Regenerating a Survey replaces section IDs. A stale bookmark must not
        // prevent leaving the unit, but another unit's section is still invalid.
        if (activity.kind === "supplement" ||
            (await this.query(`SELECT "id" FROM ${this.table("UnitSection")} WHERE "id"=?`, [position.sectionId])).length)
            throw new MainlineUnavailable();
        const resolved = resolveLearningPositionInContext(context, position);
        return resolved.position.sectionId
            ? resolved.position
            : {
                version: 1,
                unitId: activity.unitId,
                mode: "reading",
                contentRevision: context.contentRevision,
            };
    }
    async candidates(userId: string): Promise<MainlineCandidate[]> {
        // Read live course and review facts directly. No AgendaItem, allocator or model dependency.
        const units = await this.query(`SELECT u.*,m."unlockStatus",g."status" AS "goalStatus" FROM ${this.table("LearningUnit")} u JOIN ${this.table("LearningGoal")} g ON g."id"=u."goalId" LEFT JOIN ${this.table("LearningModule")} m ON m."id"=u."moduleId" WHERE g."userId"=? ORDER BY m."orderIndex",u."orderIndex",u."id"`, [userId]);
        const done = new Set(units
            .filter((u) => isUnitJourneyResolved(String(u.status)) || Boolean(u.completedAt))
            .map((u) => String(u.id)));
        const result: MainlineCandidate[] = units
            .filter((u) => u.unitKind === "lesson" && !done.has(String(u.id)))
            .map((u, order) => ({
            id: `lesson:${u.id}`,
            goalId: String(u.goalId),
            unitId: String(u.id),
            title: String(u.title),
            kind: "lesson",
            order,
            executable: u.goalStatus === "active" &&
                ["available", "in_progress"].includes(String(u.status)) &&
                u.unlockStatus !== "locked" &&
                parsePrereqs(String(u.prerequisites ?? "[]")).every((id) => done.has(id)),
            preparing: u.unlockStatus !== "locked" &&
                !["available", "in_progress", "locked"].includes(String(u.status)),
            prerequisiteUnitIds: parsePrereqs(String(u.prerequisites ?? "[]")),
            urgency: 0,
            verifiedRelated: false,
            estimatedMinutes: null,
        }));
        const now = Date.now();
        const reviews = await this.query(`SELECT r."id",r."nextReviewAt",u."id" AS "unitId",u."title",u."goalId",g."goalKind",g."learningMode",u."cognitiveModelStatus",u."cognitiveModelBuildInputHash",g."cognitiveModelInputHash",g."cognitiveModelPublishedHash",m."unlockStatus",m."generationStatus",(SELECT COUNT(*) FROM ${this.table("UnitLearningTarget")} ut WHERE ut."unitId"=u."id") AS "targetCount" FROM ${this.table("ReviewCard")} r JOIN ${this.table("LearningUnit")} u ON u."id"=r."unitId" JOIN ${this.table("LearningGoal")} g ON g."id"=u."goalId" LEFT JOIN ${this.table("LearningModule")} m ON m."id"=u."moduleId" WHERE g."userId"=? AND u."unitKind"='lesson'`, [userId]);
        for (const r of reviews) {
            const due = referenceDateValue(r.nextReviewAt, "review due date").getTime();
            if (!Number.isFinite(due) ||
                due > now ||
                r.goalKind === "micro" ||
                r.learningMode === "exploration")
                continue;
            // The normal assessment gate can promote an expanded legacy slice without generation.
            // Both that boundary and unlocked modules require actual persisted targets.
            const access = deriveLearningAccess({
                unitStatus: String(r.cognitiveModelStatus),
                goalInputHash: r.cognitiveModelInputHash == null
                    ? null
                    : String(r.cognitiveModelInputHash),
                goalPublishedHash: r.cognitiveModelPublishedHash == null
                    ? null
                    : String(r.cognitiveModelPublishedHash),
                buildInputHash: r.cognitiveModelBuildInputHash == null
                    ? null
                    : String(r.cognitiveModelBuildInputHash),
                hasCanonicalTargets: Number(r.targetCount) > 0,
                hasCanonicalTargetsFallback: Number(r.targetCount) > 0,
                unitModuleUnlockStatus: r.unlockStatus == null ? null : String(r.unlockStatus),
                unitModuleGenerationStatus: r.generationStatus == null ? null : String(r.generationStatus),
            });
            if (access.assessmentMode !== "ready")
                continue;
            result.push({
                id: `review:${r.id}`,
                goalId: String(r.goalId),
                unitId: String(r.unitId),
                title: String(r.title),
                kind: "review",
                reviewSource: "course",
                executable: true,
                order: 0,
                urgency: now - due > 7 * 86400000 ? 3 : now - due > 86400000 ? 2 : 1,
                verifiedRelated: false,
                estimatedMinutes: null,
            });
        }
        if (process.env.XUELEARN_DESKTOP_LOCAL === "1" &&
            !DESKTOP_LOCAL_CAPABILITIES.flashcards)
            return result;
        const cards = await this.query(`SELECT f."unitId",f."due",f."scheduledDays",u."goalId",u."title" FROM ${this.table("FlashCard")} f JOIN ${this.table("LearningUnit")} u ON u."id"=f."unitId" JOIN ${this.table("LearningGoal")} g ON g."id"=u."goalId" WHERE g."userId"=? AND f."state"!='New'`, [userId]);
        const flash = new Map<string, MainlineCandidate>();
        for (const card of cards) {
            const due = referenceDateValue(card.due, "flashcard due date").getTime();
            if (!Number.isFinite(due) || due > now)
                continue;
            const unitId = String(card.unitId), ratio = (now - due) / (Math.max(1, Number(card.scheduledDays)) * 86400000);
            const urgency = ratio >= 1 ? 3 : ratio >= 0.25 ? 2 : 1;
            const previous = flash.get(unitId);
            flash.set(unitId, {
                id: `flashcards:${unitId}`,
                unitId,
                goalId: String(card.goalId),
                title: String(card.title),
                kind: "review",
                reviewSource: "flashcards",
                executable: true,
                order: 0,
                urgency: Math.max(urgency, previous?.urgency ?? 0),
                verifiedRelated: false,
                estimatedMinutes: null,
            });
        }
        result.push(...flash.values());
        return result;
    }
    async decision(userId: string, request: MainlineDecisionRequest) {
        const snapshot = await this.snapshot(userId, request.sessionId);
        const candidates = await this.candidates(userId);
        const current = await this.activity(userId, snapshot.focus.activityId);
        const records = await this.query(`SELECT * FROM ${this.table("LearningMainlineEvent")} WHERE "userId"=? AND "kind" IN ('shown','later','today') ORDER BY "createdAt" DESC LIMIT 500`, [userId]);
        const now = Date.now();
        let cooldownUntil = 0;
        const shown = new Set<string>();
        for (const r of records) {
            const p = decode<{
                candidateId?: string;
                cooldownUntil?: number;
                snapshotVersion?: string;
            }>(r);
            cooldownUntil = Math.max(cooldownUntil, p.cooldownUntil ?? 0);
            if (r.sessionId === request.sessionId && r.kind === "shown")
                shown.add(p.snapshotVersion ?? String(r.id));
        }
        const goalId = request.goalId ?? current?.goalId;
        const currentCandidate = candidates.find((c) => c.unitId === current?.unitId && c.kind === "lesson");
        for (const c of candidates)
            if (c.kind === "review")
                c.verifiedRelated = Boolean(currentCandidate?.prerequisiteUnitIds?.includes(c.unitId));
        const preparingModules = goalId
            ? await this.query(`SELECT m."id" FROM ${this.table("LearningModule")} m JOIN ${this.table("LearningGoal")} g ON g."id"=m."goalId" WHERE g."id"=? AND g."userId"=? AND m."generationStatus" IN ('pending','building')`, [goalId, userId])
            : [];
        const selected = selectMainline({
            candidates,
            preferences: snapshot.preferences,
            currentGoalId: goalId,
            currentUnitId: current && current.goalId === goalId && current.kind === "lesson"
                ? current.unitId
                : undefined,
            currentPreparing: Boolean(goalId &&
                (preparingModules.length > 0 ||
                    candidates.some((c) => c.goalId === goalId && c.preparing)) &&
                !candidates.some((c) => c.goalId === goalId && c.kind === "lesson" && c.executable)),
            boundary: request.boundary ?? false,
            shownCount: shown.size,
            cooldownUntil,
            now,
            timeLimitMinutes: request.timeLimitMinutes,
        });
        const snapshotVersion = this.key(JSON.stringify({
            candidates,
            preferences: snapshot.preferences,
            focus: snapshot.focus.activityId,
            goalId,
            policy: MAINLINE_POLICY_VERSION,
            timeLimit: request.timeLimitMinutes,
        }));
        return {
            ...selected,
            optional: shown.has(snapshotVersion) ? null : selected.optional,
            policyVersion: MAINLINE_POLICY_VERSION,
            snapshotVersion,
            expiresAt: new Date(now + MAINLINE_POLICY.expiresMs).toISOString(),
        };
    }
    async command(userId: string, command: MainlineCommand): Promise<MainlineSnapshot> {
        return ensurePersonalSyncCapture(() => this.em.transactional(async (tx) => {
            const r = new MikroOrmLearningMainlineRepository(tx);
            // Serialize across all windows of an owner on PostgreSQL; SQLite transactions serialize writers.
            const pg = false;
            if (!(await r.query(`SELECT "id" FROM ${r.table("User")} WHERE "id"=?${""}`, [userId])).length)
                throw new MainlineUnavailable();
            const eventId = r.key(userId, command.commandId);
            const duplicate = (await r.query(`SELECT * FROM ${r.table("LearningMainlineEvent")} WHERE "id"=? AND "userId"=?`, [eventId, userId]))[0];
            const digest = r.key(JSON.stringify(command));
            if (duplicate) {
                if (decode<{
                    digest: string;
                }>(duplicate).digest !== digest)
                    throw new MainlineConflict();
                // Return live state: a delayed retry must never restore an obsolete focus.
                return r.snapshot(userId, command.sessionId);
            }
            const snapshot = await r.snapshot(userId, command.sessionId);
            if (snapshot.focus.revision !== command.expectedRevision)
                throw new MainlineConflict();
            const now = new Date().toISOString();
            const device = process.env.XUELEARN_DESKTOP_LOCAL === "1"
                ? (await r.query(`SELECT "deviceId" FROM ${r.table("PersonalSyncState")} LIMIT 1`))[0]
                : undefined;
            const current = await r.activity(userId, snapshot.focus.activityId);
            const trajectory = new MikroOrmLearningTrajectoryRepository(tx);
            let focus: MainlineFocus = { ...snapshot.focus };
            let cooldownUntil: number | undefined;
            let expiresAt: string | undefined;
            const saveCurrent = async (state: MainlineActivity["state"]) => {
                if (!current)
                    return;
                const position = command.position
                    ? await r.reconcilePosition(userId, current, command.position)
                    : current.position;
                await r.putActivity(userId, {
                    ...current,
                    state,
                    position,
                    revision: current.revision + 1,
                    updatedAt: now,
                });
            };
            if (command.action === "resume") {
                const target = await r.activity(userId, command.activityId);
                if (!target || !(await trajectory.context(userId, target.unitId)))
                    throw new MainlineUnavailable();
                await saveCurrent("paused");
                const resumed: MainlineActivity = {
                    ...target,
                    position: await r.reconcilePosition(userId, target, target.position),
                    id: randomUUID(),
                    sessionId: command.sessionId,
                    sourceActivityId: current?.id ?? null,
                    state: "active",
                    revision: 0,
                    createdAt: now,
                    updatedAt: now,
                };
                if (target.kind === "supplement" && target.branchId) {
                    const branch = await trajectory.branch(userId, target.branchId);
                    if (!branch || branch.status !== "ready")
                        throw new MainlineUnavailable();
                    const visit = await trajectory.enter({
                        userId,
                        branchId: branch.id,
                        visitId: randomUUID(),
                        sessionId: command.sessionId,
                        returnPosition: branch.origin,
                    });
                    resumed.visitId = visit.id;
                }
                await r.putActivity(userId, resumed);
                focus.activityId = resumed.id;
            }
            else if (command.action === "start") {
                if (!command.unitId)
                    throw new MainlineUnavailable();
                const context = await trajectory.context(userId, command.unitId);
                if (!context || (command.goalId && command.goalId !== context.goalId))
                    throw new MainlineUnavailable();
                const kind = command.kind ?? "lesson";
                if (kind === "review" || command.candidateId) {
                    const decision = await r.decision(userId, {
                        sessionId: command.sessionId,
                        boundary: true,
                        timeLimitMinutes: command.timeLimitMinutes,
                    });
                    if (command.snapshotVersion !== decision.snapshotVersion)
                        throw new MainlineConflict();
                    const displays = await r.query(`SELECT "payload" FROM ${r.table("LearningMainlineEvent")} WHERE "userId"=? AND "sessionId"=? AND "kind"='shown'`, [userId, command.sessionId]);
                    const display = displays
                        .map((p) => decode<{
                        snapshotVersion: string;
                        candidateId: string;
                        expiresAt: string;
                    }>(p))
                        .find((p) => p.snapshotVersion === command.snapshotVersion &&
                        p.candidateId === command.candidateId);
                    if (!display ||
                        !Number.isFinite(Date.parse(display.expiresAt)) ||
                        Date.parse(display.expiresAt) <= Date.now())
                        throw new MainlineConflict();
                    const candidate = (await r.candidates(userId)).find((c) => c.id === command.candidateId &&
                        c.unitId === command.unitId &&
                        c.executable &&
                        c.kind === kind &&
                        c.reviewSource === (command.reviewSource ?? "course"));
                    const pref = snapshot.preferences.find((p) => p.goalId === context.goalId);
                    if (!candidate || (kind === "review" && pref?.reviews === false))
                        throw new MainlineUnavailable();
                }
                let supplement: Awaited<ReturnType<typeof trajectory.branch>> = null;
                if (kind === "supplement") {
                    const branch = command.branchId
                        ? await trajectory.branch(userId, command.branchId)
                        : null;
                    if (!branch ||
                        branch.unitId !== command.unitId ||
                        branch.status !== "ready")
                        throw new MainlineUnavailable();
                    supplement = branch;
                }
                await saveCurrent("paused");
                const previous = snapshot.activities.find((a) => a.unitId === command.unitId &&
                    a.kind === kind &&
                    a.branchId === command.branchId);
                const activity: MainlineActivity = {
                    id: randomUUID(),
                    goalId: context.goalId,
                    unitId: context.unitId,
                    title: supplement?.title ?? context.unitTitle,
                    kind,
                    branchId: command.branchId,
                    reviewSource: command.reviewSource,
                    sessionId: command.sessionId,
                    sourceActivityId: current?.id ?? null,
                    returnActivityId: kind === "lesson" ? null : (current?.id ?? null),
                    state: "active",
                    position: previous
                        ? await r.reconcilePosition(userId, previous, previous.position)
                        : {
                            version: 1,
                            unitId: context.unitId,
                            mode: "reading",
                            ...(supplement?.sectionId
                                ? { sectionId: supplement.sectionId }
                                : {}),
                        },
                    revision: 0,
                    createdAt: now,
                    updatedAt: now,
                };
                if (supplement) {
                    const visit = await trajectory.enter({
                        userId,
                        branchId: supplement.id,
                        visitId: randomUUID(),
                        sessionId: command.sessionId,
                        returnPosition: command.position ?? current?.position ?? supplement.origin,
                    });
                    activity.visitId = visit.id;
                }
                await r.putActivity(userId, activity);
                focus.activityId = activity.id;
            }
            else if (["position", "pause", "return"].includes(command.action)) {
                const activity = await r.activity(userId, command.activityId);
                if (!activity ||
                    activity.id !== current?.id ||
                    activity.sessionId !== command.sessionId ||
                    activity.revision !== command.activityRevision)
                    throw new MainlineConflict();
                if (command.action === "return") {
                    const target = await r.activity(userId, activity.returnActivityId);
                    if (!target || !(await trajectory.context(userId, target.unitId)))
                        throw new MainlineUnavailable();
                    await saveCurrent("ended");
                    if (activity.visitId) {
                        const visit = await trajectory.visit(userId, activity.visitId);
                        if (visit)
                            await trajectory.updateVisit({
                                userId,
                                id: visit.id,
                                revision: visit.revision,
                                action: "return",
                            });
                    }
                    // A return creates a new segment and retains the old segment's history.
                    const returned = {
                        ...target,
                        position: await r.reconcilePosition(userId, target, target.position),
                        id: randomUUID(),
                        sessionId: command.sessionId,
                        state: "active" as const,
                        sourceActivityId: activity.id,
                        revision: 0,
                        createdAt: now,
                        updatedAt: now,
                    };
                    await r.putActivity(userId, returned);
                    focus.activityId = returned.id;
                }
                else {
                    if (command.position) {
                        if (activity.kind === "supplement") {
                            const branch = activity.branchId
                                ? await trajectory.branch(userId, activity.branchId)
                                : null;
                            if (!branch?.sectionId ||
                                command.position.sectionId !== branch.sectionId)
                                throw new MainlineUnavailable();
                        }
                    }
                    await saveCurrent(command.action === "pause" ? "paused" : activity.state);
                }
            }
            else if (command.action === "preference") {
                if (!command.goalId ||
                    !command.preference ||
                    !(await r.query(`SELECT "id" FROM ${r.table("LearningGoal")} WHERE "id"=? AND "userId"=?`, [command.goalId, userId])).length)
                    throw new MainlineUnavailable();
                const previous = snapshot.preferences.find((p) => p.goalId === command.goalId);
                if ((previous?.revision ?? 0) !== command.preference.revision)
                    throw new MainlineConflict();
                const pref = {
                    ...command.preference,
                    goalId: command.goalId,
                    revision: command.preference.revision + 1,
                };
                await r.query(`INSERT INTO ${r.table("LearningGoalPreference")} ("id","userId","goalId","payload") VALUES (?,?,?,?) ON CONFLICT ("id") DO UPDATE SET "payload"=excluded."payload"`, [
                    r.key(userId, command.goalId),
                    userId,
                    command.goalId,
                    JSON.stringify(pref),
                ]);
            }
            else {
                const decision = await r.decision(userId, {
                    sessionId: command.sessionId,
                    boundary: true,
                    timeLimitMinutes: command.timeLimitMinutes,
                });
                // Later/today refer to a previously displayed decision; they may still dismiss after expiry.
                if (command.action === "shown") {
                    const repeated = await r.query(`SELECT "payload" FROM ${r.table("LearningMainlineEvent")} WHERE "userId"=? AND "sessionId"=? AND "kind"='shown'`, [userId, command.sessionId]);
                    if (repeated.some((p) => decode<{
                        snapshotVersion: string;
                    }>(p).snapshotVersion ===
                        command.snapshotVersion))
                        throw new MainlineConflict();
                    expiresAt = decision.expiresAt;
                    if (!decision.optional ||
                        decision.optional.id !== command.candidateId ||
                        decision.snapshotVersion !== command.snapshotVersion)
                        throw new MainlineConflict();
                }
                else {
                    const prior = await r.query(`SELECT "payload" FROM ${r.table("LearningMainlineEvent")} WHERE "userId"=? AND "sessionId"=? AND "kind"='shown'`, [userId, command.sessionId]);
                    if (!prior.some((p) => decode<{
                        snapshotVersion: string;
                        candidateId: string;
                    }>(p)
                        .snapshotVersion === command.snapshotVersion &&
                        decode<{
                            candidateId: string;
                        }>(p).candidateId ===
                            command.candidateId))
                        throw new MainlineUnavailable();
                    cooldownUntil = Date.now() + MAINLINE_POLICY.cooldownMs;
                    if (command.action === "today") {
                        const zone = command.timezone ?? "UTC";
                        const formatter = new Intl.DateTimeFormat("en-CA", {
                            timeZone: zone,
                            year: "numeric",
                            month: "2-digit",
                            day: "2-digit",
                        });
                        const today = formatter.format(new Date());
                        // Find the next local calendar boundary, including DST offsets.
                        let next = Date.now();
                        do {
                            next += 60000;
                        } while (formatter.format(new Date(next)) === today);
                        cooldownUntil = Math.max(cooldownUntil, next);
                    }
                }
            }
            focus.revision++;
            await r.query(`INSERT INTO ${r.table("LearningFocus")} ("id","userId","sessionId","activityId","revision") VALUES (?,?,?,?,?) ON CONFLICT ("id") DO UPDATE SET "activityId"=excluded."activityId","revision"=excluded."revision"`, [
                r.key(userId, command.sessionId),
                userId,
                command.sessionId,
                focus.activityId,
                focus.revision,
            ]);
            await r.query(`INSERT INTO ${r.table("LearningMainlineEvent")} ("id","userId","sessionId","kind","payload","createdAt") VALUES (?,?,?,?,?,?)`, [
                eventId,
                userId,
                command.sessionId,
                command.action,
                JSON.stringify({
                    digest,
                    originDeviceId: device?.deviceId ?? null,
                    occurredAt: now,
                    receivedAt: now,
                    sourceActivityId: current?.id ?? null,
                    activityId: focus.activityId,
                    sequence: focus.revision,
                    candidateId: command.candidateId,
                    snapshotVersion: command.snapshotVersion,
                    expiresAt,
                    cooldownUntil,
                }),
                now,
            ]);
            return r.snapshot(userId, command.sessionId);
        }));
    }
}
