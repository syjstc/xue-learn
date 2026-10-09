import type { EntityManager } from "@mikro-orm/core";
import type { QuizSessionRepository } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { referenceDateValue } from "./date-value.ts";

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

function table(em: EntityManager, name: string): string {
  const schema = em.schema ?? em.config?.getSchema();
  const quoted = `"${name.replaceAll('"', '""')}"`;
  return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}

export class MikroOrmQuizSessionRepository implements QuizSessionRepository {
  constructor(private readonly em: EntityManager) {}

  private execute(sql: string, params: unknown[] = []) {
    return this.em
      .getConnection()
      .execute(sql, params, undefined, this.em.getTransactionContext());
  }

  private async owned(userId: string, unitId: string): Promise<boolean> {
    return rows(
      await this.execute(
        `SELECT u."id" FROM ${table(this.em, "LearningUnit")} u
          JOIN ${table(this.em, "LearningGoal")} g ON g."id" = u."goalId"
         WHERE u."id" = ? AND g."userId" = ?`,
        [unitId, userId],
      ),
    ).length === 1;
  }

  async findOwnedUnit(input: { userId: string; unitId: string }) {
    const row = rows(
      await this.execute(
        `SELECT u."goalId", u."title" FROM ${table(this.em, "LearningUnit")} u
          JOIN ${table(this.em, "LearningGoal")} g ON g."id" = u."goalId"
         WHERE u."id" = ? AND g."userId" = ?`,
        [input.unitId, input.userId],
      ),
    )[0];
    return row
      ? { goalId: String(value(row, "goalId")), title: String(value(row, "title")) }
      : null;
  }

  async listQuizSets(input: { userId: string; unitId: string }) {
    if (!(await this.owned(input.userId, input.unitId))) return [];
    const result = rows(
      await this.execute(
        `SELECT s."id", s."questions", s."createdAt", a."score", a."createdAt" AS "attemptCreatedAt"
           FROM ${table(this.em, "QuizSet")} s
           LEFT JOIN ${table(this.em, "QuizAttempt")} a ON a."quizSetId" = s."id"
          WHERE s."unitId" = ? AND s."purpose" <> 'course_production' ORDER BY s."createdAt" DESC, a."createdAt" DESC`,
        [input.unitId],
      ),
    );
    const grouped = new Map<string, { row: Row; attempts: Array<{ score: number; at: Date }> }>();
    for (const row of result) {
      const id = String(value(row, "id"));
      const entry = grouped.get(id) ?? { row, attempts: [] };
      if (value(row, "attemptCreatedAt") != null) {
        entry.attempts.push({
          score: Number(value(row, "score")),
          at: referenceDateValue(
            value(row, "attemptCreatedAt"),
            "quiz attempt createdAt",
          ),
        });
      }
      grouped.set(id, entry);
    }
    return [...grouped.values()].map(({ row, attempts }) => {
      let questions: Array<{ type?: string; question?: string }> = [];
      try {
        const parsed = JSON.parse(String(value(row, "questions") ?? "[]"));
        questions = Array.isArray(parsed)
          ? parsed
          : [...(Array.isArray(parsed?.questions) ? parsed.questions : []), ...(Array.isArray(parsed?.interleaved) ? parsed.interleaved : [])];
      } catch {
        // Corrupt legacy quiz sets remain visible with an empty summary.
      }
      const first = String(questions[0]?.question ?? "（无题目）").replace(/\s+/g, " ").trim();
      const scores = attempts.map((attempt) => attempt.score);
      return {
        id: String(value(row, "id")),
        createdAt: referenceDateValue(
          value(row, "createdAt"),
          "quiz set createdAt",
        ).toISOString(),
        questionCount: questions.length,
        typeCounts: {
          mcq: questions.filter((question) => question.type === "mcq").length,
          mcq_multi: questions.filter((question) => question.type === "mcq_multi").length,
          true_false: questions.filter((question) => question.type === "true_false").length,
        },
        preview: first.length > 72 ? `${first.slice(0, 72)}…` : first,
        attemptCount: attempts.length,
        bestScore: scores.length ? Math.max(...scores) : null,
        latestScore: attempts[0]?.score ?? null,
        latestAttemptAt: attempts[0]?.at.toISOString() ?? null,
      };
    });
  }

  async findAttemptExplanations(input: {
    userId: string;
    unitId: string;
    quizSetId: string;
    attemptId: string;
  }): Promise<string | null> {
    if (!(await this.owned(input.userId, input.unitId))) return null;
    const row = rows(
      await this.execute(
        `SELECT "explanations" FROM ${table(this.em, "QuizAttempt")}
          WHERE "id" = ? AND "unitId" = ?`,
        [input.attemptId, input.unitId],
      ),
    )[0];
    return row ? String(value(row, "explanations") ?? "{}") : null;
  }

  async listLearningSetQuestions(input: { userId: string; unitId: string }) {
    if (!(await this.owned(input.userId, input.unitId))) return [];
    return rows(
      await this.execute(
        `SELECT "questions" FROM ${table(this.em, "QuizSet")}
          WHERE "unitId" = ? AND "purpose" = 'learning'
          ORDER BY "createdAt", "id"`,
        [input.unitId],
      ),
    ).map((row) => String(value(row, "questions") ?? "{}"));
  }

  async getRecallStats(input: { userId: string; unitId: string }) {
    if (!(await this.owned(input.userId, input.unitId))) {
      return { completedBatches: 0, totalAnswers: 0 };
    }
    const attempts = rows(
      await this.execute(
        `SELECT a."questions", a."quizSetId"
           FROM ${table(this.em, "QuizAttempt")} a
           JOIN ${table(this.em, "QuizSet")} s ON s."id" = a."quizSetId"
          WHERE s."unitId" = ? AND s."purpose" = 'learning'`,
        [input.unitId],
      ),
    );
    const sets = new Set<string>();
    let totalAnswers = 0;
    for (const attempt of attempts) {
      sets.add(String(value(attempt, "quizSetId")));
      try {
        const parsed = JSON.parse(String(value(attempt, "questions") ?? "[]"));
        totalAnswers += Array.isArray(parsed) ? parsed.length : 0;
      } catch {
        // Corrupt legacy attempts contribute no answer count.
      }
    }
    return { completedBatches: sets.size, totalAnswers };
  }

  async findQuizSetDetail(input: {
    userId: string;
    unitId: string;
    quizSetId: string;
  }) {
    if (!(await this.owned(input.userId, input.unitId))) return null;
    const result = rows(
      await this.execute(
        `SELECT s."id", s."questions", s."createdAt",
                a."id" AS "attemptId", a."quizSetId", a."score",
                a."weakTags", a."answers", a."results", a."explanations",
                a."createdAt" AS "attemptCreatedAt"
           FROM ${table(this.em, "QuizSet")} s
           LEFT JOIN ${table(this.em, "QuizAttempt")} a ON a."quizSetId" = s."id"
          WHERE s."id" = ? AND s."unitId" = ? AND s."purpose" <> 'course_production'
          ORDER BY a."createdAt" DESC`,
        [input.quizSetId, input.unitId],
      ),
    );
    const first = result[0];
    if (!first) return null;
    return {
      id: String(value(first, "id")),
      questionsJson: String(value(first, "questions") ?? "{}"),
      createdAt: referenceDateValue(
        value(first, "createdAt"),
        "quiz set createdAt",
      ),
      attempts: result.flatMap((row) =>
        value(row, "attemptId") == null
          ? []
          : [{
              id: String(value(row, "attemptId")),
              quizSetId:
                value(row, "quizSetId") == null
                  ? null
                  : String(value(row, "quizSetId")),
              score: Number(value(row, "score")),
              weakTagsJson: String(value(row, "weakTags") ?? "[]"),
              answersJson: String(value(row, "answers") ?? "{}"),
              resultsJson: String(value(row, "results") ?? "[]"),
              explanationsJson: String(value(row, "explanations") ?? "{}"),
              createdAt: referenceDateValue(
                value(row, "attemptCreatedAt"),
                "quiz attempt createdAt",
              ),
            }],
      ),
    };
  }

  async saveAttemptExplanation(input: {
    userId: string;
    unitId: string;
    attemptId: string;
    questionIndex: number;
    explanation: string;
  }) {
    if (!(await this.owned(input.userId, input.unitId))) return null;
    const row = rows(
      await this.execute(
        `SELECT "explanations" FROM ${table(this.em, "QuizAttempt")}
          WHERE "id" = ? AND "unitId" = ? LIMIT 1`,
        [input.attemptId, input.unitId],
      ),
    )[0];
    if (!row) return null;
    let explanations: Record<number, string> = {};
    try {
      const parsed = JSON.parse(String(value(row, "explanations") ?? "{}"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        explanations = Object.fromEntries(
          Object.entries(parsed).flatMap(([key, item]) =>
            typeof item === "string" && Number.isInteger(Number(key))
              ? [[Number(key), item]]
              : [],
          ),
        );
      }
    } catch {
      // Replace a corrupt legacy explanation envelope with the valid update.
    }
    explanations[input.questionIndex] = input.explanation;
    await this.execute(
      `UPDATE ${table(this.em, "QuizAttempt")} SET "explanations" = ?
        WHERE "id" = ? AND "unitId" = ?`,
      [JSON.stringify(explanations), input.attemptId, input.unitId],
    );
    return explanations;
  }

  async publishGenerated(input: {
    userId: string;
    unitId: string;
    quizSetId: string;
    questionsJson: string;
    graphState: string;
  }): Promise<{ quizSetId: string }> {
    if (!(await this.owned(input.userId, input.unitId))) {
      throw new Error("Unit not found");
    }
    const quizSetId = input.quizSetId;
    await this.execute(
      `INSERT INTO ${table(this.em, "QuizSet")}
        ("id", "unitId", "questions", "purpose") VALUES (?, ?, ?, 'learning')`,
      [quizSetId, input.unitId, input.questionsJson],
    );
    await this.execute(
      `UPDATE ${table(this.em, "UnitSessionState")}
          SET "graphState" = ?, "currentStep" = 'active_recall',
              "structuredSubStep" = 'done' WHERE "unitId" = ?`,
      [input.graphState, input.unitId],
    );
    return { quizSetId };
  }
}
