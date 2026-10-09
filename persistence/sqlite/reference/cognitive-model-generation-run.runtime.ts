import type {
  AppendCognitiveModelRunEventInput,
  CognitiveModelGenerationRunRepository,
  CognitiveModelRunEventRecord,
  CognitiveModelRunRecord,
  FinishCognitiveModelRunInput,
  FindCognitiveModelRunInput,
  ReadCognitiveModelRunEventInput,
  StartCognitiveModelRunInput,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Transaction-owning composition adapter for unit generation runs/events. */
export class MikroOrmCognitiveModelGenerationRunRuntimeAdapter implements CognitiveModelGenerationRunRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  start(input: StartCognitiveModelRunInput): Promise<CognitiveModelRunRecord> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.cognitiveModelGenerationRun.start(input),
    );
  }

  findLatest(
    input: FindCognitiveModelRunInput,
  ): Promise<CognitiveModelRunRecord | null> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.cognitiveModelGenerationRun.findLatest(input),
    );
  }

  readLatestEvent(
    input: ReadCognitiveModelRunEventInput,
  ): Promise<CognitiveModelRunEventRecord | null> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.cognitiveModelGenerationRun.readLatestEvent(input),
    );
  }

  appendEvent(input: AppendCognitiveModelRunEventInput): Promise<boolean> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.cognitiveModelGenerationRun.appendEvent(input),
    );
  }

  finish(input: FinishCognitiveModelRunInput): Promise<boolean> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.cognitiveModelGenerationRun.finish(input),
    );
  }
}
