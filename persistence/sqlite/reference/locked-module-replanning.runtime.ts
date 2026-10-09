import type {
  LockedModuleReplanningRepository,
  ReplanOwnedLockedModulesInput,
  ReplanOwnedLockedModulesResult,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Transaction-owning runtime adapter for locked-module replanning. */
export class MikroOrmLockedModuleReplanningRuntimeAdapter implements LockedModuleReplanningRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  replanOwned(
    input: ReplanOwnedLockedModulesInput,
  ): Promise<ReplanOwnedLockedModulesResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.lockedModuleReplanning.replanOwned(input),
    );
  }
}
