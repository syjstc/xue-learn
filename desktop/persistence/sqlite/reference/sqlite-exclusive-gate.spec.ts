import type { EntityManager } from "@mikro-orm/core";
import { installSqliteExclusiveGate } from "./sqlite-exclusive-gate.ts";

describe("sqlite exclusive gate", () => {
  it("runs sibling transactionals one after another", async () => {
    const order: string[] = [];
    let inFlight = 0;
    let overlap = 0;
    const connection = {
      execute: jest.fn(async () => []),
      getPlatform: () => ({ constructor: { name: "SqlitePlatform" } }),
    };
    const em = {
      getConnection: () => connection,
      transactional: jest.fn(async (work: () => Promise<unknown>) => {
        inFlight += 1;
        if (inFlight > 1) overlap += 1;
        order.push("start");
        await work();
        await Promise.resolve();
        order.push("end");
        inFlight -= 1;
        return "ok";
      }),
    } as unknown as EntityManager;

    installSqliteExclusiveGate(em);

    await Promise.all([
      em.transactional(async () => undefined),
      em.transactional(async () => undefined),
    ]);

    expect(overlap).toBe(0);
    expect(order).toEqual(["start", "end", "start", "end"]);
  });

  it("keeps an unrelated execute behind the active transaction", async () => {
    const order: string[] = [];
    let releaseTransaction!: () => void;
    const transactionCanFinish = new Promise<void>((resolve) => {
      releaseTransaction = resolve;
    });
    const connection = {
      execute: jest.fn(async (label: string) => {
        order.push(label);
        return [];
      }),
      getPlatform: () => ({ constructor: { name: "SqlitePlatform" } }),
    };
    const em = {
      getConnection: () => connection,
      transactional: jest.fn(async (work: () => Promise<unknown>) => work()),
    } as unknown as EntityManager;

    installSqliteExclusiveGate(em);

    const transaction = em.transactional(async () => {
      await connection.execute("transaction-start");
      await transactionCanFinish;
      await connection.execute("transaction-end");
    });
    await Promise.resolve();
    await Promise.resolve();
    const unrelated = connection.execute("unrelated");
    await Promise.resolve();

    expect(order).toEqual(["transaction-start"]);
    releaseTransaction();
    await Promise.all([transaction, unrelated]);
    expect(order).toEqual([
      "transaction-start",
      "transaction-end",
      "unrelated",
    ]);
  });

  it("releases the gate after a failed transaction", async () => {
    const connection = {
      execute: jest.fn(async () => []),
      getPlatform: () => ({ constructor: { name: "SqlitePlatform" } }),
    };
    const em = {
      getConnection: () => connection,
      transactional: jest.fn(async (work: () => Promise<unknown>) => work()),
    } as unknown as EntityManager;

    installSqliteExclusiveGate(em);

    await expect(
      em.transactional(async () => {
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    await expect(connection.execute("after-failure")).resolves.toEqual([]);
  });

  it("does not wrap PostgreSQL managers", async () => {
    const transactional = jest.fn(async (work: () => Promise<unknown>) =>
      work(),
    );
    const em = {
      getConnection: () => ({
        execute: jest.fn(),
        getPlatform: () => ({ constructor: { name: "PostgreSqlPlatform" } }),
      }),
      transactional,
    } as unknown as EntityManager;

    installSqliteExclusiveGate(em);
    expect(em.transactional).toBe(transactional);
  });
});
