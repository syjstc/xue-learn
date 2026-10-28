import { openPersistenceOrm } from "./orm-connection.ts";

describe("persistence ORM connection seam", () => {
  it.each([
    ["sqlite", "@mikro-orm/sqlite", { databasePath: ":memory:" }],
  ] as const)(
    "selects the %s driver without leaking it to callers",
    async (kind, expectedSpecifier, location) => {
      const execute = jest.fn(async () => []);
      const loadExtension = jest.fn();
      const orm = {
        em: {
          getConnection: () => ({ execute, database: { loadExtension } }),
        },
        schema: {},
        migrator: {},
        close: async () => undefined,
        isConnected: async () => true,
        connect: async () => ({}) as never,
      };
      const init = jest.fn(async () => orm);
      const loader = jest.fn(async () => ({ MikroORM: { init } }));

      await expect(
        openPersistenceOrm(
          {
            kind,
            entities: [],
            ...location,
          },
          loader,
        ),
      ).resolves.toBe(orm);

      expect(loader).toHaveBeenCalledWith(expectedSpecifier);
      expect(init).toHaveBeenCalledWith(
        expect.objectContaining(
          { dbName: ":memory:" },
        ),
      );
      expect(execute.mock.calls.map(([sql]) => sql)).toEqual(
        kind === "sqlite"
          ? [
              "PRAGMA busy_timeout = 5000",
              "PRAGMA foreign_keys = ON",
              "PRAGMA journal_mode = WAL",
              "PRAGMA synchronous = NORMAL",
              "PRAGMA cache_size = -32768",
              "PRAGMA mmap_size = 67108864",
              "PRAGMA temp_store = MEMORY",
              "SELECT vec_version() AS version",
            ]
          : [],
      );
    },
  );

  it("fails before loading a driver when its location is missing", async () => {
    const loader = jest.fn();
    await expect(
      openPersistenceOrm({ kind: "sqlite", entities: [] }, loader),
    ).rejects.toThrow("Missing databasePath");
    expect(loader).not.toHaveBeenCalled();
  });

  it("registers the migration extension only for configured histories", async () => {
    const execute = jest.fn(async () => []);
    const loadExtension = jest.fn();
    const orm = {
      em: {
        getConnection: () => ({ execute, database: { loadExtension } }),
      },
      schema: {},
      migrator: {},
      close: async () => undefined,
      isConnected: async () => true,
      connect: async () => ({}) as never,
    };
    const init = jest.fn(async () => orm);
    const migrator = { register: jest.fn() };
    const loader = jest.fn(async (specifier: string) =>
      specifier === "@mikro-orm/migrations"
        ? { Migrator: migrator }
        : { MikroORM: { init } },
    );

    await openPersistenceOrm(
      {
        kind: "sqlite",
        databasePath: ":memory:",
        entities: [],
        migrationsPath: "/repo/migrations/sqlite",
      },
      loader,
    );

    expect(loader).toHaveBeenNthCalledWith(1, "@mikro-orm/sqlite");
    expect(loader).toHaveBeenNthCalledWith(2, "@mikro-orm/migrations");
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        migrations: expect.objectContaining({
          path: "/repo/migrations/sqlite",
        }),
        extensions: [migrator],
      }),
    );
  });

  it("closes SQLite when connection pragma setup fails", async () => {
    const error = new Error("database is locked");
    const close = jest.fn(async () => undefined);
    const orm = {
      em: {
        getConnection: () => ({
          execute: jest.fn(async () => Promise.reject(error)),
        }),
      },
      schema: {},
      migrator: {},
      close,
      isConnected: async () => true,
      connect: async () => ({}) as never,
    };
    const loader = jest.fn(async () => ({
      MikroORM: { init: jest.fn(async () => orm) },
    }));

    await expect(
      openPersistenceOrm(
        { kind: "sqlite", databasePath: ":memory:", entities: [] },
        loader,
      ),
    ).rejects.toBe(error);
    expect(close).toHaveBeenCalledWith(true);
  });
});
