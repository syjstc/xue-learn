export const ADAPTIVE_EVALUATOR_AUTHORITY_REGISTRY = {
  rubric_llm_v1: {
    evaluatorType: "llm" as const,
    evaluatorRef: "authority:adaptive-rubric-llm:v1",
    evaluatorReliability: 0.8,
    groundingReliability: 0.9,
    evidenceStrength: "moderate" as const,
  },
} as const;

export type AdaptiveEvaluatorAuthorityKey =
  keyof typeof ADAPTIVE_EVALUATOR_AUTHORITY_REGISTRY;

export function resolveAdaptiveEvaluatorAuthority(
  key: AdaptiveEvaluatorAuthorityKey,
) {
  const authority = ADAPTIVE_EVALUATOR_AUTHORITY_REGISTRY[key];
  if (!authority) {
    throw new Error("Adaptive evaluator authority is not registered");
  }
  return authority;
}
