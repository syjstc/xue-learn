import type { EntityManager } from "@mikro-orm/core";
import { MikroOrmLlmRequestLogRepository } from "./llm-request-log.repository.ts";

describe("LLM request-log reference repository", () => {
  it("normalizes SQLite epoch-millisecond timestamps when reading a row", async () => {
    const manager = {
      schema: undefined,
      getTransactionContext: () => undefined,
      getConnection: () => ({
        execute: async () => [
          {
            id: "log-1",
            createdAt: 1_786_524_531_844,
            request: "{}",
            response: "{}",
          },
        ],
      }),
    } as unknown as EntityManager;

    const row = await new MikroOrmLlmRequestLogRepository(manager).find("log-1");

    expect(row?.createdAt.toISOString()).toBe("2026-08-12T08:48:51.844Z");
  });

  it("does not pass undefined values into raw SQL", async () => {
    const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
    const manager = {
      schema: "tenant_a",
      getTransactionContext: () => undefined,
      getConnection: () => ({
        execute: async (sql: string, params: readonly unknown[] = []) => {
          calls.push({ sql, params });
          return [];
        },
      }),
    } as unknown as EntityManager;

    await new MikroOrmLlmRequestLogRepository(manager).create({
      operation: "unit.cornell",
      kind: "chat",
      provider: "deepseek",
      model: "deepseek-flash",
      status: "running",
      durationMs: 0,
      request: "{}",
      response: "{}",
      requestId: undefined,
      structuredAttempt: undefined,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      sql: expect.not.stringContaining('"requestId"'),
    });
    expect(calls[0].params).not.toContain(undefined);
  });
});
