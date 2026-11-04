import type {EntityManager} from "@mikro-orm/core";
import {DatabaseSync} from "node:sqlite";
import {MikroOrmAgentConversationRepository} from "./agent-conversation.repository.ts";

it("announces the first lesson once without completing creation or replacing its background checkpoint", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE GoalCreationSession (
      id TEXT PRIMARY KEY, status TEXT, firstUnitId TEXT, version INTEGER, updatedAt INTEGER, checkpointJson TEXT
    ); INSERT INTO GoalCreationSession VALUES ('session','running','',1,0,'background-checkpoint');`);
    const em = {getTransactionContext: () => undefined, getConnection: () => ({execute: async (sql: string, params: unknown[]) =>
      db.prepare(sql).all(...params.map(value => value instanceof Date ? value.getTime() : value) as never[]),
    })} as unknown as EntityManager;
    const repository = new MikroOrmAgentConversationRepository(em);
    expect(await Promise.all([
      repository.markGoalCreationFirstUnitReady("session", "first"),
      repository.markGoalCreationFirstUnitReady("session", "later"),
    ])).toEqual([true, false]);
    expect(db.prepare("SELECT status, firstUnitId, version, checkpointJson FROM GoalCreationSession").get()).toEqual({
      status: "running", firstUnitId: "first", version: 2, checkpointJson: "background-checkpoint",
    });
    db.exec("UPDATE GoalCreationSession SET status='stopped',firstUnitId=NULL");
    expect(await repository.markGoalCreationFirstUnitReady("session", "first")).toBe(false);
  } finally { db.close(); }
});
