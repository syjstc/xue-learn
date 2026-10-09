import type {
  ProjectBlueprintRepository,
  PublishProjectBlueprintInput,
  PublishProjectBlueprintResult,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Transaction-owning runtime adapter for capstone blueprint publication. */
export class MikroOrmProjectBlueprintRuntimeAdapter implements ProjectBlueprintRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  findCurrentPublication(goalId: string) {
    return this.runtime.repositories.projectBlueprint.findCurrentPublication(goalId);
  }

  publish(
    input: PublishProjectBlueprintInput,
  ): Promise<PublishProjectBlueprintResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.projectBlueprint.publish(input),
    );
  }

  deprecateStale(input: {
    goalId: string;
    blueprintHash?: string;
  }): Promise<number> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.projectBlueprint.deprecateStale(input),
    );
  }
}
