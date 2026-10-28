import { DatabaseSync } from "node:sqlite";
import type { EntityManager } from "@mikro-orm/core";

import { migrateElectronLearningSchema } from "../learning-schema.ts";
import { MikroOrmDeepPlanningResearchRepository } from "./deep-planning-research.repository.ts";

class SqlitePlatform {}

function returnsRows(sql: string): boolean {
  return /^\s*(?:SELECT|PRAGMA)\b/i.test(sql) || /\bRETURNING\b/i.test(sql);
}

function managerFor(db: DatabaseSync): EntityManager {
  const execute = async (sql: string, params: readonly unknown[] = []) => {
    const statement = db.prepare(sql);
    if (returnsRows(sql)) return statement.all(...params);
    statement.run(...params);
    return [];
  };
  const manager = {
    getTransactionContext: () => undefined,
    getConnection: () => ({
      getPlatform: () => new SqlitePlatform(),
      execute,
    }),
    fork: () => manager,
    transactional: async <T>(work: (em: EntityManager) => Promise<T>) => {
      db.exec("BEGIN IMMEDIATE");
      try { const value = await work(manager as unknown as EntityManager); db.exec("COMMIT"); return value; }
      catch (error) { db.exec("ROLLBACK"); throw error; }
    },
  } as unknown as EntityManager;
  return manager;
}

describe("desktop-local deep-planning research lease", () => {
  it("acquires and releases a FIFO slot in the official fresh learning schema", async () => {
    const db = new DatabaseSync(":memory:");
    const manager = managerFor(db);
    const initialized = await migrateElectronLearningSchema(manager);
    expect(initialized.kind).toBe("fresh");
    const repository = new MikroOrmDeepPlanningResearchRepository(manager);
    const now = new Date("2026-08-25T02:00:00.000Z");

    await repository.updateConcurrency({
      value: 1,
      updatedByUserId: "admin-1",
      now,
    });
    await repository.enqueue({
      id: "lease-1",
      ownerKey: "module-draft:module-1",
      goalId: "goal-1",
      moduleKey: "m_1",
      now,
    });
    await expect(
      repository.tryAcquire({
        id: "lease-1",
        now,
        expiresAt: new Date(now.getTime() + 90_000),
      }),
    ).resolves.toBe(true);

    await repository.enqueue({
      id: "lease-2",
      ownerKey: "module-draft:module-2",
      goalId: "goal-1",
      moduleKey: "m_2",
      now: new Date(now.getTime() + 1_000),
    });
    await expect(
      repository.tryAcquire({
        id: "lease-2",
        now: new Date(now.getTime() + 1_000),
        expiresAt: new Date(now.getTime() + 91_000),
      }),
    ).resolves.toBe(false);

    await expect(repository.getSnapshot(now)).resolves.toMatchObject({
      deepPlanningResearchConcurrency: 1,
      activeResearchCount: 1,
      queuedResearchCount: 1,
      expiredLeaseCount: 0,
    });

    await repository.release("lease-1", new Date(now.getTime() + 2_000));
    await expect(
      repository.tryAcquire({
        id: "lease-2",
        now: new Date(now.getTime() + 2_000),
        expiresAt: new Date(now.getTime() + 92_000),
      }),
    ).resolves.toBe(true);
    await expect(
      repository.renew({
        id: "lease-2",
        now: new Date(now.getTime() + 3_000),
        expiresAt: new Date(now.getTime() + 93_000),
      }),
    ).resolves.toBe(true);
    db.close();
  });
});
