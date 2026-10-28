/** Retired hosted identity fields are never part of portable learner facts. */
export const legacyIdentityColumnNames = new Set(["password", "passwordHash", "tenantId"]);
export function isPortablePersonalSyncColumn(tableName:string,columnName:string):boolean {
  return tableName!=="User" || !legacyIdentityColumnNames.has(columnName);
}
export function portablePersonalSyncRow<T extends Record<string,unknown>|null>(tableName:string,row:T):T {
  if(!row||tableName!=="User")return row;
  return Object.fromEntries(Object.entries(row).filter(([key])=>isPortablePersonalSyncColumn(tableName,key))) as T;
}
