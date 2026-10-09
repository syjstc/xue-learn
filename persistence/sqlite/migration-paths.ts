import { resolve } from "node:path";
import type { PersistenceDatabaseKind } from "./orm-connection.ts";

/** Source-relative histories stay separate because hosted and local schemas have different baselines. */
export const persistenceMigrationDirectories = Object.freeze({
  // PostgreSQL migrations are split into two source folders for historical
  // ownership, but they are one ordered MikroORM history at runtime.
  sqlite: "persistence/sqlite/migrations",
} satisfies Record<PersistenceDatabaseKind, string>);

export const persistenceMigrationGlobs = Object.freeze({
  sqlite: "*.ts",
} satisfies Record<PersistenceDatabaseKind, string>);

export function resolvePersistenceMigrationsPath(
  kind: PersistenceDatabaseKind,
  rootDirectory = process.cwd(),
): string {
  return resolve(rootDirectory, persistenceMigrationDirectories[kind]);
}

export function resolvePersistenceMigrationsGlob(
  kind: PersistenceDatabaseKind,
): string {
  return persistenceMigrationGlobs[kind];
}
