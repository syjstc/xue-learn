import type { EntityManager } from "@mikro-orm/core";
import type { CognitiveModelGenerationRunRepository } from "@xue-learn/core/domain";
import { MikroOrmCognitiveModelGenerationRunRepository } from "./cognitive-model-generation-run.repository.ts";

type Call = { sql: string; params: readonly unknown[] };

class SqlitePlatform {}

function fakeManager(results: readonly unknown[]): {
  manager: EntityManager;
  calls: Call[];
} {
  const calls: Call[] = [];
  let resultIndex = 0;
  const manager = {
    schema: "tenant_a",
    getTransactionContext: () => undefined,
    getConnection: () => ({
      getPlatform: () => new SqlitePlatform(),
      execute: async (sql: string, params: readonly unknown[] = []) => {
        calls.push({ sql, params });
        return results[resultIndex++];
      },
    }),
  } as unknown as EntityManager;
  return { manager, calls };
}

describe("cognitive-model generation run reference repository", () => {
  it("starts a fenced run, appends sequenced events, and finishes it", async () => {
    const state = fakeManager([
      undefined,
      undefined,
      [{ id: "run-1", status: "running" }],
      [{ payload: JSON.stringify({ prefixHash: "prefix-1" }) }],
      [{ nextEventSequence: 1 }],
      undefined,
      [{ id: "run-1" }],
    ]);
    const repository: CognitiveModelGenerationRunRepository =
      new MikroOrmCognitiveModelGenerationRunRepository(state.manager);

    await expect(
      repository.start({
        userId: "user-1",
        unitId: "unit-1",
        statusMessage: "Building learning targets",
      }),
    ).resolves.toMatchObject({ id: expect.any(String), status: "running" });
    await expect(
      repository.findLatest({ unitId: "unit-1", statuses: ["running"] }),
    ).resolves.toEqual({ id: "run-1", status: "running" });
    await expect(
      repository.readLatestEvent({
        runId: "run-1",
        type: "learning_targets_ready",
      }),
    ).resolves.toEqual({
      payloadJson: JSON.stringify({ prefixHash: "prefix-1" }),
    });
    await expect(
      repository.appendEvent({
        runId: "run-1",
        type: "learning_access",
        payloadJson: "{}",
        snapshotKey: "learning_access",
      }),
    ).resolves.toBe(true);
    await expect(
      repository.finish({
        runId: "run-1",
        status: "completed",
        resultJson: "{}",
      }),
    ).resolves.toBe(true);

    expect(state.calls[0].sql).toContain("\"status\" = 'error'");
    expect(state.calls[4].sql).toContain(
      '"nextEventSequence" = "nextEventSequence" + 1',
    );
    expect(state.calls[5].sql).toContain("ON CONFLICT");
    expect(state.calls[6].sql).toContain("\"status\" = 'completed'");
  });

  it("returns false when an event or finish races a terminal run", async () => {
    const state = fakeManager([[], []]);
    const repository = new MikroOrmCognitiveModelGenerationRunRepository(
      state.manager,
    );

    await expect(
      repository.appendEvent({
        runId: "run-1",
        type: "late",
        payloadJson: "{}",
      }),
    ).resolves.toBe(false);
    await expect(
      repository.finish({
        runId: "run-1",
        status: "error",
        resultJson: "late",
      }),
    ).resolves.toBe(false);
  });
});
