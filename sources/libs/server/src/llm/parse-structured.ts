import type { z } from "zod";
import { ZodError } from "zod";
import { logLlmRequest, markActiveLlmStructuredParseFailed } from "./logger.js";
import { parseChatLogResponse } from "./parse-log-response.js";
import { parseLlmJsonDetailed, stripThinkingTags } from "./sanitize-response.js";
import {
  findUnknownStructuredKeys,
  type ResolvedStructuredContract,
  structuredContractLogMeta,
} from "./structured-contract.js";
import { projectProviderBindingSchema } from "../providers/llm/provider-binding-schema.js";

/**
 * Initial response plus bounded provider-owned corrective transports.
 * Providers with only two useful methods still return a shorter plan; Doubao
 * uses the fourth slot for a schema-guided prompt fallback after native Ark
 * retries.
 */
export const STRUCTURED_PARSE_MAX_ATTEMPTS = 4;

export type StructuredGenerationStage =
  "parse" | "validation" | "regeneration" | "repair" | "tool-call";

export function formatStructuredParseError(err: unknown): string {
  if (err instanceof ZodError) {
    return err.issues
      .map((issue) => {
        const path = issue.path.length ? issue.path.join(".") : "response";
        return `${path}: ${issue.message}`;
      })
      .join("; ");
  }
  return err instanceof Error ? err.message : String(err);
}

export async function parseStructuredLlmJson<T extends z.ZodType>(params: {
  schema: T;
  raw: string;
  operation: string;
  meta?: Record<string, unknown>;
  bindingSchema?: z.ZodType | Record<string, unknown>;
  contract?: ResolvedStructuredContract;
}): Promise<z.infer<T>> {
  const parseStarted = Date.now();
  const redactLogs = params.meta?.redactLogs === true;
  let syntaxRepaired = false;
  let unknownKeyCount = 0;
  try {
    const decoded = parseLlmJsonDetailed<unknown>(params.raw);
    syntaxRepaired = decoded.syntaxRepaired;
    const bindingSchema = projectProviderBindingSchema(
      params.bindingSchema ?? params.schema,
    );
    const unknownKeys = findUnknownStructuredKeys(decoded.value, bindingSchema);
    unknownKeyCount = unknownKeys.length;
    if (
      params.contract?.unknownKeyMode === "enforce" &&
      unknownKeys.length > 0
    ) {
      throw new Error(
        `response contains unknown properties: ${unknownKeys.slice(0, 20).join(", ")}`,
      );
    }
    const parsed = params.schema.parse(decoded.value);
    await logLlmRequest({
      operation: `${params.operation}.parse`,
      kind: "chat",
      spanType: "parse",
      status: "success",
      durationMs: Date.now() - parseStarted,
      request: {
        rawLength: params.raw.length,
        ...(params.contract ? structuredContractLogMeta(params.contract) : {}),
      },
      response: {
        parsed: redactLogs ? "[redacted-sensitive-output]" : parsed,
        structuredSyntaxRepaired: syntaxRepaired,
        structuredUnknownKeyCount: unknownKeyCount,
        structuredValidationStage: "schema",
        structuredOutcome: "success",
      },
      meta: {
        ...(params.meta ?? {}),
        structuredStage: "parse",
      },
    });
    return parsed;
  } catch (err) {
    const message = formatStructuredParseError(err);
    const parsed = parseChatLogResponse(stripThinkingTags(params.raw));
    const validationStage =
      err instanceof ZodError || unknownKeyCount > 0 ? "schema" : "parse";
    await logLlmRequest({
      operation: `${params.operation}.parse`,
      kind: "chat",
      spanType: "parse",
      status: "error",
      durationMs: Date.now() - parseStarted,
      request: {
        rawLength: params.raw.length,
        ...(params.contract ? structuredContractLogMeta(params.contract) : {}),
      },
      response: {
        ...(redactLogs ? {} : { parsed }),
        rawLength: parsed.raw.length,
        structuredSyntaxRepaired: syntaxRepaired,
        structuredUnknownKeyCount: unknownKeyCount,
        structuredValidationStage: validationStage,
        structuredOutcome: "error",
      },
      error: redactLogs ? "[redacted-sensitive-error]" : message,
      meta: {
        ...(params.meta ?? {}),
        structuredStage: "parse",
      },
    });
    await markActiveLlmStructuredParseFailed(
      redactLogs ? "Sensitive structured output parse failed" : message,
      {
        structuredSyntaxRepaired: syntaxRepaired,
        structuredUnknownKeyCount: unknownKeyCount,
        structuredValidationStage: validationStage,
        structuredParseOperation: params.operation,
      },
    );
    throw err;
  }
}
