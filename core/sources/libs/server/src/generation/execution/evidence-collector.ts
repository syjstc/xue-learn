import { AsyncLocalStorage } from "node:async_hooks";
import type {
  EvidenceValue,
  OperationExecutionEvidence,
  OperationExecutionStatus,
  OperationSpanEvidence,
  OperationTelemetryEvent,
  OperationTraceCollector,
} from "./types.js";
import { executionEvidenceSchemaVersion } from "./types.js";
import { getActiveLlmOperationRoute } from "../../providers/llm/operation-routing-context.js";

const storage = new AsyncLocalStorage<OperationTraceCollector>();

const known = <T>(value: T): EvidenceValue<T> => ({ status: "known", value });
const unknown = <T>(reason: string): EvidenceValue<T> => ({
  status: "unknown",
  reason,
});

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function recordSafeStructured(
  target: NonNullable<OperationSpanEvidence["structured"]>,
  value: Record<string, unknown>,
) {
  const map: Array<[keyof typeof target, unknown]> = [
    ["contractId", value.structuredContractId],
    ["contractVersion", value.structuredContractVersion],
    ["schemaHash", value.structuredSchemaHash],
    ["invocationId", value.structuredInvocationId],
    ["attempt", value.structuredAttempt],
    ["transport", value.structuredTransport],
    ["stage", value.structuredStage ?? value.structuredValidationStage],
    ["outcome", value.structuredOutcome],
    ["failureCategory", value.structuredFailureCategory],
    ["syntaxRepaired", value.structuredSyntaxRepaired],
  ];
  for (const [key, candidate] of map) {
    if (typeof candidate === "boolean") target[key] = candidate as never;
    else if (typeof candidate === "number" && Number.isInteger(candidate)) {
      target[key] = candidate as never;
    } else if (typeof candidate === "string" && candidate.trim()) {
      target[key] = candidate.trim().slice(0, 200) as never;
    }
  }
}

class InMemoryOperationTraceCollector implements OperationTraceCollector {
  readonly spans = new Map<string, OperationSpanEvidence>();
  readonly operation: string;
  private traceId?: string;
  private promptHash?: string;
  private contextBoundaryHash?: string;
  private contextViewKeys = new Set<string>();
  private contextToolKeys = new Set<string>();
  private truncatedViewCount = 0;
  private toolCalls = 0;
  private toolRounds = 0;
  private invalidToolCalls = 0;
  private toolWrites = 0;
  private invocationIds = new Set<string>();
  private firstPassValid?: boolean;
  private finalValid?: boolean;
  private attempts = 0;
  private retries = 0;
  private normalizationCount = 0;
  private repairCount = 0;
  private repairedValueCount = 0;
  private fallbackCount = 0;
  private verifierFindingCount = 0;
  private verificationStatus?: OperationExecutionEvidence["verification"]["status"] extends EvidenceValue<
    infer T
  >
    ? T
    : never;
  private repairedIndexes = new Set<number>();
  private usage: Record<string, number | undefined> = {};
  private timing: Record<string, number | undefined> = {};
  private cost: Record<string, number | undefined> = {};
  private readonly agentTrajectory: NonNullable<
    OperationExecutionEvidence["agent"]
  >["trajectory"] = [];
  private agentInterruptions = 0;
  private agentMaxRound = 0;
  private budget = {
    interrupted: false,
    cancellationRequested: false,
    exceeded: false,
  };
  private finalStatus: OperationExecutionStatus = "success";
  private failureCategory?: string;

  constructor(operation: string, traceId?: string) {
    this.operation = operation;
    this.traceId = traceId;
  }

  record(event: OperationTelemetryEvent): void {
    switch (event.type) {
      case "span_start": {
        const id = event.id ?? `${event.operation}:${this.spans.size + 1}`;
        this.spans.set(id, {
          id,
          ...(event.parentId ? { parentId: event.parentId } : {}),
          operation: event.operation,
          kind: event.kind,
          status: "running",
          provider: event.provider
            ? known(event.provider)
            : unknown("not_reported"),
          model: event.model ? known(event.model) : unknown("not_reported"),
          ...(event.route ? { route: { ...event.route } } : {}),
        });
        break;
      }
      case "span_finish": {
        const id = event.id ?? [...this.spans.keys()].at(-1);
        const span = id ? this.spans.get(id) : undefined;
        if (!span) break;
        span.status = event.status;
        if (event.durationMs !== undefined) span.durationMs = event.durationMs;
        if (event.firstResponseMs !== undefined)
          span.firstResponseMs = event.firstResponseMs;
        if (event.provider) span.provider = known(event.provider);
        if (event.model) span.model = known(event.model);
        if (event.request || event.response) {
          span.structured ??= {};
          recordSafeStructured(span.structured, {
            ...(event.request ?? {}),
            ...(event.response ?? {}),
          });
        }
        break;
      }
      case "context":
        for (const key of event.viewKeys ?? []) this.contextViewKeys.add(key);
        for (const key of event.toolKeys ?? []) this.contextToolKeys.add(key);
        this.truncatedViewCount += event.truncatedViewCount ?? 0;
        this.promptHash = event.promptHash ?? this.promptHash;
        this.contextBoundaryHash =
          event.contextBoundaryHash ?? this.contextBoundaryHash;
        break;
      case "structured":
        if (event.invocationId) this.invocationIds.add(event.invocationId);
        this.attempts = Math.max(this.attempts, event.attempt ?? 1);
        this.retries = Math.max(
          this.retries,
          Math.max(0, (event.attempt ?? 1) - 1),
        );
        if (event.firstPassValid !== undefined)
          this.firstPassValid = event.firstPassValid;
        if (event.finalValid !== undefined) this.finalValid = event.finalValid;
        this.normalizationCount += event.normalizationCount ?? 0;
        this.repairCount += event.repairCount ?? 0;
        this.repairedValueCount += event.repairedValueCount ?? 0;
        this.fallbackCount += event.fallbackCount ?? 0;
        break;
      case "tool":
        this.toolCalls += event.calls ?? 0;
        this.toolRounds += event.rounds ?? 0;
        this.invalidToolCalls += event.invalidCalls ?? 0;
        this.toolWrites += event.writes ?? 0;
        break;
      case "verification":
        if (event.status) this.verificationStatus = event.status;
        this.verifierFindingCount += event.findingCount ?? 0;
        for (const index of event.repairedIndexes ?? [])
          this.repairedIndexes.add(index);
        break;
      case "usage":
      case "timing":
      case "cost":
        Object.assign(
          event.type === "usage"
            ? this.usage
            : event.type === "timing"
              ? this.timing
              : this.cost,
          event,
        );
        break;
      case "budget":
        {
          const { type: _type, ...budget } = event;
          this.budget = { ...this.budget, ...budget };
        }
        break;
      case "agent_round":
        this.agentMaxRound = Math.max(this.agentMaxRound, event.round);
        this.toolRounds += 1;
        break;
      case "agent_tool":
        this.agentMaxRound = Math.max(this.agentMaxRound, event.round);
        this.toolCalls += 1;
        if (event.status === "invalid") this.invalidToolCalls += 1;
        this.toolWrites += event.writes ?? 0;
        this.agentTrajectory.push({
          round: event.round,
          name: event.name,
          status: event.status,
          ...(event.argumentHash ? { argumentHash: event.argumentHash } : {}),
          ...(event.resultHash ? { resultHash: event.resultHash } : {}),
          writes: event.writes ?? 0,
        });
        break;
      case "agent_interrupt":
        this.agentInterruptions += 1;
        break;
      case "status":
        this.finalStatus = event.status;
        this.failureCategory = event.failureCategory;
        break;
    }
  }

  snapshot(status = this.finalStatus): OperationExecutionEvidence {
    const spans = [...this.spans.values()];
    const inputTokens = asFiniteNumber(this.usage.inputTokens);
    const cacheReadTokens = asFiniteNumber(this.usage.cacheReadTokens);
    const durationMs = asFiniteNumber(this.timing.durationMs);
    const traceId = this.traceId
      ? known(this.traceId)
      : unknown<string>("not_reported");
    const finalValid =
      this.finalValid ?? (status === "success" || status === "recovered");
    const verificationStatus = this.verificationStatus;
    return {
      schemaVersion: executionEvidenceSchemaVersion,
      operation: this.operation,
      traceId,
      promptHash: this.promptHash
        ? known(this.promptHash)
        : unknown("not_reported"),
      contextBoundaryHash: this.contextBoundaryHash
        ? known(this.contextBoundaryHash)
        : unknown("not_reported"),
      status,
      failureCategory: this.failureCategory
        ? known(
            this
              .failureCategory as OperationExecutionEvidence["failureCategory"] extends EvidenceValue<
              infer T
            >
              ? T
              : never,
          )
        : unknown("not_reported"),
      provider:
        spans.find((span) => span.provider.status === "known")?.provider ??
        unknown("not_reported"),
      model:
        spans.find((span) => span.model.status === "known")?.model ??
        unknown("not_reported"),
      route: (() => {
        const route = spans.find((span) => span.route)?.route;
        return route ? known(route) : unknown("not_reported");
      })(),
      spans,
      context: {
        viewKeys: [...this.contextViewKeys].sort(),
        toolKeys: [...this.contextToolKeys].sort(),
        truncatedViewCount: this.truncatedViewCount,
      },
      tools: {
        calls: this.toolCalls,
        rounds: this.toolRounds,
        invalidCalls: this.invalidToolCalls,
        writes: this.toolWrites,
      },
      structured: {
        invocationIds: [...this.invocationIds].sort(),
        firstPassValid:
          this.firstPassValid === undefined
            ? unknown("not_reported")
            : known(this.firstPassValid),
        finalValid: known(finalValid),
        attempts: this.attempts,
        retries: this.retries,
        normalizationCount: this.normalizationCount,
        repairCount: this.repairCount,
        repairedValueCount: this.repairedValueCount,
        fallbackCount: this.fallbackCount,
        verifierFindingCount: this.verifierFindingCount,
      },
      verification: {
        status:
          verificationStatus === undefined
            ? unknown("not_run")
            : known(verificationStatus),
        findingCount: this.verifierFindingCount,
        repairedIndexes: [...this.repairedIndexes].sort((a, b) => a - b),
        finalStatus:
          verificationStatus === undefined
            ? unknown("not_run")
            : known(verificationStatus),
      },
      usage: {
        inputTokens:
          inputTokens === undefined
            ? unknown("not_reported")
            : known(inputTokens),
        outputTokens: this.knownNumber(this.usage.outputTokens),
        totalTokens: this.knownNumber(this.usage.totalTokens),
        cacheReadTokens:
          cacheReadTokens === undefined
            ? unknown("not_reported")
            : known(cacheReadTokens),
        cacheCreationTokens: this.knownNumber(this.usage.cacheCreationTokens),
        reasoningTokens: this.knownNumber(this.usage.reasoningTokens),
        // Cache-prefix coverage is unknown until the provider reports both
        // the relevant cache counters and the denominator. Never infer a
        // perfect measurement from ordinary input-token telemetry.
        measurementCoverage: this.knownNumber(this.usage.measurementCoverage),
      },
      timing: {
        timeToFirstResponseMs: this.knownNumber(
          this.timing.timeToFirstResponseMs,
        ),
        durationMs:
          durationMs === undefined
            ? unknown("not_reported")
            : known(durationMs),
      },
      cost: {
        estimatedMinor: this.knownNumber(this.cost.estimatedMinor),
        ledgerMinor: this.knownNumber(this.cost.ledgerMinor),
      },
      budgets: this.budget,
      agent: {
        trajectory: this.agentTrajectory.map((entry) => ({ ...entry })),
        interruptions: this.agentInterruptions,
        maxRound: this.agentMaxRound,
      },
      redaction: {
        applied: true,
        excluded: [
          "prompts",
          "learner_artifacts",
          "secrets",
          "chain_of_thought",
          "raw_provider_payloads",
        ],
      },
    };
  }

  private knownNumber(value: unknown): EvidenceValue<number> {
    const number = asFiniteNumber(value);
    return number === undefined ? unknown("not_reported") : known(number);
  }
}

export function createOperationTraceCollector(
  operation: string,
  traceId?: string,
): OperationTraceCollector {
  return new InMemoryOperationTraceCollector(operation, traceId);
}

export function getActiveOperationTraceCollector():
  OperationTraceCollector | undefined {
  return storage.getStore();
}

export async function runWithOperationTraceCollector<T>(
  collector: OperationTraceCollector,
  run: () => Promise<T>,
): Promise<T> {
  return storage.run(collector, run);
}

export function recordActiveOperationTelemetry(
  event: OperationTelemetryEvent,
): void {
  storage.getStore()?.record(event);
}

export function recordActiveOperationStructured(
  event: Omit<Extract<OperationTelemetryEvent, { type: "structured" }>, "type">,
): void {
  recordActiveOperationTelemetry({ type: "structured", ...event });
}

export function recordActiveOperationVerification(
  event: Omit<
    Extract<OperationTelemetryEvent, { type: "verification" }>,
    "type"
  >,
): void {
  recordActiveOperationTelemetry({ type: "verification", ...event });
}

export function recordActiveOperationLlmStart(params: {
  id?: string;
  parentId?: string;
  operation: string;
  provider?: string;
  model?: string;
  kind?: OperationSpanEvidence["kind"];
}): void {
  const route = getActiveLlmOperationRoute();
  recordActiveOperationTelemetry({
    type: "span_start",
    ...params,
    kind: params.kind ?? "llm",
    ...(route
      ? {
          route: {
            operationKey: route.operationKey,
            source: route.source,
            reasoningMode: route.reasoningMode,
            ...(route.fallbackFromModel
              ? { fallbackFromModel: route.fallbackFromModel }
              : {}),
          },
        }
      : {}),
  });
}

export function recordActiveOperationLlmFinish(params: {
  id?: string;
  status: string;
  durationMs?: number;
  firstResponseMs?: number;
  provider?: string;
  model?: string;
  request?: Record<string, unknown>;
  response?: Record<string, unknown>;
}): void {
  recordActiveOperationTelemetry({ type: "span_finish", ...params });
}
