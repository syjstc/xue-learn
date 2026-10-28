import type { EntityManager } from "@mikro-orm/core";
import { MikroOrmUnitSectionPlanRepository } from "./unit-section-plan.repository.ts";

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
