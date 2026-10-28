import type { AnyEntity, EntityClass, EntitySchema } from "@mikro-orm/core";
import type { Options as SqliteOptions } from "@mikro-orm/sqlite";

/** Entity references accepted by both SQL drivers. */
export type PersistenceEntity = EntityClass<AnyEntity> | EntitySchema | string;

export type PersistenceOrmInput = Readonly<{
  entities: readonly PersistenceEntity[];
  migrationsPath?: string;
  migrationsGlob?: string;
  /** Optional SQL namespace, primarily for isolated PostgreSQL contract runs. */
  schema?: string;
  debug?: boolean;
}>;

export type SqliteOrmInput = PersistenceOrmInput &
  Readonly<{
    databasePath: string;
  }>;

const migrations = (path: string | undefined, glob: string | undefined) =>
  path
    ? {
        path,
        pathTs: path,
        glob,
        // Migration files are reviewed source; do not write generated
        // database-specific snapshots into the repository at runtime.
        snapshot: false,
      }
    : undefined;

/**
 * Builds an embedded SQLite configuration without opening a connection. The
 * SQLite adapter is intentionally selected here, while pragmas/lifecycle and
 * vector extensions remain explicit infrastructure concerns.
 */
export function createSqliteOrmOptions(input: SqliteOrmInput): SqliteOptions {
  return {
    dbName: input.databasePath,
    entities: input.entities,
    schema: input.schema,
    debug: input.debug ?? false,
    migrations: migrations(input.migrationsPath, input.migrationsGlob),
    // FTS5 virtual tables (and their internal shadow tables) are migration-
    // owned infrastructure. SQLite reports typeless virtual columns that the
    // MikroORM schema comparator cannot normalize, so keep them outside the
    // entity diff while live contract tests verify the FTS table explicitly.
    schemaGenerator: {
      skipTables: [/^RagChunkFts(?:_.*)?$/],
    },
  } as SqliteOptions;
}
