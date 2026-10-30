import { pathModuleSchema } from "./learning-path-contract.js";

type PathLessonRow = {
  id: string;
  title: string;
  orderIndex: number;
  unitPlanningBrief: unknown;
};

/** Bind symbolic path edges to host-owned unit IDs after skeleton publication. */
export function resolvePathLessonPrerequisites(rows: readonly PathLessonRow[]) {
  const indexed = rows.flatMap((row) => {
    const brief = typeof row.unitPlanningBrief === "string"
      ? JSON.parse(row.unitPlanningBrief || "{}")
      : row.unitPlanningBrief;
    const context = brief && typeof brief === "object"
      ? (brief as { pathContract?: { contract?: unknown } }).pathContract
      : undefined;
    if (!context) return [];
    const contract = pathModuleSchema.parse(context.contract);
    const unit = contract.units[row.orderIndex];
    if (!unit || unit.title !== row.title) return []; // adaptive/legacy lessons
    return [{ id: row.id, unit }];
  });
  const ids = new Map(indexed.map((row) => [row.unit.unitRef, row.id]));
  return indexed.flatMap(({ id, unit }) => {
    const sources = [...new Set(unit.requires.map((entry) => entry.source))]
      .filter((source) => source !== "baseline");
    // Module drafts may arrive out of order. Reconcile again after each publish;
    // never replace an unresolved real dependency with the previous lesson.
    if (sources.some((source) => !ids.has(source))) return [];
    return [{ unitId: id, prerequisites: sources.map((source) => ids.get(source)!) }];
  });
}
