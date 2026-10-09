import { requireContentRevisionPersistence } from "./content-revision-persistence.js";

/**
 * Increment LearningUnit.contentRevision when stable generated content changes.
 * Call inside the same transaction as the content write when possible.
 */
export async function bumpUnitContentRevision(
  unitId: string,
  _compatibilityClient?: unknown,
): Promise<number> {
  return requireContentRevisionPersistence().bump(unitId);
}

export class StaleUnitContentRevisionError extends Error {
  constructor(
    readonly unitId: string,
    readonly expectedContentRevision: number,
    readonly currentContentRevision?: number,
  ) {
    super("单元内容已更新，请重新发起本次操作");
    this.name = "StaleUnitContentRevisionError";
  }
}

/**
 * Persist a generated SQ preview only if the unit is still on the revision
 * from which generation started. The session write and revision claim share
 * one transaction, preventing a stale generator from adopting a concurrent
 * material writer's newer revision.
 */
export async function commitSqPreviewAtRevision(params: {
  db?: unknown;
  unitId: string;
  expectedContentRevision: number;
  sq3rData: string;
}): Promise<number> {
  const result = await requireContentRevisionPersistence().commitSqPreview({
    unitId: params.unitId,
    expectedContentRevision: params.expectedContentRevision,
    sq3rData: params.sq3rData,
  });
  if (result.status === "stale") {
    throw new StaleUnitContentRevisionError(
      params.unitId,
      params.expectedContentRevision,
      result.currentContentRevision,
    );
  }
  return result.contentRevision;
}
