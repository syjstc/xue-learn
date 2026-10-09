import { z } from "zod";
import type { LearningSystemSubject } from "../../learning-systems/types.js";

/** Versioned, JSON-safe representation of telemetry that is safe to grade. */
export const executionEvidenceSchemaVersion = 1 as const;

export const unknownEvidenceSchema = z.object({
  status: z.literal("unknown"),
  reason: z.string().trim().min(1).max(200).optional(),
});

export const knownEvidenceSchema = <T extends z.ZodType>(value: T) =>
  z.object({ status: z.literal("known"), value });

export const evidenceValueSchema = <T extends z.ZodType>(value: T) =>
  z.union([knownEvidenceSchema(value), unknownEvidenceSchema]);

export type EvidenceValue<T> =
  { status: "known"; value: T } | { status: "unknown"; reason?: string };

export type OperationExecutionStatus =
  "success" | "recovered" | "error" | "cancelled" | "budget_exhausted";

export type OperationFailureCategory =
  | "validation"
  | "provider_or_transport"
  | "authorization"
  | "timeout"
  | "cancellation"
  | "budget_exhaustion"
  | "resource_limit"
  | "unknown";

export type OperationSpanEvidence = {
  id?: string;
  parentId?: string;
  operation: string;
  kind: "llm" | "tool" | "parse" | "verification" | "other";
  status: string;
  durationMs?: number;
  firstResponseMs?: number;
  provider: EvidenceValue<string>;
  model: EvidenceValue<string>;
  route?: {
    operationKey: string;
    source: string;
    reasoningMode: string;
    fallbackFromModel?: string;
  };
  structured?: {
    contractId?: string;
    contractVersion?: number;
    schemaHash?: string;
    invocationId?: string;
    attempt?: number;
    transport?: string;
    stage?: string;
    outcome?: string;
    failureCategory?: string;
    syntaxRepaired?: boolean;
  };
};

export type OperationExecutionEvidence = {
  schemaVersion: typeof executionEvidenceSchemaVersion;
  operation: string;
  traceId: EvidenceValue<string>;
  promptHash: EvidenceValue<string>;
  contextBoundaryHash: EvidenceValue<string>;
  status: OperationExecutionStatus;
  failureCategory: EvidenceValue<OperationFailureCategory>;
  provider: EvidenceValue<string>;
  model: EvidenceValue<string>;
  route: EvidenceValue<{
    operationKey: string;
    source: string;
    reasoningMode: string;
    fallbackFromModel?: string;
  }>;
  spans: OperationSpanEvidence[];
  context: {
    viewKeys: string[];
    toolKeys: string[];
    truncatedViewCount: number;
  };
  tools: {
    calls: number;
    rounds: number;
    invalidCalls: number;
    writes: number;
  };
  structured: {
    invocationIds: string[];
    firstPassValid: EvidenceValue<boolean>;
    finalValid: EvidenceValue<boolean>;
    attempts: number;
    retries: number;
    normalizationCount: number;
    repairCount: number;
    repairedValueCount: number;
    fallbackCount: number;
    verifierFindingCount: number;
  };
  verification: {
    status: EvidenceValue<
      "passed" | "repaired" | "shadow_issues" | "skipped_error"
    >;
    findingCount: number;
    repairedIndexes: number[];
    finalStatus: EvidenceValue<string>;
  };
  usage: {
    inputTokens: EvidenceValue<number>;
    outputTokens: EvidenceValue<number>;
    totalTokens: EvidenceValue<number>;
    cacheReadTokens: EvidenceValue<number>;
    cacheCreationTokens: EvidenceValue<number>;
    reasoningTokens: EvidenceValue<number>;
    measurementCoverage: EvidenceValue<number>;
  };
  timing: {
    timeToFirstResponseMs: EvidenceValue<number>;
    durationMs: EvidenceValue<number>;
  };
  cost: {
    estimatedMinor: EvidenceValue<number>;
    ledgerMinor: EvidenceValue<number>;
  };
  budgets: {
    interrupted: boolean;
    cancellationRequested: boolean;
    exceeded: boolean;
  };
  agent?: {
    trajectory: Array<{
      round: number;
      name: string;
      status: "invalid" | "started" | "success" | "error" | "interrupt";
      argumentHash?: string;
      resultHash?: string;
      writes: number;
    }>;
    interruptions: number;
    maxRound: number;
  };
  /** Evidence must never contain prompts, learner artifacts, secrets, or CoT. */
  redaction: {
    applied: true;
    excluded: string[];
  };
};

export type OperationEvent =
  | {
      type: "token";
      operation: string;
      token: string;
    }
  | {
      type: "partial";
      operation: string;
      payload: unknown;
    }
  | {
      type: "verification";
      operation: string;
      status: string;
      findingCount?: number;
      repairedIndexes?: number[];
      patches?: Array<{ index: number; kind: string; content: unknown }>;
    }
  | {
      type: "publication_candidate";
      operation: string;
      payload: unknown;
    }
  | {
      type: "retryable";
      operation: string;
      sequenceId: string;
      failedStage: "author" | "verify";
      attempts: number;
      issues: string[];
      validPreviewAvailable: boolean;
    };

export type OperationEventSink = {
  emit(event: OperationEvent): void | Promise<void>;
};

export type OperationTraceCollector = {
  readonly operation: string;
  record(event: OperationTelemetryEvent): void;
  snapshot(status?: OperationExecutionStatus): OperationExecutionEvidence;
};

export type OperationTelemetryEvent =
  | {
      type: "span_start";
      id?: string;
      parentId?: string;
      operation: string;
      kind: OperationSpanEvidence["kind"];
      provider?: string;
      model?: string;
      route?: {
        operationKey: string;
        source: string;
        reasoningMode: string;
        fallbackFromModel?: string;
      };
    }
  | {
      type: "span_finish";
      id?: string;
      status: string;
      durationMs?: number;
      firstResponseMs?: number;
      provider?: string;
      model?: string;
      request?: Record<string, unknown>;
      response?: Record<string, unknown>;
    }
  | {
      type: "context";
      viewKeys?: string[];
      toolKeys?: string[];
      truncatedViewCount?: number;
      promptHash?: string;
      contextBoundaryHash?: string;
    }
  | {
      type: "structured";
      contractId?: string;
      contractVersion?: number;
      schemaHash?: string;
      invocationId?: string;
      attempt?: number;
      transport?: string;
      stage?: string;
      outcome?: string;
      failureCategory?: string;
      syntaxRepaired?: boolean;
      firstPassValid?: boolean;
      finalValid?: boolean;
      normalizationCount?: number;
      repairCount?: number;
      repairedValueCount?: number;
      fallbackCount?: number;
    }
  | {
      type: "tool";
      calls?: number;
      rounds?: number;
      invalidCalls?: number;
      writes?: number;
    }
  | {
      type: "verification";
      status?: OperationExecutionEvidence["verification"]["status"] extends EvidenceValue<
        infer T
      >
        ? T
        : never;
      findingCount?: number;
      repairedIndexes?: number[];
    }
  | {
      type: "usage";
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      cacheReadTokens?: number;
      cacheCreationTokens?: number;
      reasoningTokens?: number;
      measurementCoverage?: number;
    }
  | {
      type: "timing";
      timeToFirstResponseMs?: number;
      durationMs?: number;
    }
  | {
      type: "cost";
      estimatedMinor?: number;
      ledgerMinor?: number;
    }
  | {
      type: "budget";
      interrupted?: boolean;
      cancellationRequested?: boolean;
      exceeded?: boolean;
    }
  | {
      type: "agent_round";
      round: number;
    }
  | {
      type: "agent_tool";
      round: number;
      name: string;
      status: "invalid" | "started" | "success" | "error" | "interrupt";
      argumentHash?: string;
      resultHash?: string;
      writes?: number;
    }
  | {
      type: "agent_interrupt";
    }
  | {
      type: "status";
      status: OperationExecutionStatus;
      failureCategory?: OperationFailureCategory;
    };

export type OperationExecutionContext = {
  subject: LearningSystemSubject;
  signal?: AbortSignal;
  purpose?: "production" | "evaluation";
  trace: OperationTraceCollector;
  events: OperationEventSink;
};

export type OperationExecutionResult<TOutput> = {
  output: TOutput;
  evidence: OperationExecutionEvidence;
};

export type EvaluableOperation<TInput, TOutput> = {
  key: string;
  inputSchema: z.ZodType<TInput>;
  outputSchema?: z.ZodType<TOutput>;
  execute(input: TInput, context: OperationExecutionContext): Promise<TOutput>;
};

export type OperationExecutionOptions = {
  subject: LearningSystemSubject;
  signal?: AbortSignal;
  traceId?: string;
  purpose?: "production" | "evaluation";
  events?: OperationEventSink;
};

/** Runtime validation for persisted/reportable evidence envelopes. */
export const operationExecutionEvidenceSchema = z
  .object({
    schemaVersion: z.literal(executionEvidenceSchemaVersion),
    operation: z.string().min(1),
    traceId: evidenceValueSchema(z.string()),
    promptHash: evidenceValueSchema(z.string()),
    contextBoundaryHash: evidenceValueSchema(z.string()),
    status: z.enum([
      "success",
      "recovered",
      "error",
      "cancelled",
      "budget_exhausted",
    ]),
    failureCategory: evidenceValueSchema(z.string()),
    provider: evidenceValueSchema(z.string()),
    model: evidenceValueSchema(z.string()),
    route: evidenceValueSchema(
      z.object({
        operationKey: z.string().min(1),
        source: z.string().min(1),
        reasoningMode: z.string().min(1),
        fallbackFromModel: z.string().min(1).optional(),
      }),
    ),
    spans: z.array(z.record(z.string(), z.unknown())),
    context: z.record(z.string(), z.unknown()),
    tools: z.record(z.string(), z.unknown()),
    structured: z.record(z.string(), z.unknown()),
    verification: z.record(z.string(), z.unknown()),
    usage: z.record(z.string(), z.unknown()),
    timing: z.record(z.string(), z.unknown()),
    cost: z.record(z.string(), z.unknown()),
    budgets: z.record(z.string(), z.unknown()),
    redaction: z.object({
      applied: z.literal(true),
      excluded: z.array(z.string()),
    }),
  })
  .passthrough();
