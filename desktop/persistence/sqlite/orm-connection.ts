import type { EntityManager, MikroORM } from "@mikro-orm/core";
import {
  createSqliteOrmOptions,
  type PersistenceEntity,
} from "./orm-config.ts";

export type PersistenceDatabaseKind = "sqlite";

export type PersistenceConnectionInput = Readonly<{
  kind: PersistenceDatabaseKind;
  entities: readonly PersistenceEntity[];
  migrationsPath?: string;
  migrationsGlob?: string;
  /** Optional SQL namespace, primarily for isolated PostgreSQL contract runs. */
  schema?: string;
  debug?: boolean;
  /** SQLite database path; required when kind is `sqlite`. */
  databasePath?: string;
}>;

export type PersistenceSchemaGenerator = MikroORM["schema"];
export type PersistenceMigrator = MikroORM["migrator"];

/**
 * The small ORM surface exposed by the infrastructure composition root.
 * Domain/application callers receive capability repositories, not this type.
 */
export type PersistenceOrm = Pick<
  MikroORM,
  "em" | "close" | "isConnected" | "connect" | "schema" | "migrator"
> & {
  em: EntityManager;
};

type MikroOrmModule = {
  MikroORM: {
    init(options: object): Promise<PersistenceOrm>;
  };
  Migrator?: {
    register(orm: unknown): void;
  };
};

export type PersistenceModuleLoader = (
  specifier: string,
) => Promise<MikroOrmModule>;

const SQLITE_BUSY_TIMEOUT_MS = 5_000;
const SQLITE_CACHE_KIB = 32 * 1024;
const SQLITE_MMAP_BYTES = 64 * 1024 * 1024;

/**
 * Apply the desktop-local concurrency contract to the live SQLite handle.
 *
 * `busy_timeout` is connection-local, so it must be set on every open rather
 * than left to a one-time migration. WAL is persistent for file databases,
 * while the remaining pragmas deliberately describe each new connection.
 */
async function configureSqliteConnection(orm: PersistenceOrm): Promise<void> {
  const connection = orm.em.getConnection();
  await connection.execute(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
  await connection.execute("PRAGMA foreign_keys = ON");
  await connection.execute("PRAGMA journal_mode = WAL");
  await connection.execute("PRAGMA synchronous = NORMAL");
  // Desktop has one long-lived connection and repeatedly reads the same goal,
  // unit, and session projections. Keep those pages in-process and let SQLite
  // use memory for transient sorts instead of touching the workspace folder.
  await connection.execute(`PRAGMA cache_size = -${SQLITE_CACHE_KIB}`);
  await connection.execute(`PRAGMA mmap_size = ${SQLITE_MMAP_BYTES}`);
  await connection.execute("PRAGMA temp_store = MEMORY");
  const rawDatabase = (
    connection as typeof connection & {
      database?: { loadExtension(path: string): void };
    }
  ).database;
  if (!rawDatabase) {
    throw new Error(
      "sqlite-vec initialization failed: the SQLite driver did not expose its native connection",
    );
  }
  const sqliteVec = await import("sqlite-vec");
  sqliteVec.load(rawDatabase);
  await connection.execute("SELECT vec_version() AS version");
}

/**
 * Keep ESM-only MikroORM v7 drivers loadable from the repository's current
 * CommonJS Nest build. The specifiers are constants below; callers cannot
 * inject arbitrary modules through the public connection input.
 */
const loadMikroOrmModule: PersistenceModuleLoader = async (specifier) => {
  if (__filename.endsWith(".ts")) {
    // The source-based dev path is evaluated by jiti so it can bridge the
    // TypeScript persistence graph to ESM-only MikroORM packages. Reuse that
    // bridge for the driver imports as well; Node cannot provide an import
    // callback for code evaluated inside jiti's VM context.
    const { createJiti } = await import("jiti");
    const jiti = createJiti(process.cwd(), { moduleCache: false });
    return jiti.import(specifier) as Promise<MikroOrmModule>;
  }

  // Keep native import syntax out of the CommonJS TypeScript transform, but
  // evaluate it in the current module context so Node can provide the import
  // callback required by dynamically evaluated code.
  const dynamicImport = globalThis.eval(
    "(moduleName) => import(moduleName)",
  ) as (moduleName: string) => Promise<MikroOrmModule>;
  return dynamicImport(specifier);
};

function required(value: string | undefined, field: string): string {
  if (!value) {
    throw new Error(`Missing ${field} for persistence database`);
  }
  return value;
}

async function withMigrationExtension(
  options: object,
  migrationsPath: string | undefined,
  moduleLoader: PersistenceModuleLoader,
): Promise<object> {
  if (!migrationsPath) return options;
  const migrationsModule = await moduleLoader("@mikro-orm/migrations");
  if (!migrationsModule.Migrator) {
    throw new Error(
      "MikroORM migrations extension is unavailable while a migration history is configured",
    );
  }
  return {
    ...options,
    extensions: [migrationsModule.Migrator],
  };
}

/**
 * Opens a PostgreSQL or SQLite MikroORM connection using the same entity
 * metadata and migration contract. Driver-specific imports are deliberately
 * confined to this function; application services should depend on ports.
 */
export async function openPersistenceOrm(
  input: PersistenceConnectionInput,
  moduleLoader: PersistenceModuleLoader = loadMikroOrmModule,
): Promise<PersistenceOrm> {
  if (input.kind !== "sqlite") throw new Error("Electron persistence only supports SQLite");

  const databasePath = required(input.databasePath, "databasePath");
  const module = await moduleLoader("@mikro-orm/sqlite");
  const options = await withMigrationExtension(
    createSqliteOrmOptions({
      databasePath,
      entities: input.entities,
      migrationsPath: input.migrationsPath,
      migrationsGlob: input.migrationsGlob,
      schema: input.schema,
      debug: input.debug,
    }),
    input.migrationsPath,
    moduleLoader,
  );
  const orm = await module.MikroORM.init(options);
  try {
    await configureSqliteConnection(orm);
    return orm;
  } catch (error) {
    await orm.close(true);
    throw error;
  }
}
