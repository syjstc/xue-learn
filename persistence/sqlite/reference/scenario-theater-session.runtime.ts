import type { ScenarioTheaterSessionRepository } from "@xue-learn/core/domain";
import type { ReferencePersistenceRuntime } from "./runtime.ts";
export class MikroOrmScenarioTheaterSessionRuntimeAdapter implements ScenarioTheaterSessionRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}
  load(input: Parameters<ScenarioTheaterSessionRepository["load"]>[0]) { return this.runtime.repositories.scenarioTheaterSession.load(input); }
  findRun(input: Parameters<ScenarioTheaterSessionRepository["findRun"]>[0]) { return this.runtime.repositories.scenarioTheaterSession.findRun(input); }
  createOrReuse(input: Parameters<ScenarioTheaterSessionRepository["createOrReuse"]>[0]) { return this.runtime.runInTransaction(r => r.scenarioTheaterSession.createOrReuse(input)); }
  restart(input: Parameters<ScenarioTheaterSessionRepository["restart"]>[0]) { return this.runtime.runInTransaction(r => r.scenarioTheaterSession.restart(input)); }
  commitChoice(input: Parameters<ScenarioTheaterSessionRepository["commitChoice"]>[0]) { return this.runtime.runInTransaction(r => r.scenarioTheaterSession.commitChoice(input)); }
}
