import type { EntityManager } from "@mikro-orm/core";
import { MikroOrmEventOutboxDeliveryRepository } from "./event-outbox-delivery.repository.ts";

class SqlitePlatform {}

describe("event outbox delivery repository", () => {
  it("claims SQLite rows created with textual CURRENT_TIMESTAMP defaults", async () => {
    const now = new Date("2026-08-12T09:48:21.000Z");
    const leaseUntil = new Date("2026-08-12T10:03:21.000Z");
    const execute = jest.fn(async (sql: string) => {
      if (sql.includes('SELECT "id", "type", "payload"')) {
        return [
          {
            id: "module-event-1",
            type: "course.module.generate",
            payload: "{}",
            createdAt: "1786528100000",
            publishedAt: null,
            attemptCount: 0,
            nextAttemptAt: "2026-08-12 09:48:20",
            lastError: null,
            deadLetteredAt: null,
          },
        ];
      }
      if (sql.includes('RETURNING "attemptCount", "nextAttemptAt"')) {
        return [{ attemptCount: 1, nextAttemptAt: leaseUntil.toISOString() }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
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

    const repository = new MikroOrmEventOutboxDeliveryRepository(em);
    await expect(
      repository.claimDue({
        types: ["course.module.generate"],
        includeTypes: true,
        limit: 100,
        now,
        leaseUntil,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "module-event-1",
        createdAt: new Date(1_786_528_100_000),
        attemptCount: 1,
        nextAttemptAt: leaseUntil,
      }),
    ]);

    expect(execute).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('julianday("nextAttemptAt") <= julianday(?)'),
      [now.toISOString(), "course.module.generate", 100],
      undefined,
      undefined,
    );
    expect(execute).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('julianday("nextAttemptAt") <= julianday(?)'),
      [leaseUntil.toISOString(), "module-event-1", 0, now.toISOString()],
      undefined,
      undefined,
    );
  });
});
