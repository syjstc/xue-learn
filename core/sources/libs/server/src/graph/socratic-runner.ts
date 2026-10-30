import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { z } from "zod";
import { extractAgentToolCalls } from "../agents/core/extract-tool-calls.js";
import { defineAgentTool } from "../agents/core/tools.js";
import {
  capabilityToolSetFromTools,
  ToolCapabilitySession,
} from "../agents/core/tool-capability.js";
import { toLangChainTools } from "../agents/core/tools.js";
import { getChatModel } from "../llm/client.js";
import { getLlmProvider } from "../llm/providers/index.js";
import {
  getActiveLlmOperationRoute,
  markActiveLlmRouteOutputStarted,
  withLlmOperationRoute,
} from "../providers/llm/index.js";
import { getUnitModulePromptBlock } from "../goals/module-prompt-context.js";
import { beginLlmRequestLog } from "../llm/logger.js";
import { parseMessageForLog } from "../llm/parse-log-response.js";
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
import { buildTeachingDialogueInvocationPrompt } from "../learning-systems/capabilities/teaching-dialogue/capability.js";
import { TEACHING_DIALOGUE_VIEW_KEYS } from "../learning-systems/capabilities/teaching-dialogue/keys.js";
import { getPlanContextForGoal } from "./unit-session.js";
import { retrieveContextForUnit } from "../rag/retrieve.js";
import { runValidatedStructuredGeneration } from "../llm/validated-structured-generation.js";
import {
  prepareGenerationInvocation,
  runMergedGenerationContextScope,
} from "../generation/kernel.js";

const socraticFeedbackSchema = z.object({
  dn: z.boolean().optional().default(false),
  rs: z.boolean().optional().default(false),
  et: z.enum(["careless", "concept", "prerequisite"]).optional(),
});

const strictSocraticFeedbackSchema = z.object({
  dn: z.boolean(),
  rs: z.boolean(),
  et: z.enum(["none", "careless", "concept", "prerequisite"]),
});

const submitSocraticFeedbackTool = defineAgentTool({
  name: "submit_socratic_feedback",
  description:
    "After your user-facing reply, record session metadata. rs=true only when the learner's own latest answer demonstrates the corrected understanding. dn=true when resolved or when the guided dialogue must end. A turn limit is never evidence of resolution.",
  schema: socraticFeedbackSchema,
  handler: async (args) => args,
});

export type SocraticStreamEvent =
  { type: "message"; delta: string; role?: "assistant" } | { type: "thinking"; delta?: string };

export type SocraticStreamSend = (
  event: SocraticStreamEvent,
) => void | Promise<void>;

export type StreamSocraticParams = {
  goalId: string;
  unitId?: string;
  unitTitle: string;
  weakTags: string[];
  turn: number;
  lastAnswer?: string;
  priorContext?: string;
  signal?: AbortSignal;
  send?: SocraticStreamSend;
};

export type StreamSocraticResult = {
  question: string;
  done: boolean;
  resolved: boolean;
  terminatedByLimit: boolean;
  errorType?: "careless" | "concept" | "prerequisite";
};

function normalizeFeedbackToolCalls(
  calls: Array<{ id: string; name: string; args: Record<string, unknown> }>,
) {
  return calls
    .filter((tc) => tc.name === submitSocraticFeedbackTool.name)
    .slice(0, 1)
    .map((tc, index) => ({
      ...tc,
      id: tc.id || `socratic-feedback-${Date.now()}-${index}`,
    }));
}

export async function streamSocratic(
  params: StreamSocraticParams,
): Promise<StreamSocraticResult> {
  if (getActiveLlmOperationRoute()?.operationKey !== "unit.socratic") {
    return withLlmOperationRoute("unit.socratic", () => streamSocratic(params));
  }
  const plan = await getPlanContextForGoal(params.goalId);
  const ragContext = await retrieveContextForUnit(
    params.goalId,
    params.unitTitle,
    [...params.weakTags, params.lastAnswer].filter(Boolean).join(" "),
    4,
  );
  const ragBlock = ragContext ? `\nReference context:\n${ragContext}\n` : "";
  const moduleContext = params.unitId
    ? await getUnitModulePromptBlock(params.unitId)
    : "";

  const promptInvocation = {
    unitTitle: params.unitTitle,
    weakTags: params.weakTags,
    turn: params.turn,
    lastAnswer: params.lastAnswer,
    priorContext: [moduleContext, params.priorContext, ragBlock]
      .filter(Boolean)
      .join("\n"),
    languageBlock: plan.languageBlock(),
  };

  const userContent =
    params.lastAnswer?.trim() ||
    (params.turn === 0
      ? "Begin the Socratic correction for this mistake."
      : "Continue the Socratic dialogue.");
  const preparedGeneration = await runMergedGenerationContextScope(
    {
      subject: { goalId: params.goalId, unitId: params.unitId },
      query: `${params.unitTitle}: ${params.lastAnswer ?? ""}`.slice(0, 2_000),
      invocation: promptInvocation,
    },
    () =>
      prepareGenerationInvocation(
        "unit.socratic",
        buildTeachingDialogueInvocationPrompt(
          TEACHING_DIALOGUE_VIEW_KEYS.socraticInstructionContext,
          promptInvocation,
        ) ?? "",
      ),
  );

  const toolSession = new ToolCapabilitySession({
    operation: "unit.socratic",
    subject: { goalId: params.goalId, unitId: params.unitId },
    toolSets: [
      capabilityToolSetFromTools({
        key: "socratic_feedback",
        ownerCapabilityId: "teaching-dialogue",
        description: "Submit server-validated Socratic dialogue metadata.",
        tools: [submitSocraticFeedbackTool],
      }),
    ],
    preloadedToolSetKeys: ["socratic_feedback"],
    includeGetToolSet: false,
  });
  const tools = toolSession.getExposedTools();
  const lcTools = toLangChainTools(tools);
  const model = await getChatModel();
  const provider = getLlmProvider();
  const modelWithTools =
    lcTools.length > 0 && typeof model.bindTools === "function"
      ? model.bindTools(lcTools)
      : model;
  const preferInvokeForTools = provider.id === "ollama" && lcTools.length > 0;

  const baseMessages: BaseMessage[] = [
    new SystemMessage(preparedGeneration.prompt),
    new HumanMessage(userContent),
  ];

  let assistantText = "";
  let feedback: z.infer<typeof socraticFeedbackSchema> | undefined;
  const send = params.send ?? (() => {});

  const llmStarted = Date.now();
  const tagFilter = new ThinkingTagStreamFilter();
  const sendAssistantDelta = async (delta: string) => {
    markActiveLlmRouteOutputStarted();
    assistantText += delta;
    await send({ type: "message", delta, role: "assistant" });
  };
  const sendThinking = async (delta?: string) => {
    await send({ type: "thinking", ...(delta ? { delta } : {}) });
  };

  const logHandle = await beginLlmRequestLog({
    operation: "unit.socratic",
    kind: "chat",
    request: {
      unitTitle: params.unitTitle,
      turn: params.turn,
      hasLastAnswer: Boolean(params.lastAnswer?.trim()),
      ...preparedGeneration.contextMeta,
    },
    meta: {
      topicCategory: plan.topicCategory,
      goalTitle: plan.goalTitle,
      unitTitle: params.unitTitle,
      turn: params.turn,
    },
    setActiveSpan: true,
  });

  let gathered: AIMessageChunk | undefined;

  try {
    if (preferInvokeForTools) {
      const aiMsg = await modelWithTools.invoke(baseMessages, {
        signal: params.signal,
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
        signal: params.signal,
      });
      for await (const chunk of stream) {
        if (params.signal?.aborted) break;
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
    return {
      question: "",
      done: params.turn >= 4,
      resolved: false,
      terminatedByLimit: params.turn >= 4,
    };
  }

  const aiMsg = gathered as AIMessage;
  const text = extractAssistantText(aiMsg);
  if (!assistantText && text) {
    assistantText = text;
  }

  const toolCalls = normalizeFeedbackToolCalls(
    extractAgentToolCalls(aiMsg, [submitSocraticFeedbackTool.name]),
  );
  if (toolCalls.length > 0) markActiveLlmRouteOutputStarted();

  const llmDurationMs = Date.now() - llmStarted;
  await logHandle?.finish({
    status: "success",
    durationMs: llmDurationMs,
    response: {
      parsed: parseMessageForLog(aiMsg),
      rawLength: text.length,
      toolCallCount: toolCalls.length,
      ...usageLogFields(extractTokenUsage(gathered), llmDurationMs),
    },
  });

  const initialFeedback = socraticFeedbackSchema.safeParse(toolCalls[0]?.args);
  if (initialFeedback.success) {
    feedback = initialFeedback.data;
  } else {
    const feedbackInvocation = {
      unitTitle: params.unitTitle,
      turn: params.turn,
      lastAnswer: params.lastAnswer,
      assistantText,
    };
    const repaired = await runValidatedStructuredGeneration(
      {
        mode: "object",
        schema: strictSocraticFeedbackSchema,
        prompt:
          buildTeachingDialogueInvocationPrompt(
            TEACHING_DIALOGUE_VIEW_KEYS.socraticFeedbackInstructionContext,
            feedbackInvocation,
          ) ?? "",
        options: {
          operation: "unit.socratic.feedback",
          bindingSchema: strictSocraticFeedbackSchema,
          meta: {
            topicCategory: plan.topicCategory,
            goalTitle: plan.goalTitle,
            unitTitle: params.unitTitle,
            turn: params.turn,
            outputFormat: "structured_object",
          },
        },
        contextSubject: { goalId: params.goalId, unitId: params.unitId },
        contextQuery: `${params.unitTitle}: ${params.lastAnswer ?? ""}`.slice(
          0,
          2_000,
        ),
        contextInvocation: feedbackInvocation,
      },
      { signal: params.signal },
    );
    feedback = socraticFeedbackSchema.parse({
      dn: repaired.dn,
      rs: repaired.rs,
      ...(repaired.et === "none" ? {} : { et: repaired.et }),
    });
  }

  const question = stripThinkingTags(assistantText).trim();
  const resolved = feedback?.rs === true;
  const terminatedByLimit = params.turn >= 4 && !resolved;
  const done = resolved || feedback?.dn === true || terminatedByLimit;

  return {
    question,
    done,
    resolved,
    terminatedByLimit,
    errorType: feedback?.et,
  };
}
