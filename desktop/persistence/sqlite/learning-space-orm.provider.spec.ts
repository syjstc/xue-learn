import fs from "node:fs";
import type { EntityManager } from "@mikro-orm/core";
import {
  bumpUnitContentRevision,
  commitSqPreviewAtRevision,
} from "@xue-learn/core/server/graph/content-revision";
import { requireContentRevisionPersistence } from "@xue-learn/core/server/graph/content-revision-persistence";
import { SqliteLearningSpaceOrmProvider } from "./learning-space-orm.provider";
import { MikroOrmUnitContentRevisionRepository } from "./reference/unit-content-revision.repository";

// Keep unrelated runtime adapters outside this lifecycle test. The revision
// repository and the Core publication functions use a real SQLite transaction.
jest.mock(__dirname + "/persistence-reference.js", () => new Proxy({
  openReferencePersistenceRuntime: jest.fn(),
}, {
  get(target, key) {
    if (key in target) return target[key as keyof typeof target];
    if (typeof key === "string" && key.startsWith("MikroOrm")) return class {};
    return undefined;
  },
}), { virtual: true });

const { DatabaseSync } = require("node:sqlite");

test("desktop startup enables revision publication, stale previews roll back, and shutdown releases persistence", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE LearningUnit (id TEXT PRIMARY KEY, contentRevision INTEGER);
    CREATE TABLE UnitSessionState (
      unitId TEXT PRIMARY KEY, sq3rData TEXT, structuredSubStep TEXT,
      currentStep TEXT, updatedAt TEXT
    );
    INSERT INTO LearningUnit VALUES ('unit', 7);
    INSERT INTO UnitSessionState VALUES ('unit', '{}', NULL, NULL, NULL);
  `);
  const em = {
    config: { getSchema: () => undefined },
    getTransactionContext: () => undefined,
    getConnection: () => ({ execute: async (sql: string, params: unknown[] = []) =>
      db.prepare(sql).all(...params.map(value => value instanceof Date ? value.toISOString() : value)),
    }),
    fork: () => em,
    transactional: async <T>(work: (manager: EntityManager) => Promise<T>) => {
      db.exec("BEGIN");
      try {
        const result = await work(em as unknown as EntityManager);
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const repository = new MikroOrmUnitContentRevisionRepository(em as unknown as EntityManager);
  const close = jest.fn(async () => undefined);
  const runtime = {
    orm: { em }, close,
    repositories: new Proxy({
      unitContentRevision: repository,
      unitSectionPlan: { recoverInterruptedGenerations: jest.fn(async () => undefined) },
      learningTrajectory: { recoverInterrupted: jest.fn(async () => undefined) },
    }, { get: (target, key) => target[key as keyof typeof target] ?? {} }),
  };
  const reference = jest.requireMock(__dirname + "/persistence-reference.js");
  reference.openReferencePersistenceRuntime.mockResolvedValue(runtime);
  const exists = fs.existsSync;
  const existsSpy = jest.spyOn(fs, "existsSync").mockImplementation(path =>
    String(path).endsWith("/persistence/sqlite/persistence-reference.js") || exists(path));
  const previousPath = process.env.PERSISTENCE_DATABASE_PATH;
  process.env.PERSISTENCE_DATABASE_PATH = ":memory:";
  const provider = new SqliteLearningSpaceOrmProvider();
  try {
    await provider.initialize();
    await provider.initialize();
    expect(reference.openReferencePersistenceRuntime).toHaveBeenCalledTimes(1);
    const sq3rData = JSON.stringify({ survey: { outline: ["Accepted course preview"] } });
    await expect(commitSqPreviewAtRevision({ unitId: "unit", expectedContentRevision: 7, sq3rData })).resolves.toBe(8);
    await expect(bumpUnitContentRevision("unit")).resolves.toBe(9);
    await expect(commitSqPreviewAtRevision({ unitId: "unit", expectedContentRevision: 7, sq3rData: "stale preview" }))
      .rejects.toThrow("单元内容已更新");
    expect(db.prepare("SELECT contentRevision FROM LearningUnit").get()).toMatchObject({ contentRevision: 9 });
    expect(db.prepare("SELECT sq3rData FROM UnitSessionState").get()).toMatchObject({ sq3rData });
  } finally {
    await provider.onModuleDestroy();
    existsSpy.mockRestore();
    if (previousPath === undefined) delete process.env.PERSISTENCE_DATABASE_PATH;
    else process.env.PERSISTENCE_DATABASE_PATH = previousPath;
    db.close();
  }
  expect(close).toHaveBeenCalledTimes(1);
  expect(() => requireContentRevisionPersistence()).toThrow("Content revision persistence is unavailable");
});
