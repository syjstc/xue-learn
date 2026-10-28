export function goalPlanApprovalAction(input: {
  isSequentialPlan: boolean;
  legacyGenerationEnabled: boolean;
}): "navigate" | "generate-map" {
  return input.isSequentialPlan || !input.legacyGenerationEnabled
    ? "navigate"
    : "generate-map";
}
