import type { UnitSubdivisionRepository } from "@xue-learn/core/source/libs/domain/src/index.ts";
import type { ReferencePersistenceRuntime } from "./runtime.ts";
export class MikroOrmUnitSubdivisionRuntimeAdapter implements UnitSubdivisionRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}
  getStatus(unitId: string, userId?: string) { return this.runtime.repositories.unitSubdivision.getStatus(unitId, userId); }
  saveSteps(input: Parameters<UnitSubdivisionRepository["saveSteps"]>[0]) { return this.runtime.runInTransaction(r => r.unitSubdivision.saveSteps(input)); }
  applyStructural(input: Parameters<UnitSubdivisionRepository["applyStructural"]>[0]) { return this.runtime.runInTransaction(async r => { const result = await r.unitSubdivision.applyStructural(input); if (result.status === "applied") await r.cognitiveModelPublication.publishMappingOnlyRevision({ goalId: result.goalId, reason: input.replaceExisting ? "unit_structural_submap_regenerated" : "unit_structurally_subdivided" }); return result; }); }
  remove(unitId: string) { return this.runtime.runInTransaction(async r => { const result = await r.unitSubdivision.remove(unitId); if (result.status === "applied" && result.mode === "structural") await r.cognitiveModelPublication.publishMappingOnlyRevision({ goalId: result.goalId, reason: "unit_structural_submap_removed" }); return result; }); }
}
