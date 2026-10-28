import { decideModuleDiagnosticPass } from "../assessment/module-diagnostic-application.js";

const LEARNED_UNIT_STATUSES = new Set([
  "completed",
  "completed_needs_reinforcement",
]);

export function areRequiredModuleUnitsComplete(
  units: ReadonlyArray<{ status: string }>,
): boolean {
  return (
    units.length > 0 &&
    units.every((unit) => LEARNED_UNIT_STATUSES.has(unit.status))
  );
}

export function passesModuleDiagnostic(params: {
  overallScore: number;
  capabilities: ReadonlyArray<{
    criticalCompletionGate: boolean;
    passed: boolean;
  }>;
}): boolean {
  return decideModuleDiagnosticPass(params);
}
