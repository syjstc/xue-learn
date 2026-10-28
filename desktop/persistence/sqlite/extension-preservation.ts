import type { EntityManager } from "@mikro-orm/core";

const GUARD_PREFIX = "ElectronLearningExtensionGuard_";
const destructiveActions = new Set(["CASCADE", "SET NULL", "SET DEFAULT"]);
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const literal = (text: string) => `'${text.replaceAll("'", "''")}'`;
type Row = Record<string, unknown>;
async function query(em: EntityManager, sql: string): Promise<Row[]> {
  return await em.getConnection().execute(sql, [], undefined, em.getTransactionContext()) as Row[];
}

/** Only schema metadata is inspected; retained extension payloads are never read. */
export async function installLearningExtensionPreservationGuards(
  em: EntityManager,
  ownedTables: readonly string[],
  validatedLegacyTables: readonly string[],
): Promise<{ protectedTables: number; retainedExtensionTables: number }> {
  const owned = new Set(ownedTables);
  const guardRows = await query(em, `SELECT "name" FROM sqlite_master WHERE "type"='trigger' AND "name" LIKE '${GUARD_PREFIX}%'`);
  for (const row of guardRows.filter(row => String(row.name).startsWith(GUARD_PREFIX))) await query(em, `DROP TRIGGER ${quote(String(row.name))}`);
  const protectedDeletes = new Set<string>();
  const protectedUpdates = new Map<string, Set<string>>();
  for (const extension of validatedLegacyTables) {
    const foreignKeys = await query(em, `PRAGMA foreign_key_list(${quote(extension)})`);
    for (const key of foreignKeys) {
      const parent = String(key.table);
      if (!owned.has(parent)) continue;
      if (destructiveActions.has(String(key.on_delete))) protectedDeletes.add(parent);
      if (destructiveActions.has(String(key.on_update))) {
        const columns = protectedUpdates.get(parent) ?? new Set<string>();
        if (key.to) columns.add(String(key.to));
        else {
          const parentColumns = await query(em, `PRAGMA table_info(${quote(parent)})`);
          for (const column of parentColumns.filter(column => Number(column.pk) > 0)) columns.add(String(column.name));
        }
        protectedUpdates.set(parent, columns);
      }
    }
  }
  const message = literal("ELECTRON_LEARNING_EXTENSIONS_ATTACHED: This mutation could erase or rewrite retained historical extension data. Create and verify a learning-only workspace through the controlled split/import tool before retrying; the original archive stays intact");
  for (const parent of protectedDeletes) await query(em, `CREATE TRIGGER ${quote(`${GUARD_PREFIX}${parent}_delete`)} BEFORE DELETE ON ${quote(parent)} BEGIN SELECT RAISE(ABORT, ${message}); END`);
  for (const [parent, columns] of protectedUpdates) {
    if (!columns.size) throw new Error("Historical foreign key has no reviewed referenced identity column");
    await query(em, `CREATE TRIGGER ${quote(`${GUARD_PREFIX}${parent}_update`)} BEFORE UPDATE OF ${[...columns].map(quote).join(",")} ON ${quote(parent)}
      WHEN ${[...columns].map(column => `OLD.${quote(column)} IS NOT NEW.${quote(column)}`).join(" OR ")}
      BEGIN SELECT RAISE(ABORT, ${message}); END`);
  }
  return {protectedTables: new Set([...protectedDeletes, ...protectedUpdates.keys()]).size, retainedExtensionTables: validatedLegacyTables.length};
}
