import type {
  AdaptiveAssessmentTaskDeclaration,
  AdaptiveAssessmentTaskRecord,
  AdaptiveAssessmentTaskRepository,
} from "@xue-learn/core/domain";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Transaction-owning runtime adapter for adaptive task materialization. */
export class MikroOrmAdaptiveAssessmentTaskRuntimeAdapter implements AdaptiveAssessmentTaskRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  publishTasks(input: {
    userId: string;
    goalId: string;
    moduleId?: string;
    unitId?: string;
    purpose: "mastery" | "readiness";
    tasks: readonly AdaptiveAssessmentTaskDeclaration[];
  }): Promise<readonly AdaptiveAssessmentTaskRecord[]> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.adaptiveAssessmentTask.publishTasks(input),
    );
  }
}
