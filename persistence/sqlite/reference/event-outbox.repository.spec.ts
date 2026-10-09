import type { EntityManager } from "@mikro-orm/core";
import { EventOutboxSchema } from "./event-outbox.entity.ts";
import { MikroOrmEventOutboxRepository } from "./event-outbox.repository.ts";

jest.mock("@mikro-orm/core", () => ({
  EntitySchema: class EntitySchema<T extends object> {
    readonly tableName: string;
    readonly properties: Record<string, Record<string, unknown>>;
    readonly meta: { primaryKeys: string[] };

    constructor(input: {
      tableName: string;
      properties: Record<string, Record<string, unknown>>;
    }) {
      this.tableName = input.tableName;
      this.properties = input.properties;
      this.meta = {
        primaryKeys: Object.entries(input.properties)
          .filter(([, property]) => property.primary === true)
          .map(([name]) => name),
      };
    }
  },
}));

describe("event outbox reference repository", () => {
  it("declares the final hosted columns and indexes", () => {
    expect(EventOutboxSchema.tableName).toBe("EventOutbox");
    expect(EventOutboxSchema.meta.primaryKeys).toEqual(["id"]);
    expect(Object.keys(EventOutboxSchema.properties)).toEqual([
      "id",
      "type",
      "payload",
      "createdAt",
      "publishedAt",
      "attemptCount",
      "nextAttemptAt",
      "lastError",
      "deadLetteredAt",
    ]);
    expect(EventOutboxSchema.properties.nextAttemptAt.defaultRaw).toBe(
      "CURRENT_TIMESTAMP",
    );
  });

  it("appends with deterministic retry defaults", async () => {
    const state: {
      entity: Record<string, unknown> | null;
      flushes: number;
    } = { entity: null, flushes: 0 };
    const em = {
      persist(entity: object) {
        state.entity = entity as Record<string, unknown>;
      },
      async flush() {
        state.flushes += 1;
      },
    } as unknown as EntityManager;
    const repository = new MikroOrmEventOutboxRepository(em);
    const createdAt = new Date("2026-08-09T00:00:00.000Z");

    await expect(
      repository.append({
        id: "event-1",
        type: "goal.updated",
        payload: "{}",
        createdAt,
      }),
    ).resolves.toMatchObject({
      id: "event-1",
      type: "goal.updated",
      payload: "{}",
      createdAt,
      nextAttemptAt: createdAt,
      attemptCount: 0,
      publishedAt: null,
      lastError: null,
      deadLetteredAt: null,
    });
    expect(state.flushes).toBe(1);
  });

  it("inserts unpublished events with WHERE NOT EXISTS", async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const em = {
      persist() {},
      async flush() {},
      getTransactionContext() {
        return undefined;
      },
      getConnection() {
        return {
          execute: async (sql: string, params?: unknown[]) => {
            calls.push({ sql, params: params ?? [] });
            return { affectedRows: 1 };
          },
          getPlatform() {
            return { constructor: { name: "SqlitePlatform" } };
          },
        };
      },
    } as unknown as EntityManager;
    const repository = new MikroOrmEventOutboxRepository(em);

    await expect(
      repository.appendUnlessUnpublished({
        event: {
          id: "event-2",
          type: "goal.overview.generate",
          payload: '{"userId":"u1","goalId":"g1"}',
        },
        unpublishedType: "goal.overview.generate",
        payloadIncludes: '"goalId":"g1"',
      }),
    ).resolves.toBe(true);
    expect(calls[0]?.sql).toContain("WHERE NOT EXISTS");
    expect(calls[0]?.sql).not.toMatch(/INSERT OR IGNORE/i);
  });
});
