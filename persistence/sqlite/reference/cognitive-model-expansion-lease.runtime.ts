import type {
  ClaimCognitiveModelExpansionInput,
  ClaimCognitiveModelExpansionResult,
  CognitiveModelExpansionLeaseRepository,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Transaction-owning composition adapter for the unit expansion lease. */
export class MikroOrmCognitiveModelExpansionLeaseRuntimeAdapter implements CognitiveModelExpansionLeaseRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  claim(
    input: ClaimCognitiveModelExpansionInput,
  ): Promise<ClaimCognitiveModelExpansionResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.cognitiveModelExpansionLease.claim(input),
    );
  }

  readState(input: { goalId: string; unitId: string }) {
    return this.runtime.repositories.cognitiveModelExpansionLease.readState(input);
  }

  fail(input: Parameters<CognitiveModelExpansionLeaseRepository["fail"]>[0]) {
    return this.runtime.runInTransaction((repositories) =>
      repositories.cognitiveModelExpansionLease.fail(input),
    );
  }
}
