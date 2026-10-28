import type { EntityManager } from "@mikro-orm/core";
import { MikroOrmGoalIconRepository } from "./goal-icon.repository.ts";

function manager(execute: jest.Mock) {
  return {
    schema: undefined,
    config: { getSchema: () => undefined },
    getTransactionContext: () => "tx",
    getConnection: () => ({
      execute,
      getPlatform: () => ({ constructor: { name: "SqlitePlatform" } }),
    }),
  } as unknown as EntityManager;
}

describe("MikroOrmGoalIconRepository", () => {
  it("reads only the requested owner's goal metadata", async () => {
    const execute = jest.fn().mockResolvedValue([
      {
        id: "goal-1",
        title: "Learn SQL",
        iconSvg: "<svg />",
        iconTint: "#EEF0FF",
      },
    ]);
    const repository = new MikroOrmGoalIconRepository(manager(execute));

    await expect(
      repository.findOwned({ userId: "user-1", goalId: "goal-1" }),
    ).resolves.toEqual({
      id: "goal-1",
      title: "Learn SQL",
      iconSvg: "<svg />",
      iconTint: "#EEF0FF",
    });
    expect(execute.mock.calls[0]![0]).toContain(
      'WHERE "id" = ? AND "userId" = ?',
    );
    expect(execute.mock.calls[0]![1]).toEqual(["goal-1", "user-1"]);
    expect(execute.mock.calls[0]![3]).toBe("tx");
  });

  it("conditionally saves an empty icon and returns the winner in one transaction", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce([
        {
          id: "goal-1",
          title: "Learn SQL",
          iconSvg: "<svg generated />",
          iconTint: "#E8F0FF",
        },
      ]);
    const repository = new MikroOrmGoalIconRepository(manager(execute));

    await expect(
      repository.saveOwnedIfEmpty({
        userId: "user-1",
        goalId: "goal-1",
        iconSvg: "<svg generated />",
        iconTint: "#E8F0FF",
      }),
    ).resolves.toMatchObject({ iconSvg: "<svg generated />" });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls.every((call) => call[3] === "tx")).toBe(true);
    expect(execute.mock.calls[0]![0]).toContain(
      'AND "userId" = ? AND "iconSvg" = \'\'',
    );
    expect(execute.mock.calls[0]![1]).toEqual([
      "<svg generated />",
      "#E8F0FF",
      expect.any(Date),
      "goal-1",
      "user-1",
    ]);
  });

  it("does not claim another owner's goal or overwrite a non-empty icon", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce({ affectedRows: 0 })
      .mockResolvedValueOnce([]);
    const repository = new MikroOrmGoalIconRepository(manager(execute));

    await expect(
      repository.saveOwnedIfEmpty({
        userId: "user-2",
        goalId: "goal-1",
        iconSvg: "<svg attacker />",
        iconTint: "#FFE8EE",
      }),
    ).resolves.toBeNull();
    expect(execute.mock.calls[0]![0]).toContain('"userId" = ?');
    expect(execute.mock.calls[0]![0]).toContain("\"iconSvg\" = ''");
  });
});
