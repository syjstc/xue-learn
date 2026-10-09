import type { EntityManager } from "@mikro-orm/core";
import type { UnitSessionStateRepository } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { MikroOrmUnitSessionStateRepository } from "./unit-session.repository.ts";

describe("unit session reference repository", () => {
  it("authorizes the unit, creates state, and preserves omitted active time", async () => {
    const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
    let state: Record<string, unknown> | null = null;
    const manager = {
      schema: "tenant_a",
      getConnection: () => ({
        execute: async (sql: string, params: readonly unknown[] = []) => {
          calls.push({ sql, params });
          if (sql.includes("JOIN") && sql.includes("LearningGoal")) {
            return [{ id: "unit-1" }];
          }
          if (sql.startsWith("SELECT") && sql.includes("UnitSessionState")) {
            return state ? [state] : [];
          }
          if (sql.startsWith("INSERT")) {
            state = {
              id: params[0],
              unitId: params[1],
              currentStep: "structured_input",
              structuredSubStep: "sq",
              graphState: "{}",
              sq3rData: "{}",
              socraticTurn: 0,
              cumulativeActiveSeconds: 0,
              updatedAt: params[2],
            };
            return [];
          }
          if (sql.startsWith("UPDATE") && sql.includes("UnitSessionState")) {
            state = { ...state, graphState: params[0], updatedAt: params[1] };
            return [];
          }
          return [];
        },
      }),
    } as unknown as EntityManager;
    const repository: UnitSessionStateRepository =
      new MikroOrmUnitSessionStateRepository(manager);

    await expect(
      repository.getOrCreateOwned("user-1", "unit-1"),
    ).resolves.toMatchObject({
      unitId: "unit-1",
      cumulativeActiveSeconds: 0,
    });
    await expect(
      repository.updateOwned({
        userId: "user-1",
        unitId: "unit-1",
        patch: { graphState: '{"learningTime":{}}' },
      }),
    ).resolves.toMatchObject({
      graphState: '{"learningTime":{}}',
      cumulativeActiveSeconds: 0,
    });
    expect(
      calls.some((call) => call.sql.includes('"tenant_a"."UnitSessionState"')),
    ).toBe(true);
  });

  it("normalizes SQLite epoch timestamps before quiz submission uses them", async () => {
    const updatedAt = 1_786_687_562_017;
    const manager = {
      getConnection: () => ({
        execute: async (sql: string) => {
          if (sql.includes("JOIN") && sql.includes("LearningGoal")) {
            return [{ id: "unit-1" }];
          }
          if (sql.startsWith("SELECT") && sql.includes("UnitSessionState")) {
            return [
              {
                id: "session-1",
                unitId: "unit-1",
                currentStep: "active_recall",
                structuredSubStep: "done",
                graphState: "{}",
                sq3rData: "{}",
                socraticTurn: 0,
                cumulativeActiveSeconds: 0,
                updatedAt,
              },
            ];
          }
          return [];
        },
      }),
    } as unknown as EntityManager;
    const repository = new MikroOrmUnitSessionStateRepository(manager);

    const session = await repository.getOrCreateOwned("user-1", "unit-1");

    expect(session?.updatedAt.toISOString()).toBe("2026-08-14T06:06:02.017Z");
  });
});
