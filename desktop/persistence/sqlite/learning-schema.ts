import { createHash } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import baseline from "./learning-schema.v1.json";
export const ELECTRON_LEARNING_SCHEMA_ID = baseline.schemaId;
export const ELECTRON_LEARNING_SCHEMA_TABLES: readonly string[] = baseline.tableNames;
const owned = new Set(baseline.tableNames);
const identityExtras = new Set(["password", "passwordHash", "tenantId"]);
const METADATA_TABLE = "ElectronLearningSchemaAdoption";
const retiredIdentityIndexSql = 'CREATE INDEX "User_tenantId_idx" ON "User" ("tenantId")';
type Row = Record<string, unknown>;
export type LearningSchemaReport = {schemaId: string; kind: "fresh" | "legacy"; structureFingerprint: string;
  legacyHistoryFingerprint: string | null; legacyExtensionFingerprint: string | null; adoptedAt: string};
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const canonical = (value: unknown): string => {
  if (!value || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
};
const fingerprint = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const pick = (row: Row, keys: readonly string[]) => Object.fromEntries(keys.map(key => [key, row[key]]));
const sorted = (values: Row[]) => values.sort((a, b) => canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0);
const normalize = (sql: string) => sql.replace(/\s+/g, " ").trim();
const isManaged = (name: string, type: unknown = "table") =>
  type === "table" && /^RagChunkFts_(?:config|content|data|docsize|idx)$/.test(name) ||
  type === "trigger" && (/^PersonalSyncCapture_/.test(name) || /^ElectronLearningExtensionGuard_/.test(name));
const expectedCoreObjects = new Map(baseline.coreObjects.map(object => [object.name, object]));
const expectedTableSql = new Map(baseline.tableNames.map((name, index) => [name, normalize(baseline.statements[index]!)]));
async function query(em: EntityManager, sql: string, params: unknown[] = []): Promise<Row[]> {
  return await em.getConnection().execute(sql, params, undefined, em.getTransactionContext()) as Row[];
}
function unsupported(message: string): never {
  throw new Error(`ELECTRON_LEARNING_SCHEMA_UNSUPPORTED: ${message}. Preserve this workspace and use a supported upgrade/import; no migration history was marked complete`);
}
async function inspect(em: EntityManager) {
  const objects = await query(em, `SELECT type, name, tbl_name AS "tableName", sql FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY type, name`);
  const actualTables = new Set(objects.filter(row => row.type === "table").map(row => String(row.name)));
  const missing = baseline.tableNames.filter(name => !actualTables.has(name));
  if (missing.length) unsupported(`Learning schema is incomplete (missing ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? ", …" : ""})`);
  const structure: Row[] = [];
  for (const name of baseline.tableNames) {
    const columnRows = await query(em, `PRAGMA table_xinfo(${quote(name)})`);
    const columns = columnRows.filter(row => !(name === "User" && identityExtras.has(String(row.name))))
      .map(row => pick(row, ["name", "type", "notnull", "dflt_value", "pk", "hidden"])).sort((a, b) => String(a.name) < String(b.name) ? -1 : 1);
    const foreignKeys = sorted((await query(em, `PRAGMA foreign_key_list(${quote(name)})`)).map(row => pick(row, ["table", "from", "to", "on_update", "on_delete", "match", "seq"])));
    const indexes: Row[] = [];
    for (const index of await query(em, `PRAGMA index_list(${quote(name)})`)) {
      const cols = (await query(em, `PRAGMA index_xinfo(${quote(String(index.name))})`)).map(row => pick(row, ["name", "desc", "coll", "key"]));
      if (name === "User" && cols.filter(row => row.key).every(row => row.name == null || identityExtras.has(String(row.name)))) continue;
      indexes.push({name: index.name, unique: index.unique, origin: index.origin, partial: index.partial, columns: cols});
    }
    indexes.sort((a, b) => String(a.name) < String(b.name) ? -1 : 1);
    structure.push({name, columns, foreignKeys, indexes});
    let sql = String(objects.find(object => object.type === "table" && object.name === name)?.sql ?? "");
    if (name === "User") sql = sql.replace(/^\s*"(?:password|passwordHash|tenantId)" TEXT,?\n/gm, "");
    if (normalize(sql) !== expectedTableSql.get(name)) unsupported(`Table ${name} differs from the reviewed learning schema`);
  }
  const structureFingerprint = fingerprint(structure);
  if (structureFingerprint !== baseline.structureFingerprint) unsupported("Learning columns, keys or indexes differ from the reviewed schema");
  for (const expected of baseline.coreObjects) {
    const actual = objects.find(object => object.name === expected.name && object.type === expected.type);
    if (!actual || normalize(String(actual.sql)) !== normalize(expected.sql)) unsupported(`Required ${expected.type} ${expected.name} differs from its reviewed definition`);
  }
  for (const object of objects) {
    if (object.type === "table" || isManaged(String(object.name), object.type) || !owned.has(String(object.tableName))) continue;
    if (expectedCoreObjects.has(String(object.name))) continue;
    if (object.tableName === "User" && object.name === "User_tenantId_idx") {
      if (normalize(String(object.sql)) !== retiredIdentityIndexSql) unsupported("Retired identity index differs from the reviewed legacy definition");
      continue;
    }
    unsupported(`Unreviewed ${object.type} on learning table ${object.tableName}`);
  }
  const extensions = objects.filter(object => object.name !== "mikro_orm_migrations" && object.name !== METADATA_TABLE &&
    !isManaged(String(object.name), object.type) && !owned.has(String(object.tableName)) && object.name !== "MainCourseSection");
  return {structureFingerprint, extensionFingerprint: fingerprint(extensions), actualTables};
}
async function readAdoptionReport(em: EntityManager, checked: Awaited<ReturnType<typeof inspect>>): Promise<LearningSchemaReport> {
  if (!checked.actualTables.has(METADATA_TABLE)) unsupported("Learning schema has not passed the adoption gate");
  const rows = await query(em, `SELECT "schemaId", "reportJson" FROM ${quote(METADATA_TABLE)} WHERE "id"='primary'`);
  const saved = rows[0]?.reportJson;
  if (typeof saved !== "string" || rows[0]?.schemaId !== baseline.schemaId) unsupported("Schema adoption metadata is incomplete");
  let report: LearningSchemaReport;
  try { report = JSON.parse(saved) as LearningSchemaReport; }
  catch { unsupported("Schema adoption metadata is invalid JSON"); }
  if (report.schemaId !== baseline.schemaId || report.structureFingerprint !== checked.structureFingerprint || !["fresh", "legacy"].includes(report.kind))
    unsupported("Schema adoption metadata has an incompatible version");
  if (report.kind === "legacy") {
    const history = (await query(em, `SELECT "name" FROM "mikro_orm_migrations" ORDER BY "name"`)).map(row => String(row.name));
    if (fingerprint(history) !== baseline.legacyHistoryFingerprint || report.legacyHistoryFingerprint !== baseline.legacyHistoryFingerprint)
      unsupported("Historical migration provenance changed after validated adoption");
    if (checked.extensionFingerprint !== baseline.legacyExtensionFingerprint || report.legacyExtensionFingerprint !== baseline.legacyExtensionFingerprint)
      unsupported("Historical extension schema changed after validated adoption");
  } else if (checked.extensionFingerprint !== fingerprint([])) unsupported("Fresh learning workspace contains unreviewed extension schema");
  return report;
}
/** Validate first, then record ownership in a separate metadata table. No legacy table or row is rewritten. */
export async function migrateElectronLearningSchema(em: EntityManager): Promise<LearningSchemaReport> {
  return em.fork().transactional(async tx => {
    const tables = await query(tx, `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`);
    const nonMetadata = tables.filter(table => table.name !== "mikro_orm_migrations");
    let report: LearningSchemaReport;
    if (!nonMetadata.length) {
      for (const statement of baseline.statements) await query(tx, statement);
      const checked = await inspect(tx);
      report = {schemaId: baseline.schemaId, kind: "fresh", structureFingerprint: checked.structureFingerprint,
        legacyHistoryFingerprint: null, legacyExtensionFingerprint: null, adoptedAt: new Date().toISOString()};
    } else {
      const checked = await inspect(tx);
      if (checked.actualTables.has(METADATA_TABLE)) {
        report = await readAdoptionReport(tx, checked);
        return report;
      }
      if (!checked.actualTables.has("mikro_orm_migrations")) unsupported("Existing workspace has no supported migration provenance");
      const history = (await query(tx, `SELECT "name" FROM "mikro_orm_migrations" ORDER BY "name"`)).map(row => String(row.name));
      const historyFingerprint = fingerprint(history);
      if (historyFingerprint !== baseline.legacyHistoryFingerprint) unsupported("Existing migration provenance is not one of the verified legacy baselines");
      if (checked.extensionFingerprint !== baseline.legacyExtensionFingerprint) unsupported("Historical extension schema differs from the verified legacy baseline");
      report = {schemaId: baseline.schemaId, kind: "legacy", structureFingerprint: checked.structureFingerprint,
        legacyHistoryFingerprint: historyFingerprint, legacyExtensionFingerprint: checked.extensionFingerprint, adoptedAt: new Date().toISOString()};
    }
    await query(tx, `CREATE TABLE ${quote(METADATA_TABLE)} ("id" TEXT PRIMARY KEY, "schemaId" TEXT NOT NULL, "reportJson" TEXT NOT NULL)`);
    await query(tx, `INSERT INTO ${quote(METADATA_TABLE)} ("id","schemaId","reportJson") VALUES ('primary',?,?)`, [baseline.schemaId, JSON.stringify(report)]);
    return report;
  });
}
/** Publication gate for an already adopted workspace; extra obsolete tables remain untouched. */
export async function assertElectronLearningSchema(em: EntityManager): Promise<void> { await readAdoptionReport(em, await inspect(em)); }

/** Hosts can omit unchanged historical extension tables from sync coverage only after validation. */
export async function validatedLegacyLearningExtensionTables(em:EntityManager):Promise<readonly string[]> {
  const exists=await query(em,`SELECT name FROM sqlite_master WHERE type='table' AND name='ElectronLearningSchemaAdoption'`);
  if(!exists.length)return [];
  const rows=await query(em,`SELECT "reportJson" FROM "ElectronLearningSchemaAdoption" WHERE "id"='primary'`);
  const report=JSON.parse(String(rows[0]?.reportJson??"{}")) as LearningSchemaReport;
  if(report.kind!=="legacy")return [];
  const checked=await inspect(em);
  if(checked.extensionFingerprint!==baseline.legacyExtensionFingerprint)unsupported("Historical extension schema no longer matches validated adoption");
  return [...checked.actualTables].filter(name=>!owned.has(name)&&name!=="ElectronLearningSchemaAdoption"&&!isManaged(name)&&name!=="mikro_orm_migrations");
}
