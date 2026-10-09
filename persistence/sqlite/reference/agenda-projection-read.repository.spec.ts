import type { EntityManager } from "@mikro-orm/core";
import { MikroOrmAgendaProjectionReadRepository } from "./agenda-projection-read.repository.ts";

describe("agenda projection read reference repository", () => {
  it("normalizes SQLite epoch timestamps in agenda items", async () => {
    const completedAt = 1_786_687_500_000;
    const reviewDueAt = 1_786_687_562_017;
    const manager = {
      getConnection: () => ({
        execute: async (sql: string) => {
          if (sql.includes('FROM "AgendaRevision"')) {
            return [
              {
                id: "revision-1",
                capacityMinutes: 30,
                capacityJson: "{}",
                generationSource: "deterministic",
                reason: "daily",
              },
            ];
          }
          if (sql.includes('FROM "AgendaItem"')) {
            return [
              {
                id: "item-1",
                goalId: "goal-1",
                unitId: "unit-1",
                sectionId: null,
                goalTitle: "Goal",
                sectionTitle: null,
                itemType: "review",
                plannedDate: "2026-08-14",
                estimatedMinutes: 15,
                priority: 1,
                explanation: "Review",
                explanationCode: "review_due",
                completedAt,
                reviewDueAt,
                reviewCardId: "review-1",
                cognitiveEntityIds: "[]",
                targetState: "{}",
                expectedEvidence: "{}",
                sortIndex: 0,
              },
            ];
          }
          if (sql.includes('FROM "LearningUnit"')) {
            return [
              {
                id: "unit-1",
                title: "Unit",
                status: "available",
                completedAt: null,
                completionMethod: null,
              },
            ];
          }
          return [];
        },
      }),
    } as unknown as EntityManager;

    const projection = await new MikroOrmAgendaProjectionReadRepository(
      manager,
    ).findActiveProjection("user-1", "2026-08-14");

    expect(projection?.items[0]?.completedAt?.toISOString()).toBe(
      "2026-08-14T06:05:00.000Z",
    );
    expect(projection?.items[0]?.reviewDueAt?.toISOString()).toBe(
      "2026-08-14T06:06:02.017Z",
    );
  });
});
