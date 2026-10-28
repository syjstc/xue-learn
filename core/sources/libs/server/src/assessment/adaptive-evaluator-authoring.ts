import { z } from "zod";
import { buildAssessmentInvocationPrompt } from "../learning-systems/capabilities/assessment-runtime.js";
import { ASSESSMENT_GENERATION_VIEW_KEYS } from "../learning-systems/capabilities/assessment-generation-keys.js";

const cognitiveDimensionSchema = z.enum([
  "memory",
  "understanding",
  "application",
  "transfer",
  "fluency",
  "stability",
  "independence",
]);

/** The provider-facing structured result, before immutable binding checks. */
export const adaptiveEvaluatorOutputSchema = z.object({
  requirementId: z.string().min(1),
  cognitiveEntityId: z.string().min(1),
  learningTargetId: z.string().min(1),
  dimension: cognitiveDimensionSchema,
  criterionRef: z.string().min(1),
  score: z.number().min(0).max(1),
  contextNoveltyVerified: z.boolean(),
  rationale: z.string().min(1),
});

export type AdaptiveEvaluatorOutput = z.infer<
  typeof adaptiveEvaluatorOutputSchema
>;

export type AdaptiveEvaluatorInvocation = Readonly<{
  goalTitle: string;
  task: Readonly<{
    title: string;
    instructions: string;
    rubric: Record<string, unknown>;
  }>;
  requirement: Readonly<{
    id: string;
    learningTargetId: string;
    cognitiveEntityId: string;
    dimension: string;
  }>;
  criterionRef: string;
  response: Record<string, unknown>;
}>;

export type AdaptiveEvaluatorBinding = Readonly<{
  requirementId: string;
  learningTargetId: string;
  cognitiveEntityId: string;
  dimension: string;
  criterionRef: string;
}>;

export type PreparedAdaptiveEvaluator = Readonly<{
  operation: "assessment.adaptive.evaluate";
  invocation: AdaptiveEvaluatorInvocation;
  prompt: string;
  parseProviderOutput: (content: string) => AdaptiveEvaluatorOutput;
}>;

function parseJsonContent(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse((fenced?.[1] ?? trimmed).trim());
}

/** Prepare the same capability-owned prompt and structured output contract used by hosted evaluation. */
export function prepareAdaptiveEvaluator(
  invocation: AdaptiveEvaluatorInvocation,
): PreparedAdaptiveEvaluator {
  const prompt = buildAssessmentInvocationPrompt(
    ASSESSMENT_GENERATION_VIEW_KEYS.adaptiveEvaluationInstructionContext,
    invocation,
  );
  if (!prompt) throw new Error("Adaptive evaluator invocation is incomplete");
  return {
    operation: "assessment.adaptive.evaluate",
    invocation,
    prompt,
    parseProviderOutput: (content) =>
      adaptiveEvaluatorOutputSchema.parse(parseJsonContent(content)),
  };
}

/** Fail closed when a provider changes any server-owned evidence binding. */
export function assertAdaptiveEvaluatorBinding(
  output: AdaptiveEvaluatorOutput,
  binding: AdaptiveEvaluatorBinding,
): AdaptiveEvaluatorOutput {
  if (
    output.requirementId !== binding.requirementId ||
    output.learningTargetId !== binding.learningTargetId ||
    output.cognitiveEntityId !== binding.cognitiveEntityId ||
    output.dimension !== binding.dimension ||
    output.criterionRef !== binding.criterionRef
  ) {
    throw new Error(
      "Evaluator output does not match the immutable evidence binding",
    );
  }
  return output;
}

export function normalizeAdaptiveEvaluatorContextDistance(
  declared: "same" | "near" | "far",
  contextNoveltyVerified: boolean,
): "same" | "near" | "far" {
  return declared === "far" && !contextNoveltyVerified ? "near" : declared;
}
