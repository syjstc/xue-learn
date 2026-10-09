import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { FlashcardDeckRecord, FlashcardExperienceRepository, FlashcardMaterialRecord, FlashcardMutationResult, FlashcardRecord, FlashcardReviewScope, FsrsRating, } from "@xue-learn/core/domain";
import { scheduleReview } from "@xue-learn/core/server/domain/fsrs";
import { nullableReferenceDateValue, referenceDateValue } from "./date-value.ts";
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
function text(row: Row, key: string): string {
    return String(value(row, key) ?? "");
}
function numberValue(row: Row, key: string): number {
    const parsed = Number(value(row, key));
    return Number.isFinite(parsed) ? parsed : 0;
}
function date(row: Row, key: string): Date {
    return referenceDateValue(value(row, key), key);
}
function optionalDate(row: Row, key: string): Date | null {
    return nullableReferenceDateValue(value(row, key), key);
}
function entityKind(row: Row): "atom" | "concept" | "skill" | "competency" {
    const kind = text(row, "entityKind");
    return kind === "concept" || kind === "skill" || kind === "competency"
        ? kind
        : "atom";
}
function table(em: EntityManager, name: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${name.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
export class MikroOrmFlashcardExperienceRepository implements FlashcardExperienceRepository {
    constructor(private readonly em: EntityManager) { }
    private execute(em: EntityManager, sql: string, params: unknown[] = []) {
        return em
            .getConnection()
            .execute(sql, params, undefined, em.getTransactionContext());
    }
    private material(row: Row): FlashcardMaterialRecord | null {
        if (value(row, "materialIntroduction") == null)
            return null;
        return {
            introduction: text(row, "materialIntroduction"),
            sections: text(row, "materialSections"),
            keyTakeaways: text(row, "materialKeyTakeaways"),
            contextSources: text(row, "materialContextSources"),
        };
    }
    private card(row: Row): FlashcardRecord {
        const entityId = text(row, "entityId");
        return {
            id: text(row, "id"),
            deckId: text(row, "deckId"),
            unitId: text(row, "unitId"),
            cognitiveEntityId: text(row, "cognitiveEntityId"),
            front: text(row, "front"),
            back: text(row, "back"),
            anchorJson: text(row, "anchorJson"),
            sourceExcerpt: text(row, "sourceExcerpt"),
            origin: text(row, "origin"),
            sortOrder: numberValue(row, "sortOrder"),
            due: date(row, "due"),
            stability: numberValue(row, "stability"),
            difficulty: numberValue(row, "difficulty"),
            elapsedDays: numberValue(row, "elapsedDays"),
            scheduledDays: numberValue(row, "scheduledDays"),
            reps: numberValue(row, "reps"),
            lapses: numberValue(row, "lapses"),
            state: text(row, "state"),
            lastReview: optionalDate(row, "lastReview"),
            unit: {
                id: text(row, "unitId"),
                goalId: text(row, "goalId"),
                title: text(row, "unitTitle"),
                goal: { id: text(row, "goalId"), title: text(row, "goalTitle") },
                learningMaterial: this.material(row),
            },
            deck: {
                id: text(row, "deckId"),
                cardCount: numberValue(row, "cardCount"),
            },
            cognitiveEntity: entityId
                ? {
                    id: entityId,
                    title: text(row, "entityTitle"),
                    description: text(row, "entityDescription"),
                    kind: entityKind(row),
                    atom: value(row, "atomExplanation") == null
                        ? null
                        : { explanation: text(row, "atomExplanation") },
                }
                : null,
        };
    }
    private cardSelect(em: EntityManager): string {
        return `SELECT c.*, d."cardCount", u."goalId", u."title" AS "unitTitle", g."title" AS "goalTitle",
                   g."userId" AS "ownerUserId", ce."id" AS "entityId", ce."title" AS "entityTitle",
                   ce."description" AS "entityDescription", ce."kind" AS "entityKind", ka."explanation" AS "atomExplanation",
                   lm."introduction" AS "materialIntroduction", lm."sections" AS "materialSections",
                   lm."keyTakeaways" AS "materialKeyTakeaways", lm."contextSources" AS "materialContextSources"
              FROM ${table(em, "FlashCard")} c
              JOIN ${table(em, "FlashCardDeck")} d ON d."id" = c."deckId"
              JOIN ${table(em, "LearningUnit")} u ON u."id" = c."unitId"
              JOIN ${table(em, "LearningGoal")} g ON g."id" = u."goalId"
              LEFT JOIN ${table(em, "CognitiveEntity")} ce ON ce."id" = c."cognitiveEntityId"
              LEFT JOIN ${table(em, "KnowledgeAtom")} ka ON ka."entityId" = ce."id"
              LEFT JOIN ${table(em, "LearningMaterial")} lm ON lm."unitId" = u."id"`;
    }
    async findGenerationContext(userId: string, unitId: string) {
        const base = rows(await this.execute(this.em, `SELECT u."id", u."goalId", u."title" AS "unitTitle",
                g."title" AS "goalTitle", g."level", g."contentLanguage", g."generationOptions",
                lm."introduction", lm."sections", lm."keyTakeaways", lm."contextSources", cn."cues"
           FROM ${table(this.em, "LearningUnit")} u
           JOIN ${table(this.em, "LearningGoal")} g ON g."id" = u."goalId"
           LEFT JOIN ${table(this.em, "LearningMaterial")} lm ON lm."unitId" = u."id"
           LEFT JOIN ${table(this.em, "CornellNote")} cn ON cn."unitId" = u."id"
          WHERE u."id" = ? AND g."userId" = ?`, [unitId, userId]))[0];
        if (!base || value(base, "introduction") == null)
            return null;
        const anchors = rows(await this.execute(this.em, `SELECT lt."id" AS "learningTargetId", lt."title" AS "targetTitle", lt."learningObjective",
                lt."assessmentCriteria", lt."importance", lt."difficulty", lt."targetCognitiveLevel",
                r."cognitiveEntityId", ce."title" AS "entityTitle"
           FROM ${table(this.em, "UnitLearningTarget")} ult
           JOIN ${table(this.em, "LearningTarget")} lt ON lt."id" = ult."learningTargetId"
           JOIN ${table(this.em, "LearningTargetRequirement")} r ON r."learningTargetId" = lt."id"
           JOIN ${table(this.em, "CognitiveEntity")} ce ON ce."id" = r."cognitiveEntityId"
          WHERE ult."unitId" = ? AND lt."goalId" = ? AND lt."status" = 'active'
            AND r."dimension" = 'memory' AND ce."goalId" = ? AND ce."status" = 'active'
          ORDER BY ult."orderIndex", r."orderIndex", r."id"`, [unitId, text(base, "goalId"), text(base, "goalId")])).map((row) => ({
            learningTargetId: text(row, "learningTargetId"),
            targetTitle: text(row, "targetTitle"),
            learningObjective: text(row, "learningObjective"),
            assessmentCriteria: text(row, "assessmentCriteria"),
            importance: text(row, "importance"),
            difficulty: text(row, "difficulty"),
            targetCognitiveLevel: text(row, "targetCognitiveLevel"),
            cognitiveEntityId: text(row, "cognitiveEntityId"),
            entityTitle: text(row, "entityTitle"),
        }));
        return {
            unit: { id: unitId, goalId: text(base, "goalId"), title: text(base, "unitTitle") },
            goal: {
                id: text(base, "goalId"),
                title: text(base, "goalTitle"),
                level: text(base, "level"),
                contentLanguage: text(base, "contentLanguage"),
                generationOptions: text(base, "generationOptions"),
            },
            material: {
                introduction: text(base, "introduction"),
                sections: text(base, "sections"),
                keyTakeaways: text(base, "keyTakeaways"),
                contextSources: text(base, "contextSources"),
            },
            cornellCues: value(base, "cues") == null ? null : text(base, "cues"),
            anchors,
        };
    }
    async replaceGeneratedDeck(input: Parameters<FlashcardExperienceRepository["replaceGeneratedDeck"]>[0]) {
        return this.em.transactional(async (em) => {
            const owner = rows(await this.execute(em, `SELECT u."id" FROM ${table(em, "LearningUnit")} u JOIN ${table(em, "LearningGoal")} g ON g."id" = u."goalId"
            WHERE u."id" = ? AND g."userId" = ?`, [input.unitId, input.userId]))[0];
            if (!owner)
                throw new Error("Unit not found");
            const existing = rows(await this.execute(em, `SELECT "id" FROM ${table(em, "FlashCardDeck")} WHERE "unitId" = ?`, [input.unitId]))[0];
            const deckId = existing ? text(existing, "id") : randomUUID();
            if (existing) {
                await this.execute(em, `DELETE FROM ${table(em, "FlashCard")} WHERE "deckId" = ?`, [deckId]);
            }
            await this.execute(em, `INSERT INTO ${table(em, "FlashCardDeck")} ("id", "unitId", "cardCount", "sourceHash", "generatedAt")
         VALUES (?, ?, ?, ?, ?) ON CONFLICT ("unitId") DO UPDATE SET
           "cardCount" = excluded."cardCount", "sourceHash" = excluded."sourceHash", "generatedAt" = excluded."generatedAt"`, [deckId, input.unitId, input.cards.length, input.sourceHash, input.generatedAt]);
            for (const card of input.cards) {
                await this.execute(em, `INSERT INTO ${table(em, "FlashCard")}
            ("id", "deckId", "unitId", "cognitiveEntityId", "front", "back", "anchorJson", "sourceExcerpt",
             "origin", "sortOrder", "due", "stability", "difficulty", "elapsedDays", "scheduledDays", "reps",
             "lapses", "state", "lastReview", "updatedAt")
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'generated', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [randomUUID(), deckId, input.unitId, card.cognitiveEntityId, card.front, card.back, card.anchorJson,
                    card.sourceExcerpt, card.sortOrder, card.due, card.stability, card.difficulty, card.elapsedDays,
                    card.scheduledDays, card.reps, card.lapses, card.state, card.lastReview, input.generatedAt]);
            }
            return { deckId, cardCount: input.cards.length };
        });
    }
    async getUnitDeck(userId: string, unitId: string) {
        const row = rows(await this.execute(this.em, `SELECT d."id", d."unitId", d."cardCount", d."generatedAt", d."sourceHash",
                lm."introduction", lm."sections", lm."keyTakeaways", lm."contextSources",
                SUM(CASE WHEN c."due" <= ? THEN 1 ELSE 0 END) AS "dueCount",
                SUM(CASE WHEN c."state" = 'New' THEN 1 ELSE 0 END) AS "newCount",
                SUM(CASE WHEN c."state" IN ('Learning', 'Relearning') THEN 1 ELSE 0 END) AS "learningCount",
                COUNT(c."id") AS "totalCount"
           FROM ${table(this.em, "FlashCardDeck")} d
           JOIN ${table(this.em, "LearningUnit")} u ON u."id" = d."unitId"
           JOIN ${table(this.em, "LearningGoal")} g ON g."id" = u."goalId"
           LEFT JOIN ${table(this.em, "LearningMaterial")} lm ON lm."unitId" = u."id"
           LEFT JOIN ${table(this.em, "FlashCard")} c ON c."deckId" = d."id"
          WHERE d."unitId" = ? AND g."userId" = ?
          GROUP BY d."id", d."unitId", d."cardCount", d."generatedAt", d."sourceHash",
                   lm."introduction", lm."sections", lm."keyTakeaways", lm."contextSources"`, [new Date(), unitId, userId]))[0];
        if (!row)
            return null;
        const material = value(row, "introduction") == null ? null : {
            introduction: text(row, "introduction"), sections: text(row, "sections"),
            keyTakeaways: text(row, "keyTakeaways"), contextSources: text(row, "contextSources"),
        };
        return {
            id: text(row, "id"), unitId: text(row, "unitId"), cardCount: numberValue(row, "cardCount"),
            generatedAt: date(row, "generatedAt"), sourceHash: text(row, "sourceHash"), material,
            stats: { due: numberValue(row, "dueCount"), newCount: numberValue(row, "newCount"),
                learning: numberValue(row, "learningCount"), total: numberValue(row, "totalCount") },
        };
    }
    private async ownedCard(em: EntityManager, userId: string, cardId: string, lock = false): Promise<FlashcardMutationResult<FlashcardRecord>> {
        const row = rows(await this.execute(em, `${this.cardSelect(em)} WHERE c."id" = ? ${""}`, [cardId]))[0];
        if (!row)
            return { status: "not_found" };
        if (text(row, "ownerUserId") !== userId)
            return { status: "forbidden" };
        return { status: "ok", value: this.card(row) };
    }
    async findCard(userId: string, cardId: string) {
        return this.ownedCard(this.em, userId, cardId);
    }
    async listDecks(userId: string): Promise<readonly FlashcardDeckRecord[]> {
        const result = await this.execute(this.em, `SELECT d."id", d."unitId", d."generatedAt", d."sourceHash", u."title" AS "unitTitle",
              g."id" AS "goalId", g."title" AS "goalTitle", c."id" AS "cardId", c."due", c."state", c."lastReview",
              lm."introduction" AS "materialIntroduction", lm."sections" AS "materialSections",
              lm."keyTakeaways" AS "materialKeyTakeaways", lm."contextSources" AS "materialContextSources"
         FROM ${table(this.em, "FlashCardDeck")} d JOIN ${table(this.em, "LearningUnit")} u ON u."id" = d."unitId"
         JOIN ${table(this.em, "LearningGoal")} g ON g."id" = u."goalId"
         LEFT JOIN ${table(this.em, "FlashCard")} c ON c."deckId" = d."id"
         LEFT JOIN ${table(this.em, "LearningMaterial")} lm ON lm."unitId" = u."id"
        WHERE g."userId" = ? ORDER BY u."goalId", u."orderIndex", c."sortOrder", c."id"`, [userId]);
        const decks = new Map<string, FlashcardDeckRecord & {
            cards: Array<{
                id: string;
                due: Date;
                state: string;
                lastReview: Date | null;
            }>;
        }>();
        for (const row of rows(result)) {
            const id = text(row, "id");
            let deck = decks.get(id);
            if (!deck) {
                deck = {
                    id,
                    unitId: text(row, "unitId"),
                    unitTitle: text(row, "unitTitle"),
                    goalId: text(row, "goalId"),
                    goalTitle: text(row, "goalTitle"),
                    generatedAt: date(row, "generatedAt"),
                    sourceHash: text(row, "sourceHash"),
                    material: this.material(row),
                    cards: [],
                };
                decks.set(id, deck);
            }
            const cardId = text(row, "cardId");
            if (cardId)
                deck.cards.push({
                    id: cardId,
                    due: date(row, "due"),
                    state: text(row, "state"),
                    lastReview: optionalDate(row, "lastReview"),
                });
        }
        return [...decks.values()];
    }
    async listDeckCards(userId: string, deckId: string) {
        const owner = rows(await this.execute(this.em, `SELECT g."userId" FROM ${table(this.em, "FlashCardDeck")} d JOIN ${table(this.em, "LearningUnit")} u ON u."id" = d."unitId"
       JOIN ${table(this.em, "LearningGoal")} g ON g."id" = u."goalId" WHERE d."id" = ?`, [deckId]))[0];
        if (!owner)
            return { status: "not_found" } as const;
        if (text(owner, "userId") !== userId)
            return { status: "forbidden" } as const;
        const result = await this.execute(this.em, `${this.cardSelect(this.em)} WHERE c."deckId" = ? ORDER BY c."sortOrder", c."id"`, [deckId]);
        return {
            status: "ok",
            value: rows(result).map((row) => this.card(row)),
        } as const;
    }
    async deleteDeck(userId: string, deckId: string) {
        const cards = await this.listDeckCards(userId, deckId);
        if (cards.status !== "ok")
            return cards;
        await this.execute(this.em, `DELETE FROM ${table(this.em, "FlashCardDeck")} WHERE "id" = ?`, [deckId]);
        return { status: "ok", value: { deletedDeckId: deckId } } as const;
    }
    async updateCard(userId: string, cardId: string, front: string, back: string) {
        const owned = await this.ownedCard(this.em, userId, cardId);
        if (owned.status !== "ok")
            return owned;
        await this.execute(this.em, `UPDATE ${table(this.em, "FlashCard")} SET "front" = ?, "back" = ?, "updatedAt" = ? WHERE "id" = ?`, [front, back, new Date(), cardId]);
        return this.ownedCard(this.em, userId, cardId);
    }
    async deleteCard(userId: string, cardId: string) {
        return this.em.transactional(async (em) => {
            const owned = await this.ownedCard(em, userId, cardId, true);
            if (owned.status !== "ok")
                return owned;
            const card = owned.value;
            const remaining = numberValue(rows(await this.execute(em, `SELECT COUNT(*) AS "count" FROM ${table(em, "FlashCard")} WHERE "deckId" = ? AND "id" <> ?`, [card.deckId, cardId]))[0] ?? {}, "count");
            if (remaining === 0) {
                await this.execute(em, `DELETE FROM ${table(em, "FlashCardDeck")} WHERE "id" = ?`, [card.deckId]);
                return {
                    status: "ok",
                    value: {
                        deletedCardId: cardId,
                        deletedDeckId: card.deckId,
                        deckDeleted: true,
                    },
                } as const;
            }
            await this.execute(em, `DELETE FROM ${table(em, "FlashCard")} WHERE "id" = ?`, [cardId]);
            await this.execute(em, `UPDATE ${table(em, "FlashCardDeck")} SET "cardCount" = ? WHERE "id" = ?`, [remaining, card.deckId]);
            return {
                status: "ok",
                value: {
                    deletedCardId: cardId,
                    deletedDeckId: null,
                    deckDeleted: false,
                },
            } as const;
        });
    }
    private scope(scope: FlashcardReviewScope): {
        sql: string;
        params: string[];
    } {
        if (scope.type === "goal")
            return { sql: ` AND g."id" = ?`, params: [scope.goalId] };
        if (scope.type === "unit")
            return { sql: ` AND u."id" = ?`, params: [scope.unitId] };
        return { sql: "", params: [] };
    }
    async countDue(userId: string, scope: FlashcardReviewScope, now: Date) {
        const scoped = this.scope(scope);
        const result = rows(await this.execute(this.em, `SELECT SUM(CASE WHEN c."due" <= ? THEN 1 ELSE 0 END) AS "due",
              SUM(CASE WHEN c."state" = 'New' THEN 1 ELSE 0 END) AS "newCount"
         FROM ${table(this.em, "FlashCard")} c JOIN ${table(this.em, "LearningUnit")} u ON u."id" = c."unitId"
         JOIN ${table(this.em, "LearningGoal")} g ON g."id" = u."goalId" WHERE g."userId" = ?${scoped.sql}`, [now, userId, ...scoped.params]))[0] ?? {};
        return {
            due: numberValue(result, "due"),
            newCount: numberValue(result, "newCount"),
        };
    }
    async listDue(userId: string, scope: FlashcardReviewScope, now: Date, limit: number, offset: number) {
        const scoped = this.scope(scope);
        const params = [userId, now, ...scoped.params];
        const [cardResult, countResult] = await Promise.all([
            this.execute(this.em, `${this.cardSelect(this.em)} WHERE g."userId" = ? AND c."due" <= ?${scoped.sql}
        ORDER BY c."due", c."lapses" DESC, c."id" LIMIT ? OFFSET ?`, [...params, limit, offset]),
            this.execute(this.em, `SELECT COUNT(*) AS "count" FROM ${table(this.em, "FlashCard")} c
        JOIN ${table(this.em, "LearningUnit")} u ON u."id" = c."unitId" JOIN ${table(this.em, "LearningGoal")} g ON g."id" = u."goalId"
        WHERE g."userId" = ? AND c."due" <= ?${scoped.sql}`, params),
        ]);
        return {
            cards: rows(cardResult).map((row) => this.card(row)),
            total: numberValue(rows(countResult)[0] ?? {}, "count"),
        };
    }
    async submitReview(userId: string, cardId: string, rating: FsrsRating, now: Date) {
        return this.em.transactional(async (em) => {
            const owned = await this.ownedCard(em, userId, cardId, true);
            if (owned.status !== "ok")
                return owned;
            const card = owned.value;
            const next = scheduleReview(card, rating, now);
            await this.execute(em, `INSERT INTO ${table(em, "FlashCardReview")} ("id", "cardId", "rating", "reviewedAt") VALUES (?, ?, ?, ?)`, [randomUUID(), cardId, rating, now]);
            await this.execute(em, `UPDATE ${table(em, "FlashCard")} SET "due" = ?, "stability" = ?, "difficulty" = ?,
        "elapsedDays" = ?, "scheduledDays" = ?, "reps" = ?, "lapses" = ?, "state" = ?, "lastReview" = ?, "updatedAt" = ? WHERE "id" = ?`, [
                next.due,
                next.stability,
                next.difficulty,
                next.elapsedDays,
                next.scheduledDays,
                next.reps,
                next.lapses,
                next.state,
                next.lastReview ?? now,
                now,
                cardId,
            ]);
            return this.ownedCard(em, userId, cardId);
        });
    }
}
