import type { z } from "zod";
import type { StructuredOutputOptions } from "./structured-output.js";
import { runValidatedStructuredGeneration } from "./validated-structured-generation.js";

export type StructuredInvokeOptions = StructuredOutputOptions;

/**
 * Invoke chat model with structured output (no token streaming).
 * Prefer `runStructuredOutput` with handlers when the caller can surface progress.
 */
export async function invokeWithSchema<T extends z.ZodType>(
  schema: T,
  prompt: string,
  options: StructuredInvokeOptions,
): Promise<z.infer<T>> {
  return runValidatedStructuredGeneration({
    mode: "object",
    schema,
    prompt,
    options,
  });
}
