import { moduleStructureAuditGeneration } from "./module-structure-draft.repository.ts";
import { MikroOrmModuleStructureDraftRepository } from "./module-structure-draft.repository.ts";
import type { EntityManager } from "@mikro-orm/core";
import { DatabaseSync } from "node:sqlite";
import { formatModuleStructureAuditInventory } from "@xue-learn/core/server/goal-creation/module-structure-audit";
import type { CommitModulePathRepairsInput } from "@xue-learn/core/domain/persistence/module-structure-draft-port";

class SqlitePlatform {}

describe("audited capability path repair publication", () => {
  let db: DatabaseSync;
  let repository: MikroOrmModuleStructureDraftRepository;
  const input: CommitModulePathRepairsInput = {
    goalId: "goal", sessionId: "session", expectedMapPlanJson: "original-plan", mapPlanJson: "revised-plan",
    modules: [{ moduleId: "flagged", expectedCandidateHash: "repaired-hash", plannedOutcomesJson: "[]", exitCapabilityBriefsJson: "[]", estimatedUnitCount: 3, unitPlanningBriefJson: "revised-brief" }],
  };
  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE LearningGoal (id TEXT PRIMARY KEY, userId TEXT, mapPlanJson TEXT, updatedAt INTEGER);
      CREATE TABLE GoalCreationSession (id TEXT, goalId TEXT, userId TEXT, status TEXT);
      CREATE TABLE LearningModule (id TEXT PRIMARY KEY, goalId TEXT, plannedOutcomes TEXT, exitCapabilityBriefs TEXT, estimatedUnitCount INTEGER, unitPlanningBrief TEXT, title TEXT DEFAULT 'Original title', summary TEXT DEFAULT 'Original summary', objective TEXT DEFAULT 'Original objective');
      CREATE TABLE ModuleStructureDraft (moduleId TEXT, goalId TEXT, sessionId TEXT, candidateHash TEXT, status TEXT, planHash TEXT);
      CREATE TABLE LearningUnit (id TEXT, moduleId TEXT);
      INSERT INTO LearningGoal VALUES ('goal','user','original-plan',0);
      INSERT INTO GoalCreationSession VALUES ('session','goal','user','running');
      INSERT INTO LearningModule (id,goalId,plannedOutcomes,exitCapabilityBriefs,estimatedUnitCount,unitPlanningBrief) VALUES ('flagged','goal','[]','[]',2,'original-brief'), ('valid','goal','[]','[]',4,'valid-brief');
      INSERT INTO ModuleStructureDraft VALUES ('flagged','goal','session','repaired-hash','ready_for_audit','old-hash'), ('valid','goal','session','valid-hash','ready_for_audit','old-hash');
    `);
    const em = {
      getConnection: () => ({ execute: async (sql: string, params: unknown[]) => {
        const values = params.map((value) => value instanceof Date ? value.getTime() : value);
        return /^\s*SELECT/.test(sql) ? db.prepare(sql).all(...values as never[]) : db.prepare(sql).run(...values as never[]);
      } }),
      getTransactionContext: () => undefined,
      transactional: async (work: (tx: EntityManager) => Promise<unknown>) => {
        db.exec("BEGIN");
        try { const result = await work(em as unknown as EntityManager); db.exec("COMMIT"); return result; }
        catch (error) { db.exec("ROLLBACK"); throw error; }
      },
    } as unknown as EntityManager;
    repository = new MikroOrmModuleStructureDraftRepository(em);
  });
  afterEach(() => db.close());

  it("saves the goal and flagged brief together, retaining valid modules and candidate hashes", async () => {
    expect(await repository.commitPathRepairs(input)).toBe(true);
    expect(db.prepare("SELECT mapPlanJson FROM LearningGoal").get()).toEqual({ mapPlanJson: "revised-plan" });
    expect(db.prepare("SELECT estimatedUnitCount,unitPlanningBrief FROM LearningModule WHERE id='flagged'").get()).toEqual({ estimatedUnitCount: 3, unitPlanningBrief: "revised-brief" });
    expect(db.prepare("SELECT unitPlanningBrief FROM LearningModule WHERE id='valid'").get()).toEqual({ unitPlanningBrief: "valid-brief" });
    expect(db.prepare("SELECT candidateHash FROM ModuleStructureDraft WHERE moduleId='valid'").get()).toEqual({ candidateHash: "valid-hash" });
    expect(await repository.commitPathRepairs(input)).toBe(true);
  });

  it("atomically aligns only the audited module metadata and leaves other headings intact", async () => {
    const metadata = { title: "Actual operation", summary: "The unchanged lessons already teach this operation.", objective: "Perform the existing exit ability." };
    expect(await repository.commitPathRepairs({ ...input, modules: [{ ...input.modules[0]!, metadata }] })).toBe(true);
    expect(db.prepare("SELECT title,summary,objective FROM LearningModule WHERE id='flagged'").get()).toEqual(metadata);
    expect(db.prepare("SELECT title FROM LearningModule WHERE id='valid'").get()).toEqual({ title: "Original title" });
    expect(db.prepare("SELECT mapPlanJson FROM LearningGoal").get()).toEqual({ mapPlanJson: "revised-plan" });
  });

  it("rejects metadata from an unaudited draft without updating the plan or heading", async () => {
    db.exec("UPDATE ModuleStructureDraft SET status='repairing' WHERE moduleId='flagged'");
    expect(await repository.commitPathRepairs({ ...input, modules: [{ ...input.modules[0]!, metadata: { title: "Unreviewed", summary: "Unreviewed", objective: "Unreviewed" } }] })).toBe(false);
    expect(db.prepare("SELECT title FROM LearningModule WHERE id='flagged'").get()).toEqual({ title: "Original title" });
    expect(db.prepare("SELECT mapPlanJson FROM LearningGoal").get()).toEqual({ mapPlanJson: "original-plan" });
  });

  it("rejects stale plans and stale audited drafts without changing any owning record", async () => {
    expect(await repository.commitPathRepairs({ ...input, expectedMapPlanJson: "stale" })).toBe(false);
    expect(await repository.commitPathRepairs({ ...input, modules: [...input.modules, { ...input.modules[0]!, moduleId: "valid", expectedCandidateHash: "stale" }] })).toBe(false);
    expect(db.prepare("SELECT mapPlanJson FROM LearningGoal").get()).toEqual({ mapPlanJson: "original-plan" });
    expect(db.prepare("SELECT unitPlanningBrief FROM LearningModule WHERE id='flagged'").get()).toEqual({ unitPlanningBrief: "original-brief" });
  });

  it("does not revise stopped sessions or overwrite published learner lessons", async () => {
    db.exec("UPDATE GoalCreationSession SET status='stopped'");
    expect(await repository.commitPathRepairs(input)).toBe(false);
    db.exec("UPDATE GoalCreationSession SET status='running'; INSERT INTO LearningUnit VALUES ('lesson','flagged')");
    expect(await repository.commitPathRepairs(input)).toBe(false);
  });

  it("rolls back the goal update when saving a brief fails", async () => {
    db.exec("CREATE TRIGGER fail_brief BEFORE UPDATE ON LearningModule BEGIN SELECT RAISE(ABORT,'brief write failed'); END;");
    await expect(repository.commitPathRepairs(input)).rejects.toThrow("brief write failed");
    expect(db.prepare("SELECT mapPlanJson FROM LearningGoal").get()).toEqual({ mapPlanJson: "original-plan" });
  });
});

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
