import { migrateElectronLearningSchema, assertElectronLearningSchema } from "./learning-schema.ts";
import type { PersistenceOrm } from "./orm-connection.ts";

export type PersistenceSchemaDiff = Readonly<{
  sql: string;
  safe: boolean;
}>;

export type PersistenceSchemaSafetyOptions = Readonly<{
  kind?: "sqlite";
}>;

/**
 * SQLite does not retain foreign-key constraint names in its catalog. The
 * MikroORM comparator consequently reports a table rebuild when a migrated
 * table keeps the hosted PostgreSQL name (`*_fkey`) but metadata uses that
 * same name. The live contract separately checks the SQLite FK semantics.
 */
function isKnownSqliteForeignKeyNameOnlyDiff(sql: string): boolean {
  const normalized = sql.replace(/\s+/g, " ").trim();
  const tableName = normalized.match(
    /^pragma foreign_keys = off; create table `([^`]+)__temp_alter`/,
  )?.[1];
  const expectedForeignKeyName = {
    UserSettings: "UserSettings_userId_fkey",
    TeachingPersona: "TeachingPersona_userId_fkey",
    LearnerPlanningSettings: "LearnerPlanningSettings_userId_fkey",
    LearningSpace: "LearningSpace_userId_fkey",
  }[tableName ?? ""];
  if (!expectedForeignKeyName) return false;
  return (
    normalized.includes(
      `constraint \`${expectedForeignKeyName}\` foreign key (\`userId\`) references \`User\` (\`id\`) on update cascade on delete cascade`,
    ) && normalized.endsWith("pragma foreign_keys = on;")
  );
}

/** Apply only the selected database's migration history. */
export async function migratePersistenceOrm(
  orm: PersistenceOrm,
  schema?: string,
): Promise<readonly unknown[]> {
  if (schema) throw new Error("Electron learning SQLite does not use SQL namespaces");
  return [await migrateElectronLearningSchema(orm.em)];
}

/**
 * Checks entity metadata against the live database without allowing schema
 * mutation. Callers use this as a publication/startup gate after migrations.
 */
export async function inspectPersistenceSchema(
  orm: PersistenceOrm,
  options: PersistenceSchemaSafetyOptions = {},
): Promise<PersistenceSchemaDiff> {
  const adopted = await orm.em.getConnection().execute(`SELECT name FROM sqlite_master WHERE type='table' AND name='ElectronLearningSchemaAdoption'`) as unknown[];
  if (adopted.length) {
    try { await assertElectronLearningSchema(orm.em); return {sql: "", safe: true}; }
    catch (error) { return {sql: error instanceof Error ? error.message : String(error), safe: false}; }
  }
  const sql = await orm.schema.getUpdateSchemaSQL({
    safe: true,
    dropTables: false,
  });
  return {
    sql,
    safe:
      sql.trim().length === 0 ||
      (options.kind === "sqlite" && isKnownSqliteForeignKeyNameOnlyDiff(sql)),
  };
}

export async function assertPersistenceSchemaSafe(
  orm: PersistenceOrm,
  options: PersistenceSchemaSafetyOptions = {},
): Promise<void> {
  const diff = await inspectPersistenceSchema(orm, options);
  if (!diff.safe) {
    throw new Error(
      `Persistence schema differs from registered entities:\n${diff.sql}`,
    );
  }
}
