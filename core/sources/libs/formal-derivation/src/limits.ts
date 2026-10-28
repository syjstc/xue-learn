export const DERIVATION_SCHEMA_VERSION = 1 as const;

export const DERIVATION_LIMITS = Object.freeze({
  maxActionsPerStep: 8,
  maxFormulasIntroducedPerStep: 8,
  maxNodesPerFormula: 200,
  maxStepsPerRun: 80,
  maxFocusHighlightTargets: 12,
  checkpointInterval: 24,
  minCasesPerSplit: 2,
  maxCasesPerSplit: 6,
  maxExpansionDepth: 1,
  minExpansionSteps: 2,
  maxExpansionSteps: 12,
});

export const LAGRANGE_RULE_IDS = [
  "define_secant_slope",
  "define_auxiliary_function",
  "substitute_endpoint",
  "substitute_definition",
  "cancel_nonzero_factor",
  "differentiate_difference",
  "rolle_theorem",
  "solve_linear_equality",
] as const;

export type LagrangeRuleId = (typeof LAGRANGE_RULE_IDS)[number];

export const REGISTERED_RULE_IDS: readonly string[] = LAGRANGE_RULE_IDS;
