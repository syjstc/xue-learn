import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { z } from "zod";
import type { StructuredOutputMethod } from "./structured-output-method.js";
import type {
  ResolvedStructuredContract,
  StructuredOutputLimits,
} from "../../llm/structured-contract.js";

export type StructuredOutputMode =
  "object" | "item-envelope" | "repair-envelope" | "root-array" | "json-lines";

export type StructuredOutputAttempt = {
  id: string;
  transport: "native" | "prompt-json" | "raw";
  method?: StructuredOutputMethod;
  strict?: boolean;
  modelTarget?: "default" | "strict";
};

export type StructuredOutputAttemptPlanRequest = {
  mode: StructuredOutputMode;
  bindingSchema?: z.ZodType | Record<string, unknown>;
  maxAttempts?: number;
  /** Prefer schema-bearing methods over unconstrained JSON mode. */
  preferSchemaConstrained?: boolean;
};

export type StructuredOutputAttemptRequest = {
  schema: z.ZodType;
  bindingSchema: z.ZodType | Record<string, unknown>;
  prompt: string;
  attempt: StructuredOutputAttempt;
  maxTokens?: number;
  /** Stable prompt prefix for provider-side prompt caching. */
  cachePrefix?: string;
  limits?: StructuredOutputLimits;
  contract?: ResolvedStructuredContract;
  signal?: AbortSignal;
};

export type StructuredOutputStreamCallbacks = {
  /** Meaningful provider activity only; never expose reasoning text. */
  onProgress?: (kind: "output" | "reasoning") => void | Promise<void>;
  onToken?: (delta: string) => void | Promise<void>;
  onPartialCandidate?: (candidate: unknown) => void | Promise<void>;
};

export type StructuredOutputAttemptResult =
  | {
      kind: "candidate";
      candidate: unknown;
      raw?: unknown;
      syntaxRepaired?: boolean;
    }
  | { kind: "unavailable"; reason: string };

/** Provider attempt failure that still carries the original model output. */
export class StructuredOutputAttemptError extends Error {
  constructor(
    message: string,
    readonly rawResponse: unknown,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "StructuredOutputAttemptError";
  }
}

export interface StructuredOutputAdapter {
  createAttemptPlan(
    request: StructuredOutputAttemptPlanRequest,
  ): readonly StructuredOutputAttempt[];
  executeAttempt(
    request: StructuredOutputAttemptRequest,
    callbacks: StructuredOutputStreamCallbacks,
  ): Promise<StructuredOutputAttemptResult>;
}

export type StructuredOutputCapableModel = BaseChatModel;

export type NativeStructuredOutputModel = BaseChatModel & {
  withStructuredOutput?: (
    schema: unknown,
    config?: {
      name?: string;
      method?: StructuredOutputMethod;
      includeRaw?: boolean;
      strict?: boolean;
    },
  ) => {
    invoke: (
      input: string,
      options?: { signal?: AbortSignal },
    ) => Promise<unknown>;
    stream?: (
      input: string,
      options?: { signal?: AbortSignal },
    ) => Promise<AsyncIterable<unknown>>;
  };
};
