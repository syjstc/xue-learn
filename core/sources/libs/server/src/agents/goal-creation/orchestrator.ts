import { tBackend } from "../../../../common/src/index.js";
import { agentMemoryStore } from "../memory/store.js";
import {
  formatGoalCreationUserReply,
  isGoalCreationHumanTool,
} from "./display.js";
import {
  resumeToolCall,
  runSubagentLoop,
  type RunSubagentResult,
} from "../core/runtime.js";
import { updateRegistryAfterAgentTurn } from "../core/agent-registry.js";
import {
  appendAgentMessage,
  loadCheckpoint,
  requireAgentConversationPersistence,
  saveCheckpoint,
  type ThreadCheckpoint,
} from "../core/checkpoint.js";
import {
  clearInterrupt,
  getPendingInterrupt,
  setInterrupt,
} from "../core/interrupt.js";
import type {
  AgentRunContext,
  AgentSubagent,
  AgentToolCallRecord,
  LlmMessageRecord,
} from "../core/types.js";
import {
  interruptForConfirmation,
  interruptForCollectForm,
  interruptForGoalSpaceSuggestion,
  needsCollectFormInterrupt,
} from "./subagents/intake/collect-form.js";
import { applyIntakeResumeResult } from "./subagents/intake/tools.js";
import { mergeDiscoveryQuestionHistory } from "./subagents/intake/discovery-questions.js";
import { applyPlanResumeResult } from "./subagents/plan/tools.js";
import {
  approveGoalPlan,
  createGoalRecord,
  generatePlanForGoal,
} from "./actions.js";
import { createMicroUnitForGoal } from "../../goals/create-micro-unit.js";
import { ensureGoalIcon } from "../../goals/ensure-goal-icon.js";
import {
  deactivateEmbeddedGoalCreation,
  mergeEmbeddedCheckpoint,
  type GoalCreationRunOptions,
  withEmbeddedCheckpoint,
} from "./embedded.js";
import {
  createInitialGoalState,
  goalStateFromCheckpoint,
  mergeGoalState,
  type GoalCreationState,
} from "./state.js";
import { createCapabilityAgentQueryTools } from "../core/capability-query-tools.js";
import { getDefaultLearningSystemRuntime } from "../../learning-systems/index.js";
import {
  capabilityToolSetsFromTools,
  ToolCapabilitySession,
} from "../core/tool-capability.js";
import {
  assessGoalScope,
  compileGoalScopeProposal,
  GoalScopeAssessmentError,
  selectGoalScopeProposal,
} from "../../goal-creation/scope-assessment.js";
import { ensureGoalTitleFromTopic } from "../../goals/refine-goal-title-from-topic.js";
import { formatPlannedGoalActivationContext } from "../../learning-spaces/planned-goal-brief.js";
import { resolveGoalContentLanguage } from "../../llm/content-language.js";
import {
  compileGoalCreationContract,
  goalCreationContractHash,
  goalCreationContractJson,
  isAgenticGoalCreation,
  resolveGoalCreationExecutionMode,
  resolvePlannedGoalActivationPlanningMode,
  shouldConfirmPlannedGoalWithoutIntake,
} from "./contract.js";
import {
  runAgenticPostApproval,
  shouldRunAgenticPostApproval,
} from "./agentic-workflow.js";

async function generateGoalIconDuringCreation(
  ctx: AgentRunContext,
  userId: string,
  checkpoint: ThreadCheckpoint,
  goalId: string,
  title: string,
): Promise<ThreadCheckpoint> {
  const next = mergeGoalState(checkpoint, {
    goalId,
    goalApproved: true,
    currentPhase: "generating_icon",
  }) as ThreadCheckpoint;
  await saveCheckpoint(ctx.threadId, next);
  await ctx.send({
    type: "phase",
    phase: "generating_icon",
    subagent: "intake",
  });
  await ctx.send({
    type: "status",
    message: tBackend("status.generation.goalIcon"),
    phase: "generating_icon",
  });
  await ensureGoalIcon(userId, goalId, title);
  return next;
}

function resolveSubagent(checkpoint: ThreadCheckpoint): AgentSubagent {
  const state = goalStateFromCheckpoint(checkpoint);
  if (state.isSmallCourse) return "intake";
  if (state.currentSubagent === "plan") return "plan";
  if (state.goalId) return "plan";
  return "intake";
}

async function getSubagentConfig(
  subagent: AgentSubagent,
  userId: string,
  scope: { goalId?: string; threadId: string },
) {
  const base = (() => {
    switch (subagent) {
      case "plan":
        return {
          systemPrompt: "",
        };
    }
    return {
      systemPrompt: "",
    };
  })();
  const learningRuntime = getDefaultLearningSystemRuntime();
  const capabilityQueryTools = await createCapabilityAgentQueryTools({
    registry: learningRuntime.registry,
    activationResolver: learningRuntime.activationResolver,
    operation: `agent.goal_creation.${subagent}`,
    subject: {
      userId,
      threadId: scope.threadId,
      ...(scope.goalId ? { goalId: scope.goalId } : {}),
    },
  });
  const workflowSetKey = `goal_creation.${subagent}`;
  const workflowSet = learningRuntime.registry.getToolSet(workflowSetKey);
  if (!workflowSet) {
    throw new Error(`Missing registered tool set "${workflowSetKey}"`);
  }
  const toolSets = [
    workflowSet,
    ...capabilityToolSetsFromTools(capabilityQueryTools.tools),
  ];
  return {
    systemPrompt: base.systemPrompt,
    toolSession: new ToolCapabilitySession({
      operation: `agent.goal_creation.${subagent}`,
      subject: {
        userId,
        threadId: scope.threadId,
        ...(scope.goalId ? { goalId: scope.goalId } : {}),
      },
      toolSets,
      preloadedToolSetKeys: [workflowSetKey],
      loadableToolSetKeys: toolSets.map((set) => set.key),
      maxToolCalls: 48,
    }),
  };
}

function syncExecutionMode(checkpoint: ThreadCheckpoint): ThreadCheckpoint {
  const state = goalStateFromCheckpoint(checkpoint);
  const executionMode = resolveGoalCreationExecutionMode({
    isSmallCourse: state.isSmallCourse,
    isPlannedGoalActivation: state.isPlannedGoalActivation,
    autoApproveWithoutQuestions: state.autoApproveWithoutQuestions,
  });
  if (state.executionMode === executionMode) return checkpoint;
  return mergeGoalState(checkpoint, { executionMode }) as ThreadCheckpoint;
}

function applyConfirmationEdits(
  state: GoalCreationState,
  edits: Record<string, unknown> | undefined,
): GoalCreationState {
  if (!edits) return state;
  const planningMode =
    edits.planningMode === "fast" ||
    edits.planningMode === "deep" ||
    edits.planningMode === "docs_first"
      ? edits.planningMode
      : state.planningMode;
  const learningMode =
    edits.learningMode === "exploration" || edits.learningMode === "mastery"
      ? edits.learningMode
      : state.learningMode;
  return {
    ...state,
    ...(typeof edits.isSmallCourse === "boolean"
      ? { isSmallCourse: edits.isSmallCourse }
      : {}),
    planningMode,
    learningMode,
  };
}

function persistCompiledContract(state: GoalCreationState): GoalCreationState {
  try {
    const contract = compileGoalCreationContract(state);
    return {
      ...state,
      contractJson: goalCreationContractJson(contract),
      contractHash: goalCreationContractHash(contract),
      executionMode: resolveGoalCreationExecutionMode(state),
    };
  } catch {
    return {
      ...state,
      executionMode: resolveGoalCreationExecutionMode(state),
    };
  }
}

async function continueAfterFullGoalApproval(
  ctx: AgentRunContext,
  userId: string,
  checkpoint: ThreadCheckpoint,
  embedded: boolean,
  options: GoalCreationRunOptions,
): Promise<RunSubagentResult> {
  const state = goalStateFromCheckpoint(checkpoint);
  if (
    state.planningMode === "deep" &&
    !state.targetSpaceId &&
    state.spaceSuggestionStatus === "pending" &&
    state.spaceSuggestion
  ) {
    return interruptForGoalSpaceSuggestion(
      ctx,
      checkpoint,
      embedded,
      state.spaceSuggestion,
    );
  }
  if (shouldRunAgenticPostApproval(checkpoint)) {
    const session =
      await requireAgentConversationPersistence().findGoalCreationSessionByThreadId(
        ctx.threadId,
      );
    if (!session) {
      throw new Error("Goal-creation session is missing");
    }
    await ctx.send({ type: "subagent", name: "plan" });
    const next = await runAgenticPostApproval(
      ctx,
      userId,
      checkpoint,
      options,
      session.id,
    );
    return { checkpoint: next, completed: false, interrupted: false };
  }
  await ctx.send({ type: "subagent", name: "plan" });
  const plan = await generatePlanForGoal(
    userId,
    goalStateFromCheckpoint(checkpoint),
    ctx,
    {
      learningGoalPlan: options.learningSpaceApplication?.learningGoalPlan,
    },
  );
  const planned = mergeGoalState(checkpoint, {
    mapPlan: plan,
    mapPlanStatus: "ready",
    currentPhase: "reviewing_plan",
    currentSubagent: "plan",
  }) as ThreadCheckpoint;
  await saveCheckpoint(ctx.threadId, planned);
  return interruptForPlanReview(
    ctx,
    userId,
    planned,
    embedded,
    options.learningSpaceApplication,
  );
}

async function ensureGoalState(
  checkpoint: ThreadCheckpoint,
): Promise<ThreadCheckpoint> {
  if (!checkpoint.goalState) {
    return {
      ...checkpoint,
      goalState: createInitialGoalState(),
    };
  }
  return checkpoint;
}

async function hydratePlannedGoalBrief(
  userId: string,
  checkpoint: ThreadCheckpoint,
  application?: GoalCreationRunOptions["learningSpaceApplication"],
): Promise<ThreadCheckpoint> {
  const state = goalStateFromCheckpoint(checkpoint);
  if (
    !state.targetSpaceId ||
    !state.targetSpaceItemId ||
    state.scopeStatus !== "pending" ||
    !application
  ) {
    return checkpoint;
  }
  const seed = await application.plannedGoalSeed(
    userId,
    state.targetSpaceId,
    state.targetSpaceItemId,
  );
  if (!seed) {
    return mergeGoalState(checkpoint, {
      scopeStatus: "skipped",
    }) as ThreadCheckpoint;
  }
  const brief = seed.goalBrief;
  const collectedFields = new Set(state.collectedFields);
  collectedFields.add("level");
  collectedFields.add("contentLanguage");
  collectedFields.add("isSmallCourse");
  collectedFields.add("documents");
  return mergeGoalState(checkpoint, {
    topic: brief?.originalRequest || seed.title,
    refinedTitle: seed.title,
    intentAnalysis: brief?.intendedOutcome || seed.rationale || seed.title,
    isSmallCourse: seed.suggestedGoalKind === "micro",
    isPlannedGoalActivation: true,
    discoverySkipped: true,
    scopeStatus: "skipped",
    generationOptions: [
      state.generationOptions,
      formatPlannedGoalActivationContext(seed),
    ]
      .filter(Boolean)
      .join("\n\n"),
    collectedFields: [...collectedFields],
    planningMode: resolvePlannedGoalActivationPlanningMode({
      isSmallCourse: seed.suggestedGoalKind === "micro",
      hasDocuments: state.hasDocuments,
      suggestedPlanningMode: brief?.suggestedPlanningMode,
    }),
    ...(brief
      ? {
          level: brief.suggestedLevel,
          learningMode: brief.suggestedLearningMode,
          contentLanguage: brief.suggestedContentLanguage,
          contentLanguageSourceText: brief.originalRequest,
        }
      : {}),
  }) as ThreadCheckpoint;
}

async function interruptForGoalScope(
  ctx: AgentRunContext,
  checkpoint: ThreadCheckpoint,
  embedded: boolean,
): Promise<RunSubagentResult> {
  const state = goalStateFromCheckpoint(checkpoint);
  const toolCall: AgentToolCallRecord = {
    id: `goal-scope-review-${Date.now()}`,
    name: "review_goal_scope",
    args: {
      title: "建议拆分为学习路线",
      summary: state.scopeAssessment?.rationale ?? "",
      decision: state.scopeStatus,
      existingSpaceId: state.scopeAssessment?.existingSpaceId,
      recommendedFirstGoalRef: state.scopeAssessment?.recommendedFirstGoalRef,
      proposal: state.scopeProposal,
    },
  };
  const next = mergeGoalState(checkpoint, {
    currentPhase: "scoping",
  }) as ThreadCheckpoint;
  const { working, globalMessages } = withEmbeddedCheckpoint(next, embedded);
  const interruptedWorking = setInterrupt(
    {
      ...working,
      llmMessages: [
        ...working.llmMessages,
        { role: "assistant", content: "", toolCalls: [toolCall] },
      ],
    },
    {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      uiKind: "goal_scope_roadmap_preview",
      args: toolCall.args,
    },
  );
  const merged = mergeEmbeddedCheckpoint(
    next,
    interruptedWorking,
    globalMessages,
    embedded,
  );
  await ctx.send({ type: "phase", phase: "scoping", subagent: "intake" });
  await ctx.send({
    type: "tool_ui",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    uiKind: "goal_scope_roadmap_preview",
    args: toolCall.args,
  });
  await ctx.send({
    type: "interrupt",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
  });
  await saveCheckpoint(ctx.threadId, merged);
  await appendAgentMessage(ctx.threadId, {
    role: "assistant",
    content: "",
    toolCalls: [toolCall],
    uiPayload: { uiKind: "goal_scope_roadmap_preview", args: toolCall.args },
  });
  return { checkpoint: merged, completed: false, interrupted: true };
}

async function assessScopeBeforeConfirmation(
  ctx: AgentRunContext,
  userId: string,
  checkpoint: ThreadCheckpoint,
  embedded: boolean,
  application?: GoalCreationRunOptions["learningSpaceApplication"],
): Promise<RunSubagentResult> {
  const state = goalStateFromCheckpoint(checkpoint);
  if (
    state.scopeStatus !== "pending" ||
    state.isSmallCourse ||
    state.hasDocuments ||
    state.targetSpaceItemId
  ) {
    const skipped =
      state.scopeStatus === "pending"
        ? (mergeGoalState(checkpoint, {
            scopeStatus: "skipped",
          }) as ThreadCheckpoint)
        : checkpoint;
    await saveCheckpoint(ctx.threadId, skipped);
    return interruptForConfirmation(ctx, skipped, embedded);
  }
  if (!application) {
    const failed = mergeGoalState(checkpoint, {
      scopeStatus: "failed",
    }) as ThreadCheckpoint;
    await saveCheckpoint(ctx.threadId, failed);
    return interruptForConfirmation(ctx, failed, embedded);
  }

  await ctx.send({ type: "phase", phase: "scoping", subagent: "intake" });
  let portfolioFingerprint = "";
  try {
    const titled = await ensureGoalTitleFromTopic(
      state.topic,
      state.refinedTitle,
      {
        contentLanguage: resolveGoalContentLanguage(
          state.contentLanguage,
          state.contentLanguageSourceText || state.topic,
        ),
        userId,
        threadId: ctx.threadId,
      },
    );
    const portfolio = await application.portfolio(userId);
    portfolioFingerprint = portfolio.fingerprint;
    const { assessment, research } = await assessGoalScope({
      userId,
      threadId: ctx.threadId,
      topic: state.topic,
      refinedTitle: titled.refinedTitle,
      intentAnalysis: state.intentAnalysis || titled.intentAnalysis,
      generationOptions: state.generationOptions,
      level: state.level,
      contentLanguage: state.contentLanguage,
      learningMode: state.learningMode,
      planningMode: state.planningMode,
      portfolio,
      signal: ctx.signal,
      onActivity: async (activity) => {
        await ctx.send({ type: "knowledge_activity", activity });
      },
    });
    const proposal = compileGoalScopeProposal(assessment, portfolio);
    const hasExistingSpace = Boolean(
      assessment.existingSpaceId &&
      portfolio.spaces.some((space) => space.id === assessment.existingSpaceId),
    );
    const status =
      assessment.decision === "multi_goal" && proposal
        ? "multi_goal"
        : assessment.decision === "existing_roadmap" && hasExistingSpace
          ? "existing_roadmap"
          : "single_goal";
    const scoped = mergeGoalState(checkpoint, {
      refinedTitle: titled.refinedTitle,
      intentAnalysis: state.intentAnalysis || titled.intentAnalysis,
      scopeStatus: status,
      scopeAssessment: assessment,
      scopeProposal: proposal,
      scopePortfolioFingerprint: portfolio.fingerprint,
      scopeResearch: research,
      currentPhase: status === "single_goal" ? "confirming" : "scoping",
    }) as ThreadCheckpoint;
    await saveCheckpoint(ctx.threadId, scoped);
    return status === "single_goal"
      ? interruptForConfirmation(ctx, scoped, embedded)
      : interruptForGoalScope(ctx, scoped, embedded);
  } catch (error) {
    console.warn(
      "[goal-creation] scope assessment failed:",
      error instanceof Error ? error.message : error,
    );
    await ctx.send({
      type: "status",
      message: "范围分析暂时不可用，将按单个学习目标继续。",
      phase: "scoping",
    });
    const failed = mergeGoalState(checkpoint, {
      scopeStatus: "failed",
      scopePortfolioFingerprint: portfolioFingerprint,
      scopeResearch:
        error instanceof GoalScopeAssessmentError ? error.research : null,
      currentPhase: "confirming",
    }) as ThreadCheckpoint;
    await saveCheckpoint(ctx.threadId, failed);
    return interruptForConfirmation(ctx, failed, embedded);
  }
}

async function finishScopeDecision(
  ctx: AgentRunContext,
  checkpoint: ThreadCheckpoint,
  embedded: boolean,
  input: {
    toolCallId: string;
    submitted: Record<string, unknown>;
    message: string;
    navigateTo?: string;
  },
): Promise<RunSubagentResult> {
  const resultStr = JSON.stringify(input.submitted);
  let completed = clearInterrupt(
    mergeGoalState(checkpoint, {
      currentPhase: "completed",
    }) as ThreadCheckpoint,
  );
  const { working, globalMessages } = withEmbeddedCheckpoint(
    completed,
    embedded,
  );
  completed = mergeEmbeddedCheckpoint(
    completed,
    {
      ...working,
      goalState: goalStateFromCheckpoint(completed),
      llmMessages: [
        ...working.llmMessages,
        { role: "tool", content: resultStr, toolCallId: input.toolCallId },
        { role: "assistant", content: input.message },
      ],
    },
    globalMessages,
    embedded,
  );
  if (embedded) completed = deactivateEmbeddedGoalCreation(completed);
  await saveCheckpoint(ctx.threadId, completed);
  await appendAgentMessage(ctx.threadId, {
    role: "tool",
    content: resultStr,
    toolCallId: input.toolCallId,
    uiPayload: input.submitted,
  });
  await appendAgentMessage(ctx.threadId, {
    role: "assistant",
    content: input.message,
  });
  await ctx.send({
    type: "done",
    ...(input.navigateTo ? { navigateTo: input.navigateTo } : {}),
    ...(embedded ? { inline: true } : {}),
  });
  return { checkpoint: completed, completed: true, interrupted: false };
}

async function addGoalCreationUserMessage(
  threadId: string,
  content: string,
  embedded: boolean,
): Promise<ThreadCheckpoint> {
  const checkpoint = await loadCheckpoint(threadId);
  if (embedded) {
    const goalCreationMessages = Array.isArray(checkpoint.goalCreationMessages)
      ? (checkpoint.goalCreationMessages as LlmMessageRecord[])
      : [];
    checkpoint.goalCreationMessages = [
      ...goalCreationMessages,
      { role: "user", content },
    ];
  } else {
    checkpoint.llmMessages = [
      ...checkpoint.llmMessages,
      { role: "user", content },
    ];
  }
  await saveCheckpoint(threadId, checkpoint);
  await appendAgentMessage(threadId, { role: "user", content });
  return checkpoint;
}

async function runGoalSubagentLoop(
  ctx: AgentRunContext,
  userId: string,
  checkpoint: ThreadCheckpoint,
  subagent: AgentSubagent,
  embedded: boolean,
): Promise<RunSubagentResult> {
  const base = await ensureGoalState(checkpoint);
  const { working, globalMessages } = withEmbeddedCheckpoint(base, embedded);
  const goalState = goalStateFromCheckpoint(base);
  const config = await getSubagentConfig(subagent, userId, {
    goalId: goalStateFromCheckpoint(base).goalId,
    threadId: ctx.threadId,
  });
  const result = await runSubagentLoop({
    ctx,
    systemPrompt: config.systemPrompt,
    toolSession: config.toolSession,
    checkpoint: working,
    stateKey: "goalState",
    subagent,
    registryAgentId: "goal_creation",
    invocation: {
      ...(goalState.targetSpaceId
        ? {
            goalCreationTargetSpaceId: goalState.targetSpaceId,
          }
        : {}),
      ...(goalState.targetSpaceItemId
        ? {
            goalCreationTargetSpaceItemId: goalState.targetSpaceItemId,
          }
        : {}),
    },
  });
  let merged = mergeEmbeddedCheckpoint(
    base,
    result.checkpoint,
    globalMessages,
    embedded,
  );
  merged = updateRegistryAfterAgentTurn(merged, "goal_creation");
  await saveCheckpoint(ctx.threadId, merged);
  return { ...result, checkpoint: merged };
}

function formatGoalCreatedMessage(
  title: string,
  goalId?: string,
  isMicro?: boolean,
): string {
  const base = isMicro
    ? `已为你创建轻课「${title}」。`
    : `已为你创建学习目标「${title}」，学习地图已生成。`;
  return goalId ? `${base} [查看目标](/goals/${goalId})` : base;
}

async function runMicroCourseCreation(
  ctx: AgentRunContext,
  userId: string,
  checkpoint: ThreadCheckpoint,
  embedded: boolean,
  options: GoalCreationRunOptions = {},
): Promise<RunSubagentResult> {
  const state = goalStateFromCheckpoint(checkpoint);
  if (!state.goalId) {
    return { checkpoint, completed: false, interrupted: false };
  }

  let unitId: string | undefined;
  let isOverview = false;
  try {
    const created = await createMicroUnitForGoal(
      userId,
      state.goalId,
      ctx,
      {
        hasDocuments: state.hasDocuments,
        autoContent: true,
        microUnitPublication: options.microUnitPublication,
      },
    );
    unitId = created.unitId;
    isOverview = created.isOverview;
  } catch {
    // The LearningGoal already exists. Survey/material failure is unit work,
    // not a goal-creation failure.
  }
  const finalCheckpoint = mergeGoalState(checkpoint, {
    currentPhase: "completed",
    goalId: state.goalId,
  }) as ThreadCheckpoint;
  await saveCheckpoint(ctx.threadId, finalCheckpoint);
  return finishMicroCourse(ctx, finalCheckpoint, embedded, unitId, isOverview);
}

async function finishMicroCourse(
  ctx: AgentRunContext,
  checkpoint: ThreadCheckpoint,
  embedded: boolean,
  unitId?: string,
  isOverview = false,
): Promise<RunSubagentResult> {
  const finalState = goalStateFromCheckpoint(checkpoint);
  const title = finalState.refinedTitle || finalState.topic || "学习目标";
  const navigateTo = unitId
    ? isOverview
      ? `/goals/${finalState.goalId}/overview`
      : `/goals/${finalState.goalId}/units/${unitId}`
    : `/goals/${finalState.goalId}`;
  const content = formatGoalCreatedMessage(title, finalState.goalId, true);

  if (embedded) {
    await ctx.send({
      type: "done",
      goalId: finalState.goalId,
      navigateTo,
      inline: true,
    });
    let next = deactivateEmbeddedGoalCreation(checkpoint);
    next = {
      ...next,
      llmMessages: [...next.llmMessages, { role: "assistant", content }],
    };
    await saveCheckpoint(ctx.threadId, next);
    await appendAgentMessage(ctx.threadId, { role: "assistant", content });
    await agentMemoryStore.recordEpisode(
      ctx.threadId,
      `完成轻课创建: ${title}`,
    );
    return { checkpoint: next, completed: true, interrupted: false };
  }

  await ctx.send({
    type: "done",
    goalId: finalState.goalId,
    unitCount: 1,
    navigateTo,
  });
  await saveCheckpoint(ctx.threadId, checkpoint);
  return { checkpoint, completed: true, interrupted: false };
}

function postPlanApprovalNavigateTo(
  goalId: string,
  opts: { isMicro: boolean; isSequential: boolean },
): string {
  // Sequential v2 already persisted module stubs + queued first-module
  // generation at approve_plan time — open the journey, not the plan page.
  if (opts.isSequential && !opts.isMicro) {
    return `/goals/${goalId}`;
  }
  return `/goals/${goalId}/plan?generateMap=1`;
}

async function finishPlanApprovedForClientMap(
  ctx: AgentRunContext,
  checkpoint: ThreadCheckpoint,
  embedded: boolean,
  isMicro: boolean,
): Promise<RunSubagentResult> {
  const finalState = goalStateFromCheckpoint(checkpoint);
  const goalId = finalState.goalId;
  if (!goalId) {
    return { checkpoint, completed: true, interrupted: false };
  }

  const isSequential =
    finalState.mapPlan?.schemaVersion === 2 &&
    Boolean(finalState.mapPlan.modules?.length);
  const navigateTo = postPlanApprovalNavigateTo(goalId, {
    isMicro,
    isSequential,
  });
  const title = finalState.refinedTitle || finalState.topic || "学习目标";
  const content = isMicro
    ? `已确认「${title}」的学习计划，正在打开规划页生成轻课。 [查看规划](/goals/${goalId}/plan?generateMap=1)`
    : isSequential
      ? `已确认「${title}」的学习计划，正在打开学习旅程并准备第一个模块。 [查看学习旅程](/goals/${goalId})`
      : `已确认「${title}」的学习计划，正在打开规划页生成学习地图。 [查看规划](/goals/${goalId}/plan?generateMap=1)`;

  if (embedded) {
    await ctx.send({
      type: "done",
      goalId,
      navigateTo,
      inline: true,
    });
    let next = deactivateEmbeddedGoalCreation(checkpoint);
    next = {
      ...next,
      llmMessages: [...next.llmMessages, { role: "assistant", content }],
    };
    await saveCheckpoint(ctx.threadId, next);
    await appendAgentMessage(ctx.threadId, { role: "assistant", content });
    await agentMemoryStore.recordEpisode(
      ctx.threadId,
      `确认学习计划并前往生成: ${title}`,
    );
    return { checkpoint: next, completed: true, interrupted: false };
  }

  await ctx.send({
    type: "done",
    goalId,
    navigateTo,
  });
  await saveCheckpoint(ctx.threadId, checkpoint);
  return { checkpoint, completed: true, interrupted: false };
}

async function finishDecompose(
  ctx: AgentRunContext,
  checkpoint: ThreadCheckpoint,
  embedded: boolean,
): Promise<RunSubagentResult> {
  const finalState = goalStateFromCheckpoint(checkpoint);
  if (embedded) {
    const title = finalState.refinedTitle || finalState.topic || "学习目标";
    const content = formatGoalCreatedMessage(title, finalState.goalId, false);
    await ctx.send({
      type: "done",
      goalId: finalState.goalId,
      navigateTo: `/goals/${finalState.goalId}`,
      inline: true,
    });
    let next = deactivateEmbeddedGoalCreation(checkpoint);
    next = {
      ...next,
      llmMessages: [
        ...next.llmMessages,
        {
          role: "assistant",
          content,
        },
      ],
    };
    await saveCheckpoint(ctx.threadId, next);
    await appendAgentMessage(ctx.threadId, {
      role: "assistant",
      content,
    });
    await agentMemoryStore.recordEpisode(
      ctx.threadId,
      `完成目标创建: ${title}`,
    );
    return { checkpoint: next, completed: true, interrupted: false };
  }

  await ctx.send({
    type: "done",
    goalId: finalState.goalId,
    unitCount: undefined,
    navigateTo: `/goals/${finalState.goalId}`,
  });
  await saveCheckpoint(ctx.threadId, checkpoint);
  return { checkpoint, completed: true, interrupted: false };
}

async function interruptForPlanReview(
  ctx: AgentRunContext,
  userId: string,
  checkpoint: ThreadCheckpoint,
  embedded: boolean,
  learningSpaceApplication?: GoalCreationRunOptions["learningSpaceApplication"],
): Promise<RunSubagentResult> {
  const state = goalStateFromCheckpoint(checkpoint);
  if (!state.goalId || !state.mapPlan) {
    return { checkpoint, completed: true, interrupted: false };
  }
  if (state.autoApproveWithoutQuestions) {
    await approveGoalPlan(userId, state.goalId, {
      learningGoalPlan: learningSpaceApplication?.learningGoalPlan,
      sequentialCurriculumApproval:
        learningSpaceApplication?.sequentialCurriculumApproval,
      moduleStructureQueue: learningSpaceApplication?.moduleStructureQueue,
    });
    const approvedState = {
      ...state,
      mapPlanStatus: "approved",
      currentSubagent: "plan" as const,
      currentPhase: "completed" as const,
    };
    const approved = {
      ...checkpoint,
      goalState: approvedState,
    } as ThreadCheckpoint;
    await saveCheckpoint(ctx.threadId, approved);
    return finishPlanApprovedForClientMap(
      ctx,
      approved,
      embedded,
      approvedState.isSmallCourse === true,
    );
  }

  const toolCall: AgentToolCallRecord = {
    id: `goal-plan-review-${Date.now()}`,
    name: "review_plan",
    args: { message: "请确认学习计划" },
  };
  const uiArgs = {
    ...toolCall.args,
    goalId: state.goalId,
    plan: state.mapPlan,
    isMicroCourse: state.isSmallCourse === true,
  };

  const next = mergeGoalState(checkpoint, {
    currentSubagent: "plan",
    currentPhase: "reviewing_plan",
  }) as ThreadCheckpoint;
  const { working, globalMessages } = withEmbeddedCheckpoint(next, embedded);
  const workingWithInterrupt = setInterrupt(
    {
      ...working,
      llmMessages: [
        ...working.llmMessages,
        { role: "assistant", content: "", toolCalls: [toolCall] },
      ],
    },
    {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      uiKind: "plan_editor",
      args: uiArgs,
    },
  );
  const merged = mergeEmbeddedCheckpoint(
    next,
    workingWithInterrupt,
    globalMessages,
    embedded,
  );

  await ctx.send({
    type: "tool_ui",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    uiKind: "plan_editor",
    args: uiArgs,
  });
  await ctx.send({
    type: "interrupt",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
  });
  await saveCheckpoint(ctx.threadId, merged);
  await appendAgentMessage(ctx.threadId, {
    role: "assistant",
    content: "",
    toolCalls: [toolCall],
    uiPayload: { uiKind: "plan_editor", args: uiArgs },
  });

  return { checkpoint: merged, completed: false, interrupted: true };
}

async function maybeInterruptForCollectForm(
  ctx: AgentRunContext,
  checkpoint: ThreadCheckpoint,
  embedded: boolean,
  prior: RunSubagentResult,
): Promise<RunSubagentResult> {
  if (prior.interrupted) {
    return prior;
  }
  const pending = getPendingInterrupt(checkpoint);
  if (pending) {
    return prior;
  }
  const state = goalStateFromCheckpoint(checkpoint);
  if (!needsCollectFormInterrupt(state)) {
    return prior;
  }
  return interruptForCollectForm(ctx, checkpoint, embedded);
}

export async function runGoalCreationOrchestrator(
  ctx: AgentRunContext,
  userId: string,
  userMessage?: string,
  options: GoalCreationRunOptions = {},
): Promise<RunSubagentResult> {
  const embedded = Boolean(options.embedded);

  let checkpoint = await loadCheckpoint(ctx.threadId);
  checkpoint = await ensureGoalState(checkpoint);
  checkpoint = await hydratePlannedGoalBrief(
    userId,
    checkpoint,
    options.learningSpaceApplication,
  );
  checkpoint = syncExecutionMode(checkpoint);
  await saveCheckpoint(ctx.threadId, checkpoint);

  const pending = getPendingInterrupt(checkpoint);
  if (pending && userMessage?.trim()) {
    return resumeGoalCreation(
      ctx,
      userId,
      pending.toolCallId,
      {
        answer: userMessage.trim(),
        userResponse: userMessage.trim(),
      },
      { ...options, userDisplayText: userMessage.trim() },
    );
  }
  if (pending) {
    await ctx.send({
      type: "tool_ui",
      toolCallId: pending.toolCallId,
      toolName: pending.toolName,
      uiKind: pending.uiKind,
      args: pending.args,
    });
    await ctx.send({
      type: "interrupt",
      toolCallId: pending.toolCallId,
      toolName: pending.toolName,
    });
    return { checkpoint, completed: false, interrupted: true };
  }

  let currentState = goalStateFromCheckpoint(checkpoint);
  if (shouldConfirmPlannedGoalWithoutIntake(currentState)) {
    if (userMessage?.trim()) {
      checkpoint = await addGoalCreationUserMessage(
        ctx.threadId,
        userMessage.trim(),
        embedded,
      );
    }
    checkpoint = mergeGoalState(checkpoint, {
      currentPhase: "confirming",
      currentSubagent: "intake",
      discoverySkipped: true,
    }) as ThreadCheckpoint;
    await saveCheckpoint(ctx.threadId, checkpoint);
    return interruptForConfirmation(ctx, checkpoint, embedded);
  }

  currentState = goalStateFromCheckpoint(checkpoint);
  if (
    !pending &&
    isAgenticGoalCreation(currentState) &&
    currentState.goalId &&
    !currentState.isSmallCourse &&
    currentState.mapPlanStatus === "approved"
  ) {
    return { checkpoint, completed: false, interrupted: false };
  }
  if (
    !pending &&
    currentState.isSmallCourse &&
    currentState.goalId &&
    currentState.currentPhase === "decomposing"
  ) {
    return runMicroCourseCreation(ctx, userId, checkpoint, embedded, options);
  }
  if (
    !pending &&
    currentState.goalId &&
    !currentState.isSmallCourse &&
    currentState.mapPlanStatus === "ready" &&
    currentState.mapPlan
  ) {
    if (isAgenticGoalCreation(currentState)) {
      return continueAfterFullGoalApproval(
        ctx,
        userId,
        checkpoint,
        embedded,
        options,
      );
    }
    return interruptForPlanReview(
      ctx,
      userId,
      checkpoint,
      embedded,
      options.learningSpaceApplication,
    );
  }
  if (
    !pending &&
    currentState.goalId &&
    !currentState.isSmallCourse &&
    currentState.planningMode === "deep" &&
    !currentState.targetSpaceId &&
    currentState.spaceSuggestionStatus === "pending" &&
    currentState.spaceSuggestion &&
    currentState.mapPlanStatus !== "ready"
  ) {
    return interruptForGoalSpaceSuggestion(
      ctx,
      checkpoint,
      embedded,
      currentState.spaceSuggestion,
    );
  }
  if (
    !pending &&
    currentState.goalId &&
    !currentState.isSmallCourse &&
    currentState.currentPhase === "generating_plan" &&
    currentState.mapPlanStatus !== "ready"
  ) {
    return continueAfterFullGoalApproval(
      ctx,
      userId,
      checkpoint,
      embedded,
      options,
    );
  }

  if (userMessage?.trim()) {
    checkpoint = await addGoalCreationUserMessage(
      ctx.threadId,
      userMessage.trim(),
      embedded,
    );
    const state = goalStateFromCheckpoint(checkpoint);
    const languageSource = [state.contentLanguageSourceText, userMessage.trim()]
      .filter(Boolean)
      .join("\n")
      .slice(-6000);
    if (!state.topic.trim()) {
      checkpoint = {
        ...checkpoint,
        goalState: {
          ...state,
          topic: userMessage.trim(),
          contentLanguageSourceText: languageSource,
        },
      };
      await saveCheckpoint(ctx.threadId, checkpoint);
    } else if (languageSource !== state.contentLanguageSourceText) {
      checkpoint = {
        ...checkpoint,
        goalState: { ...state, contentLanguageSourceText: languageSource },
      };
      await saveCheckpoint(ctx.threadId, checkpoint);
    }
  }

  const subagent = resolveSubagent(checkpoint);
  await ctx.send({ type: "subagent", name: subagent });

  const result = await runGoalSubagentLoop(
    ctx,
    userId,
    checkpoint,
    subagent,
    embedded,
  );

  if (subagent === "intake") {
    const withForm = await maybeInterruptForCollectForm(
      ctx,
      result.checkpoint,
      embedded,
      result,
    );
    if (withForm.interrupted) {
      return withForm;
    }
  }

  if (result.completed && !result.interrupted) {
    const state = goalStateFromCheckpoint(result.checkpoint);
    if (subagent === "intake" && state.goalId) {
      if (state.isSmallCourse) {
        return runMicroCourseCreation(
          ctx,
          userId,
          result.checkpoint,
          embedded,
          options,
        );
      }
      const next = await runGoalSubagentLoop(
        ctx,
        userId,
        {
          ...result.checkpoint,
          ...mergeGoalState(result.checkpoint, {
            currentSubagent: "plan",
          }),
        },
        "plan",
        embedded,
      );
      if (next.completed && !next.interrupted) {
        const planState = goalStateFromCheckpoint(next.checkpoint);
        if (planState.mapPlanStatus === "ready" && planState.mapPlan) {
          return interruptForPlanReview(
            ctx,
            userId,
            next.checkpoint,
            embedded,
            options.learningSpaceApplication,
          );
        }
        if (planState.currentPhase === "completed") {
          return finishDecompose(ctx, next.checkpoint, embedded);
        }
      }
      return next;
    }
    if (subagent === "plan") {
      const planState = goalStateFromCheckpoint(result.checkpoint);
      if (planState.mapPlanStatus === "ready" && planState.mapPlan) {
        return interruptForPlanReview(
          ctx,
          userId,
          result.checkpoint,
          embedded,
          options.learningSpaceApplication,
        );
      }
      if (planState.currentPhase === "completed") {
        return finishDecompose(ctx, result.checkpoint, embedded);
      }
    }
  }

  return result;
}

export async function resumeGoalCreation(
  ctx: AgentRunContext,
  userId: string,
  toolCallId: string,
  result: unknown,
  options: GoalCreationRunOptions = {},
): Promise<RunSubagentResult> {
  const embedded = Boolean(options.embedded);
  let checkpoint = await loadCheckpoint(ctx.threadId);
  checkpoint = await ensureGoalState(checkpoint);
  checkpoint = await hydratePlannedGoalBrief(
    userId,
    checkpoint,
    options.learningSpaceApplication,
  );
  await saveCheckpoint(ctx.threadId, checkpoint);
  const pending = getPendingInterrupt(checkpoint);
  const toolName = pending?.toolName ?? "";

  if (!pending) {
    await ctx.send({
      type: "error",
      message: "当前没有等待处理的操作，请重新发送你的目标或刷新页面后重试。",
    });
    return { checkpoint, completed: false, interrupted: false };
  }

  if (pending.toolCallId !== toolCallId) {
    await ctx.send({
      type: "tool_ui",
      toolCallId: pending.toolCallId,
      toolName: pending.toolName,
      uiKind: pending.uiKind,
      args: pending.args,
    });
    await ctx.send({
      type: "error",
      message: "这个操作已经过期，请使用当前最新的表单或确认卡片继续。",
    });
    return { checkpoint, completed: false, interrupted: true };
  }

  if (isGoalCreationHumanTool(toolName)) {
    const userDisplay =
      options.userDisplayText?.trim() ||
      formatGoalCreationUserReply(toolName, result, pending.args);
    if (userDisplay) {
      checkpoint = await addGoalCreationUserMessage(
        ctx.threadId,
        userDisplay,
        embedded,
      );
    }
  }

  if (toolName === "review_goal_scope") {
    const data =
      typeof result === "object" && result
        ? (result as Record<string, unknown>)
        : {};
    const action = data.action;
    if (action === "continue_single") {
      const submitted = { action: "continue_single" };
      const resultStr = JSON.stringify(submitted);
      const next = clearInterrupt(
        mergeGoalState(checkpoint, {
          scopeStatus: "single_goal",
          currentPhase: "confirming",
        }) as ThreadCheckpoint,
      );
      next.llmMessages = [
        ...next.llmMessages,
        { role: "tool", content: resultStr, toolCallId },
      ];
      await saveCheckpoint(ctx.threadId, next);
      await appendAgentMessage(ctx.threadId, {
        role: "tool",
        content: resultStr,
        toolCallId,
        uiPayload: submitted,
      });
      return interruptForConfirmation(ctx, next, embedded);
    }
    if (action === "cancel") {
      return finishScopeDecision(ctx, checkpoint, embedded, {
        toolCallId,
        submitted: { action: "cancel", cancelled: true },
        message: "已取消本次学习目标创建。",
      });
    }
    if (action === "open_existing") {
      const state = goalStateFromCheckpoint(checkpoint);
      const spaceId =
        typeof data.spaceId === "string"
          ? data.spaceId
          : state.scopeAssessment?.existingSpaceId;
      const navigateTo = spaceId ? `/spaces/${spaceId}` : "/spaces";
      return finishScopeDecision(ctx, checkpoint, embedded, {
        toolCallId,
        submitted: { action: "open_existing", ...(spaceId ? { spaceId } : {}) },
        message: spaceId
          ? `这个方向已在现有学习路线中规划。 [查看学习空间](${navigateTo})`
          : "这个方向已在现有学习路线中规划。 [查看学习空间](/spaces)",
        navigateTo,
      });
    }
    if (action === "apply_roadmap") {
      const state = goalStateFromCheckpoint(checkpoint);
      const selectedGoalRefs = Array.isArray(data.selectedGoalRefs)
        ? data.selectedGoalRefs.map(String)
        : [];
      if (!state.scopeProposal || !options.learningSpaceApplication) {
        await ctx.send({
          type: "error",
          message: "学习路线方案已失效，请重新分析。",
        });
        return { checkpoint, completed: false, interrupted: true };
      }
      try {
        const selected = selectGoalScopeProposal(
          state.scopeProposal,
          selectedGoalRefs,
        );
        const applied =
          await options.learningSpaceApplication.applyOrganizationProposal(
            userId,
            selected.proposal,
            selected.operationIds,
          );
        // Prefer newly created spaces, then existing targets, so the CTA opens
        // a concrete space detail page even when the roadmap spans several spaces.
        const existingSpaceIds = selected.proposal.plannedGoals.flatMap(
          (goal) => (goal.target.spaceId ? [goal.target.spaceId] : []),
        );
        const spaceIds = [
          ...new Set([...applied.spaceIds, ...existingSpaceIds]),
        ];
        const primarySpaceId = spaceIds[0];
        const navigateTo = primarySpaceId
          ? `/spaces/${primarySpaceId}`
          : "/spaces";
        return finishScopeDecision(ctx, checkpoint, embedded, {
          toolCallId,
          submitted: {
            action: "apply_roadmap",
            selectedGoalRefs,
            appliedOperations: applied.appliedOperations,
            spaceIds,
            ...(primarySpaceId ? { spaceId: primarySpaceId } : {}),
          },
          message: `学习路线已保存为待规划目标，没有创建正式学习目标。 [查看学习路线](${navigateTo})`,
          navigateTo,
        });
      } catch (error) {
        await ctx.send({
          type: "error",
          message:
            error instanceof Error
              ? error.message
              : "学习路线保存失败，请重试。",
        });
        return { checkpoint, completed: false, interrupted: true };
      }
    }
    await ctx.send({
      type: "error",
      message: "请选择保存路线、继续单个目标或取消创建。",
    });
    return { checkpoint, completed: false, interrupted: true };
  }

  if (toolName === "suggest_learning_space") {
    const data =
      typeof result === "object" && result
        ? (result as Record<string, unknown>)
        : {};
    const action =
      data.action === "create"
        ? "create"
        : data.action === "skip"
          ? "skip"
          : null;
    if (!action) {
      await ctx.send({
        type: "error",
        message: "请选择创建学习空间或暂时跳过。",
      });
      return { checkpoint, completed: false, interrupted: true };
    }
    const state = goalStateFromCheckpoint(checkpoint);
    if (!state.goalId) {
      await ctx.send({
        type: "error",
        message: "学习目标尚未创建，无法创建学习空间。",
      });
      return { checkpoint, completed: false, interrupted: true };
    }

    let spaceId = "";
    if (action === "create") {
      try {
        const spaceInput = {
          name: String(pending.args.name ?? ""),
          purpose: String(pending.args.purpose ?? ""),
        };
        if (!options.learningSpaceApplication) {
          throw new Error("Learning-space application is unavailable");
        }
        const space = await options.learningSpaceApplication.createForGoal(
          userId,
          state.goalId,
          spaceInput,
        );
        spaceId = space.id;
      } catch (error) {
        await ctx.send({
          type: "error",
          message:
            error instanceof Error
              ? error.message
              : "学习空间创建失败，请重试或暂时跳过。",
        });
        return { checkpoint, completed: false, interrupted: true };
      }
    }

    const submitted = {
      action,
      ...(spaceId ? { spaceId } : {}),
      name: String(pending.args.name ?? ""),
    };
    const nextState = {
      ...state,
      targetSpaceId: spaceId || state.targetSpaceId,
      spaceSuggestionStatus:
        action === "create" ? ("accepted" as const) : ("skipped" as const),
      currentSubagent: "plan" as const,
      currentPhase: "generating_plan" as const,
    };
    const resultStr = JSON.stringify(submitted);
    const completedBase = clearInterrupt({
      ...checkpoint,
      goalState: nextState,
    });
    const { working, globalMessages } = withEmbeddedCheckpoint(
      completedBase,
      embedded,
    );
    const completed = mergeEmbeddedCheckpoint(
      completedBase,
      {
        ...working,
        goalState: nextState,
        llmMessages: [
          ...working.llmMessages,
          { role: "tool", content: resultStr, toolCallId },
        ],
      },
      globalMessages,
      embedded,
    );
    await saveCheckpoint(ctx.threadId, completed);
    await appendAgentMessage(ctx.threadId, {
      role: "tool",
      content: resultStr,
      toolCallId,
      uiPayload: submitted,
    });

    return continueAfterFullGoalApproval(
      ctx,
      userId,
      completed,
      embedded,
      options,
    );
  }

  if (toolName) {
    const goalState = (checkpoint.goalState ?? {}) as Record<string, unknown>;
    if (toolName === "ask_discovery_questions") {
      const current = goalStateFromCheckpoint({ goalState }).discoveryQuestions;
      goalState.discoveryQuestions = mergeDiscoveryQuestionHistory(
        current,
        Array.isArray(pending.args.questions) ? pending.args.questions : [],
      );
    }
    applyIntakeResumeResult(toolName, result, { state: goalState });
    await applyPlanResumeResult(
      toolName,
      result,
      {
        state: goalState,
        userId,
        threadId: ctx.threadId,
        traceId: ctx.traceId,
        send: ctx.send,
        signal: ctx.signal,
      },
      {
        learningGoalPlan: options.learningSpaceApplication?.learningGoalPlan,
      },
    );
    checkpoint.goalState = goalState;

    if (
      toolName === "review_plan" &&
      typeof result === "object" &&
      result &&
      (result as { approved?: boolean }).approved === false &&
      typeof (result as { feedback?: unknown }).feedback === "string" &&
      (result as { feedback: string }).feedback.trim()
    ) {
      const resultStr = JSON.stringify(result);
      const completedBase = clearInterrupt(checkpoint);
      const { working, globalMessages } = withEmbeddedCheckpoint(
        completedBase,
        embedded,
      );
      const completed = mergeEmbeddedCheckpoint(
        completedBase,
        {
          ...working,
          llmMessages: [
            ...working.llmMessages,
            { role: "tool", content: resultStr, toolCallId },
          ],
        },
        globalMessages,
        embedded,
      );
      await saveCheckpoint(ctx.threadId, completed);
      await appendAgentMessage(ctx.threadId, {
        role: "tool",
        content: resultStr,
        toolCallId,
        uiPayload: result as Record<string, unknown>,
      });
      return interruptForPlanReview(
        ctx,
        userId,
        completed,
        embedded,
        options.learningSpaceApplication,
      );
    }

    if (
      toolName === "show_confirmation" &&
      typeof result === "object" &&
      result &&
      (result as { approved?: boolean }).approved === false
    ) {
      const state = goalStateFromCheckpoint(checkpoint);
      if (state.isPlannedGoalActivation) {
        const navigateTo = state.targetSpaceId
          ? `/spaces/${state.targetSpaceId}`
          : "/spaces";
        return finishScopeDecision(ctx, checkpoint, embedded, {
          toolCallId,
          submitted: { approved: false, cancelled: true },
          message: `已取消激活，待规划目标保持不变。 [返回学习空间](${navigateTo})`,
          navigateTo,
        });
      }
      const resultStr = JSON.stringify(result);
      const next = clearInterrupt(
        mergeGoalState(checkpoint, {
          currentPhase: "parsing",
          currentSubagent: "intake",
          contractJson: "",
          contractHash: "",
        }) as ThreadCheckpoint,
      );
      const { working, globalMessages } = withEmbeddedCheckpoint(
        next,
        embedded,
      );
      const completed = mergeEmbeddedCheckpoint(
        next,
        {
          ...working,
          llmMessages: [
            ...working.llmMessages,
            { role: "tool", content: resultStr, toolCallId },
          ],
        },
        globalMessages,
        embedded,
      );
      await saveCheckpoint(ctx.threadId, completed);
      await appendAgentMessage(ctx.threadId, {
        role: "tool",
        content: resultStr,
        toolCallId,
        uiPayload: result as Record<string, unknown>,
      });
      await ctx.send({
        type: "status",
        message: "已返回目标确认前，请补充或修改后再确认。",
        phase: "intake",
      });
      return runGoalCreationOrchestrator(ctx, userId, undefined, options);
    }

    if (
      toolName === "show_confirmation" &&
      typeof result === "object" &&
      result &&
      (result as { approved?: boolean }).approved
    ) {
      const state = goalStateFromCheckpoint(checkpoint);
      const edits = (result as { edits?: Record<string, unknown> }).edits;
      const confirmedState =
        pending.args.state && typeof pending.args.state === "object"
          ? (pending.args.state as Record<string, unknown>)
          : {};
      // The intake prompt normally reaches this confirmation only after the
      // server-owned scope phase. Keep creation fail-safe if a provider calls
      // the human confirmation tool earlier than instructed.
      if (
        state.scopeStatus === "pending" &&
        !state.isSmallCourse &&
        !state.hasDocuments &&
        !state.targetSpaceItemId
      ) {
        const reassess = clearInterrupt(checkpoint);
        await saveCheckpoint(ctx.threadId, reassess);
        return assessScopeBeforeConfirmation(
          ctx,
          userId,
          reassess,
          embedded,
          options.learningSpaceApplication,
        );
      }
      const scopeChanged =
        state.scopeStatus === "single_goal" &&
        edits &&
        ["topic", "refinedTitle", "generationOptions"].some(
          (key) =>
            typeof edits[key] === "string" &&
            edits[key] !== confirmedState[key],
        );
      if (scopeChanged) {
        const reassess = clearInterrupt(
          mergeGoalState(checkpoint, {
            scopeStatus: "pending",
            scopeAssessment: null,
            scopeProposal: null,
            scopePortfolioFingerprint: "",
            scopeResearch: null,
          }) as ThreadCheckpoint,
        );
        await saveCheckpoint(ctx.threadId, reassess);
        return assessScopeBeforeConfirmation(
          ctx,
          userId,
          reassess,
          embedded,
          options.learningSpaceApplication,
        );
      }
      const confirmed = persistCompiledContract(
        applyConfirmationEdits(state, edits),
      );
      const resultStr = JSON.stringify(result);
      const accepted = clearInterrupt(
        mergeGoalState(checkpoint, {
          ...confirmed,
          goalApproved: true,
        }) as ThreadCheckpoint,
      );
      const { working: acceptedWorking, globalMessages: acceptedGlobal } =
        withEmbeddedCheckpoint(accepted, embedded);
      const acceptedCheckpoint = mergeEmbeddedCheckpoint(
        accepted,
        {
          ...acceptedWorking,
          goalState: {
            ...confirmed,
            goalApproved: true,
          },
          llmMessages: [
            ...acceptedWorking.llmMessages,
            { role: "tool", content: resultStr, toolCallId },
          ],
        },
        acceptedGlobal,
        embedded,
      );
      await saveCheckpoint(ctx.threadId, acceptedCheckpoint);
      await appendAgentMessage(ctx.threadId, {
        role: "tool",
        content: resultStr,
        toolCallId,
        uiPayload: result as Record<string, unknown>,
      });
      await ctx.send({
        type: "phase",
        phase: "confirming",
        subagent: "intake",
      });

      const { goalId } = await createGoalRecord(userId, confirmed, {
        threadId: ctx.threadId,
        learningSpaceApplication: options.learningSpaceApplication,
        onStatus: async (message) => {
          await ctx.send({ type: "status", message, phase: "ingesting" });
        },
      });
      const withIcon = await generateGoalIconDuringCreation(
        ctx,
        userId,
        mergeGoalState(acceptedCheckpoint, {
          goalId,
          goalApproved: true,
        }) as ThreadCheckpoint,
        goalId,
        confirmed.refinedTitle || confirmed.topic,
      );
      const approvedState = {
        ...goalStateFromCheckpoint(withIcon),
        goalId,
        goalApproved: true,
        currentSubagent: confirmed.isSmallCourse
          ? ("intake" as const)
          : ("plan" as const),
        currentPhase: confirmed.isSmallCourse
          ? ("decomposing" as const)
          : ("generating_plan" as const),
      };
      const completed = mergeGoalState(
        withIcon,
        approvedState,
      ) as ThreadCheckpoint;
      await saveCheckpoint(ctx.threadId, completed);

      if (confirmed.isSmallCourse) {
        return runMicroCourseCreation(
          ctx,
          userId,
          completed,
          embedded,
          options,
        );
      }

      return continueAfterFullGoalApproval(
        ctx,
        userId,
        completed,
        embedded,
        options,
      );
    }

    if (
      toolName === "review_plan" &&
      typeof result === "object" &&
      result &&
      (result as { approved?: boolean }).approved
    ) {
      const state = goalStateFromCheckpoint(checkpoint);
      if (state.goalId) {
        await approveGoalPlan(userId, state.goalId, {
          learningGoalPlan: options.learningSpaceApplication?.learningGoalPlan,
          sequentialCurriculumApproval:
            options.learningSpaceApplication?.sequentialCurriculumApproval,
          moduleStructureQueue:
            options.learningSpaceApplication?.moduleStructureQueue,
        });
        const approvedState = {
          ...state,
          mapPlanStatus: "approved",
          currentSubagent: "plan" as const,
          currentPhase: "decomposing" as const,
        };
        const resultStr = JSON.stringify(result);
        const completedBase = clearInterrupt({
          ...checkpoint,
          goalState: approvedState,
        });
        const { working, globalMessages } = withEmbeddedCheckpoint(
          completedBase,
          embedded,
        );
        const completed = mergeEmbeddedCheckpoint(
          completedBase,
          {
            ...working,
            goalState: approvedState,
            llmMessages: [
              ...working.llmMessages,
              { role: "tool", content: resultStr, toolCallId },
            ],
          },
          globalMessages,
          embedded,
        );
        await saveCheckpoint(ctx.threadId, completed);
        await appendAgentMessage(ctx.threadId, {
          role: "tool",
          content: resultStr,
          toolCallId,
          uiPayload: result as Record<string, unknown>,
        });

        const finalCheckpoint = mergeGoalState(completed, {
          currentPhase: "completed",
        }) as ThreadCheckpoint;
        await saveCheckpoint(ctx.threadId, finalCheckpoint);
        return finishPlanApprovedForClientMap(
          ctx,
          finalCheckpoint,
          embedded,
          approvedState.isSmallCourse === true,
        );
      }
    }

    await saveCheckpoint(ctx.threadId, checkpoint);

    if (toolName === "collect_form") {
      const resultStr =
        typeof result === "string" ? result : JSON.stringify(result ?? {});
      const completedBase = clearInterrupt(checkpoint);
      const { working, globalMessages } = withEmbeddedCheckpoint(
        completedBase,
        embedded,
      );
      const completed = mergeEmbeddedCheckpoint(
        completedBase,
        {
          ...working,
          llmMessages: [
            ...working.llmMessages,
            { role: "tool", content: resultStr, toolCallId },
          ],
        },
        globalMessages,
        embedded,
      );
      await saveCheckpoint(ctx.threadId, completed);
      await appendAgentMessage(ctx.threadId, {
        role: "tool",
        content: resultStr,
        toolCallId,
        uiPayload:
          typeof result === "object" && result
            ? (result as Record<string, unknown>)
            : { userResponse: result },
      });
      return assessScopeBeforeConfirmation(
        ctx,
        userId,
        completed,
        embedded,
        options.learningSpaceApplication,
      );
    }
  }

  const subagent = resolveSubagent(checkpoint);
  const config = await getSubagentConfig(subagent, userId, {
    goalId: goalStateFromCheckpoint(checkpoint).goalId,
    threadId: ctx.threadId,
  });
  const { working, globalMessages } = withEmbeddedCheckpoint(
    checkpoint,
    embedded,
  );
  const resumed = await resumeToolCall({
    ctx,
    systemPrompt: config.systemPrompt,
    toolSession: config.toolSession,
    checkpoint: working,
    stateKey: "goalState",
    subagent,
    toolCallId,
    result,
    registryAgentId: "goal_creation",
  });

  let merged = mergeEmbeddedCheckpoint(
    checkpoint,
    resumed.checkpoint,
    globalMessages,
    embedded,
  );
  merged = updateRegistryAfterAgentTurn(merged, "goal_creation");
  await saveCheckpoint(ctx.threadId, merged);

  const withForm = await maybeInterruptForCollectForm(ctx, merged, embedded, {
    ...resumed,
    checkpoint: merged,
  });
  if (withForm.interrupted) {
    return withForm;
  }

  const shouldContinue =
    toolName === "show_confirmation" &&
    typeof result === "object" &&
    result &&
    (result as { approved?: boolean }).approved;

  if (shouldContinue) {
    const state = goalStateFromCheckpoint(merged);
    if (state.isSmallCourse) {
      return { ...resumed, checkpoint: merged };
    }
    if (resumed.interrupted) {
      return { ...resumed, checkpoint: merged };
    }
    return runGoalCreationOrchestrator(ctx, userId, undefined, options);
  }

  return { ...resumed, checkpoint: merged };
}
