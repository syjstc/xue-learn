import type {
  CognitiveModelGoalReadRecord,
  CognitiveModelPresentationReadRepository,
  CognitiveModelUnitReadRecord,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Runtime adapter for cognitive-model presentation inputs. */
export class MikroOrmCognitiveModelPresentationReadRuntimeAdapter implements CognitiveModelPresentationReadRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  findGoal(input: {
    goalId: string;
  }): Promise<CognitiveModelGoalReadRecord | null> {
    return this.runtime.repositories.cognitiveModelPresentationRead.findGoal(
      input,
    );
  }

  findUnit(input: {
    unitId: string;
  }): Promise<CognitiveModelUnitReadRecord | null> {
    return this.runtime.repositories.cognitiveModelPresentationRead.findUnit(
      input,
    );
  }
}
