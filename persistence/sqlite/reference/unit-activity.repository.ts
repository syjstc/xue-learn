import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { TouchUnitActivityInput, TouchUnitActivityResult, UnitActivityRepository, } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { localDateKey } from "@xue-learn/core/source/libs/server/src/agenda/timezone.ts";
type ValueRow = Readonly<Record<string, unknown>>;
type UnitLearningTimeState = {
    totalActiveSeconds: number;
    lastTickAt?: string;
    byTab?: Record<string, number>;
};
type ActivityGraphState = {
    learningTime?: UnitLearningTimeState;
    materialPresentation?: {
        slideIndex: number;
        hasCompletedSlides: boolean;
        sectionSteps?: Record<string, number>;
        sectionCursors?: Record<string, {
            contentRevision: number;
            cursor: number;
        }>;
    };
    [key: string]: unknown;
};
const MAX_LEARNING_TIME_DELTA_SECONDS = 90;
function parseGraphState(raw: string): ActivityGraphState {
    try {
        const parsed = JSON.parse(raw) as unknown;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as ActivityGraphState)
            : {};
    }
    catch {
        return {};
    }
}
function parseUnitLearningTime(graphState: ActivityGraphState): Required<Pick<UnitLearningTimeState, "totalActiveSeconds" | "byTab">> & Pick<UnitLearningTimeState, "lastTickAt"> {
    const raw = graphState.learningTime;
    const byTab: Record<string, number> = {};
    if (raw?.byTab && typeof raw.byTab === "object") {
        for (const [key, value] of Object.entries(raw.byTab)) {
            if (typeof value === "number" && Number.isFinite(value) && value > 0) {
                byTab[key] = Math.floor(value);
            }
        }
    }
    return {
        totalActiveSeconds: Math.max(0, Math.floor(raw?.totalActiveSeconds ?? 0)),
        lastTickAt: typeof raw?.lastTickAt === "string" ? raw.lastTickAt : undefined,
        byTab,
    };
}
function accumulateUnitLearningTime(current: ReturnType<typeof parseUnitLearningTime>, deltaSeconds: number, now: Date, tab?: string) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
        return { next: current, acceptedSeconds: 0 };
    }
    let accepted = Math.min(Math.floor(deltaSeconds), MAX_LEARNING_TIME_DELTA_SECONDS);
    if (current.lastTickAt) {
        const wallSeconds = Math.floor((now.getTime() - new Date(current.lastTickAt).getTime()) / 1000);
        if (wallSeconds >= 0)
            accepted = Math.min(accepted, wallSeconds + 5);
    }
    if (accepted <= 0)
        return { next: current, acceptedSeconds: 0 };
    const byTab = { ...current.byTab };
    const normalizedTab = tab?.trim();
    if (normalizedTab) {
        byTab[normalizedTab] = (byTab[normalizedTab] ?? 0) + accepted;
    }
    return {
        next: {
            totalActiveSeconds: current.totalActiveSeconds + accepted,
            lastTickAt: now.toISOString(),
            byTab,
        },
        acceptedSeconds: accepted,
    };
}
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
function rowValue(row: ValueRow, key: string): unknown {
    return row[key] ?? row[key[0]?.toLowerCase() + key.slice(1)];
}
function stringValue(value: unknown, fallback = ""): string {
    return typeof value === "string" ? value : fallback;
}
function numberValue(value: unknown, fallback = 0): number {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}
function qualifiedTable(em: EntityManager, table: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${table.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
function toActivityResult(totalActiveSeconds: unknown, acceptedActiveSeconds: number): TouchUnitActivityResult {
    return {
        totalActiveSeconds: numberValue(totalActiveSeconds),
        acceptedActiveSeconds,
    };
}
/**
 * Raw-SQL adapter for the atomic learner activity heartbeat. It deliberately
 * owns the session, daily rollup, and section-progress writes together so a
 * time flush cannot update only one of those projections.
 */
export class MikroOrmUnitActivityRepository implements UnitActivityRepository {
    constructor(private readonly em: EntityManager) { }
    async touchOwned(input: TouchUnitActivityInput): Promise<TouchUnitActivityResult> {
        return this.em.transactional((tx) => this.touchInTransaction(tx, input));
    }
    private async touchInTransaction(em: EntityManager, input: TouchUnitActivityInput): Promise<TouchUnitActivityResult> {
        const unitTable = qualifiedTable(em, "LearningUnit");
        const goalTable = qualifiedTable(em, "LearningGoal");
        const settingsTable = qualifiedTable(em, "LearnerPlanningSettings");
        const sessionTable = qualifiedTable(em, "UnitSessionState");
        const sectionTable = qualifiedTable(em, "MainCourseSection");
        const progressTable = qualifiedTable(em, "UnitSectionProgress");
        const dailyTable = qualifiedTable(em, "LearnerDailyActivity");
        const connection = em.getConnection();
        const execute = (sql: string, params: unknown[] = []) => connection.execute(sql, params, undefined, em.getTransactionContext());
        const now = new Date();
        const ownerRows = resultRows(await execute(`SELECT g."userId", COALESCE(ps."timezone", ?) AS "timezone"
           FROM ${unitTable} u
           JOIN ${goalTable} g ON g."id" = u."goalId"
           LEFT JOIN ${settingsTable} ps ON ps."userId" = g."userId"
          WHERE u."id" = ? AND g."userId" = ?
          LIMIT 1`, ["Asia/Shanghai", input.unitId, input.userId]));
        const owner = ownerRows[0];
        if (!owner)
            throw new Error("Unit session not found");
        await execute(`INSERT INTO ${sessionTable} ("id", "unitId", "updatedAt")
       VALUES (?, ?, ?)
       ON CONFLICT ("unitId") DO NOTHING`, [randomUUID(), input.unitId, now]);
        const sessionRows = resultRows(await execute(`SELECT s."graphState", s."structuredSubStep",
                s."cumulativeActiveSeconds"
           FROM ${sessionTable} s
          WHERE s."unitId" = ?
          ${""}`, [input.unitId]));
        const session = sessionRows[0];
        if (!session)
            throw new Error("Unit session not found");
        const graphState = parseGraphState(stringValue(rowValue(session, "graphState"), "{}"));
        const learningTime = parseUnitLearningTime(graphState);
        let nextLearningTime = learningTime;
        let acceptedSeconds = 0;
        if (typeof input.activeSeconds === "number" &&
            Number.isFinite(input.activeSeconds) &&
            input.activeSeconds > 0) {
            const accumulated = accumulateUnitLearningTime(learningTime, input.activeSeconds, now, input.tab);
            nextLearningTime = accumulated.next;
            acceptedSeconds = accumulated.acceptedSeconds;
        }
        const nextGraph = {
            ...graphState,
            lastActivityAt: now.toISOString(),
            learningTime: nextLearningTime,
        };
        if (typeof input.slideIndex === "number" ||
            typeof input.hasCompletedSlides === "boolean" ||
            input.sectionSteps !== undefined ||
            typeof input.sectionCursor === "number") {
            const sectionCursors = {
                ...(graphState.materialPresentation?.sectionCursors ?? {}),
            };
            const sectionId = input.sectionId?.trim();
            if (sectionId &&
                typeof input.sectionCursor === "number" &&
                Number.isFinite(input.sectionCursor) &&
                input.sectionCursor >= 1 &&
                typeof input.sectionContentRevision === "number" &&
                Number.isFinite(input.sectionContentRevision) &&
                input.sectionContentRevision >= 0) {
                const contentRevision = Math.floor(input.sectionContentRevision);
                const cursor = Math.floor(input.sectionCursor);
                const current = sectionCursors[sectionId];
                sectionCursors[sectionId] = {
                    contentRevision,
                    cursor: current?.contentRevision === contentRevision
                        ? Math.max(current.cursor, cursor)
                        : cursor,
                };
            }
            nextGraph.materialPresentation = {
                slideIndex: typeof input.slideIndex === "number"
                    ? Math.max(0, input.slideIndex)
                    : (graphState.materialPresentation?.slideIndex ?? 0),
                hasCompletedSlides: Boolean(input.hasCompletedSlides ??
                    graphState.materialPresentation?.hasCompletedSlides),
                sectionSteps: input.sectionSteps ??
                    graphState.materialPresentation?.sectionSteps ??
                    {},
                sectionCursors,
            };
        }
        const tab = input.tab?.trim();
        const structuredSubStep = new Set([
            "sq",
            "material",
            "cornell",
            "done",
        ]).has(tab ?? "")
            ? tab
            : undefined;
        await execute(`UPDATE ${sessionTable}
          SET "graphState" = ?,
              "updatedAt" = ?,
              "structuredSubStep" = COALESCE(?, "structuredSubStep"),
              "cumulativeActiveSeconds" = "cumulativeActiveSeconds" + ?
        WHERE "unitId" = ?`, [
            JSON.stringify(nextGraph),
            now,
            structuredSubStep ?? null,
            acceptedSeconds,
            input.unitId,
        ]);
        if (acceptedSeconds <= 0) {
            return toActivityResult(rowValue(session, "cumulativeActiveSeconds"), acceptedSeconds);
        }
        const userId = stringValue(rowValue(owner, "userId"), input.userId);
        const timezone = stringValue(rowValue(owner, "timezone"), "Asia/Shanghai");
        const localDate = localDateKey(now, timezone);
        await execute(`INSERT INTO ${dailyTable} AS d
        ("id", "userId", "localDate", "activeSeconds", "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT ("userId", "localDate") DO UPDATE SET
         "activeSeconds" = d."activeSeconds" + excluded."activeSeconds",
         "updatedAt" = excluded."updatedAt"`, [randomUUID(), userId, localDate, acceptedSeconds, now, now]);
        if (input.sectionId) {
            const sectionRows = resultRows(await execute(`SELECT s."id"
             FROM ${sectionTable} s
             JOIN ${unitTable} u ON u."id" = s."unitId"
             JOIN ${goalTable} g ON g."id" = u."goalId"
            WHERE s."id" = ? AND s."unitId" = ? AND g."userId" = ?
            LIMIT 1`, [input.sectionId, input.unitId, userId]));
            if (sectionRows.length > 0) {
                const progressRows = resultRows(await execute(`SELECT "id", "status", "startedAt"
               FROM ${progressTable}
              WHERE "userId" = ? AND "sectionId" = ?
              LIMIT 1`, [userId, input.sectionId]));
                const progress = progressRows[0];
                const status = stringValue(rowValue(progress ?? {}, "status"));
                const isTerminal = status === "completed" || status === "skipped";
                if (progress) {
                    await execute(`UPDATE ${progressTable}
                SET "activeSeconds" = "activeSeconds" + ?,
                    "status" = ?,
                    "startedAt" = ?,
                    "updatedAt" = ?
              WHERE "id" = ?`, [
                        acceptedSeconds,
                        isTerminal ? status : "in_progress",
                        isTerminal
                            ? (rowValue(progress, "startedAt") ?? null)
                            : (rowValue(progress, "startedAt") ?? now),
                        now,
                        rowValue(progress, "id"),
                    ]);
                }
                else {
                    await execute(`INSERT INTO ${progressTable}
              ("id", "userId", "sectionId", "status", "activeSeconds", "startedAt", "updatedAt")
             VALUES (?, ?, ?, 'in_progress', ?, ?, ?)`, [randomUUID(), userId, input.sectionId, acceptedSeconds, now, now]);
                }
            }
        }
        return toActivityResult(numberValue(rowValue(session, "cumulativeActiveSeconds")) +
            acceptedSeconds, acceptedSeconds);
    }
}
