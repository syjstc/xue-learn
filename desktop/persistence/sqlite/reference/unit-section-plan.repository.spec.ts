import type { EntityManager } from "@mikro-orm/core";
import { DatabaseSync } from "node:sqlite";
import { MikroOrmUnitSectionPlanRepository } from "./unit-section-plan.repository.ts";

function readingQuizDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE UnitSection (id TEXT PRIMARY KEY, orderIndex INTEGER DEFAULT 0,
      contentRevision INTEGER DEFAULT 1, generationStatus TEXT DEFAULT 'pending',
      generationError TEXT, generationStartedAt TEXT, generationToken TEXT,
      testGenerationStatus TEXT DEFAULT 'building', testGenerationError TEXT,
      testGenerationStartedAt TEXT, testGenerationToken TEXT, updatedAt TEXT);
    CREATE VIEW MainCourseSection AS SELECT * FROM UnitSection;
    CREATE TABLE UnitSectionMaterial (id TEXT PRIMARY KEY, sectionId TEXT UNIQUE,
      introduction TEXT DEFAULT '', blocks TEXT DEFAULT '[]', keyTakeaways TEXT DEFAULT '[]',
      contextSources TEXT DEFAULT '[]', sourceItems TEXT DEFAULT '[]', createdAt TEXT, updatedAt TEXT);
    CREATE TABLE LearningUnit (id TEXT PRIMARY KEY, contentRevision INTEGER DEFAULT 1);
    CREATE TABLE LearningTask (goalId TEXT, unitId TEXT, origin TEXT, status TEXT, updatedAt TEXT);
    INSERT INTO UnitSection (id,testGenerationToken) VALUES ('chapter','quiz-lease');
    INSERT INTO LearningUnit (id) VALUES ('unit');
  `);
  const manager = {
    getTransactionContext: () => undefined,
    getConnection: () => ({
      execute: async (sql: string, params: unknown[] = []) => db.prepare(sql).all(...params.map(value =>
        value instanceof Date ? value.toISOString() : typeof value === "boolean" ? Number(value) : value,
      ) as never[]),
    }),
    transactional: async (work: (em: EntityManager) => Promise<unknown>) => {
      db.exec("BEGIN");
      try { const result = await work(manager as unknown as EntityManager); db.exec("COMMIT"); return result; }
      catch (error) { db.exec("ROLLBACK"); throw error; }
    },
  } as unknown as EntityManager;
  return {db, repository: new MikroOrmUnitSectionPlanRepository(manager)};
}

it.each([false, true])("stores a shared reading quiz with or without existing Display (%s)", async existing => {
  const {db, repository} = readingQuizDatabase();
  try {
    if (existing) db.exec(`INSERT INTO UnitSectionMaterial (id,sectionId,introduction) VALUES ('material','chapter','Keep saved introduction')`);
    await repository.publishGeneratedMiniTest({
      userId: "owner", goalId: "goal", unitId: "unit", sectionId: "chapter", token: "quiz-lease",
      blocks: '[{"type":"check","checkId":"shared"}]', materialCheckTasks: [],
    });
    expect(db.prepare("SELECT introduction,blocks FROM UnitSectionMaterial").get()).toMatchObject({
      introduction: existing ? "Keep saved introduction" : "", blocks: '[{"type":"check","checkId":"shared"}]',
    });
    expect(db.prepare("SELECT generationStatus,testGenerationStatus,contentRevision FROM UnitSection").get())
      .toEqual({generationStatus: "pending", testGenerationStatus: "ready", contentRevision: 2});
  } finally {db.close();}
});

it("keeps the existing quiz ready when Display is first authored after reading", async () => {
  const {db, repository} = readingQuizDatabase();
  try {
    db.exec(`UPDATE UnitSection SET generationStatus='building',generationToken='display-lease',testGenerationStatus='ready',testGenerationToken=NULL`);
    await repository.publishGeneratedContent({
      userId: "owner", goalId: "goal", unitId: "unit", sectionId: "chapter", token: "display-lease",
      force: false, preserveMiniTest: true,
      material: {introduction: "Display", blocks: '[{"type":"check","checkId":"shared"}]',
        keyTakeaways: "[]", contextSources: "[]", sourceItemsJson: "[]"}, materialCheckTasks: [],
    });
    expect(db.prepare("SELECT generationStatus,testGenerationStatus FROM UnitSection").get())
      .toEqual({generationStatus: "ready", testGenerationStatus: "ready"});
  } finally {db.close();}
});

describe("MikroOrmUnitSectionPlanRepository", () => {
  it.each([true, false])("fences a teaching regeneration format switch by lease ownership (%s)", async (ownsLease) => {
    const execute = jest.fn().mockResolvedValue(ownsLease ? [{ id: "section-1" }] : []);
    const em = {
      transactional: async (work: (tx: EntityManager) => Promise<unknown>) =>
        work(em as unknown as EntityManager),
      getConnection: () => ({ execute }),
      getTransactionContext: () => ({ transaction: true }),
    } as unknown as EntityManager;
    const repository = new MikroOrmUnitSectionPlanRepository(em);
    await expect(repository.lockDerivationFormat({
      sectionId: "section-1", format: "teaching_v1", regenerationToken: "active-token",
    })).resolves.toBe(ownsLease ? "locked" : "conflict");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toContain('"generationToken"=?');
    expect(execute.mock.calls[0][1]).toEqual(["teaching_v1", expect.any(Date), "section-1", "active-token"]);
  });

  it("fails both content and mini-test leases interrupted by a local restart", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce({ affectedRows: 2 })
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 4 })
      .mockResolvedValueOnce({ affectedRows: 0 });
    const em = {
      transactional: async (work: (tx: EntityManager) => Promise<unknown>) =>
        work(em as unknown as EntityManager),
      getConnection: () => ({ execute }),
      getTransactionContext: () => ({ transaction: true }),
    } as unknown as EntityManager;
    const repository = new MikroOrmUnitSectionPlanRepository(em);

    await expect(
      repository.recoverInterruptedGenerations("[SERVER_RESTART_INTERRUPTED]"),
    ).resolves.toBe(3);

    expect(execute).toHaveBeenCalledTimes(4);
    expect(execute.mock.calls[0]?.[0]).toContain(`"generationStatus"='failed'`);
    expect(execute.mock.calls[0]?.[0]).toContain(
      `WHERE "generationStatus"='building'`,
    );
    expect(execute.mock.calls[1]?.[0]).toContain(
      `"testGenerationStatus"='failed'`,
    );
    expect(execute.mock.calls[1]?.[0]).toContain(
      `WHERE "testGenerationStatus"='building'`,
    );
    expect(execute.mock.calls[2]?.[0]).toContain(`FormalDerivationRun`);
    expect(execute.mock.calls[3]?.[0]).toContain(`TeachingDerivationRun`);
    expect(execute.mock.calls[0]?.[1]?.[0]).toBe(
      "[SERVER_RESTART_INTERRUPTED]",
    );
    expect(execute.mock.calls[1]?.[1]?.[0]).toBe(
      "[SERVER_RESTART_INTERRUPTED]",
    );
  });

  it("treats a SQLite affected-row UPDATE as a claimed generation lease", async () => {
    const execute = jest.fn().mockResolvedValueOnce({ affectedRows: 1 });
    const em = {
      getConnection: () => ({
        execute,
        getPlatform: () => ({ constructor: { name: "SqlitePlatform" } }),
      }),
      getTransactionContext: () => ({ transaction: true }),
    } as unknown as EntityManager;
    const repository = new MikroOrmUnitSectionPlanRepository(em);

    await expect(
      repository.claimGeneration({
        sectionId: "section-1",
        kind: "content",
        token: "token-1",
        staleBefore: new Date("2026-08-29T00:00:00.000Z"),
        force: true,
        initialAttempt: true,
      }),
    ).resolves.toBe("claimed");

    expect(execute).toHaveBeenCalledTimes(1);
  });
});
