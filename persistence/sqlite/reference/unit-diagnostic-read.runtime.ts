import type {
  UnitDiagnosticAttemptRecord,
  UnitDiagnosticReadRecord,
  UnitDiagnosticReadRepository,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Runtime adapter for learner-owned diagnostic reads. */
export class MikroOrmUnitDiagnosticReadRuntimeAdapter implements UnitDiagnosticReadRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  listGoalUnits(input: { userId: string; goalId: string }) {
    return this.runtime.repositories.unitDiagnosticRead.listGoalUnits(input);
  }

  findUnit(input: {
    userId: string;
    unitId: string;
  }): Promise<UnitDiagnosticReadRecord | null> {
    return this.runtime.repositories.unitDiagnosticRead.findUnit(input);
  }

  findAttempt(input: {
    userId: string;
    unitId: string;
    attemptId: string;
  }): Promise<UnitDiagnosticAttemptRecord | null> {
    return this.runtime.repositories.unitDiagnosticRead.findAttempt(input);
  }
}
