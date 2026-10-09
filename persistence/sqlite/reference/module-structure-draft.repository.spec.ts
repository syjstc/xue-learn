import { moduleStructureAuditGeneration } from "./module-structure-draft.repository.ts";
import { MikroOrmModuleStructureDraftRepository } from "./module-structure-draft.repository.ts";
import type { EntityManager } from "@mikro-orm/core";
import { DatabaseSync } from "node:sqlite";
import { formatModuleStructureAuditInventory } from "@xue-learn/core/source/libs/server/src/goal-creation/module-structure-audit.ts";

class SqlitePlatform {}

describe("module draft curriculum order", () => {
  it("feeds audit in teaching order even when ids and insertion order differ", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`
        CREATE TABLE LearningModule (id TEXT PRIMARY KEY, goalId TEXT, orderIndex INTEGER);
        CREATE TABLE ModuleStructureDraft (moduleId TEXT, goalId TEXT, candidateJson TEXT);
        INSERT INTO LearningModule VALUES ('a-two-digit', 'goal', 1), ('z-foundations', 'goal', 0), ('b-three-digit', 'goal', 2), ('other', 'another-goal', 0);
        INSERT INTO ModuleStructureDraft VALUES ('b-three-digit', 'goal', '{}'), ('a-two-digit', 'goal', '{}'), ('z-foundations', 'goal', '{}'), ('other', 'another-goal', '{}');
      `);
      const em = {
        getConnection: () => ({
          execute: async (sql: string, params: string[]) =>
            db.prepare(sql).all(...params),
        }),
      } as unknown as EntityManager;
      const rows = await new MikroOrmModuleStructureDraftRepository(em).listByGoal("goal");
      expect(rows.map((row) => row.moduleId)).toEqual([
        "z-foundations", "a-two-digit", "b-three-digit",
      ]);
      const inventory = formatModuleStructureAuditInventory(
        rows.map((row) => ({ ...row, title: row.moduleId })),
      );
      expect(inventory).toMatch(/^1\. z-foundations/);
      expect(inventory).toContain("2. a-two-digit");
      expect(inventory).toContain("3. b-three-digit");
    } finally {
      db.close();
    }
  });
});

describe("module structure audit generation", () => {
  it("is stable across concurrent draft completion order", () => {
    const left = moduleStructureAuditGeneration([
      { moduleId: "module-b", candidateHash: "hash-b" },
      { moduleId: "module-a", candidateHash: "hash-a" },
    ]);
    const right = moduleStructureAuditGeneration([
      { moduleId: "module-a", candidateHash: "hash-a" },
      { moduleId: "module-b", candidateHash: "hash-b" },
    ]);

    expect(left).toBe(right);
  });

  it("changes after a targeted draft repair", () => {
    const before = moduleStructureAuditGeneration([
      { moduleId: "module-a", candidateHash: "hash-a" },
    ]);
    const after = moduleStructureAuditGeneration([
      { moduleId: "module-a", candidateHash: "hash-a-repaired" },
    ]);

    expect(after).not.toBe(before);
  });
});

describe("module structure draft outbox enqueue", () => {
  it("reopens a published audit event with the same generation", async () => {
    const execute = jest.fn(async (sql: string) => {
      if (sql.includes("SELECT d.* FROM") && sql.includes("goalId")) {
        return [
          {
            moduleId: "module-a",
            sessionId: "session-1",
            goalId: "goal-1",
            planHash: "plan",
            candidateJson: "{}",
            candidateHash: "hash-a",
            status: "ready_for_audit",
            attemptCount: 1,
            issuesJson: "[]",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ];
      }
      return [];
    });
    const em = {
      schema: undefined,
      config: { getSchema: () => undefined },
      getConnection: () => ({
        getPlatform: () => new SqlitePlatform(),
        execute,
      }),
      getTransactionContext: () => undefined,
      transactional: async (work: (tx: EntityManager) => Promise<unknown>) =>
        work(em as unknown as EntityManager),
    } as unknown as EntityManager;
    const repository = new MikroOrmModuleStructureDraftRepository(em);

    await repository.enqueueAuditEvent({
      goalId: "goal-1",
      sessionId: "session-1",
    });

    expect(execute).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("ON CONFLICT (\"id\") DO UPDATE SET"),
      expect.arrayContaining([
        expect.stringMatching(/^goal-module-structure-audit:goal-1:/),
        "goal.module_structure.audit",
        expect.stringContaining("\"goalId\":\"goal-1\""),
      ]),
    );
  });
});

describe("module structure audit generation", () => {
  it("is stable across concurrent draft completion order", () => {
    const left = moduleStructureAuditGeneration([
      { moduleId: "module-b", candidateHash: "hash-b" },
      { moduleId: "module-a", candidateHash: "hash-a" },
    ]);
    const right = moduleStructureAuditGeneration([
      { moduleId: "module-a", candidateHash: "hash-a" },
      { moduleId: "module-b", candidateHash: "hash-b" },
    ]);

    expect(left).toBe(right);
  });

  it("changes after a targeted draft repair", () => {
    const before = moduleStructureAuditGeneration([
      { moduleId: "module-a", candidateHash: "hash-a" },
    ]);
    const after = moduleStructureAuditGeneration([
      { moduleId: "module-a", candidateHash: "hash-a-repaired" },
    ]);

    expect(after).not.toBe(before);
  });
});
