import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { getChatModel } from "../llm/client.js";
import { getLlmProvider } from "../llm/providers/index.js";
import {
  getActiveLlmOperationRoute,
  markActiveLlmRouteOutputStarted,
  withLlmOperationRoute,
} from "../providers/llm/index.js";
import {
  beginLlmRequestLog,
  logLlmRequest,
  patchLlmRequestLog,
} from "../llm/logger.js";
import { parseMessageForLog } from "../llm/parse-log-response.js";
import { runWithLogParentAsync } from "../llm/trace-context.js";
import {
  buildValidationReport,
  formatValidationReportForModel,
} from "../llm/validation-report.js";
import {
  extractTokenUsage,
  usageLogFields,
} from "../llm/token-usage.js";
import {
  extractAssistantStreamChunk,
  extractAssistantText,
  stripThinkingTags,
  ThinkingTagStreamFilter,
} from "../llm/sanitize-response.js";
import { extractAgentToolCalls } from "../agents/core/extract-tool-calls.js";
import { resolveOperationMaxToolRounds } from "../agents/core/capability-query-tools.js";
import { serializeAgentMessagesForLog } from "../agents/core/log-messages.js";
import { normalizeToolArgsBeforeValidation } from "../agents/core/normalize-tool-args.js";
import {
  collectStreamedToolArgumentChunk,
  emptyStreamedToolArgState,
  emptyToolArgumentsRepairMessage,
  recoverAgentToolCallsFromStream,
  toolArgsAreEmpty,
} from "../agents/core/streamed-tool-args.js";
import { toLangChainTools } from "../agents/core/tools.js";
import type { AgentToolDef, LlmMessageRecord } from "../agents/core/types.js";
import {
  prepareGenerationInvocation,
  runGenerationContextScope,
} from "../generation/kernel.js";
import { ToolCapabilitySession } from "../agents/core/tool-capability.js";
import type { TeachingDerivationRunEventV1 } from "../learning-systems/capabilities/teaching-derivation/session.js";
import {
  UNIT_TEACHING_DERIVATION_OPERATION,
  TEACHING_DERIVATION_TOOL_SET,
} from "../learning-systems/capabilities/teaching-derivation/keys.js";
import { buildTeachingDerivationInvocationPrompt } from "../learning-systems/capabilities/teaching-derivation/prompt.js";
import { compactCommitToolResponse } from "../learning-systems/capabilities/teaching-derivation/tools.js";
import { requireTeachingDerivationPersistence } from "../learning-systems/capabilities/teaching-derivation/persistence.js";

const DEFAULT_MAX_TOOL_ROUNDS = 80;

export type RunTeachingDerivationAgentParams = {
  runId: string;
  userId: string;
  title: string;
  locale: string;
  requirementText: string;
  assumptions?: string[];
  target?: string;
  traceId: string;
  signal?: AbortSignal;
  send: (event: TeachingDerivationRunEventV1) => Promise<void>;
  operation?: string;
  toolSet?: string;
  invocationPrompt?: string;
  finishToolName?: string;
  missingFinishMessage?: string;
  platformFunded?: boolean;
};

function toBaseMessages(records: LlmMessageRecord[]): BaseMessage[] {
  return records.map((record) => {
    if (record.role === "system") return new SystemMessage(record.content);
    if (record.role === "user") return new HumanMessage(record.content);
    if (record.role === "tool") {
      return new ToolMessage({
        content: record.content,
        tool_call_id: record.toolCallId ?? "",
      });
    }
    return new AIMessage({
      content: record.content,
      additional_kwargs: record.reasoningContent
        ? { reasoning_content: record.reasoningContent }
        : {},
      tool_calls: record.toolCalls?.map((tc) => ({
        id: tc.id,
        name: tc.name,
        args: tc.args,
      })),
    });
  });
}

function normalizeToolCalls(
  calls: Array<{ id: string; name: string; args: Record<string, unknown> }>,
) {
  return calls.map((tc, index) => ({
    ...tc,
    id: tc.id || `formal-derivation-tool-${Date.now()}-${index}`,
  }));
}

export const MAX_REPEATED_DERIVATION_TOOL_ERRORS = 5;

export function shouldCountRepeatedDerivationToolError(
  toolName: string,
  result: unknown,
): boolean {
  if (toolName !== "validate_derivation") return true;
  return !(result && typeof result === "object" && "findings" in result);
}

export function shouldAbortInvalidDerivationToolSchema(
  attempts: number,
  limit = MAX_REPEATED_DERIVATION_TOOL_ERRORS,
): boolean {
  return attempts >= limit;
}

async function logRejectedDerivationToolCall(params: {
  operation: string;
  toolCall: { id: string; name: string; args: Record<string, unknown> };
  result: Record<string, unknown>;
  parentLogId?: string;
  platformFunded: boolean;
}): Promise<void> {
  const write = () =>
    logLlmRequest({
      operation: `${params.operation}.tool.${params.toolCall.name}`,
      kind: "chat",
      status: "error",
      durationMs: 0,
      spanType: "tool",
      toolName: params.toolCall.name,
      request: {
        toolCall: {
          id: params.toolCall.id,
          name: params.toolCall.name,
          args: params.toolCall.args,
        },
        platformFunded: params.platformFunded,
      },
      response: {
        content: JSON.stringify(params.result),
        structuredOutcome: "schema_invalid",
        structuredIssues: params.result.issues,
      },
      meta: {
        scope: "thread",
        operation: params.operation,
        platformFunded: params.platformFunded,
      },
    });
  if (params.parentLogId) {
    await runWithLogParentAsync(params.parentLogId, write);
    return;
  }
  await write();
}

/** Keep the invocation in the user turn; the prepared system prompt is context/policy only. */
export function buildTeachingDerivationInitialMessages(
  systemPrompt: string,
  invocationPrompt: string,
): LlmMessageRecord[] {
  return [
    ...(systemPrompt.trim()
      ? [{ role: "system" as const, content: systemPrompt.trim() }]
      : []),
    { role: "user" as const, content: invocationPrompt },
  ];
}

export async function runTeachingDerivationAgent(
  params: RunTeachingDerivationAgentParams,
): Promise<void> {
  const operation = params.operation ?? UNIT_TEACHING_DERIVATION_OPERATION;
  const toolSet = params.toolSet ?? TEACHING_DERIVATION_TOOL_SET;
  const finishToolName = params.finishToolName ?? "finish_teaching_derivation";
  const missingFinishMessage =
    params.missingFinishMessage ??
    "The agent stopped without finishing the teaching derivation.";
  if (getActiveLlmOperationRoute()?.operationKey !== operation) {
    return withLlmOperationRoute(operation, () =>
      runTeachingDerivationAgent(params),
    );
  }

  const repository = requireTeachingDerivationPersistence();
  const route = getActiveLlmOperationRoute();
  if (route) {
    await repository.updateRun({
      id: params.runId,
      routedProvider: route.provider,
      routedModel: route.model,
      now: new Date(),
    });
  }

  const { getDefaultLearningSystemRuntime } =
    await import("../learning-systems/default-runtime.js");
  const learningRuntime = getDefaultLearningSystemRuntime();
  const workflowSet = learningRuntime.registry.getToolSet(toolSet);
  if (!workflowSet) {
    throw new Error(`Missing registered tool set "${toolSet}"`);
  }
  const toolSession = new ToolCapabilitySession({
    operation,
    subject: {
      userId: params.userId,
      threadId: params.runId,
    },
    toolSets: [workflowSet],
    preloadedToolSetKeys: [toolSet],
    includeGetToolSet: false,
    maxToolCalls: 160,
  });
  const model = await getChatModel();
  const provider = getLlmProvider();
  const promptInvocation = {
    title: params.title,
    locale: params.locale,
    requirementText: params.requirementText,
    assumptions: params.assumptions,
    target: params.target,
  };
  const invocationPrompt =
    params.invocationPrompt ??
    buildTeachingDerivationInvocationPrompt(promptInvocation);
  const preparedGeneration = await runGenerationContextScope(
    {
      subject: { userId: params.userId, threadId: params.runId },
      query: params.requirementText,
      invocation: promptInvocation,
    },
    () => prepareGenerationInvocation(operation, ""),
  );
  const llmMessages = buildTeachingDerivationInitialMessages(
    preparedGeneration.prompt,
    invocationPrompt,
  );
  const maxToolRounds = resolveOperationMaxToolRounds(
    operation,
    DEFAULT_MAX_TOOL_ROUNDS,
  );
  let rounds = 0;
  let emptyTurns = 0;
  const invalidToolAttempts = new Map<string, number>();
  let lastToolErrorKey = "";
  let repeatedToolErrors = 0;

  const tools = toolSession.getExposedTools();
  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));
  const lcTools = toLangChainTools(tools);
  const modelWithTools =
    lcTools.length > 0 && typeof model.bindTools === "function"
      ? model.bindTools(
          lcTools,
          provider.id === "bigmodel" ? { tool_choice: "auto" } : undefined,
        )
      : model;
  const toolNames = [...toolMap.keys()];
  const preferInvokeForTools = provider.id === "ollama" && lcTools.length > 0;

  const executeTool = async (
    tc: { id: string; name: string; args: Record<string, unknown> },
    parsed: unknown,
  ) => {
    await params.send({
      type: "tool_started",
      toolCallId: tc.id,
      toolName: tc.name,
      args: tc.args,
    });
    const toolStarted = Date.now();
    let result: unknown;
    try {
      result = await toolSession.execute(tc.name, parsed, {
        userId: params.userId,
        threadId: params.runId,
        traceId: params.traceId,
        signal: params.signal,
        send: async () => undefined,
        state: {},
      });
    } catch (error) {
      result = {
        ok: false,
        code: "tool_error",
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
      };
    }
    const resultStr =
      typeof result === "string" ? result : JSON.stringify(result ?? {});
    const ok =
      !(result && typeof result === "object" && "ok" in result) ||
      (result as { ok?: unknown }).ok !== false;
    await params.send({
      type: "tool_finished",
      toolCallId: tc.id,
      ok,
      result,
    });
    await logLlmRequest({
      operation: `${operation}.tool.${tc.name}`,
      kind: "chat",
      status: ok ? "success" : "error",
      durationMs: Date.now() - toolStarted,
      spanType: "tool",
      toolName: tc.name,
      request: {
        toolCall: { id: tc.id, name: tc.name, args: tc.args },
        traceId: params.traceId,
        platformFunded: params.platformFunded ?? true,
      },
      response: { content: resultStr },
      meta: {
        scope: "thread",
        scopeId: params.runId,
        operation,
        platformFunded: params.platformFunded ?? true,
      },
    });
    return { result, resultStr, ok };
  };

  if (params.signal?.aborted) {
    await params.send({ type: "run_cancelled" });
    return;
  }
  // Bootstrap from the bound tool, without spending a model round asking to
  // inspect. This message is written once; all later history is append-only.
  if (toolMap.has("inspect_teaching_derivation")) {
    const initial = await executeTool(
      {
        id: `initial-inspect-${params.runId}`,
        name: "inspect_teaching_derivation",
        args: {},
      },
      {},
    );
    if (initial.ok) {
      llmMessages.push({
        role: "user",
        content:
          "The server has already called inspect_teaching_derivation for this run. Use this initial state directly; inspect again only on conflict or missing context.\n" +
          initial.resultStr,
      });
    }
  }

  while (rounds < maxToolRounds) {
    if (params.signal?.aborted) {
      await params.send({ type: "run_cancelled" });
      return;
    }
    rounds += 1;
    let gathered: AIMessageChunk | undefined;
    const streamedArgs = emptyStreamedToolArgState();
    const llmStarted = Date.now();
    const tagFilter = new ThinkingTagStreamFilter();
    let pendingAssistantText = "";
    const sendAssistantDelta = async (delta: string) => {
      markActiveLlmRouteOutputStarted();
      pendingAssistantText += delta;
    };
    const logHandle = await beginLlmRequestLog({
      operation: `${operation}.llm`,
      kind: "chat",
      request: {
        messages: serializeAgentMessagesForLog(llmMessages),
        ...preparedGeneration.contextMeta,
        agentAvailableTools: toolNames,
        threadId: params.runId,
        traceId: params.traceId,
        platformFunded: params.platformFunded ?? true,
      },
      meta: {
        scope: "thread",
        scopeId: params.runId,
        operation,
        platformFunded: params.platformFunded ?? true,
      },
      setActiveSpan: true,
    });
    try {
      if (preferInvokeForTools) {
        const aiMsg = await modelWithTools.invoke(toBaseMessages(llmMessages), {
          signal: params.signal,
        });
        gathered = aiMsg as AIMessageChunk;
        collectStreamedToolArgumentChunk(gathered, streamedArgs);
        const streamChunk = extractAssistantStreamChunk(gathered);
        if (streamChunk.delta) {
          await tagFilter.push(streamChunk.delta, {
            onVisible: sendAssistantDelta,
            onThinking: async () => undefined,
          });
        }
      } else {
        const stream = await modelWithTools.stream(
          toBaseMessages(llmMessages),
          {
            signal: params.signal,
          },
        );
        for await (const chunk of stream) {
          if (params.signal?.aborted) break;
          gathered = gathered ? gathered.concat(chunk) : chunk;
          collectStreamedToolArgumentChunk(chunk, streamedArgs);
          const streamChunk = extractAssistantStreamChunk(chunk);
          if (streamChunk.delta) {
            await logHandle?.recordFirstResponse();
            await tagFilter.push(streamChunk.delta, {
              onVisible: sendAssistantDelta,
              onThinking: async () => undefined,
            });
          }
        }
      }
      await tagFilter.flush({
        onVisible: sendAssistantDelta,
        onThinking: async () => undefined,
      });
    } catch (err) {
      await logHandle?.finish({
        status: "error",
        durationMs: Date.now() - llmStarted,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    if (!gathered) {
      await logHandle?.finish({
        status: "success",
        durationMs: Date.now() - llmStarted,
        response: { empty: true },
      });
      break;
    }

    const aiMsg = gathered as AIMessage;
    const text = extractAssistantText(aiMsg);
    const reasoning = aiMsg.additional_kwargs?.reasoning_content;
    const reasoningContent =
      typeof reasoning === "string" ? reasoning : undefined;
    const recoveredCalls = recoverAgentToolCallsFromStream(
      extractAgentToolCalls(aiMsg, toolNames),
      streamedArgs,
      (name) => toolMap.get(name)?.schema,
      normalizeToolArgsBeforeValidation,
    );
    const toolCalls = normalizeToolCalls(recoveredCalls.calls);
    if (toolCalls.length > 0) markActiveLlmRouteOutputStarted();
    const llmDurationMs = Date.now() - llmStarted;
    const parsed = parseMessageForLog(aiMsg);
    if (recoveredCalls.recovered) {
      parsed.toolCalls = toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        args: tc.args,
      }));
    }
    await logHandle?.finish({
      status: recoveredCalls.recovered ? "recovered" : "success",
      durationMs: llmDurationMs,
      response: {
        parsed,
        rawLength: text.length,
        toolCallCount: toolCalls.length,
        ...(recoveredCalls.recovered
          ? { structuredRepairType: "streamed_tool_args" }
          : {}),
        ...usageLogFields(extractTokenUsage(gathered), llmDurationMs),
      },
    });

    const visible = stripThinkingTags(pendingAssistantText || text).trim();
    if (visible) {
      await params.send({ type: "agent_message", message: visible });
    }

    const validatedToolArgs = new Map<string, unknown>();
    const repairMessages: LlmMessageRecord[] = [];
    const schemaIssues: ReturnType<typeof buildValidationReport>["issues"] = [];
    for (const tc of toolCalls) {
      const def = toolMap.get(tc.name) as AgentToolDef | undefined;
      if (!def) continue;
      const normalizedArgs = normalizeToolArgsBeforeValidation(
        tc.name,
        tc.args,
      );
      const parsed = def.schema.safeParse(normalizedArgs);
      if (!parsed.success) {
        const invalidAttempts = (invalidToolAttempts.get(tc.name) ?? 0) + 1;
        invalidToolAttempts.set(tc.name, invalidAttempts);
        const report = buildValidationReport(parsed.error, normalizedArgs);
        schemaIssues.push(...report.issues);
        const result = {
          ok: false as const,
          code: "schema_invalid",
          message:
            toolArgsAreEmpty(tc.args) || toolArgsAreEmpty(normalizedArgs)
              ? emptyToolArgumentsRepairMessage(tc.name)
              : formatValidationReportForModel(report),
          retryable: true,
          issues: report.issues,
        };
        await logRejectedDerivationToolCall({
          operation,
          toolCall: { id: tc.id, name: tc.name, args: normalizedArgs },
          result,
          parentLogId: logHandle?.id,
          platformFunded: params.platformFunded ?? true,
        });
        if (shouldAbortInvalidDerivationToolSchema(invalidAttempts)) {
          await params.send({
            type: "run_failed",
            error: {
              code: "tool_error_loop",
              message: `The derivation agent kept sending invalid ${tc.name} arguments.`,
              retryable: true,
            },
          });
          return;
        }
        repairMessages.push({
          role: "tool",
          content: JSON.stringify({
            ok: result.ok,
            code: result.code,
            message: result.message,
            retryable: result.retryable,
          }),
          toolCallId: tc.id,
        });
        continue;
      }
      invalidToolAttempts.set(tc.name, 0);
      tc.args = normalizedArgs as Record<string, unknown>;
      validatedToolArgs.set(tc.id, parsed.data);
    }
    if (schemaIssues.length > 0 && logHandle?.id) {
      await patchLlmRequestLog(logHandle.id, {
        response: {
          structuredOutcome: "schema_invalid",
          structuredIssues: schemaIssues,
        },
      });
    }
    if (repairMessages.length > 0) {
      llmMessages.push({
        role: "assistant",
        content: text,
        toolCalls,
        reasoningContent,
      });
      llmMessages.push(
        ...toolCalls.map(
          (tc) =>
            repairMessages.find((message) => message.toolCallId === tc.id) ?? {
              role: "tool" as const,
              toolCallId: tc.id,
              content: JSON.stringify({
                ok: false,
                code: "batch_not_executed",
                message:
                  "No calls in this batch executed because another call had invalid arguments. Fix it and retry in order.",
                retryable: true,
              }),
            },
        ),
      );
      continue;
    }
    if (toolCalls.length === 0) {
      emptyTurns += 1;
      if (emptyTurns >= 3) {
        await params.send({
          type: "run_failed",
          error: {
            code: "missing_finish",
            message: missingFinishMessage,
            retryable: true,
          },
        });
        return;
      }
      continue;
    }
    emptyTurns = 0;
    llmMessages.push({
      role: "assistant",
      content: text,
      toolCalls,
      reasoningContent,
    });
    let finished = false;
    for (const tc of toolCalls) {
      const parsed = validatedToolArgs.get(tc.id);
      const { result, ok } = await executeTool(tc, parsed);
      llmMessages.push({
        role: "tool",
        content: JSON.stringify(compactCommitToolResponse(result) ?? {}),
        toolCallId: tc.id,
      });
      if (!ok && shouldCountRepeatedDerivationToolError(tc.name, result)) {
        let errorKey = `${tc.name}:tool_error`;
        try {
          const parsedResult =
            typeof result === "string" ? JSON.parse(result) : result;
          if (
            parsedResult &&
            typeof parsedResult === "object" &&
            "code" in parsedResult
          ) {
            errorKey = `${tc.name}:${String((parsedResult as { code: unknown }).code)}`;
          }
        } catch {
          // keep generic key
        }
        try {
          const failure = (typeof result === "string" ? JSON.parse(result) : result) as { retryable?: boolean; message?: string };
          if (failure.retryable === false) {
            await params.send({ type: "run_failed", error: { code: "presentation_needs_attention", message: failure.message ?? "Teaching step needs attention", retryable: false } });
            return;
          }
        } catch { /* Non-JSON tool errors retain the existing bounded repair policy. */ }
        if (errorKey === lastToolErrorKey) repeatedToolErrors += 1;
        else {
          lastToolErrorKey = errorKey;
          repeatedToolErrors = 1;
        }
        if (repeatedToolErrors >= MAX_REPEATED_DERIVATION_TOOL_ERRORS) {
          await params.send({
            type: "run_failed",
            error: {
              code: "tool_error_loop",
              message: `The derivation agent kept failing on ${errorKey}. Inspect and change strategy before retrying.`,
              retryable: true,
            },
          });
          return;
        }
      } else {
        lastToolErrorKey = "";
        repeatedToolErrors = 0;
      }
      if (tc.name === finishToolName && ok) finished = true;
    }
    if (finished) return;
  }

  await params.send({
    type: "run_failed",
    error: {
      code: "tool_loop_exhausted",
      message: "The derivation agent reached its tool-round budget.",
      retryable: true,
    },
  });
}
