import type { z } from "zod";
import type { TopicCategory } from "../../../common/src/index.js";
import { streamChat, type StreamTokenHandler } from "./chat-stream.js";
import { resolveCompactBindingSchema } from "./compact-schemas.js";
import {
  appendCompactJsonPrompt,
  COMPACT_JSON_INSTRUCTION,
  isPromptJsonShape,
} from "./schema-shapes.js";
import {
  formatStructuredParseError,
  parseStructuredLlmJson,
  STRUCTURED_PARSE_MAX_ATTEMPTS,
} from "./parse-structured.js";
import { streamStructuredNative } from "./structured-native.js";
import { getLlmProvider } from "./providers/index.js";
import { projectProviderBindingSchema } from "../providers/llm/provider-binding-schema.js";
import {
  createStructuredDeadline,
  type ResolvedStructuredContract,
  structuredContractLogMeta,
} from "./structured-contract.js";

function buildPromptJsonStreamPrompt(
  prompt: string,
  schemaShape?: string,
  validationError?: string,
  bindingSchema?: z.ZodType | Record<string, unknown>,
): string {
  const shape = isPromptJsonShape(schemaShape) ? schemaShape : undefined;
  const projectedSchema =
    !shape && bindingSchema
      ? JSON.stringify(projectProviderBindingSchema(bindingSchema))
      : undefined;
  const basePrompt = shape
    ? appendCompactJsonPrompt(prompt, shape)
    : projectedSchema
      ? `${prompt}

Required JSON Schema (use the exact field names and nesting):
${projectedSchema}`
      : prompt;
  const jsonInstruction =
    "Respond with ONLY a single minified JSON object. Do not include thinking tags or markdown.";
  if (!validationError) {
    return `${basePrompt}\n\n${jsonInstruction}`;
  }

  return `${basePrompt}

Your previous JSON failed validation: ${validationError}
Return ONLY a corrected JSON object that satisfies the required schema. Do not include thinking tags or markdown.`;
}

function isStructuredNativeOutputError(error: unknown): boolean {
  return error instanceof Error && error.name === "StructuredNativeOutputError";
}

function nativeCandidateHash(error: unknown): string | undefined {
  if (!isStructuredNativeOutputError(error)) return undefined;
  const value = (error as { candidateHash?: unknown }).candidateHash;
  return typeof value === "string" ? value : undefined;
}

class PromptJsonValidationError extends Error {
  constructor(readonly originalError: unknown) {
    super(formatStructuredParseError(originalError));
    this.name = "PromptJsonValidationError";
  }
}

async function streamPromptJsonAttempt<T extends z.ZodType>(
  schema: T,
  prompt: string,
  operation: string,
  meta: Record<string, unknown>,
  attempt: number,
  validationError?: string,
  onToken?: StreamTokenHandler,
  signal?: AbortSignal,
  schemaShape?: string,
  bindingSchema?: z.ZodType | Record<string, unknown>,
  contract?: ResolvedStructuredContract,
  onProgress?: () => void,
): Promise<z.infer<T>> {
  const fullPrompt = buildPromptJsonStreamPrompt(
    prompt,
    schemaShape,
    validationError,
    bindingSchema ?? schema,
  );
  const op = attempt === 0 ? operation : `${operation}.retry`;
  const lastRaw = await streamChat(fullPrompt, {
    operation: op,
    meta: {
      ...meta,
      ...(contract ? structuredContractLogMeta(contract) : {}),
      parseAttempt: attempt + 1,
      structuredAttempt: attempt + 1,
      structuredTransport: "prompt-json",
      structuredStage: "generation",
      structuredOutput: false,
    },
    onToken,
    onProgress,
    signal,
    structuredContract: contract,
    outputLimits: contract?.limits,
    outputMode: contract?.mode,
  });

  try {
    return await parseStructuredLlmJson({
      schema,
      raw: lastRaw,
      operation,
      meta: {
        ...meta,
        parseAttempt: attempt + 1,
        retried: attempt > 0,
        structuredOutput: false,
      },
      bindingSchema,
      contract,
    });
  } catch (error) {
    throw new PromptJsonValidationError(error);
  }
}

/** Stream structured output via native JSON schema / function calling when supported. */
export async function streamStructured<T extends z.ZodType>(
  schema: T,
  prompt: string,
  operation: string,
  meta: Record<string, unknown>,
  onToken?: StreamTokenHandler,
  signal?: AbortSignal,
  schemaShape?: string,
  onStructuredPartial?: (partial: unknown) => void | Promise<void>,
  bindingSchemaOverride?: z.ZodType | Record<string, unknown>,
  contract?: ResolvedStructuredContract,
  deepseekStrictOnly = false,
  onAttempt?: () => void,
  onProgress?: () => void,
): Promise<z.infer<T>> {
  const bindingSchema =
    bindingSchemaOverride ?? resolveCompactBindingSchema(operation);
  const useCompactShape = isPromptJsonShape(schemaShape);
  const basePrompt = useCompactShape
    ? appendCompactJsonPrompt(prompt, schemaShape)
    : prompt;

  let lastError = "";
  let lastNativeError: unknown;
  const seenValidationSignatures = new Set<string>();
  const seenCandidateHashes = new Set<string>();

  const provider = getLlmProvider();
  const requireDeepseekStrict =
    deepseekStrictOnly && provider.id === "deepseek";
  // A schema that cannot be projected to a provider JSON Schema (e.g. it
  // embeds z.preprocess transforms) must degrade to prompt JSON instead of
  // failing the whole operation before any request is attempted.
  let providerBindingSchema: Record<string, unknown> | undefined;
  try {
    providerBindingSchema = projectProviderBindingSchema(
      bindingSchema ?? schema,
    );
  } catch {
    providerBindingSchema = undefined;
  }
  let plannedProviderAttempts = provider.structuredOutput.createAttemptPlan({
    mode: "object",
    bindingSchema: providerBindingSchema,
    maxAttempts: STRUCTURED_PARSE_MAX_ATTEMPTS,
    preferSchemaConstrained: requireDeepseekStrict,
  });
  if (providerBindingSchema == null) {
    plannedProviderAttempts = plannedProviderAttempts.filter(
      (attempt) => attempt.transport !== "native",
    );
  }
  if (plannedProviderAttempts.length === 0) {
    plannedProviderAttempts = [{ id: "prompt-json", transport: "prompt-json" }];
  }
  // `deepseekStrictOnly` is a publication-safety contract, not merely an
  // adapter preference. Keep the invariant here at the shared execution
  // boundary so a provider regression or stale adapter cannot silently route a
  // strict-only operation through JSON mode or prompt JSON.
  const providerAttempts = requireDeepseekStrict
    ? plannedProviderAttempts.filter(
        (attempt) =>
          attempt.transport === "native" &&
          attempt.method === "functionCalling" &&
          attempt.strict === true,
      )
    : plannedProviderAttempts;
  if (requireDeepseekStrict && providerAttempts.length === 0) {
    throw new Error(
      "DeepSeek strict function calling is unavailable for this structured schema",
    );
  }

  for (let attempt = 0; attempt < providerAttempts.length; attempt += 1) {
    const providerAttempt = providerAttempts[attempt]!;
    const op = attempt === 0 ? operation : `${operation}.retry`;
    const nativeBasePrompt = bindingSchema ? basePrompt : prompt;
    const attemptPrompt =
      attempt === 0
        ? nativeBasePrompt
        : `${nativeBasePrompt}

Your previous structured response failed validation: ${lastError}
Return a corrected response that satisfies the required schema.
${useCompactShape ? COMPACT_JSON_INSTRUCTION : ""}`;

    if (providerAttempt.transport === "native") {
      const deadline = contract
        ? createStructuredDeadline(signal, contract.limits.timeoutMs, contract.timeoutPolicy)
        : undefined;
      try {
        onAttempt?.();
        const native = await streamStructuredNative(
          schema,
          attemptPrompt,
          {
            operation: op,
            bindingSchema: bindingSchema ?? undefined,
            methodIndex: attempt,
            throwOnError: true,
            schemaShape,
            meta: {
              ...meta,
              ...(contract ? structuredContractLogMeta(contract) : {}),
              parseAttempt: attempt + 1,
              structuredAttempt: attempt + 1,
              structuredTransport: providerAttempt.id,
              structuredStage: "generation",
              retried: attempt > 0,
            },
            contract,
            onProgress: () => { deadline?.recordProgress(); onProgress?.(); },
          },
          onToken,
          deadline?.signal ?? signal,
          onStructuredPartial,
        );
        if (native != null) return native;
        // A strict retry is useful only when the first call returned a
        // candidate that authoritative validation could diagnose.
        if (providerAttempt.strict && providerAttempts[attempt + 1]?.strict) {
          attempt += 1;
        }
        continue;
      } catch (error) {
        if (!isStructuredNativeOutputError(error)) throw error;
        lastNativeError = error;
        lastError = formatStructuredParseError(error);
        const candidateHash = nativeCandidateHash(error);
        if (candidateHash) {
          if (seenCandidateHashes.has(candidateHash)) {
            // Do not spend more calls on the same candidate, but do preserve
            // the remaining transport fallbacks. A repeated strict tool result
            // says nothing about JSON mode or prompt JSON reliability.
            lastError = `Repeated structured candidate hash: ${candidateHash}`;
            continue;
          }
          seenCandidateHashes.add(candidateHash);
        } else if (
          providerAttempt.strict &&
          providerAttempts[attempt + 1]?.strict
        ) {
          // Transport/beta failure without a usable candidate: skip the
          // corrected strict retry and go directly to stable JSON mode.
          attempt += 1;
        }
        const signature = lastError.replace(/\d+/g, "#");
        if (seenValidationSignatures.has(signature)) {
          // A different transport can recover the same schema failure. Only
          // fail after the provider-owned attempt plan is exhausted.
          lastError = `Repeated validation signature: ${lastError}`;
          continue;
        }
        seenValidationSignatures.add(signature);
        continue;
      } finally {
        deadline?.cleanup();
      }
    }

    const deadline = contract
      ? createStructuredDeadline(signal, contract.limits.timeoutMs, contract.timeoutPolicy)
      : undefined;
    try {
      onAttempt?.();
      return await streamPromptJsonAttempt(
        schema,
        prompt,
        operation,
        meta,
        attempt,
        lastError || undefined,
        onToken,
        deadline?.signal ?? signal,
        schemaShape,
        bindingSchema,
        contract,
        () => { deadline?.recordProgress(); onProgress?.(); },
      );
    } catch (error) {
      if (!(error instanceof PromptJsonValidationError)) throw error;
      lastError = formatStructuredParseError(error.originalError);
      const signature = lastError.replace(/\d+/g, "#");
      if (
        seenValidationSignatures.has(signature) &&
        attempt >= providerAttempts.length - 1
      ) {
        throw error.originalError;
      }
      seenValidationSignatures.add(signature);
      if (attempt >= providerAttempts.length - 1) throw error.originalError;
    } finally {
      deadline?.cleanup();
    }
  }

  // Preserve evidence of a parsed candidate for final diagnostics. The
  // formatted target/schema message alone is indistinguishable from a
  // provider failure once native attempts have been exhausted.
  throw new Error(lastError || "Structured parse failed", {
    cause: lastNativeError,
  });
}
