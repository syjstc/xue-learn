import type { EntityManager } from "@mikro-orm/core";
import { MikroOrmUnitLabRepository } from "./unit-lab.repository.ts";

function manager(execute: jest.Mock) {
  return {
    schema: undefined,
    config: { getSchema: () => undefined },
    getTransactionContext: () => "tx",
    getConnection: () => ({ execute }),
  } as unknown as EntityManager;
}

describe("MikroOrmUnitLabRepository", () => {
  it("replaces a lab definition only at the expected revision", async () => {
    const execute = jest.fn().mockResolvedValue({ affectedRows: 1 });
    const repository = new MikroOrmUnitLabRepository(manager(execute));
    const definition = {
      type: "unit_lab",
      title: "Lab",
      summary: "Try it",
      items: [],
    };

    await expect(
      repository.publishRegeneratedItem({
        labId: "lab-1",
        expectedRevision: 4,
        definitionJson: definition,
      }),
    ).resolves.toBe(true);

    expect(execute.mock.calls[0]![0]).toContain('"revision"="revision"+1');
    expect(execute.mock.calls[0]![0]).toContain(
      'WHERE "id"=? AND "revision"=?',
    );
    expect(execute.mock.calls[0]![1]).toEqual([
      JSON.stringify(definition),
      expect.any(Date),
      "lab-1",
      4,
    ]);
  });

  it("reports a concurrent lab update as a conflict", async () => {
    const execute = jest.fn().mockResolvedValue({ affectedRows: 0 });
    const repository = new MikroOrmUnitLabRepository(manager(execute));

    await expect(
      repository.publishRegeneratedItem({
        labId: "lab-1",
        expectedRevision: 4,
        definitionJson: {},
      }),
    ).resolves.toBe(false);
  });

  it("publishes a regenerated item and bumps the unit revision together", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce([{ contentRevision: 12 }]);
    const repository = new MikroOrmUnitLabRepository(manager(execute));
    const definition = {
      type: "unit_lab",
      title: "Lab",
      summary: "Try it",
      items: [],
    };

    await expect(
      repository.publishRegeneratedItemAndBumpContentRevision({
        labId: "lab-1",
        unitId: "unit-1",
        expectedRevision: 4,
        definitionJson: definition,
      }),
    ).resolves.toEqual({ applied: true, contentRevision: 12 });

    expect(execute).toHaveBeenCalledTimes(3);
    expect(execute.mock.calls[1]![0]).toContain('"contentRevision"');
    expect(execute.mock.calls[1]![1]).toEqual([expect.any(Date), "unit-1"]);
  });

  it("accepts SQLite changes when publishing atomically", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce({ changes: 1 })
      .mockResolvedValueOnce({ changes: 1 })
      .mockResolvedValueOnce([{ contentRevision: 8 }]);
    const repository = new MikroOrmUnitLabRepository(manager(execute));

    await expect(
      repository.publishRegeneratedItemAndBumpContentRevision({
        labId: "lab-1",
        unitId: "unit-1",
        expectedRevision: 2,
        definitionJson: {},
      }),
    ).resolves.toEqual({ applied: true, contentRevision: 8 });
  });
});
