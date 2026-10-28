/**
 * Resolve the learner destination after a diagnostic is submitted.
 *
 * Module diagnostics return a module id, while unit diagnostics return a unit
 * id. Keeping that distinction in one shared helper prevents the renderer from
 * treating a module id as a unit route on either hosted or desktop-local.
 */
export function diagnosticCompletionPath(input: {
  goalId: string;
  unitId: string;
  moduleId: string;
  isModuleDiagnostic: boolean;
  passed: boolean;
  nextId?: string | null;
  remediationUnitId?: string | null;
}): string {
  if (input.isModuleDiagnostic) {
    return input.passed && input.nextId
      ? `/goals/${input.goalId}/modules/${input.nextId}`
      : `/goals/${input.goalId}`;
  }
  if (input.passed && input.nextId) {
    return `/goals/${input.goalId}/units/${input.nextId}`;
  }
  if (input.passed) return `/goals/${input.goalId}`;
  if (input.remediationUnitId) {
    return `/goals/${input.goalId}/units/${input.remediationUnitId}`;
  }
  return `/goals/${input.goalId}/units/${input.unitId}?focus=target-gaps`;
}
