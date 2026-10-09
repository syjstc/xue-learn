import type { MaterialFollowUpRepository } from "@xue-learn/core/domain";
import type { ReferencePersistenceRuntime } from "./runtime.ts";
export class MikroOrmMaterialFollowUpRuntimeAdapter implements MaterialFollowUpRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}
  listForUnit(userId: string, unitId: string) { return this.runtime.repositories.materialFollowUp.listForUnit(userId,unitId); }
  listRecent(userId: string, limit: number) { return this.runtime.repositories.materialFollowUp.listRecent(userId,limit); }
  findUnitContext(userId: string, unitId: string) { return this.runtime.repositories.materialFollowUp.findUnitContext(userId,unitId); }
  findThread(userId: string, unitId: string, threadId: string) { return this.runtime.repositories.materialFollowUp.findThread(userId,unitId,threadId); }
  saveConversation(input: Parameters<MaterialFollowUpRepository["saveConversation"]>[0]) { return this.runtime.runInTransaction(r => r.materialFollowUp.saveConversation(input)); }
  delete(userId: string, unitId: string, threadId: string) { return this.runtime.runInTransaction(r => r.materialFollowUp.delete(userId,unitId,threadId)); }
}
