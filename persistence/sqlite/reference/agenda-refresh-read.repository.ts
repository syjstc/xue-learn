import type { EntityManager } from "@mikro-orm/core";
import type {
  AgendaActiveRevisionRecord,
  AgendaPlanningGapRecord,
  AgendaPlanningGoalRecord,
  AgendaPlanningReviewRecord,
  AgendaPlanningSectionRecord,
  AgendaRefreshReadRepository,
} from "@xue-learn/core/domain";
import { nullableReferenceDateValue, referenceDateValue } from "./date-value.ts";

type Row = Readonly<Record<string, unknown>>;
function rows(result: unknown): readonly Row[] {
  if (Array.isArray(result)) return result as Row[];
  if (result && typeof result === "object" && "rows" in result) {
    const value = (result as { rows?: unknown }).rows;
    return Array.isArray(value) ? (value as Row[]) : [];
  }
  return [];
}
function value(row: Row, key: string): unknown {
  return row[key] ?? row[key[0]?.toLowerCase() + key.slice(1)];
}
function optionalString(row: Row, key: string): string | null {
  const result = value(row, key);
  return result == null ? null : String(result);
}
function numberValue(row: Row, key: string): number {
  const result = Number(value(row, key));
  return Number.isFinite(result) ? result : 0;
}
function dateValue(row: Row, key: string): Date {
  return referenceDateValue(value(row, key), key);
}
function optionalDate(row: Row, key: string): Date | null {
  return nullableReferenceDateValue(value(row, key), key);
}
function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
function stringArray(value: unknown): string[] {
  const parsed = jsonValue(value);
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
}
function objectValue(value: unknown): Record<string, unknown> {
  const parsed = jsonValue(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}
function table(em: EntityManager, name: string): string {
  const schema = em.schema ?? em.config?.getSchema();
  const quoted = `"${name.replaceAll('"', '""')}"`;
  return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}

export class MikroOrmAgendaRefreshReadRepository implements AgendaRefreshReadRepository {
  constructor(private readonly em: EntityManager) {}
  private execute(sql: string, params: unknown[] = []) {
    return this.em.getConnection().execute(sql, params);
  }

  async listOwnedUnitSections(
    userId: string,
    unitIds: readonly string[],
  ): Promise<readonly AgendaPlanningSectionRecord[]> {
    if (unitIds.length === 0) return [];
    const placeholders = unitIds.map(() => "?").join(", ");
    const result = await this.execute(
      `SELECT s."id", s."unitId", s."title", s."orderIndex", s."baseEstimatedMinutes",
              p."status" AS "progressStatus", p."activeSeconds", p."completedAt"
         FROM ${table(this.em, "MainCourseSection")} s
         JOIN ${table(this.em, "LearningUnit")} u ON u."id" = s."unitId"
         JOIN ${table(this.em, "LearningGoal")} g ON g."id" = u."goalId" AND g."userId" = ?
         LEFT JOIN ${table(this.em, "UnitSectionProgress")} p
           ON p."sectionId" = s."id" AND p."userId" = ?
        WHERE s."unitId" IN (${placeholders})
        ORDER BY s."unitId", s."orderIndex" ASC`,
      [userId, userId, ...unitIds],
    );
    return rows(result).map((row) => ({
      id: String(value(row, "id")),
      unitId: String(value(row, "unitId")),
      title: String(value(row, "title")),
      orderIndex: numberValue(row, "orderIndex"),
      baseEstimatedMinutes: numberValue(row, "baseEstimatedMinutes"),
      progress: optionalString(row, "progressStatus")
        ? [
            {
              status: String(value(row, "progressStatus")),
              activeSeconds: numberValue(row, "activeSeconds"),
              completedAt: optionalDate(row, "completedAt"),
            },
          ]
        : [],
    }));
  }

  async readPlanningInputs(input: {
    userId: string;
    activityStart: string;
    planningDate: string;
    windowEnd: Date;
  }) {
    const [
      goalResult,
      unitResult,
      secondsResult,
      activityResult,
      previousResult,
      reviewResult,
      gapResult,
    ] = await Promise.all([
      this.execute(
        `SELECT "id", "title", "contentLanguage" FROM ${table(this.em, "LearningGoal")}
            WHERE "userId" = ? AND "status" = 'active' ORDER BY "createdAt" ASC`,
        [input.userId],
      ),
      this.execute(
        `SELECT u."id", u."goalId", u."title", u."status", u."unitKind", u."parentUnitId",
                  u."orderIndex", u."prerequisites", u."completedAt", u."completionMethod",
                  u."remediationSourceUnitId", u."supportKind", m."unlockStatus"
             FROM ${table(this.em, "LearningUnit")} u
             JOIN ${table(this.em, "LearningGoal")} g ON g."id" = u."goalId"
             LEFT JOIN ${table(this.em, "LearningModule")} m ON m."id" = u."moduleId"
            WHERE g."userId" = ? AND g."status" = 'active'
            ORDER BY u."goalId", u."orderIndex" ASC`,
        [input.userId],
      ),
      this.execute(
        `SELECT u."goalId", COALESCE(SUM(s."cumulativeActiveSeconds"), 0) AS "activeSeconds"
             FROM ${table(this.em, "UnitSessionState")} s
             JOIN ${table(this.em, "LearningUnit")} u ON u."id" = s."unitId"
             JOIN ${table(this.em, "LearningGoal")} g ON g."id" = u."goalId"
            WHERE g."userId" = ? AND g."status" = 'active' GROUP BY u."goalId"`,
        [input.userId],
      ),
      this.execute(
        `SELECT "activeSeconds" FROM ${table(this.em, "LearnerDailyActivity")}
            WHERE "userId" = ? AND "localDate" >= ? AND "localDate" <= ?`,
        [input.userId, input.activityStart, input.planningDate],
      ),
      this.execute(
        `SELECT "capacityMinutes", "contentHash", "planningDate"
             FROM ${table(this.em, "AgendaRevision")}
            WHERE "userId" = ? AND "status" = 'active'
            ORDER BY "activatedAt" DESC, "createdAt" DESC LIMIT 1`,
        [input.userId],
      ),
      this.execute(
        `SELECT r."id", r."nextReviewAt", u."id" AS "unitId", u."title" AS "unitTitle",
                  u."status" AS "unitStatus", g."id" AS "goalId", g."title" AS "goalTitle",
                  req."cognitiveEntityId"
             FROM ${table(this.em, "ReviewCard")} r
             JOIN ${table(this.em, "LearningUnit")} u ON u."id" = r."unitId"
             JOIN ${table(this.em, "LearningGoal")} g ON g."id" = u."goalId"
             LEFT JOIN ${table(this.em, "UnitLearningTarget")} ult ON ult."unitId" = u."id"
             LEFT JOIN ${table(this.em, "LearningTargetRequirement")} req
               ON req."learningTargetId" = ult."learningTargetId"
            WHERE g."userId" = ? AND g."status" = 'active' AND r."nextReviewAt" <= ?
            ORDER BY r."nextReviewAt" ASC LIMIT 500`,
        [input.userId, input.windowEnd],
      ),
      this.execute(
        `SELECT h."id", h."status", h."gapType", h."primaryEntityId", h."supportingEntityIds",
                  h."recommendedAction", h."severity", h."confidence", u."id" AS "unitId",
                  u."goalId", u."title" AS "unitTitle", u."status" AS "unitStatus",
                  g."title" AS "goalTitle", ult."orderIndex" AS "targetOrder"
             FROM ${table(this.em, "LearnerGapHypothesis")} h
             JOIN ${table(this.em, "LearningGoal")} g
               ON g."id" = h."goalId" AND g."status" = 'active'
             LEFT JOIN ${table(this.em, "LearningTargetRequirement")} req
               ON req."cognitiveEntityId" = h."primaryEntityId"
             LEFT JOIN ${table(this.em, "UnitLearningTarget")} ult
               ON ult."learningTargetId" = req."learningTargetId"
             LEFT JOIN ${table(this.em, "LearningUnit")} u ON u."id" = ult."unitId"
            WHERE h."userId" = ? AND h."status" IN ('active', 'testing')
              AND h."primaryEntityId" IS NOT NULL
            ORDER BY h."severity" DESC, h."confidence" DESC, ult."orderIndex" ASC`,
        [input.userId],
      ),
    ]);

    const unitRows = rows(unitResult);
    const unitIds = unitRows.map((row) => String(value(row, "id")));
    const sections = await this.listOwnedUnitSections(input.userId, unitIds);
    const sectionsByUnit = new Map<string, AgendaPlanningSectionRecord[]>();
    for (const section of sections) {
      const list = sectionsByUnit.get(section.unitId) ?? [];
      list.push(section);
      sectionsByUnit.set(section.unitId, list);
    }
    const unitsByGoal = new Map<
      string,
      AgendaPlanningGoalRecord["units"][number][]
    >();
    for (const row of unitRows) {
      const goalId = String(value(row, "goalId"));
      const list = unitsByGoal.get(goalId) ?? [];
      const unlockStatus = optionalString(row, "unlockStatus");
      list.push({
        id: String(value(row, "id")),
        goalId,
        title: String(value(row, "title")),
        status: String(value(row, "status")),
        unitKind: String(value(row, "unitKind")),
        parentUnitId: optionalString(row, "parentUnitId"),
        orderIndex: numberValue(row, "orderIndex"),
        prerequisites: String(value(row, "prerequisites") ?? "[]"),
        completedAt: optionalDate(row, "completedAt"),
        completionMethod: optionalString(row, "completionMethod"),
        module: unlockStatus ? { unlockStatus } : null,
        remediationSourceUnitId: optionalString(row, "remediationSourceUnitId"),
        supportKind: optionalString(row, "supportKind"),
        sections: sectionsByUnit.get(String(value(row, "id"))) ?? [],
      });
      unitsByGoal.set(goalId, list);
    }
    const goals: AgendaPlanningGoalRecord[] = rows(goalResult).map((row) => ({
      id: String(value(row, "id")),
      title: String(value(row, "title")),
      contentLanguage: String(value(row, "contentLanguage")),
      units: unitsByGoal.get(String(value(row, "id"))) ?? [],
    }));

    const reviewMap = new Map<
      string,
      AgendaPlanningReviewRecord & { cognitiveEntityIds: string[] }
    >();
    for (const row of rows(reviewResult)) {
      const id = String(value(row, "id"));
      let review = reviewMap.get(id);
      if (!review) {
        if (reviewMap.size >= 80) continue;
        review = {
          id,
          nextReviewAt: dateValue(row, "nextReviewAt"),
          unitId: String(value(row, "unitId")),
          unitTitle: String(value(row, "unitTitle")),
          unitStatus: String(value(row, "unitStatus")),
          goalId: String(value(row, "goalId")),
          goalTitle: String(value(row, "goalTitle")),
          cognitiveEntityIds: [],
        };
        reviewMap.set(id, review);
      }
      const entityId = optionalString(row, "cognitiveEntityId");
      if (entityId && !review.cognitiveEntityIds.includes(entityId))
        review.cognitiveEntityIds.push(entityId);
    }
    const gapMap = new Map<string, AgendaPlanningGapRecord>();
    for (const row of rows(gapResult)) {
      const id = String(value(row, "id"));
      if (gapMap.has(id) || gapMap.size >= 40) continue;
      const primaryEntityId = optionalString(row, "primaryEntityId");
      if (!primaryEntityId) continue;
      const unitId = optionalString(row, "unitId");
      gapMap.set(id, {
        id,
        status: String(value(row, "status")),
        gapType: String(value(row, "gapType")),
        primaryEntityId,
        supportingEntityIds: stringArray(value(row, "supportingEntityIds")),
        recommendedAction: objectValue(value(row, "recommendedAction")),
        severity: numberValue(row, "severity"),
        confidence: numberValue(row, "confidence"),
        unit: unitId
          ? {
              id: unitId,
              goalId: String(value(row, "goalId")),
              title: String(value(row, "unitTitle")),
              status: String(value(row, "unitStatus")),
              goalTitle: String(value(row, "goalTitle")),
            }
          : null,
      });
    }
    const previousRow = rows(previousResult)[0];
    return {
      goals,
      learningSecondsByGoal: new Map(
        rows(secondsResult).map((row) => [
          String(value(row, "goalId")),
          numberValue(row, "activeSeconds"),
        ]),
      ),
      recentDailyActiveSeconds: rows(activityResult).map((row) =>
        numberValue(row, "activeSeconds"),
      ),
      previous: previousRow
        ? {
            capacityMinutes: numberValue(previousRow, "capacityMinutes"),
            contentHash: String(value(previousRow, "contentHash")),
            planningDate: String(value(previousRow, "planningDate")),
          }
        : null,
      reviews: [...reviewMap.values()],
      gaps: [...gapMap.values()],
    };
  }

  async listInvalidatedUsers(limit: number) {
    const result = await this.execute(
      `SELECT "userId", "timezone"
         FROM ${table(this.em, "LearnerPlanningSettings")}
        WHERE "enabled" = ? AND "agendaInvalidatedAt" IS NOT NULL
        ORDER BY "agendaInvalidatedAt" ASC LIMIT ?`,
      [true, limit],
    );
    return rows(result).map((row) => ({
      userId: String(value(row, "userId")),
      timezone: String(value(row, "timezone")),
    }));
  }

  async listRecentActiveGoalOwners(limit: number): Promise<readonly string[]> {
    const result = await this.execute(
      `SELECT "userId", MAX("updatedAt") AS "latest"
         FROM ${table(this.em, "LearningGoal")}
        WHERE "userId" IS NOT NULL AND "status" = 'active'
        GROUP BY "userId" ORDER BY "latest" DESC LIMIT ?`,
      [limit],
    );
    return rows(result).map((row) => String(value(row, "userId")));
  }

  async findActiveRevision(
    userId: string,
    planningDate: string,
  ): Promise<AgendaActiveRevisionRecord | null> {
    const result = await this.execute(
      `SELECT "id", "contentHash", "generationSource"
         FROM ${table(this.em, "AgendaRevision")}
        WHERE "userId" = ? AND "planningDate" = ? AND "status" = 'active'
        ORDER BY "activatedAt" DESC, "createdAt" DESC LIMIT 1`,
      [userId, planningDate],
    );
    const row = rows(result)[0];
    return row
      ? {
          id: String(value(row, "id")),
          contentHash: String(value(row, "contentHash")),
          generationSource: String(value(row, "generationSource")),
        }
      : null;
  }
}
