import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getChatModel } from "../../llm/client.js";
import { getLlmProvider } from "../../llm/providers/index.js";
import {
  getActiveLlmOperationRoute,
  markActiveLlmRouteOutputStarted,
  withLlmOperationRoute,
} from "../../providers/llm/index.js";
import {
  beginLlmRequestLog,
  logLlmRequest,
  type LlmRequestLogHandle,
} from "../../llm/logger.js";
import { parseMessageForLog } from "../../llm/parse-log-response.js";
import {
  extractTokenUsage,
  usageLogFields,
} from "../../llm/token-usage.js";
import {
  extractAssistantStreamChunk,
  extractAssistantText,
  ThinkingTagStreamFilter,
} from "../../llm/sanitize-response.js";
import {
  appendAgentMessage,
  loadCheckpoint,
  saveCheckpoint,
  type ThreadCheckpoint,
} from "./checkpoint.js";
import {
  registryFromCheckpoint,
  type AgentId,
  updateRegistryAfterAgentTurn,
} from "./agent-registry.js";
import { clearInterrupt, setInterrupt } from "./interrupt.js";
import { extractAgentToolCalls } from "./extract-tool-calls.js";
import { serializeAgentMessagesForLog } from "./log-messages.js";
import { repairLlmTranscript } from "./transcript.js";
import { buildGlobalAssistantInvocationPrompt } from "../../learning-systems/capabilities/assistant-policy/capability.js";
import { normalizeToolArgsBeforeValidation } from "./normalize-tool-args.js";
import { toLangChainTools } from "./tools.js";
import type { ToolCapabilitySession } from "./tool-capability.js";
import { StructuredGenerationError } from "../../llm/validated-structured-generation.js";
import {
  prepareGenerationInvocation,
  runGenerationContextScope,
} from "../../generation/kernel.js";
import {
  executeOperation,
  type EvaluableOperation,
  type OperationExecutionContext,
} from "../../generation/execution/index.js";
import { getLlmTrace } from "../../llm/trace-context.js";
import { enrichCollectFormUiArgs } from "../goal-creation/subagents/intake/collect-form.js";
import {
  mergeDiscoveryQuestionHistory,
  normalizeDiscoveryQuestions,
  parseDiscoveryQuestions,
} from "../goal-creation/subagents/intake/discovery-questions.js";
import { shouldStopAfterToolUi } from "../global-assistant/response-policy.js";
import {
  goalStateForLearner,
  goalStateFromCheckpoint,
  mergeGoalTopicContext,
} from "../goal-creation/state.js";
import { resolveOperationMaxToolRounds } from "./capability-query-tools.js";
import { ToolGatewayError } from "../../learning-systems/tool-gateway.js";
import type {
  AgentRunContext,
  AgentToolCallRecord,
  AgentToolDef,
  LlmMessageRecord,
} from "./types.js";

const DEFAULT_MAX_TOOL_ROUNDS = 24;

function recoverableQueryToolErrorResult(error: unknown): string | undefined {
  if (
    !(error instanceof ToolGatewayError) ||
    (error.code !== "call_limit" && error.code !== "budget_exhausted")
  ) {
    return undefined;
  }

  return JSON.stringify({
    ok: false,
    reason: error.code,
    instruction:
      "This query cannot be called again in this run. Use the results already returned and answer the learner without retrying the tool.",
  });
}

function prepareGoalCreationHumanInterrupt(
  toolName: string,
  args: Record<string, unknown>,
  state: Record<string, unknown>,
): Record<string, unknown> {
  if (toolName === "ask_clarification") {
    state.currentPhase = "parsing";
    if (typeof args.topic === "string" && args.topic.trim()) {
      state.topic = mergeGoalTopicContext(
        typeof state.topic === "string" ? state.topic : "",
        args.topic,
      );
    }
    return args;
  }

  if (toolName === "ask_discovery_questions") {
    const rawQuestions = Array.isArray(args.questions) ? args.questions : [];
    const questions = normalizeDiscoveryQuestions(
      parseDiscoveryQuestions(rawQuestions),
    );
    const goalState = goalStateFromCheckpoint(state);
    state.currentPhase = "discovering";
    state.discoveryQuestions = mergeDiscoveryQuestionHistory(
      goalState.discoveryQuestions,
      questions,
    );
    return { ...args, questions };
  }

  if (toolName === "collect_form") {
    const goalState = goalStateFromCheckpoint(state);
    const uiArgs = enrichCollectFormUiArgs(goalState, args);
    state.currentPhase = "collecting";
    return uiArgs;
  }

  if (toolName === "show_confirmation") {
    state.currentPhase = "confirming";
  }

  if (toolName === "review_plan") {
    state.currentPhase = "reviewing_plan";
  }

  return args;
}

export type AgentRuntimePersistedMessage = {
  role: string;
  content?: string;
  toolCalls?: unknown[];
  toolCallId?: string;
  uiPayload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type AgentRuntimePersistencePort = {
  /** Evaluation ports must be explicitly marked; production ports are never reused there. */
  kind: "production" | "evaluation";
  loadCheckpoint(threadId: string): Promise<ThreadCheckpoint>;
  saveCheckpoint(threadId: string, checkpoint: ThreadCheckpoint): Promise<void>;
  appendAgentMessage(
    threadId: string,
    message: AgentRuntimePersistedMessage,
  ): Promise<unknown>;
};

export type AgentRuntimeBudget = {
  maxToolRounds?: number;
  maxToolCalls?: number;
};

export type AgentRuntimePorts = {
  persistence: AgentRuntimePersistencePort;
  modelFactory?: Parameters<typeof getChatModel>[0] extends infer T
    ? (options: T) => ReturnType<typeof getChatModel>
    : never;
  now?: () => number;
  yieldControl?: () => Promise<void>;
  createToolCallId?: (index: number) => string;
  budget?: AgentRuntimeBudget;
  /** Fixture model calls do not consult live route persistence. */
  skipRouteResolution?: boolean;
  /** Fixture context is supplied by the case; production still uses the broker. */
  skipGenerationContext?: boolean;
  cancelBeforeRun?: boolean;
};

const productionAgentRuntimePorts: AgentRuntimePorts = {
  persistence: {
    kind: "production",
    loadCheckpoint,
    saveCheckpoint,
    appendAgentMessage,
  },
};

function persistCheckpoint(
  checkpoint: ThreadCheckpoint,
  registryAgentId?: AgentId,
): ThreadCheckpoint {
  if (!registryAgentId) return checkpoint;
  return updateRegistryAfterAgentTurn(
    checkpoint,
    registryAgentId,
    checkpoint.llmMessages,
  );
}

async function saveCheckpointWithRegistry(
  threadId: string,
  checkpoint: ThreadCheckpoint,
  registryAgentId?: AgentId,
  persistence: AgentRuntimePersistencePort = productionAgentRuntimePorts.persistence,
): Promise<ThreadCheckpoint> {
  const next = persistCheckpoint(checkpoint, registryAgentId);
  await persistence.saveCheckpoint(threadId, next);
  return next;
}

type AgentToolLogInfo = {
  tc: AgentToolCallRecord;
  def?: AgentToolDef;
  subagent?: string;
  state: Record<string, unknown>;
};

function agentToolLogMeta(
  ctx: AgentRunContext,
  info: AgentToolLogInfo,
): Record<string, unknown> {
  const goalId =
    typeof info.state.goalId === "string" && info.state.goalId
      ? info.state.goalId
      : undefined;
  return {
    scope: "agent",
    scopeId: ctx.threadId,
    subagent: info.subagent,
    ...(goalId ? { goalId } : {}),
  };
}

function agentToolLogRequest(
  ctx: AgentRunContext,
  info: AgentToolLogInfo,
): Record<string, unknown> {
  return {
    toolCall: {
      id: info.tc.id,
      name: info.tc.name,
      args: info.tc.args,
    },
    subagent: info.subagent,
    threadId: ctx.threadId,
    traceId: ctx.traceId,
    ...(info.def?.capabilityUsage
      ? { generationContextCapabilityUsage: [info.def.capabilityUsage] }
      : {}),
  };
}

async function startAgentToolLog(
  ctx: AgentRunContext,
  info: AgentToolLogInfo,
): Promise<LlmRequestLogHandle | undefined> {
  return beginLlmRequestLog({
    operation: `agent.tool.${info.tc.name}`,
    kind: "chat",
    spanType: "tool",
    toolName: info.tc.name,
    request: agentToolLogRequest(ctx, info),
    meta: agentToolLogMeta(ctx, info),
  });
}

async function finishAgentToolExecution(
  ctx: AgentRunContext,
  options: {
    info: AgentToolLogInfo;
    toolStarted: number;
    resultStr: string;
    status: "success" | "error";
    error?: string;
    logHandle?: LlmRequestLogHandle;
    outcome?: Record<string, unknown>;
    now?: () => number;
  },
): Promise<void> {
  const { info, toolStarted, resultStr, status, error, logHandle, outcome } =
    options;
  const durationMs = (options.now ?? Date.now)() - toolStarted;
  const response = { content: resultStr, ...outcome };

  if (status === "success") {
    await ctx.send({
      type: "tool_call",
      toolCallId: info.tc.id,
      toolName: info.tc.name,
      status: "completed",
      resultPreview: resultStr.slice(0, 400),
    });
  } else {
    await ctx.send({
      type: "tool_call",
      toolCallId: info.tc.id,
      toolName: info.tc.name,
      status: "error",
      error: error ?? "Tool failed",
    });
  }

  const finishPayload = {
    status,
    durationMs,
    response,
    error,
  } as const;

  if (logHandle) {
    await logHandle.finish(finishPayload);
    return;
  }

  await logLlmRequest({
    operation: `agent.tool.${info.tc.name}`,
    kind: "chat",
    spanType: "tool",
    toolName: info.tc.name,
    request: agentToolLogRequest(ctx, info),
    meta: agentToolLogMeta(ctx, info),
    ...finishPayload,
  });
}

function normalizeToolCalls(
  calls: AgentToolCallRecord[],
  createId?: (index: number) => string,
): AgentToolCallRecord[] {
  const ids = new Set<string>();
  return calls.map((tc, index) => {
    let id = tc.id || createId?.(index) || `agent-tool-${Date.now()}-${index}`;
    if (ids.has(id)) {
      id = createId?.(index) || `${id}-${index}`;
      while (ids.has(id)) id = `${id}-${index}`;
    }
    ids.add(id);
    return { ...tc, id };
  });
}

function hashAgentValue(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value ?? null))
    .digest("hex");
}

function toolWriteCount(def: AgentToolDef | undefined): number {
  return def?.capabilityUsage?.type === "query_tool" ? 0 : 1;
}

function recordAgentTrace(
  trace: OperationExecutionContext["trace"] | undefined,
  event: Parameters<OperationExecutionContext["trace"]["record"]>[0],
): void {
  if (trace && typeof trace.record === "function") trace.record(event);
}

function hasAssistantToolCall(
  messages: LlmMessageRecord[],
  toolCallId: string,
): boolean {
  return messages.some(
    (m) =>
      m.role === "assistant" &&
      Boolean(m.toolCalls?.some((tc) => tc.id === toolCallId)),
  );
}

function toBaseMessages(records: LlmMessageRecord[]): BaseMessage[] {
  return records.map((m) => {
    if (m.role === "system") return new SystemMessage(m.content);
    if (m.role === "user") return new HumanMessage(m.content);
    if (m.role === "tool") {
      return new ToolMessage({
        content: m.content,
        tool_call_id: m.toolCallId ?? "",
      });
    }
    const toolCalls = Array.isArray(m.toolCalls) ? m.toolCalls : [];
    if (toolCalls.length === 0) {
      return new AIMessage(m.content);
    }
    return new AIMessage({
      content: m.content,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        args: tc.args,
        type: "tool_call" as const,
      })),
    });
  });
}

export type RunSubagentOptions = {
  ctx: AgentRunContext;
  systemPrompt: string;
  toolSession: ToolCapabilitySession;
  checkpoint: ThreadCheckpoint;
  stateKey?: string;
  subagent?: string;
  /** Which logical agent owns this loop (for registry updates). */
  registryAgentId?: AgentId;
  pageContext?: import("./types.js").AgentPageContext;
  invocation?: Record<string, unknown>;
  /** Optional stateful-runtime ports. Omitted in production, required for eval. */
  runtime?: AgentRuntimePorts;
};

export type RunSubagentResult = {
  checkpoint: ThreadCheckpoint;
  completed: boolean;
  interrupted: boolean;
  budgetExhausted?: boolean;
  cancelled?: boolean;
};

function isGlobalAssistantRunOptions(
  value: unknown,
): value is RunSubagentOptions {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RunSubagentOptions>;
  const ctx = candidate.ctx;
  return Boolean(
    candidate.registryAgentId === "global" &&
    typeof candidate.systemPrompt === "string" &&
    candidate.toolSession &&
    candidate.checkpoint &&
    Array.isArray(candidate.checkpoint.llmMessages) &&
    ctx &&
    typeof ctx === "object" &&
    typeof ctx.userId === "string" &&
    typeof ctx.threadId === "string" &&
    typeof ctx.traceId === "string" &&
    typeof ctx.send === "function",
  );
}

/**
 * Typed adapter for the stateful global assistant. Evaluation is allowed only
 * when the caller supplies an explicitly marked evaluation runtime, so the
 * production checkpoint/message ports cannot be reached through this path.
 */
export const globalAssistantOperation: EvaluableOperation<
  RunSubagentOptions,
  RunSubagentResult
> = {
  key: "agent.global",
  inputSchema: z.custom<RunSubagentOptions>(
    isGlobalAssistantRunOptions,
    "agent.global requires a bound run context, checkpoint, and tool session",
  ),
  async execute(
    input: RunSubagentOptions,
    executionContext: OperationExecutionContext,
  ): Promise<RunSubagentResult> {
    if (
      executionContext.subject.userId &&
      executionContext.subject.userId !== input.ctx.userId
    ) {
      throw new Error("agent.global execution cannot change user identity");
    }
    if (
      executionContext.subject.threadId &&
      executionContext.subject.threadId !== input.ctx.threadId
    ) {
      throw new Error("agent.global execution cannot change thread identity");
    }
    const isEvaluation =
      executionContext.purpose === "evaluation" ||
      getLlmTrace()?.meta?.executionPurpose === "evaluation";
    if (isEvaluation && input.runtime?.persistence.kind !== "evaluation") {
      throw new Error(
        "agent.global production adapter cannot run with evaluation without an in-memory runtime",
      );
    }
    if (!isEvaluation && input.runtime?.persistence.kind === "evaluation") {
      throw new Error(
        "agent.global evaluation runtime cannot run with production execution purpose",
      );
    }
    if (isEvaluation && !input.runtime?.modelFactory) {
      throw new Error("agent.global evaluation requires a fixture model");
    }

    const run = () =>
      runSubagentLoopCore(
        {
          ...input,
          ctx:
            executionContext.signal === input.ctx.signal
              ? input.ctx
              : { ...input.ctx, signal: executionContext.signal },
        },
        executionContext.trace,
      );

    // Keep route resolution and fallback inside the operation implementation so
    // provider errors are handled before executeOperation wraps the final error
    // in OperationExecutionError. This preserves output-start semantics and
    // cancellation/fallback behavior from the pre-adapter loop.
    return (isEvaluation && input.runtime?.skipRouteResolution) ||
      getActiveLlmOperationRoute()?.operationKey === "agent.global"
      ? run()
      : withLlmOperationRoute("agent.global", run);
  },
};

async function runSubagentLoopCore(
  options: RunSubagentOptions,
  trace?: OperationExecutionContext["trace"],
): Promise<RunSubagentResult> {
  const routingOperation =
    options.registryAgentId === "global"
      ? "agent.global"
      : `agent.goal_creation.${options.subagent ?? "plan"}`;
  const runtime = options.runtime ?? productionAgentRuntimePorts;
  const persistence = runtime.persistence;
  const maxToolRounds = Math.min(
    runtime.skipRouteResolution
      ? DEFAULT_MAX_TOOL_ROUNDS
      : resolveOperationMaxToolRounds(
          routingOperation,
          DEFAULT_MAX_TOOL_ROUNDS,
        ),
    runtime.budget?.maxToolRounds ?? Number.POSITIVE_INFINITY,
  );
  const now = runtime.now ?? Date.now;
  let executedToolCalls = 0;
  if (
    !runtime.skipRouteResolution &&
    getActiveLlmOperationRoute()?.operationKey !== routingOperation
  ) {
    return withLlmOperationRoute(routingOperation, () =>
      runSubagentLoopCore(options, trace),
    );
  }
  const {
    ctx,
    systemPrompt,
    toolSession,
    stateKey = "agentState",
    subagent,
    registryAgentId,
    pageContext,
  } = options;
  let checkpoint = { ...options.checkpoint };
  if (!checkpoint[stateKey]) {
    checkpoint[stateKey] = {};
  }
  const state = checkpoint[stateKey] as Record<string, unknown>;
  const model = await (runtime.modelFactory ?? getChatModel)({
    // Keep conversational responses bounded independently of each provider's
    // model context window. Tool rounds receive the same per-round ceiling.
    maxTokens: routingOperation === "agent.global" ? 4_096 : undefined,
  });
  const provider = getLlmProvider();

  const repairedMessages = repairLlmTranscript(
    checkpoint.llmMessages.filter((m) => m.role !== "system"),
  );
  checkpoint.llmMessages = repairedMessages;

  const currentQuery = [...repairedMessages]
    .reverse()
    .find((message) => message.role === "user")?.content;
  const contextInvocation = {
    ...(options.invocation ?? {}),
    agentRegistry: registryFromCheckpoint(checkpoint),
    selfAgentId: registryAgentId,
    goalCreationPaused: checkpoint.goalCreationPaused === true,
    pageContext,
  };
  const invocationPrompt =
    routingOperation === "agent.global"
      ? [
          systemPrompt,
          buildGlobalAssistantInvocationPrompt(contextInvocation, currentQuery),
        ]
          .filter(Boolean)
          .join("\n\n")
      : systemPrompt;
  const preparedGeneration = runtime.skipGenerationContext
    ? { prompt: invocationPrompt, contextMeta: {} }
    : await runGenerationContextScope(
        {
          subject: {
            userId: ctx.userId,
            threadId: ctx.threadId,
            goalId:
              typeof state.goalId === "string"
                ? state.goalId
                : pageContext?.goalId,
            unitId: pageContext?.unitId ?? pageContext?.focusUnitId,
          },
          query: currentQuery,
          invocation: contextInvocation,
        },
        () => prepareGenerationInvocation(routingOperation, invocationPrompt),
      );
  const llmMessages: LlmMessageRecord[] = [
    { role: "system", content: preparedGeneration.prompt },
    ...repairedMessages,
  ];

  let rounds = 0;
  let interrupted = false;
  let budgetExhausted = false;
  const invalidToolAttempts = new Map<string, number>();
  let transientRepairStart: number | undefined;

  while (rounds < maxToolRounds) {
    if (runtime.cancelBeforeRun || ctx.signal?.aborted) break;
    if (
      runtime.budget?.maxToolCalls !== undefined &&
      executedToolCalls >= runtime.budget.maxToolCalls
    ) {
      budgetExhausted = true;
      break;
    }
    rounds += 1;
    recordAgentTrace(trace, { type: "agent_round", round: rounds });
    const tools = toolSession.getExposedTools();
    const toolMap = new Map(tools.map((tool) => [tool.name, tool]));
    const lcTools = toLangChainTools(tools);
    const modelWithTools =
      lcTools.length > 0 && typeof model.bindTools === "function"
        ? model.bindTools(lcTools)
        : model;
    const toolNames = [...toolMap.keys()];
    const capabilityQueryTools = tools
      .map((tool) => tool.capabilityUsage)
      .filter((usage) => usage !== undefined);
    const preferInvokeForTools = provider.id === "ollama" && lcTools.length > 0;

    let gathered: AIMessageChunk | undefined;
    const llmStarted = now();
    const baseMessages = toBaseMessages(llmMessages);
    const tagFilter = new ThinkingTagStreamFilter();
    let pendingAssistantText = "";
    // Stream conversational text immediately even when this round may also
    // produce tool calls. Waiting for the complete tool-call payload made the
    // assistant look frozen for the whole model turn. Ollama's tool path still
    // uses invoke() (there are no incremental chunks to forward), so retain
    // the validation buffer only for that non-streaming compatibility path.
    const streamAssistantText = !preferInvokeForTools;
    const sendAssistantDelta = async (delta: string) => {
      markActiveLlmRouteOutputStarted();
      if (streamAssistantText) {
        await ctx.send({ type: "message", delta, role: "assistant" });
        return;
      }
      pendingAssistantText += delta;
    };
    const sendThinking = async (delta?: string) => {
      await ctx.send({ type: "thinking", ...(delta ? { delta } : {}) });
    };

    const logHandle = await beginLlmRequestLog({
      operation: subagent ? `agent.${subagent}.llm` : "agent.llm",
      kind: "chat",
      request: {
        messages: serializeAgentMessagesForLog(llmMessages),
        ...preparedGeneration.contextMeta,
        agentAvailableTools: toolNames,
        generationContextAvailableQueryTools: capabilityQueryTools,
        ...((options.invocation as { toolSelection?: unknown } | undefined)
          ?.toolSelection
          ? {
              agentToolSelection: (
                options.invocation as { toolSelection: unknown }
              ).toolSelection,
            }
          : {}),
        subagent,
        threadId: ctx.threadId,
        traceId: ctx.traceId,
      },
      meta: {
        scope: "agent",
        scopeId: ctx.threadId,
        subagent,
        goalId:
          typeof state.goalId === "string" && state.goalId
            ? state.goalId
            : undefined,
      },
      setActiveSpan: true,
    });

    try {
      if (preferInvokeForTools) {
        const aiMsg = await modelWithTools.invoke(baseMessages, {
          signal: ctx.signal,
        });
        gathered = aiMsg as AIMessageChunk;
        const streamChunk = extractAssistantStreamChunk(gathered);
        if (streamChunk.delta || streamChunk.thinking) {
          if (streamChunk.thinking) await sendThinking(streamChunk.thinkingDelta);
          if (streamChunk.delta) {
            await tagFilter.push(streamChunk.delta, {
              onVisible: sendAssistantDelta,
              onThinking: sendThinking,
            });
          }
        }
      } else {
        const stream = await modelWithTools.stream(baseMessages, {
          signal: ctx.signal,
        });
        for await (const chunk of stream) {
          if (ctx.signal?.aborted) break;
          gathered = gathered ? gathered.concat(chunk) : chunk;
          const streamChunk = extractAssistantStreamChunk(chunk);
          if (streamChunk.delta || streamChunk.thinking) {
            await logHandle?.recordFirstResponse();
            if (streamChunk.thinking) await sendThinking(streamChunk.thinkingDelta);
            if (streamChunk.delta) {
              await tagFilter.push(streamChunk.delta, {
                onVisible: sendAssistantDelta,
                onThinking: sendThinking,
              });
            }
          }
        }
      }
      await tagFilter.flush({
        onVisible: sendAssistantDelta,
        onThinking: sendThinking,
      });
    } catch (err) {
      await logHandle?.finish({
        status: "error",
        durationMs: now() - llmStarted,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    if (!gathered) {
      await logHandle?.finish({
        status: "success",
        durationMs: now() - llmStarted,
        response: { empty: true },
      });
      checkpoint[stateKey] = state;
      checkpoint = await saveCheckpointWithRegistry(
        ctx.threadId,
        checkpoint,
        registryAgentId,
        persistence,
      );
      return { checkpoint, completed: true, interrupted: false };
    }
    const aiMsg = gathered as AIMessage;
    const text = extractAssistantText(aiMsg);
    const toolCalls = normalizeToolCalls(
      extractAgentToolCalls(aiMsg, toolNames),
      runtime.createToolCallId,
    );
    if (toolCalls.length > 0) markActiveLlmRouteOutputStarted();
    const llmDurationMs = now() - llmStarted;
    const parsed = parseMessageForLog(aiMsg);

    await logHandle?.finish({
      status: "success",
      durationMs: llmDurationMs,
      response: {
        parsed,
        rawLength: parsed.raw.length,
        toolCallCount: parsed.toolCalls.length,
        ...usageLogFields(extractTokenUsage(gathered), llmDurationMs),
      },
    });

    // Validate the entire tool-call batch before persisting the assistant row,
    // checkpointing it, invoking a handler, or exposing human-action UI. The
    // invalid transcript remains in-memory only so the model can repair it.
    const validatedToolArgs = new Map<string, Record<string, unknown>>();
    const toolRepairMessages: LlmMessageRecord[] = [];
    for (const tc of toolCalls) {
      const def = toolMap.get(tc.name);
      if (!def) {
        const invalidAttempts = (invalidToolAttempts.get(tc.name) ?? 0) + 1;
        invalidToolAttempts.set(tc.name, invalidAttempts);
        recordAgentTrace(trace, {
          type: "agent_tool",
          round: rounds,
          name: tc.name,
          status: "invalid",
          argumentHash: hashAgentValue(tc.args),
        });
        toolRepairMessages.push({
          role: "tool",
          content: `Unknown tool: ${tc.name}. Call one of the registered tools instead.`,
          toolCallId: tc.id,
        });
        if (invalidAttempts >= 3) {
          throw new StructuredGenerationError(
            `agent.tool.${tc.name}`,
            "tool-call",
            invalidAttempts,
            ["tool: unregistered tool name"],
          );
        }
        continue;
      }
      const normalizedArgs = normalizeToolArgsBeforeValidation(
        tc.name,
        tc.args,
      );
      const parsedArgs = def.schema.safeParse(normalizedArgs);
      if (!parsedArgs.success) {
        const invalidAttempts = (invalidToolAttempts.get(tc.name) ?? 0) + 1;
        invalidToolAttempts.set(tc.name, invalidAttempts);
        recordAgentTrace(trace, {
          type: "agent_tool",
          round: rounds,
          name: tc.name,
          status: "invalid",
          argumentHash: hashAgentValue(normalizedArgs),
        });
        const issueSummary = parsedArgs.error.issues
          .map((issue) => `${issue.path.join(".") || "args"}: ${issue.message}`)
          .join("; ");
        toolRepairMessages.push({
          role: "tool",
          content: `Invalid args for ${tc.name}: ${issueSummary}. Call ${tc.name} again with corrected arguments.`,
          toolCallId: tc.id,
        });
        if (invalidAttempts >= 3) {
          throw new StructuredGenerationError(
            `agent.tool.${tc.name}`,
            "tool-call",
            invalidAttempts,
            [issueSummary],
          );
        }
        continue;
      }
      if (def.requiresHumanInput && def.validateHumanInput) {
        try {
          await def.validateHumanInput(parsedArgs.data, { ...ctx, state });
        } catch (error) {
          const invalidAttempts = (invalidToolAttempts.get(tc.name) ?? 0) + 1;
          invalidToolAttempts.set(tc.name, invalidAttempts);
          const message =
            error instanceof Error ? error.message : String(error);
          recordAgentTrace(trace, {
            type: "agent_tool",
            round: rounds,
            name: tc.name,
            status: "invalid",
            argumentHash: hashAgentValue(normalizedArgs),
          });
          toolRepairMessages.push({
            role: "tool",
            content: `Invalid args for ${tc.name}: ${message}. Call ${tc.name} again with corrected arguments.`,
            toolCallId: tc.id,
          });
          if (invalidAttempts >= 3) {
            throw new StructuredGenerationError(
              `agent.tool.${tc.name}`,
              "tool-call",
              invalidAttempts,
              [message],
            );
          }
          continue;
        }
      }
      validatedToolArgs.set(tc.id, normalizedArgs);
    }

    if (toolRepairMessages.length > 0) {
      transientRepairStart ??= llmMessages.length;
      llmMessages.push({
        role: "assistant",
        content: text,
        toolCalls,
      });
      llmMessages.push(...toolRepairMessages);
      continue;
    }

    // A provider may return several independent read-only calls in one turn.
    // Keep the batch atomic when a case-level call budget cannot accommodate
    // it; persisting or executing only part of the batch would leave an
    // assistant transcript that cannot be replayed safely.
    if (
      runtime.budget?.maxToolCalls !== undefined &&
      executedToolCalls + toolCalls.length > runtime.budget.maxToolCalls
    ) {
      budgetExhausted = true;
      break;
    }

    if (pendingAssistantText) {
      // The invoke-only provider path cannot expose live chunks. Once its tool
      // arguments validate, replay the buffered prose in small SSE chunks so
      // the client can still paint progressively instead of receiving one
      // oversized event.
      const characters = Array.from(pendingAssistantText);
      for (let offset = 0; offset < characters.length; offset += 16) {
        await ctx.send({
          type: "message",
          delta: characters.slice(offset, offset + 16).join(""),
          role: "assistant",
        });
        if (offset + 16 < characters.length) {
          await (
            runtime.yieldControl ??
            (() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
          )();
        }
      }
    }

    if (transientRepairStart != null) {
      llmMessages.splice(transientRepairStart);
      transientRepairStart = undefined;
    }

    if (text.trim() || toolCalls.length > 0) {
      const assistantRecord: LlmMessageRecord = {
        role: "assistant",
        content: text,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };
      llmMessages.push(assistantRecord);
      checkpoint.llmMessages = llmMessages.slice(1);
      const awaitsHumanInput = toolCalls.some(
        (tc) => toolMap.get(tc.name)?.requiresHumanInput,
      );
      const toolsMayRenderUi = toolCalls.some((tc) =>
        Boolean(toolMap.get(tc.name)?.renderUi),
      );
      // Ollama often returns tool_calls with empty content; persist for replay unless
      // a human-input interrupt or renderUi path will save the assistant row with
      // uiPayload (and conversational text) below.
      if (
        !awaitsHumanInput &&
        !toolsMayRenderUi &&
        (text.trim() || toolCalls.length > 0)
      ) {
        await persistence.appendAgentMessage(ctx.threadId, {
          role: "assistant",
          content: text,
          toolCalls,
        });
      }
    }

    if (toolCalls.length === 0) {
      checkpoint[stateKey] = state;
      checkpoint = await saveCheckpointWithRegistry(
        ctx.threadId,
        checkpoint,
        registryAgentId,
        persistence,
      );
      return { checkpoint, completed: true, interrupted: false };
    }

    for (const tc of toolCalls) {
      const def = toolMap.get(tc.name)!;
      const normalizedArgs = validatedToolArgs.get(tc.id)!;
      const parsed = { data: def.schema.parse(normalizedArgs) };
      invalidToolAttempts.delete(tc.name);

      if (
        runtime.budget?.maxToolCalls !== undefined &&
        executedToolCalls >= runtime.budget.maxToolCalls
      ) {
        budgetExhausted = true;
        break;
      }
      executedToolCalls += 1;

      tc.args = normalizedArgs;

      if (def.requiresHumanInput) {
        const uiKind = def.uiKind ?? "generic";
        let uiArgs = prepareGoalCreationHumanInterrupt(tc.name, tc.args, state);
        if (tc.name === "show_confirmation") {
          uiArgs = {
            ...tc.args,
            state: goalStateForLearner(goalStateFromCheckpoint(state)),
          };
        }
        if (tc.name === "review_plan") {
          const goalState = goalStateFromCheckpoint(state);
          uiArgs = {
            ...tc.args,
            goalId: goalState.goalId,
            plan: goalState.mapPlan,
            isMicroCourse: goalState.isSmallCourse === true,
          };
        }
        const phase = state.currentPhase;
        if (
          subagent === "intake" &&
          typeof phase === "string" &&
          ["parsing", "discovering", "collecting", "confirming"].includes(phase)
        ) {
          const intakePhase = phase as
            "parsing" | "discovering" | "collecting" | "confirming";
          await ctx.send({
            type: "phase",
            phase: intakePhase,
            subagent: "intake",
          });
        }
        await ctx.send({
          type: "tool_ui",
          toolCallId: tc.id,
          toolName: tc.name,
          uiKind,
          args: uiArgs,
        });
        await ctx.send({
          type: "interrupt",
          toolCallId: tc.id,
          toolName: tc.name,
        });
        recordAgentTrace(trace, {
          type: "agent_tool",
          round: rounds,
          name: tc.name,
          status: "interrupt",
          argumentHash: hashAgentValue(tc.args),
          writes: toolWriteCount(def),
        });
        recordAgentTrace(trace, { type: "agent_interrupt" });
        checkpoint = setInterrupt(checkpoint, {
          toolCallId: tc.id,
          toolName: tc.name,
          uiKind,
          args: uiArgs,
        });
        checkpoint.llmMessages = llmMessages.slice(1);
        checkpoint[stateKey] = state;
        checkpoint = await saveCheckpointWithRegistry(
          ctx.threadId,
          checkpoint,
          registryAgentId,
          persistence,
        );
        await persistence.appendAgentMessage(ctx.threadId, {
          role: "assistant",
          // Keep the model's conversational text in the visible transcript. The
          // tool UI is temporary and disappears after the user responds.
          content: text,
          toolCalls: [tc],
          uiPayload: { uiKind, args: uiArgs },
        });
        interrupted = true;
        return { checkpoint, completed: false, interrupted };
      }

      const toolStarted = now();
      const toolLogInfo: AgentToolLogInfo = { tc, def, subagent, state };
      const toolLogHandle = await startAgentToolLog(ctx, toolLogInfo);
      await ctx.send({
        type: "tool_call",
        toolCallId: tc.id,
        toolName: tc.name,
        status: "started",
        args: tc.args,
      });

      let result: unknown;
      let resultStr = "";
      let recoveredQueryToolError = false;
      let toolErrorMessage = "";
      try {
        result = await toolSession.execute(tc.name, parsed.data, {
          ...ctx,
          state,
        });
        resultStr =
          typeof result === "string" ? result : JSON.stringify(result ?? {});
        if (
          tc.name === "create_goal" &&
          result &&
          typeof result === "object" &&
          (result as { activated?: boolean }).activated
        ) {
          llmMessages.push({
            role: "tool",
            content: resultStr,
            toolCallId: tc.id,
          });
          // create_goal handler updates checkpoint (goalCreationActive, etc.) in DB;
          // merge transcript into the latest checkpoint instead of overwriting it.
          checkpoint = await persistence.loadCheckpoint(ctx.threadId);
          checkpoint.llmMessages = llmMessages.slice(1);
          checkpoint = await saveCheckpointWithRegistry(
            ctx.threadId,
            checkpoint,
            registryAgentId ?? "global",
            persistence,
          );
          await persistence.appendAgentMessage(ctx.threadId, {
            role: "tool",
            content: resultStr,
            toolCallId: tc.id,
          });
          const createGoalResult = result as {
            activated?: boolean;
            reset?: boolean;
            seedTopic?: string | null;
          };
          await finishAgentToolExecution(ctx, {
            info: toolLogInfo,
            toolStarted,
            resultStr,
            status: "success",
            logHandle: toolLogHandle,
            now,
            outcome: {
              activated: createGoalResult.activated,
              reset: createGoalResult.reset,
              seedTopic: createGoalResult.seedTopic,
              nextStep: "goal_creation_orchestrator",
            },
          });
          return { checkpoint, completed: true, interrupted: false };
        }
        if (
          tc.name === "resume_goal_creation" &&
          result &&
          typeof result === "object" &&
          (result as { resumed?: boolean }).resumed
        ) {
          llmMessages.push({
            role: "tool",
            content: resultStr,
            toolCallId: tc.id,
          });
          checkpoint = await persistence.loadCheckpoint(ctx.threadId);
          checkpoint.llmMessages = llmMessages.slice(1);
          checkpoint[stateKey] = state;
          checkpoint = await saveCheckpointWithRegistry(
            ctx.threadId,
            checkpoint,
            registryAgentId ?? "global",
            persistence,
          );
          await persistence.appendAgentMessage(ctx.threadId, {
            role: "tool",
            content: resultStr,
            toolCallId: tc.id,
          });
          await finishAgentToolExecution(ctx, {
            info: toolLogInfo,
            toolStarted,
            resultStr,
            status: "success",
            logHandle: toolLogHandle,
            now,
            outcome: {
              resumed: true,
              nextStep: "goal_creation_orchestrator",
            },
          });
          return { checkpoint, completed: true, interrupted: false };
        }
        await finishAgentToolExecution(ctx, {
          info: toolLogInfo,
          toolStarted,
          resultStr,
          status: "success",
          logHandle: toolLogHandle,
          now,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toolErrorMessage = message;
        await finishAgentToolExecution(ctx, {
          info: toolLogInfo,
          toolStarted,
          resultStr: message,
          status: "error",
          error: message,
          logHandle: toolLogHandle,
          now,
        });
        const recoverableResult = recoverableQueryToolErrorResult(err);
        if (recoverableResult !== undefined) {
          recoveredQueryToolError = true;
          result = JSON.parse(recoverableResult);
          resultStr = recoverableResult;
        } else {
          recordAgentTrace(trace, {
            type: "agent_tool",
            round: rounds,
            name: tc.name,
            status: "error",
            argumentHash: hashAgentValue(tc.args),
            resultHash: hashAgentValue(message),
            writes: toolWriteCount(def),
          });
          throw err;
        }
      }

      if (recoveredQueryToolError) {
        recordAgentTrace(trace, {
          type: "agent_tool",
          round: rounds,
          name: tc.name,
          status: "error",
          argumentHash: hashAgentValue(tc.args),
          resultHash: hashAgentValue(toolErrorMessage),
          writes: toolWriteCount(def),
        });
      } else {
        recordAgentTrace(trace, {
          type: "agent_tool",
          round: rounds,
          name: tc.name,
          status: "success",
          argumentHash: hashAgentValue(tc.args),
          resultHash: hashAgentValue(resultStr),
          writes: toolWriteCount(def),
        });
      }

      const uiPayload = recoveredQueryToolError
        ? null
        : def.renderUi?.(parsed.data, result, { ...ctx, state });

      if (uiPayload) {
        await ctx.send({
          type: "tool_ui",
          toolCallId: tc.id,
          toolName: tc.name,
          uiKind: uiPayload.uiKind,
          args: uiPayload.args,
        });
        await persistence.appendAgentMessage(ctx.threadId, {
          role: "assistant",
          // Keep the model's conversational text with the tool card, same as
          // human-input interrupts, so hydrate does not drop streamed prose.
          content: text,
          toolCalls: [tc],
          uiPayload,
        });
      } else if (def.renderUi) {
        // renderUi opted out (returned null) — still persist the assistant turn.
        await persistence.appendAgentMessage(ctx.threadId, {
          role: "assistant",
          content: text,
          toolCalls: [tc],
        });
      }

      llmMessages.push({
        role: "tool",
        content: resultStr,
        toolCallId: tc.id,
      });
      checkpoint.llmMessages = llmMessages.slice(1);
      checkpoint[stateKey] = state;
      checkpoint = await saveCheckpointWithRegistry(
        ctx.threadId,
        checkpoint,
        registryAgentId,
        persistence,
      );
      await persistence.appendAgentMessage(ctx.threadId, {
        role: "tool",
        content: resultStr,
        toolCallId: tc.id,
      });

      // generate_plan already produced and validated the authoritative plan.
      // Return control to the goal-creation orchestrator so it can construct
      // the review_plan interrupt directly from goalState.mapPlan. Continuing
      // this loop would send the full plan through another LLM round merely to
      // ask the model to select review_plan.
      if (
        tc.name === "generate_plan" &&
        stateKey === "goalState" &&
        state.mapPlanStatus === "ready" &&
        state.mapPlan
      ) {
        return { checkpoint, completed: true, interrupted: false };
      }

      // The suggested create-goal card is the complete response for this turn.
      // A second model round only repeats the card instructions and adds noise.
      if (shouldStopAfterToolUi(tc.name, result, Boolean(uiPayload))) {
        return { checkpoint, completed: true, interrupted: false };
      }
    }
  }

  if (!ctx.signal?.aborted && (budgetExhausted || rounds >= maxToolRounds)) {
    budgetExhausted = true;
    recordAgentTrace(trace, { type: "budget", exceeded: true });
  }
  const cancelled =
    runtime.cancelBeforeRun === true || ctx.signal?.aborted === true;
  if (cancelled) {
    recordAgentTrace(trace, {
      type: "budget",
      interrupted: true,
      cancellationRequested: true,
    });
  }
  checkpoint[stateKey] = state;
  checkpoint = await saveCheckpointWithRegistry(
    ctx.threadId,
    checkpoint,
    registryAgentId,
    persistence,
  );
  return {
    checkpoint,
    completed: true,
    interrupted,
    ...(cancelled ? { cancelled: true, completed: false } : {}),
    ...(budgetExhausted ? { budgetExhausted: true } : {}),
  };
}

export async function runSubagentLoop(
  options: RunSubagentOptions,
): Promise<RunSubagentResult> {
  if (options.registryAgentId !== "global") {
    return runSubagentLoopCore(options);
  }

  try {
    const execution = await executeOperation(
      globalAssistantOperation,
      options,
      {
        subject: {
          userId: options.ctx.userId,
          threadId: options.ctx.threadId,
        },
        traceId: options.ctx.traceId,
        signal: options.ctx.signal,
        purpose:
          options.runtime?.persistence.kind === "evaluation"
            ? "evaluation"
            : "production",
      },
    );
    return execution.output;
  } catch (error) {
    // The typed seam keeps evidence on its wrapper, but the public agent API
    // historically exposed the provider/tool error itself. Preserve that
    // contract while still allowing the seam to collect the failure evidence.
    if (error instanceof Error && error.name === "OperationExecutionError") {
      const cause = (error as Error & { cause?: unknown }).cause;
      if (cause !== undefined) throw cause;
    }
    throw error;
  }
}

export async function resumeToolCall(
  options: RunSubagentOptions & {
    toolCallId: string;
    result: unknown;
  },
): Promise<RunSubagentResult> {
  const { toolCallId, result, ...rest } = options;
  const persistence =
    rest.runtime?.persistence ?? productionAgentRuntimePorts.persistence;
  let checkpoint = clearInterrupt(rest.checkpoint);
  const pending = rest.checkpoint.pendingInterrupt;

  if (!pending) {
    await rest.ctx.send({
      type: "error",
      message: "当前没有等待处理的操作，请重新发送你的目标或刷新页面后重试。",
    });
    return { checkpoint, completed: false, interrupted: false };
  }

  if (pending.toolCallId !== toolCallId) {
    await rest.ctx.send({
      type: "tool_ui",
      toolCallId: pending.toolCallId,
      toolName: pending.toolName,
      uiKind: pending.uiKind,
      args: pending.args,
    });
    await rest.ctx.send({
      type: "error",
      message: "这个操作已经过期，请使用当前最新的表单或确认卡片继续。",
    });
    return { checkpoint: rest.checkpoint, completed: false, interrupted: true };
  }

  const resultStr =
    typeof result === "string" ? result : JSON.stringify(result ?? {});

  const llmMessages: LlmMessageRecord[] = [...checkpoint.llmMessages];
  if (!hasAssistantToolCall(llmMessages, toolCallId)) {
    llmMessages.push({
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: pending.toolCallId,
          name: pending.toolName,
          args: pending.args,
        },
      ],
    });
  }
  llmMessages.push({ role: "tool", content: resultStr, toolCallId });
  checkpoint.llmMessages = llmMessages;

  await persistence.appendAgentMessage(rest.ctx.threadId, {
    role: "tool",
    content: resultStr,
    toolCallId,
    uiPayload:
      typeof result === "object" && result
        ? (result as Record<string, unknown>)
        : { userResponse: result },
  });
  await persistence.saveCheckpoint(rest.ctx.threadId, checkpoint);

  return runSubagentLoop({ ...rest, checkpoint });
}

export async function addUserMessage(
  threadId: string,
  content: string,
  metadata?: Record<string, unknown>,
): Promise<ThreadCheckpoint> {
  const checkpoint = await loadCheckpoint(threadId);
  checkpoint.llmMessages = [
    ...checkpoint.llmMessages,
    { role: "user", content },
  ];
  await saveCheckpoint(threadId, checkpoint);
  await appendAgentMessage(threadId, { role: "user", content, metadata });
  return checkpoint;
}
