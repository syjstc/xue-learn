export type ModuleCognitiveEntityBudget = Readonly<{
  recommendedNewMin: number;
  maximumNew: number;
  maximumWorkingSet: number;
}>;

export function moduleCognitiveEntityBudget(
  unitCount: number,
): ModuleCognitiveEntityBudget {
  const normalizedUnits = Math.max(1, Math.min(20, Math.round(unitCount)));
  const maximumNew = Math.max(8, Math.min(40, normalizedUnits * 6));
  return {
    recommendedNewMin: Math.min(maximumNew, Math.max(8, normalizedUnits * 4)),
    maximumNew,
    maximumWorkingSet: 60,
  };
}

export type ModuleKacomStructuralReadinessInput = Readonly<{
  units: readonly Readonly<{
    modelStatus: string;
    targetCount: number;
    capabilityRefs: readonly string[];
  }>[];
  expectedCapabilityRefs: readonly string[];
  workingSetEntityCount: number;
  newlyAuthoredEntityCount: number;
  entityBudget: ModuleCognitiveEntityBudget;
}>;

export type ModuleKacomStructuralReadiness =
  | Readonly<{ status: "incomplete"; reason: string }>
  | Readonly<{ status: "invalid"; reason: string }>
  | Readonly<{
      status: "audit_ready";
      entityBudget: ModuleCognitiveEntityBudget;
    }>;

/** Hosted/local deterministic gate before the semantic module KACOM audit. */
export function evaluateModuleKacomStructuralReadiness(
  input: ModuleKacomStructuralReadinessInput,
): ModuleKacomStructuralReadiness {
  if (input.units.length === 0) {
    return { status: "incomplete", reason: "Module has no lesson structure" };
  }
  if (
    input.units.some(
      (unit) => unit.modelStatus !== "expanded" || unit.targetCount === 0,
    )
  ) {
    return {
      status: "incomplete",
      reason: "Every lesson must publish targets before module audit",
    };
  }
  const covered = new Set(input.units.flatMap((unit) => unit.capabilityRefs));
  const missing = [...new Set(input.expectedCapabilityRefs)].filter(
    (ref) => !covered.has(ref),
  );
  if (missing.length > 0) {
    return {
      status: "invalid",
      reason: `Module capability coverage missing: ${missing.join(", ")}`,
    };
  }
  if (input.workingSetEntityCount > input.entityBudget.maximumWorkingSet) {
    return {
      status: "invalid",
      reason: `Module cognitive working-set budget exceeded: ${input.workingSetEntityCount}/${input.entityBudget.maximumWorkingSet}`,
    };
  }
  // A compact or reuse-only contract is valid. This is a planning recommendation,
  // not a reason to fabricate extra KACOM entities after coverage is established.
  return { status: "audit_ready", entityBudget: input.entityBudget };
}
