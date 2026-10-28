import type { UnitSessionArtifactRepository } from "@xue-learn/core/domain";
import type { ReferencePersistenceRuntime } from "./runtime.ts";
export class MikroOrmUnitSessionArtifactRuntimeAdapter implements UnitSessionArtifactRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}
  inspect(input: Parameters<UnitSessionArtifactRepository["inspect"]>[0]) { return this.runtime.repositories.unitSessionArtifact.inspect(input); }
  findLatestFeynman(input: Parameters<UnitSessionArtifactRepository["findLatestFeynman"]>[0]) { return this.runtime.repositories.unitSessionArtifact.findLatestFeynman(input); }
  deleteLegacyMaterial(input: Parameters<UnitSessionArtifactRepository["deleteLegacyMaterial"]>[0]) { return this.runtime.runInTransaction(r => r.unitSessionArtifact.deleteLegacyMaterial(input)); }
  saveCornell(input: Parameters<UnitSessionArtifactRepository["saveCornell"]>[0]) { return this.runtime.runInTransaction(r => r.unitSessionArtifact.saveCornell(input)); }
  createDiagnosticAttempt(input: Parameters<UnitSessionArtifactRepository["createDiagnosticAttempt"]>[0]) { return this.runtime.runInTransaction(r => r.unitSessionArtifact.createDiagnosticAttempt(input)); }
  createFeynmanSession(input: Parameters<UnitSessionArtifactRepository["createFeynmanSession"]>[0]) { return this.runtime.runInTransaction(r => r.unitSessionArtifact.createFeynmanSession(input)); }
}
