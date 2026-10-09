import type { EntityManager } from "@mikro-orm/core";
import { scheduleUnitReview, type DueReviewCardRecord, type DueReviewEntityCandidate, type ReviewExperienceRepository, type ReviewPracticeUnitRecord, type SubmitUnitReviewResult, } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { referenceDateValue } from "./date-value.ts";
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
function stringValue(row: Row, key: string): string {
    return String(value(row, key) ?? "");
}
function nullableNumber(row: Row, key: string): number | null {
    const raw = value(row, key);
    if (raw == null)
        return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
}
function numberValue(row: Row, key: string): number {
    return nullableNumber(row, key) ?? 0;
}
function boolValue(row: Row, key: string): boolean {
    const raw = value(row, key);
    return raw === true || raw === 1 || raw === "1" || raw === "true";
}
function dateValue(row: Row, key: string): Date {
    return referenceDateValue(value(row, key), key);
}
function table(em: EntityManager, name: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${name.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
export class MikroOrmReviewExperienceRepository implements ReviewExperienceRepository {
    constructor(private readonly em: EntityManager) { }
    private execute(em: EntityManager, sql: string, params: unknown[] = []) {
        return em
            .getConnection()
            .execute(sql, params, undefined, em.getTransactionContext());
    }
    async findUnitNotes(userId: string, unitId: string) {
        const found = rows(await this.execute(this.em, `SELECT n."summary", n."cues", n."notes"
           FROM ${table(this.em, "CornellNote")} n
           JOIN ${table(this.em, "LearningUnit")} u ON u."id" = n."unitId"
           JOIN ${table(this.em, "LearningGoal")} g ON g."id" = u."goalId"
          WHERE n."unitId" = ? AND g."userId" = ? LIMIT 1`, [unitId, userId]))[0];
        return found
            ? {
                summary: stringValue(found, "summary"),
                cues: stringValue(found, "cues"),
                notes: stringValue(found, "notes"),
            }
            : null;
    }
    async listDue(userId: string, now: Date): Promise<readonly DueReviewCardRecord[]> {
        const result = await this.execute(this.em, `SELECT rc."id", rc."intervalDays", rc."easeFactor", rc."nextReviewAt", rc."lastGrade",
              u."id" AS "unitId", u."title" AS "unitTitle", g."id" AS "goalId", g."title" AS "goalTitle",
              ce."id" AS "entityId", ce."title" AS "entityTitle", ce."description" AS "entityDescription",
              ka."explanation" AS "atomExplanation", les."estimate", les."evidenceSufficiency",
              les."status" AS "stateStatus", req."gate", req."required", ult."role" AS "mappingRole",
              ult."orderIndex" AS "mappingOrder", req."orderIndex" AS "requirementOrder"
         FROM ${table(this.em, "ReviewCard")} rc
         JOIN ${table(this.em, "LearningUnit")} u ON u."id" = rc."unitId"
         JOIN ${table(this.em, "LearningGoal")} g ON g."id" = u."goalId"
         LEFT JOIN ${table(this.em, "UnitLearningTarget")} ult ON ult."unitId" = u."id"
         LEFT JOIN ${table(this.em, "LearningTarget")} lt
           ON lt."id" = ult."learningTargetId" AND lt."status" = 'active'
         LEFT JOIN ${table(this.em, "LearningTargetRequirement")} req ON req."learningTargetId" = lt."id"
         LEFT JOIN ${table(this.em, "CognitiveEntity")} ce
           ON ce."id" = req."cognitiveEntityId" AND ce."status" = 'active'
         LEFT JOIN ${table(this.em, "KnowledgeAtom")} ka ON ka."entityId" = ce."id"
         LEFT JOIN ${table(this.em, "LearnerEntityState")} les
           ON les."cognitiveEntityId" = ce."id" AND les."userId" = ?
        WHERE g."userId" = ? AND g."status" = 'active' AND rc."nextReviewAt" <= ?
        ORDER BY rc."nextReviewAt" ASC, rc."id" ASC, ult."orderIndex" ASC, req."orderIndex" ASC`, [userId, userId, now]);
        const cards = new Map<string, DueReviewCardRecord & {
            candidates: DueReviewEntityCandidate[];
        }>();
        for (const row of rows(result)) {
            const id = stringValue(row, "id");
            let card = cards.get(id);
            if (!card) {
                card = {
                    id,
                    intervalDays: numberValue(row, "intervalDays"),
                    easeFactor: numberValue(row, "easeFactor"),
                    nextReviewAt: dateValue(row, "nextReviewAt"),
                    lastGrade: nullableNumber(row, "lastGrade"),
                    unitId: stringValue(row, "unitId"),
                    unitTitle: stringValue(row, "unitTitle"),
                    goalId: stringValue(row, "goalId"),
                    goalTitle: stringValue(row, "goalTitle"),
                    candidates: [],
                };
                cards.set(id, card);
            }
            const entityId = stringValue(row, "entityId");
            if (!entityId)
                continue;
            const stateStatus = stringValue(row, "stateStatus");
            card.candidates.push({
                entity: {
                    id: entityId,
                    title: stringValue(row, "entityTitle"),
                    description: stringValue(row, "entityDescription"),
                    atom: value(row, "atomExplanation") == null
                        ? null
                        : { explanation: stringValue(row, "atomExplanation") },
                },
                state: stateStatus
                    ? {
                        estimate: nullableNumber(row, "estimate"),
                        evidenceSufficiency: numberValue(row, "evidenceSufficiency"),
                        status: stateStatus,
                    }
                    : null,
                gate: boolValue(row, "gate"),
                required: boolValue(row, "required"),
                mappingRole: stringValue(row, "mappingRole"),
                mappingOrder: numberValue(row, "mappingOrder"),
                requirementOrder: numberValue(row, "requirementOrder"),
            });
        }
        return [...cards.values()];
    }
    async listPracticeUnits(userId: string, limit: number): Promise<readonly ReviewPracticeUnitRecord[]> {
        const result = await this.execute(this.em, `SELECT u."id", u."title", u."status", g."id" AS "goalId", g."title" AS "goalTitle"
         FROM ${table(this.em, "LearningUnit")} u
         JOIN ${table(this.em, "LearningGoal")} g ON g."id" = u."goalId"
         JOIN ${table(this.em, "CornellNote")} n ON n."unitId" = u."id"
        WHERE g."userId" = ? ORDER BY u."goalId" ASC, u."orderIndex" ASC LIMIT ?`, [userId, limit]);
        return rows(result).map((row) => ({
            id: stringValue(row, "id"),
            title: stringValue(row, "title"),
            status: stringValue(row, "status"),
            goalId: stringValue(row, "goalId"),
            goalTitle: stringValue(row, "goalTitle"),
        }));
    }
    async submitGrade(userId: string, cardId: string, grade: number): Promise<SubmitUnitReviewResult> {
        return this.em.transactional(async (em) => {
            const found = rows(await this.execute(em, `SELECT rc."id", rc."unitId", rc."intervalDays", rc."easeFactor", rc."nextReviewAt", g."userId"
             FROM ${table(em, "ReviewCard")} rc
             JOIN ${table(em, "LearningUnit")} u ON u."id" = rc."unitId"
             JOIN ${table(em, "LearningGoal")} g ON g."id" = u."goalId"
            WHERE rc."id" = ? ${""}`, [cardId]))[0];
            if (!found)
                return { status: "not_found" };
            if (stringValue(found, "userId") !== userId)
                return { status: "forbidden" };
            const next = scheduleUnitReview({
                intervalDays: numberValue(found, "intervalDays"),
                easeFactor: numberValue(found, "easeFactor"),
                nextReviewAt: dateValue(found, "nextReviewAt"),
            }, grade);
            await this.execute(em, `UPDATE ${table(em, "ReviewCard")}
            SET "intervalDays" = ?, "easeFactor" = ?, "nextReviewAt" = ?, "lastGrade" = ?, "updatedAt" = ?
          WHERE "id" = ?`, [
                next.intervalDays,
                next.easeFactor,
                next.nextReviewAt,
                grade,
                new Date(),
                cardId,
            ]);
            return {
                status: "updated",
                card: {
                    id: cardId,
                    unitId: stringValue(found, "unitId"),
                    intervalDays: next.intervalDays,
                    easeFactor: next.easeFactor,
                    nextReviewAt: next.nextReviewAt,
                    lastGrade: grade,
                },
            };
        });
    }
}
