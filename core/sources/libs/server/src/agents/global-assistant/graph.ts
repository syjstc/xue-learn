import {
  handoffGoalCreationToGlobal,
} from "../core/agent-registry.js";
import { clearInterrupt, getPendingInterrupt } from "../core/interrupt.js";
import { addUserMessage, runSubagentLoop } from "../core/runtime.js";
import {
  appendAgentMessage,
  loadCheckpoint,
  saveCheckpoint,
  requireAgentConversationPersistence,
} from "../core/checkpoint.js";
import { runGoalCreationOrchestrator } from "../goal-creation/orchestrator.js";
import type {
  LearningSpaceGoalCreationApplication,
  LearningSpaceOrganizationApplication,
} from "../../learning-spaces/orm-application-service.js";
import {
  applyDocumentGoalSeed,
  type DocumentGoalSeed,
} from "../goal-creation/document-seed.js";
import { applyMicroCreationSeed } from "../goal-creation/micro-creation-seed.js";
import {
  applyGoalCreationDraft,
  type GoalCreationDraft,
} from "../goal-creation/state.js";
import {
  exitEmbeddedGoalCreation,
  isGlobalAssistantRequest,
  isGoalCreationResumeRequest,
  pauseEmbeddedGoalCreation,
  resumeEmbeddedGoalCreation,
  resolveEmbeddedGoalCreationStart,
  shouldRouteMessageToGoalCreation,
  startEmbeddedGoalCreation,
} from "../goal-creation/embedded.js";
import { FEATURE_GOAL_CREATION } from "../../features.js";
import {
  beginLlmRequestLog,
  type LlmRequestLogHandle,
} from "../../llm/logger.js";
import type {
  AgentMessageContextSnapshot,
  AgentPageContext,
  AgentRunContext,
  LlmMessageRecord,
} from "../core/types.js";
import { selectGlobalAssistantTools } from "./tool-selection.js";
import { GLOBAL_ASSISTANT_TOOL_PRESENTATIONS } from "./tool-presentations.js";
import { createCapabilityAgentQueryTools } from "../core/capability-query-tools.js";
import { getDefaultLearningSystemRuntime } from "../../learning-systems/index.js";
import {
  capabilityToolSetsFromTools,
  ToolCapabilitySession,
} from "../core/tool-capability.js";
import {
  requiresCurrentWebVerification,
  retrieveOrSearchWebKnowledge,
} from "../../search/web-knowledge.js";
import { z } from "zod";
import { learningSpaceOrganizationProposalSchema } from "../../learning-systems/capabilities/learning-spaces.js";

/** Hard bounds for durable chat history sent back to the global assistant. */
export const GLOBAL_ASSISTANT_CONTEXT_LIMITS = Object.freeze({
  maxMessages: 12,
  maxEstimatedTokens: 6_000,
  maxMessageChars: 6_000,
});

function estimateMessageTokens(content: string): number {
  // A conservative mixed Chinese/English estimate. The provider tokenizer is
  // deliberately not used on this hot path.
  return Math.ceil(content.length / 3);
}

function compactGlobalMessages(
  checkpoint: Awaited<ReturnType<typeof loadCheckpoint>>,
) {
  const candidates = checkpoint.llmMessages
    .filter(
      (m): m is LlmMessageRecord & { role: "user" | "assistant" } =>
        (m.role === "user" || m.role === "assistant") &&
        m.content.trim().length > 0,
    )
    .slice(-GLOBAL_ASSISTANT_CONTEXT_LIMITS.maxMessages)
    .map((m) => ({
      role: m.role,
      content:
        m.content.length > GLOBAL_ASSISTANT_CONTEXT_LIMITS.maxMessageChars
          ? `${m.content.slice(
              -GLOBAL_ASSISTANT_CONTEXT_LIMITS.maxMessageChars,
            )}`
          : m.content,
    }));
  const retained: typeof candidates = [];
  let estimatedTokens = 0;
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const message = candidates[index];
    const messageTokens = estimateMessageTokens(message.content);
    if (
      retained.length > 0 &&
      estimatedTokens + messageTokens >
        GLOBAL_ASSISTANT_CONTEXT_LIMITS.maxEstimatedTokens
    ) {
      break;
    }
    retained.unshift(message);
    estimatedTokens += messageTokens;
  }
  checkpoint.llmMessages = retained;
  return checkpoint;
}

function safeId(value: string | undefined) {
  return value && /^[a-zA-Z0-9_-]+$/.test(value) ? value : undefined;
}

function contextSnapshotFromPageContext(
  pageContext?: AgentPageContext,
): AgentMessageContextSnapshot | undefined {
  if (!pageContext) return undefined;
  const selectedText = pageContext.frontendState?.selectedText
    ?.trim()
    .slice(0, 240);
  const currentStep = pageContext.frontendState?.currentStep?.trim();
  return {
    pageKind: pageContext.pageKind,
    contextLabel: pageContext.contextLabel?.trim().slice(0, 120) || undefined,
    goalId: safeId(pageContext.goalId),
    spaceId: safeId(pageContext.spaceId),
    unitId: safeId(pageContext.unitId),
    focusUnitId: safeId(pageContext.focusUnitId),
    currentStep: currentStep?.slice(0, 120) || undefined,
    selectedText: selectedText || undefined,
  };
}

async function buildGlobalAssistantRunConfig(
  userId: string,
  checkpoint: Awaited<ReturnType<typeof loadCheckpoint>>,
  pageContext?: AgentPageContext,
  forcedWebContext?: string,
  currentQuery?: string,
) {
  const systemPrompt = "";
  const goalCreationPaused = Boolean(
    checkpoint.goalCreationActive && checkpoint.goalCreationPaused,
  );
  const selection = selectGlobalAssistantTools({
    query: currentQuery,
    pageContext,
    goalCreationPaused,
    webContextProvided: Boolean(forcedWebContext),
  });
  const learningRuntime = getDefaultLearningSystemRuntime();
  const capabilityQueryTools = await createCapabilityAgentQueryTools({
    registry: learningRuntime.registry,
    activationResolver: learningRuntime.activationResolver,
    operation: "agent.global",
    subject: {
      userId,
      ...(safeId(pageContext?.goalId)
        ? { goalId: safeId(pageContext?.goalId) }
        : {}),
      ...(safeId(pageContext?.unitId)
        ? { unitId: safeId(pageContext?.unitId) }
        : {}),
    },
    presentationAdapters: GLOBAL_ASSISTANT_TOOL_PRESENTATIONS,
  });
  const navigationSet = learningRuntime.registry.getToolSet(
    "platform.navigation",
  );
  const goalCreationSet = learningRuntime.registry.getToolSet(
    "goal_creation.entry",
  );
  const mathVisualizationSet =
    learningRuntime.registry.getToolSet("math.visualization");
  const svgVisualizationSet =
    learningRuntime.registry.getToolSet("svg.visualization");
  const learningSpacesSet = learningRuntime.registry.getToolSet(
    "learning_spaces.management",
  );
  const toolSets = [
    ...(navigationSet ? [navigationSet] : []),
    ...(goalCreationSet ? [goalCreationSet] : []),
    ...(mathVisualizationSet ? [mathVisualizationSet] : []),
    ...(svgVisualizationSet ? [svgVisualizationSet] : []),
    ...(learningSpacesSet ? [learningSpacesSet] : []),
    ...capabilityToolSetsFromTools(capabilityQueryTools.tools),
  ];
  const selectedNames = new Set(selection.capabilityToolKeys);
  const preloadedToolSetKeys = toolSets
    .filter(
      (set) =>
        (set.key === "platform.navigation" &&
          selection.actionToolKeys.includes("navigate")) ||
        (set.key === "goal_creation.entry" &&
          selection.actionToolKeys.some((key) =>
            ["create_goal", "resume_goal_creation"].includes(key),
          )) ||
        (set.key === "math.visualization" &&
          selection.intentBands.includes("visualization")) ||
        (set.key === "svg.visualization" &&
          selection.intentBands.includes("visualization")) ||
        (set.key === "learning_spaces.management" &&
          selection.intentBands.includes("spaces")) ||
        set.tools.some((tool) =>
          selectedNames.has(tool.capabilityUsage?.key ?? tool.name),
        ),
    )
    .map((set) => set.key);
  const toolSession = new ToolCapabilitySession({
    operation: "agent.global",
    subject: { userId },
    toolSets,
    preloadedToolSetKeys,
    loadableToolSetKeys: toolSets.map((set) => set.key),
    maxToolCalls: 24,
  });
  const tools = toolSession.getExposedTools();
  return {
    systemPrompt,
    toolSession,
    invocation: {
      ...(forcedWebContext ? { forcedWebContext } : {}),
      toolSelection: {
        intentBands: selection.intentBands,
        capabilityToolKeys: selection.capabilityToolKeys,
        actionToolKeys: selection.actionToolKeys,
        toolCount: tools.length,
        fallbackReason: selection.fallbackReason,
      },
    },
  };
}

function isLearningAppCurrentStateQuestion(message: string): boolean {
  return /今天学什么|今日学习|学习安排|学习日程|复习安排|待复习|目标状态|课程进度|study agenda|due review/i.test(
    message,
  );
}

export type GlobalAssistantRunOptions = {
  clientAction?: string;
  seedTopic?: string;
  documentSeed?: DocumentGoalSeed;
  isSmallCourse?: boolean;
  forceMain?: boolean;
  replayedUserMessage?: boolean;
  goalDraft?: GoalCreationDraft;
  learningSpaceApplication?: LearningSpaceGoalCreationApplication;
};

const EXIT_GOAL_CREATION_MESSAGE =
  "已退出目标创建，返回主助手。说「继续」可恢复刚才的流程。";

async function runExitEmbeddedGoalCreation(
  ctx: AgentRunContext,
): Promise<Awaited<ReturnType<typeof runSubagentLoop>>> {
  let checkpoint = await loadCheckpoint(ctx.threadId);
  if (!checkpoint.goalCreationActive || checkpoint.goalCreationPaused) {
    return { checkpoint, completed: true, interrupted: false };
  }

  checkpoint = exitEmbeddedGoalCreation(checkpoint);
  checkpoint = handoffGoalCreationToGlobal(checkpoint, "", "user_exit");
  await saveCheckpoint(ctx.threadId, checkpoint);
  await ctx.send({ type: "subagent", name: "global" });
  await ctx.send({
    type: "status",
    message: EXIT_GOAL_CREATION_MESSAGE,
  });
  await appendAgentMessage(ctx.threadId, {
    role: "system",
    content: EXIT_GOAL_CREATION_MESSAGE,
  });
  return { checkpoint, completed: true, interrupted: false };
}

async function runEmbeddedGoalCreation(
  ctx: AgentRunContext,
  userId: string,
  userMessage: string | undefined,
  pageContext: AgentPageContext | undefined,
  runOptions: GlobalAssistantRunOptions | undefined,
): Promise<Awaited<ReturnType<typeof runSubagentLoop>>> {
  const delegateStarted = Date.now();
  let delegateLog: LlmRequestLogHandle | undefined;
  try {
    const checkpoint = await loadCheckpoint(ctx.threadId);
    delegateLog = await beginLlmRequestLog({
      operation: "agent.goal_creation.run",
      kind: "chat",
      spanType: "tool",
      toolName: "goal_creation",
      request: {
        threadId: ctx.threadId,
        traceId: ctx.traceId,
        userMessage: userMessage ?? null,
        goalCreationActive: checkpoint.goalCreationActive ?? false,
        goalCreationMessageCount: Array.isArray(checkpoint.goalCreationMessages)
          ? checkpoint.goalCreationMessages.length
          : 0,
      },
      meta: {
        scope: "agent",
        scopeId: ctx.threadId,
        subagent: "goal_creation",
      },
    });

    const result = await runGoalCreationOrchestrator(ctx, userId, userMessage, {
      embedded: true,
      learningSpaceApplication: runOptions?.learningSpaceApplication,
    });

    await delegateLog?.finish({
      status: "success",
      durationMs: Date.now() - delegateStarted,
      response: {
        completed: result.completed,
        interrupted: result.interrupted,
        goalId:
          typeof result.checkpoint.goalState === "object" &&
          result.checkpoint.goalState &&
          typeof (result.checkpoint.goalState as { goalId?: unknown })
            .goalId === "string"
            ? (result.checkpoint.goalState as { goalId: string }).goalId
            : undefined,
      },
    });

    return result;
  } catch (error) {
    await delegateLog?.finish({
      status: "error",
      durationMs: Date.now() - delegateStarted,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function runGlobalAssistant(
  ctx: AgentRunContext,
  userId: string,
  userMessage?: string,
  pageContext?: AgentPageContext,
  runOptions?: GlobalAssistantRunOptions,
): Promise<Awaited<ReturnType<typeof runSubagentLoop>>> {
  if (
    FEATURE_GOAL_CREATION &&
    runOptions?.clientAction === "exit_goal_creation"
  ) {
    return runExitEmbeddedGoalCreation(ctx);
  }

  let checkpoint = await loadCheckpoint(ctx.threadId);

  const goalStart =
    FEATURE_GOAL_CREATION && !runOptions?.forceMain
      ? resolveEmbeddedGoalCreationStart(userMessage, runOptions)
      : { start: false as const };

  if (
    FEATURE_GOAL_CREATION &&
    !runOptions?.forceMain &&
    !goalStart.start &&
    isGoalCreationResumeRequest(checkpoint, userMessage)
  ) {
    checkpoint = resumeEmbeddedGoalCreation(checkpoint, {
      reason: "user_resume_request",
      question: userMessage?.trim(),
    });
    await saveCheckpoint(ctx.threadId, checkpoint);
    return runEmbeddedGoalCreation(
      ctx,
      userId,
      undefined,
      pageContext,
      runOptions,
    );
  }

  if (
    FEATURE_GOAL_CREATION &&
    !runOptions?.forceMain &&
    !goalStart.start &&
    shouldRouteMessageToGoalCreation(checkpoint, userMessage)
  ) {
    return runEmbeddedGoalCreation(
      ctx,
      userId,
      userMessage,
      pageContext,
      runOptions,
    );
  }

  if (goalStart.start) {
    const { reset } = await startEmbeddedGoalCreation(ctx.threadId, undefined, {
      send: ctx.send,
      preservePendingDocuments: Boolean(runOptions?.documentSeed),
    });
    if (!reset) {
      await ctx.send({
        type: "status",
        message: "已启动目标创建流程。",
        phase: "goal_creation",
      });
    }
    if (runOptions?.goalDraft) {
      let latest = await loadCheckpoint(ctx.threadId);
      latest = applyGoalCreationDraft(latest, {
        ...runOptions.goalDraft,
        topic:
          runOptions.goalDraft.topic ??
          goalStart.seed ??
          runOptions.seedTopic ??
          userMessage?.trim(),
      });
      await saveCheckpoint(ctx.threadId, latest);
    }
    if (runOptions?.documentSeed) {
      let latest = await loadCheckpoint(ctx.threadId);
      latest = applyDocumentGoalSeed(
        latest,
        runOptions.documentSeed,
        goalStart.seed ?? runOptions.seedTopic,
      );
      await saveCheckpoint(ctx.threadId, latest);
    }
    if (runOptions?.isSmallCourse) {
      let latest = await loadCheckpoint(ctx.threadId);
      latest = applyMicroCreationSeed(latest, {
        isSmallCourse: true,
        topic: goalStart.seed ?? runOptions.seedTopic ?? userMessage?.trim(),
      });
      await saveCheckpoint(ctx.threadId, latest);
    }
    return runEmbeddedGoalCreation(
      ctx,
      userId,
      goalStart.seed ?? userMessage?.trim(),
      pageContext,
      runOptions,
    );
  }

  if (
    FEATURE_GOAL_CREATION &&
    !runOptions?.forceMain &&
    checkpoint.goalCreationActive &&
    !checkpoint.goalCreationPaused &&
    userMessage?.trim() &&
    isGlobalAssistantRequest(userMessage)
  ) {
    checkpoint = pauseEmbeddedGoalCreation(checkpoint);
    checkpoint = handoffGoalCreationToGlobal(
      checkpoint,
      userMessage.trim(),
      "user_global_request",
    );
    await saveCheckpoint(ctx.threadId, checkpoint);
  }

  if (userMessage?.trim()) {
    if (runOptions?.replayedUserMessage) {
      checkpoint.llmMessages = [
        ...checkpoint.llmMessages,
        { role: "user", content: userMessage.trim() },
      ];
      await saveCheckpoint(ctx.threadId, checkpoint);
    } else {
      const contextSnapshot = contextSnapshotFromPageContext(pageContext);
      checkpoint = await addUserMessage(
        ctx.threadId,
        userMessage.trim(),
        contextSnapshot ? { contextSnapshot } : undefined,
      );
    }
  }
  checkpoint = compactGlobalMessages(checkpoint);
  let forcedWebContext = "";
  const currentQuery = userMessage?.trim();
  if (
    currentQuery &&
    requiresCurrentWebVerification(currentQuery) &&
    !isLearningAppCurrentStateQuestion(currentQuery)
  ) {
    const webResult = await retrieveOrSearchWebKnowledge({
      userId,
      query: currentQuery,
      reason: "问题包含需要当前验证的时间或版本信息",
      goalId: safeId(pageContext?.goalId),
      forceSearch: true,
      onActivity: async (activity) => {
        await ctx.send({ type: "knowledge_activity", activity });
      },
    });
    forcedWebContext =
      webResult.context ||
      `网页验证失败：${webResult.activity.error ?? "未找到可验证来源"}`;
    await appendAgentMessage(ctx.threadId, {
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: webResult.activity.id,
          name: "search_web_knowledge",
          args: { query: currentQuery },
        },
      ],
      uiPayload: {
        uiKind: "knowledge_activity",
        toolCallId: webResult.activity.id,
        args: { activity: webResult.activity },
      },
    });
  }
  const { systemPrompt, toolSession, invocation } =
    await buildGlobalAssistantRunConfig(
      userId,
      checkpoint,
      pageContext,
      forcedWebContext,
      currentQuery,
    );

  const result = await runSubagentLoop({
    ctx,
    systemPrompt,
    toolSession,
    checkpoint,
    registryAgentId: "global",
    pageContext,
    invocation,
  });

  checkpoint = await loadCheckpoint(ctx.threadId);
  if (
    FEATURE_GOAL_CREATION &&
    !runOptions?.forceMain &&
    checkpoint.goalCreationActive &&
    !checkpoint.goalCreationPaused &&
    !getPendingInterrupt(checkpoint) &&
    !result.interrupted
  ) {
    return runEmbeddedGoalCreation(
      ctx,
      userId,
      undefined,
      pageContext,
      runOptions,
    );
  }

  return result;
}

export async function resumeGlobalAssistant(
  ctx: AgentRunContext,
  userId: string,
  toolCallId: string,
  result: unknown,
  pageContext?: AgentPageContext,
  learningSpaceApplication?: LearningSpaceOrganizationApplication,
) {
  let checkpoint = await loadCheckpoint(ctx.threadId);
  const pending = getPendingInterrupt(checkpoint);

  if (!pending) {
    await ctx.send({
      type: "error",
      message: "当前没有等待处理的操作，请重新发送消息或刷新页面后重试。",
    });
    return { checkpoint, completed: false, interrupted: false };
  }

  if (pending.toolCallId !== toolCallId) {
    await ctx.send({
      type: "error",
      message: "这个操作已失效，请处理当前显示的最新操作。",
    });
    return { checkpoint, completed: false, interrupted: true };
  }

  if (pending.toolName === "propose_learning_space_organization") {
    const responseSchema = z.object({
      action: z.enum(["apply", "cancel"]),
      selectedOperationIds: z
        .array(z.string().trim().min(1))
        .max(128)
        .default([]),
    });
    const response = responseSchema.safeParse(result);
    const proposal = learningSpaceOrganizationProposalSchema.safeParse(
      pending.args,
    );
    if (!response.success || !proposal.success) {
      await ctx.send({
        type: "error",
        message: "学习空间整理方案无效，请重新生成。",
      });
      return { checkpoint, completed: false, interrupted: true };
    }
    if (response.data.action === "cancel") {
      checkpoint = clearInterrupt(checkpoint);
      const toolResult = { cancelled: true };
      checkpoint.llmMessages = [
        ...checkpoint.llmMessages,
        { role: "tool", content: JSON.stringify(toolResult), toolCallId },
      ];
      await saveCheckpoint(ctx.threadId, checkpoint);
      await appendAgentMessage(ctx.threadId, {
        role: "tool",
        content: JSON.stringify(toolResult),
        toolCallId,
        uiPayload: response.data,
      });
      const config = await buildGlobalAssistantRunConfig(userId, checkpoint);
      return runSubagentLoop({
        ctx,
        checkpoint,
        systemPrompt: config.systemPrompt,
        toolSession: config.toolSession,
        registryAgentId: "global",
        pageContext,
        invocation: config.invocation,
      });
    }
    let applied: Awaited<
      ReturnType<LearningSpaceOrganizationApplication["applyOrganizationProposal"]>
    >;
    try {
      if (!learningSpaceApplication) {
        throw new Error("Learning-space application is unavailable");
      }
      applied = await learningSpaceApplication.applyOrganizationProposal(
        userId,
        proposal.data,
        response.data.selectedOperationIds,
      );
      checkpoint = clearInterrupt(checkpoint);
      checkpoint.llmMessages = [
        ...checkpoint.llmMessages,
        { role: "tool", content: JSON.stringify(applied), toolCallId },
      ];
      await saveCheckpoint(ctx.threadId, checkpoint);
      await appendAgentMessage(ctx.threadId, {
        role: "tool",
        content: JSON.stringify(applied),
        toolCallId,
        uiPayload: response.data,
      });
    } catch (error) {
      // Keep the interrupt intact so a transient/stale proposal failure can be
      // retried or cancelled instead of leaving an actionable-looking card
      // with no matching server-side operation.
      await saveCheckpoint(ctx.threadId, checkpoint);
      await ctx.send({
        type: "error",
        message:
          error instanceof Error ? error.message : "学习空间整理失败，请重试。",
      });
      return { checkpoint, completed: false, interrupted: false };
    }
    const config = await buildGlobalAssistantRunConfig(userId, checkpoint);
    return runSubagentLoop({
      ctx,
      checkpoint,
      systemPrompt: config.systemPrompt,
      toolSession: config.toolSession,
      registryAgentId: "global",
      pageContext,
      invocation: config.invocation,
    });
  }

  const removedGoalActionTools = new Set([
    "ask_micro_expand_questions",
    "subdivide_unit",
    "regenerate_sub_map",
    "remove_sub_map",
    "convert_micro_to_full",
    "batch_sq_preview",
    "batch_material",
    "refresh_learning_plan",
  ]);
  if (removedGoalActionTools.has(pending.toolName)) {
    checkpoint = clearInterrupt(checkpoint);
    await saveCheckpoint(ctx.threadId, checkpoint);
    const message = "这个旧版助手操作已失效，请从对应学习目标页面重新操作。";
    await appendAgentMessage(ctx.threadId, {
      role: "system",
      content: message,
    });
    await ctx.send({ type: "status", message });
    return { checkpoint, completed: true, interrupted: false };
  }

  await ctx.send({
    type: "error",
    message: "当前没有可继续的助手操作。",
  });
  return { checkpoint, completed: false, interrupted: false };
}

export async function getGlobalBriefing(userId: string) {
  return requireAgentConversationPersistence().readGlobalBriefing(
    userId,
    new Date(),
  );
}
