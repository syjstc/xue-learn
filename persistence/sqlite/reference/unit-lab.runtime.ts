import type { UnitLabRepository } from "@xue-learn/core/source/libs/domain/src/index.ts";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

export class MikroOrmUnitLabRuntimeAdapter implements UnitLabRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  findContext(input: Parameters<UnitLabRepository["findContext"]>[0]) {
    return this.runtime.repositories.unitLab.findContext(input);
  }
  findLab(unitId: string) {
    return this.runtime.repositories.unitLab.findLab(unitId);
  }
  findLabContent(input: Parameters<UnitLabRepository["findLabContent"]>[0]) {
    return this.runtime.repositories.unitLab.findLabContent(input);
  }
  findLabSession(input: Parameters<UnitLabRepository["findLabSession"]>[0]) {
    return this.runtime.repositories.unitLab.findLabSession(input);
  }
  recommend(input: Parameters<UnitLabRepository["recommend"]>[0]) {
    return this.runtime.runInTransaction((r) => r.unitLab.recommend(input));
  }
  invalidate(unitId: string) {
    return this.runtime.runInTransaction((r) => r.unitLab.invalidate(unitId));
  }
  enqueue(input: Parameters<UnitLabRepository["enqueue"]>[0]) {
    return this.runtime.runInTransaction((r) => r.unitLab.enqueue(input));
  }
  beginPreparation(
    input: Parameters<UnitLabRepository["beginPreparation"]>[0],
  ) {
    return this.runtime.runInTransaction((r) =>
      r.unitLab.beginPreparation(input),
    );
  }
  publishPrepared(input: Parameters<UnitLabRepository["publishPrepared"]>[0]) {
    return this.runtime.runInTransaction((r) =>
      r.unitLab.publishPrepared(input),
    );
  }
  publishRegeneratedItem(
    input: Parameters<UnitLabRepository["publishRegeneratedItem"]>[0],
  ) {
    return this.runtime.runInTransaction((r) =>
      r.unitLab.publishRegeneratedItem(input),
    );
  }
  publishRegeneratedItemAndBumpContentRevision(
    input: Parameters<
      UnitLabRepository["publishRegeneratedItemAndBumpContentRevision"]
    >[0],
  ) {
    return this.runtime.runInTransaction((r) =>
      r.unitLab.publishRegeneratedItemAndBumpContentRevision(input),
    );
  }
  markFailed(input: Parameters<UnitLabRepository["markFailed"]>[0]) {
    return this.runtime.runInTransaction((r) => r.unitLab.markFailed(input));
  }
  bumpContentRevision(unitId: string) {
    return this.runtime.runInTransaction((r) =>
      r.unitLab.bumpContentRevision(unitId),
    );
  }
  markOpened(input: Parameters<UnitLabRepository["markOpened"]>[0]) {
    return this.runtime.runInTransaction((r) => r.unitLab.markOpened(input));
  }
  markCompleted(input: Parameters<UnitLabRepository["markCompleted"]>[0]) {
    return this.runtime.runInTransaction((r) => r.unitLab.markCompleted(input));
  }
}
