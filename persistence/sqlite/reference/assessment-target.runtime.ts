import type {
  AssessmentTargetRecord,
  AssessmentTargetRepository,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Runtime adapter for learner-owned assessment target reads. */
export class MikroOrmAssessmentTargetRuntimeAdapter implements AssessmentTargetRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  ensureQuizAssessableForUnit(input: { userId: string; unitId: string }) {
    return this.runtime.runInTransaction((repositories) =>
      repositories.assessmentTarget.ensureQuizAssessableForUnit(input),
    );
  }

  ensureQuizAssessableForModule(input: { userId: string; moduleId: string }) {
    return this.runtime.runInTransaction((repositories) =>
      repositories.assessmentTarget.ensureQuizAssessableForModule(input),
    );
  }

  findForUnit(input: {
    userId: string;
    unitId: string;
  }): Promise<readonly AssessmentTargetRecord[]> {
    return this.runtime.repositories.assessmentTarget.findForUnit(input);
  }

  findForModule(input: {
    userId: string;
    moduleId: string;
    role?: "entry" | "exit";
  }): Promise<readonly AssessmentTargetRecord[]> {
    return this.runtime.repositories.assessmentTarget.findForModule(input);
  }

  findForGoal(input: {
    userId: string;
    goalId: string;
  }): Promise<readonly AssessmentTargetRecord[]> {
    return this.runtime.repositories.assessmentTarget.findForGoal(input);
  }
}
