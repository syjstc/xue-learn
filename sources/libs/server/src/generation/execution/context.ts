import { randomUUID } from "node:crypto";
import { runGenerationContextScope } from "../kernel.js";
import { runWithLlmTraceAsync } from "../../llm/trace-context.js";
import type {
  EvaluableOperation,
  OperationEvent,
  OperationEventSink,
  OperationExecutionContext,
  OperationExecutionEvidence,
  OperationExecutionOptions,
  OperationExecutionResult,
  OperationExecutionStatus,
} from "./types.js";
import {
  createOperationTraceCollector,
  runWithOperationTraceCollector,
} from "./evidence-collector.js";
import { getOperationAdapter } from "./registry.js";
import { registerStructuredOperationAdapters } from "./structured-operations.js";

export class OperationExecutionError extends Error {
  constructor(
    message: string,
    readonly evidence: OperationExecutionEvidence,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "OperationExecutionError";
  }
}

class MemoryEventSink implements OperationEventSink {
  readonly events: OperationEvent[] = [];
  emit(event: OperationEvent): void {
    this.events.push(event);
  }
}

function statusForError(
  error: unknown,
  signal?: AbortSignal,
): OperationExecutionStatus {
  if (
    signal?.aborted ||
    (error instanceof Error && error.name === "AbortError")
  ) {
    return "cancelled";
  }
  if (error instanceof Error && /budget|exhausted/i.test(error.message)) {
    return "budget_exhausted";
  }
  return "error";
}

export async function executeOperation<TInput, TOutput>(
  operation: EvaluableOperation<TInput, TOutput>,
  input: TInput,
  options: OperationExecutionOptions,
): Promise<OperationExecutionResult<TOutput>> {
  const parsedInput = operation.inputSchema.parse(input);
  const traceId = options.traceId ?? randomUUID();
  const collector = createOperationTraceCollector(operation.key, traceId);
  const events = options.events ?? new MemoryEventSink();
  const context: OperationExecutionContext = {
    subject: { ...options.subject },
    signal: options.signal,
    purpose: options.purpose ?? "production",
    trace: collector,
    events,
  };

  return runWithLlmTraceAsync(
    {
      traceId,
      meta: {
        executionPurpose: options.purpose ?? "production",
        operationExecution: true,
        // Direct section retries do not pass through tracked-sse. Derive log
        // ownership from the authorized operation subject on both entry paths.
        ...(options.subject.goalId ? { goalId: options.subject.goalId } : {}),
        ...(options.subject.unitId
          ? { scope: "unit", scopeId: options.subject.unitId }
          : options.subject.goalId
            ? { scope: "goal", scopeId: options.subject.goalId }
            : {}),
      },
    },
    () =>
      runWithGenerationScope(context, async () => {
        try {
          const output = await runWithOperationTraceCollector(collector, () =>
            operation.execute(parsedInput, context),
          );
          const parsedOutput = operation.outputSchema
            ? operation.outputSchema.parse(output)
            : output;
          const completedEvidence = collector.snapshot();
          collector.record({
            type: "status",
            status:
              completedEvidence.structured.retries > 0 ||
              completedEvidence.structured.repairCount > 0
                ? "recovered"
                : "success",
          });
          return { output: parsedOutput, evidence: collector.snapshot() };
        } catch (error) {
          const status = statusForError(error, options.signal);
          collector.record({
            type: "budget",
            ...(options.signal?.aborted ? { cancellationRequested: true } : {}),
            ...(status === "budget_exhausted" ? { exceeded: true } : {}),
            ...(status === "cancelled" ? { interrupted: true } : {}),
          });
          collector.record({
            type: "status",
            status,
            failureCategory:
              status === "cancelled"
                ? "cancellation"
                : status === "budget_exhausted"
                  ? "budget_exhaustion"
                  : "unknown",
          });
          const evidence = collector.snapshot(status);
          throw new OperationExecutionError(
            `${operation.key} execution failed${error instanceof Error && error.message ? `: ${error.message}` : ""}`,
            evidence,
            error,
          );
        }
      }),
  );
}

export async function executeRegisteredOperation<TInput, TOutput>(
  key: string,
  input: TInput,
  options: OperationExecutionOptions,
): Promise<OperationExecutionResult<TOutput>> {
  registerStructuredOperationAdapters();
  const operation = getOperationAdapter<TInput, TOutput>(key);
  if (!operation)
    throw new Error(`No executable operation adapter registered: ${key}`);
  return executeOperation(operation, input, options);
}

async function runWithGenerationScope<T>(
  context: OperationExecutionContext,
  run: () => Promise<T>,
): Promise<T> {
  return runGenerationContextScope(
    { subject: context.subject, invocation: { executionPurpose: "operation" } },
    run,
  );
}
