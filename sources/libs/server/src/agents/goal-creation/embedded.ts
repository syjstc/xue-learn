import {
  appendAgentMessage,
  loadCheckpoint,
  saveCheckpoint,
  type ThreadCheckpoint,
} from "../core/checkpoint.js";
import {
  appendHandoffHistory,
  applyRegistryToCheckpoint,
  createInitialRegistry,
  type HandoffReason,
  setActiveAgent,
  syncGoalCreationCard,
  syncGlobalCard,
  syncRegistryFromCheckpoint,
  updateAgentCard,
} from "../core/agent-registry.js";
import { getPendingInterrupt } from "../core/interrupt.js";
import type { AgentRunContext, LlmMessageRecord } from "../core/types.js";
import { FEATURE_GOAL_CREATION } from "../../features.js";
import type { LearningSpaceGoalCreationApplication } from "../../learning-spaces/orm-application-service.js";
import type { MicroUnitPublicationRepository } from "../../../../domain/src/index.js";
import { clearPendingGoalDocuments } from "./pending-documents.js";
import { createInitialGoalState, goalStateFromCheckpoint } from "./state.js";

export const GOAL_CREATION_RESET_UI_KIND = "goal_creation_reset";

const GOAL_CREATION_RESET_MESSAGE =
  "已切换到新的目标创建流程。上一次流程的消息仅保留在聊天记录中供你查看，不会再放入当前目标创建 agent 的上下文。";

export type GoalCreationRunOptions = {
  embedded?: boolean;
  /** Raw text the user typed in the chat input (not a tool UI selection). */
  userDisplayText?: string;
  /** Optional typed application boundary for assistant-created learning spaces. */
  learningSpaceApplication?: LearningSpaceGoalCreationApplication;
  microUnitPublication?: MicroUnitPublicationRepository;
};

/** Tools that pause the subagent and wait for real user input (requiresHumanInput). */
export const GOAL_CREATION_HUMAN_TOOLS = new Set([
  "ask_clarification",
  "ask_discovery_questions",
  "collect_form",
  "review_goal_scope",
  "show_confirmation",
  "suggest_learning_space",
  "review_plan",
]);

function goalCreationMessagesFromCheckpoint(
  checkpoint: ThreadCheckpoint,
): LlmMessageRecord[] {
  return Array.isArray(checkpoint.goalCreationMessages)
    ? (checkpoint.goalCreationMessages as LlmMessageRecord[])
    : [];
}

export function shouldRouteToGoalCreation(
  checkpoint: ThreadCheckpoint,
): boolean {
  if (checkpoint.goalCreationActive && !checkpoint.goalCreationPaused) {
    return true;
  }
  const pending = getPendingInterrupt(checkpoint);
  return Boolean(pending && GOAL_CREATION_HUMAN_TOOLS.has(pending.toolName));
}

export function isGoalCreationHowToQuestion(message?: string): boolean {
  const m = message?.trim();
  if (!m) return false;
  const asksHow =
    /[?？]$/.test(m) || /(如何|怎么|怎样|如何才能|怎样才能)/.test(m);
  if (!asksHow) return false;
  return (
    /(创建|新建|设立|制定|开始).{0,20}(学习)?目标/.test(m) ||
    /(学习)?目标.{0,20}(创建|新建|设立|制定|开始)/.test(m)
  );
}

/** Short greetings / chitchat that must not start or continue goal creation. */
export function isCasualChitchat(message?: string): boolean {
  const m = message?.trim();
  if (!m || m.length > 24) return false;
  return /^(你好啊?|您好啊?|嗨+|哈喽|在吗|在不在|hello|hi|hey|早上好|下午好|晚上好|早安|午安|晚安)[!！.。~～?\？\s]*$/i.test(
    m,
  );
}

export function isGlobalAssistantRequest(message?: string): boolean {
  const m = message?.trim().toLowerCase();
  if (!m) return false;
  if (isCasualChitchat(message)) return true;
  if (isGoalCreationHowToQuestion(message)) return true;

  const globalPatterns = [
    /^(search|find|list|show|open|go to|navigate|continue)\b.*\b(goal|goals|unit|units|lesson|lessons|review|reviews|setting|settings|activity|activities)\b/,
    /\b(current time|what time|today|recent activity|due review|due reviews)\b/,
    /\b(what|which)\b.*\b(unit|units|lesson|lessons|card|cards)\b.*\breview\b/,
    /\breview(s)?\b.*\b(today|due|unit|units|lesson|lessons|card|cards)\b/,
    /\b(what can you do|who are you|how do i use|how to use)\b/,
    /\b(what|how|explain|tell me)\b.*\b(app|platform|feature|features|gelc|learning method|study method)\b/,
    /(搜索|查找|找一下|列出|显示|查看|打开|跳转|进入|继续).*(目标|学习目标|单元|课程|复习|设置|最近|活动|记录)/,
    /(目标|学习目标|单元|课程|复习|设置|最近|活动|记录).*(搜索|查找|列出|显示|查看|打开|跳转|进入)/,
    /(哪些|什么|哪个|还有|需要|该|应该|要).*(课程|单元|卡片|内容)?.*复习/,
    /复习.*(哪些|什么|哪个|还有|需要|该|应该|要).*(课程|单元|卡片|内容)?/,
    /(现在几点|当前时间|今天星期|待复习|最近学|最近接触)/,
    /(你能做什么|你是谁|怎么用|如何使用|使用方法|这个平台|本平台|学习平台|这个应用|这个app|功能|GELC|学习方法|高效学习)/i,
  ];

  return globalPatterns.some((pattern) => pattern.test(m));
}

export function shouldRouteMessageToGoalCreation(
  checkpoint: ThreadCheckpoint,
  message?: string,
): boolean {
  if (isGoalCreationResumeRequest(checkpoint, message)) return true;
  if (checkpoint.goalCreationPaused) return false;
  if (isGlobalAssistantRequest(message)) return false;
  return shouldRouteToGoalCreation(checkpoint);
}

export type GoalCreationMessageRoute =
  | { kind: "global" }
  | { kind: "resume"; toolCallId: string }
  | { kind: "delegate" };

export function resolveGoalCreationMessageRoute(
  checkpoint: ThreadCheckpoint,
  message?: string,
  options?: { clientAction?: string },
): GoalCreationMessageRoute {
  if (options?.clientAction === "start_goal_creation") {
    return { kind: "delegate" };
  }
  if (isGoalCreationResumeRequest(checkpoint, message)) {
    return { kind: "delegate" };
  }
  if (checkpoint.goalCreationPaused) return { kind: "global" };
  if (isGlobalAssistantRequest(message)) return { kind: "global" };
  const pending = getPendingInterrupt(checkpoint);
  if (pending?.toolCallId) {
    return { kind: "resume", toolCallId: pending.toolCallId };
  }
  return { kind: "delegate" };
}

export function hasGoalCreationProgress(checkpoint: ThreadCheckpoint): boolean {
  if (checkpoint.goalCreationActive) return true;
  if (goalCreationMessagesFromCheckpoint(checkpoint).length > 0) return true;

  const state = goalStateFromCheckpoint(checkpoint);
  return Boolean(
    state.topic.trim() ||
    state.refinedTitle.trim() ||
    state.goalId ||
    state.mapSummary ||
    state.mapPlan ||
    state.collectedFields.length > 0 ||
    state.discoveryAnswers.length > 0,
  );
}

export function activateEmbeddedGoalCreation(
  checkpoint: ThreadCheckpoint,
): ThreadCheckpoint {
  const base: ThreadCheckpoint = {
    ...checkpoint,
    goalCreationActive: true,
    goalCreationPaused: false,
    pendingInterrupt: null,
    goalCreationPausedInterrupt: null,
    goalState: createInitialGoalState(),
    goalCreationMessages: [],
  };
  let registry = createInitialRegistry();
  registry = syncGlobalCard(registry, base, "idle");
  registry = setActiveAgent(registry, "goal_creation");
  registry = syncGoalCreationCard(registry, base, "active");
  return applyRegistryToCheckpoint(base, registry);
}

export function deactivateEmbeddedGoalCreation(
  checkpoint: ThreadCheckpoint,
): ThreadCheckpoint {
  const base: ThreadCheckpoint = {
    ...checkpoint,
    goalCreationActive: false,
    goalCreationPaused: false,
    goalCreationMessages: [],
    pendingInterrupt: null,
  };
  let registry = syncRegistryFromCheckpoint(base);
  registry = setActiveAgent(registry, "global");
  const { goal_creation: _, ...agents } = registry.agents;
  registry = { ...registry, agents };
  return applyRegistryToCheckpoint(base, registry);
}

export function exitEmbeddedGoalCreation(
  checkpoint: ThreadCheckpoint,
): ThreadCheckpoint {
  if (!checkpoint.goalCreationActive || checkpoint.goalCreationPaused) {
    return checkpoint;
  }
  return pauseEmbeddedGoalCreation({
    ...checkpoint,
    pendingInterrupt: null,
    goalCreationPausedInterrupt: null,
  });
}

export function pauseEmbeddedGoalCreation(
  checkpoint: ThreadCheckpoint,
): ThreadCheckpoint {
  if (checkpoint.goalCreationPaused) {
    return checkpoint;
  }
  const base: ThreadCheckpoint = {
    ...checkpoint,
    goalCreationActive: true,
    goalCreationPaused: true,
    goalCreationPausedInterrupt: checkpoint.pendingInterrupt ?? null,
    pendingInterrupt: null,
  };
  let registry = syncRegistryFromCheckpoint(base);
  registry = setActiveAgent(registry, "global");
  registry = syncGoalCreationCard(registry, base, "paused");
  registry = updateAgentCard(registry, "global", { status: "active" });
  return applyRegistryToCheckpoint(base, registry);
}

export function resumeEmbeddedGoalCreation(
  checkpoint: ThreadCheckpoint,
  options?: { reason?: HandoffReason; question?: string },
): ThreadCheckpoint {
  const wasPaused = checkpoint.goalCreationPaused;
  const pausedInterrupt = checkpoint.goalCreationPausedInterrupt as
    ThreadCheckpoint["pendingInterrupt"] | null | undefined;
  const base: ThreadCheckpoint = {
    ...checkpoint,
    goalCreationActive: true,
    goalCreationPaused: false,
    pendingInterrupt:
      pausedInterrupt === undefined
        ? (checkpoint.pendingInterrupt ?? null)
        : pausedInterrupt,
    goalCreationPausedInterrupt: null,
  };
  let registry = syncRegistryFromCheckpoint(base);
  registry = setActiveAgent(registry, "goal_creation");
  const pending = getPendingInterrupt(base);
  registry = syncGoalCreationCard(
    registry,
    base,
    pending ? "waiting_user" : "active",
  );
  if (wasPaused) {
    registry = appendHandoffHistory(registry, {
      from: "global",
      to: "goal_creation",
      question: options?.question ?? "",
      reason: options?.reason ?? "user_resume_request",
      fromSnapshot: {
        summary: registry.agents.global?.summary ?? "",
        structuredContext: registry.agents.global?.structuredContext ?? {},
        latestMessage: registry.agents.global?.latestMessage ?? "",
        subagent: registry.agents.global?.subagent,
        phase: registry.agents.global?.phase,
      },
    });
  }
  return applyRegistryToCheckpoint(base, registry);
}

export function isGoalCreationResumeRequest(
  checkpoint: ThreadCheckpoint,
  message?: string,
): boolean {
  if (!checkpoint.goalCreationActive || !checkpoint.goalCreationPaused) {
    return false;
  }
  const m = message?.trim().toLowerCase();
  if (!m) return false;
  return [
    /\b(continue|resume)\b$/,
    /\b(continue|resume|go back|back to|return to)\b.*\b(goal|plan|creation|flow|it|sub.?agent)\b/,
    /(继续|恢复|回到|返回|接着|回去).*(目标|计划|创建|流程|刚才|子agent|子 agent)?/,
    /(目标|计划|创建|流程|刚才).*(继续|恢复|回到|返回|接着|回去)/,
  ].some((pattern) => pattern.test(m));
}

export function forkCheckpointForGoalCreation(checkpoint: ThreadCheckpoint): {
  working: ThreadCheckpoint;
  globalMessages: LlmMessageRecord[];
} {
  const globalMessages = checkpoint.llmMessages;
  const working: ThreadCheckpoint = {
    ...checkpoint,
    llmMessages: [...goalCreationMessagesFromCheckpoint(checkpoint)],
  };
  return { working, globalMessages };
}

export function mergeGoalCreationFork(
  checkpoint: ThreadCheckpoint,
  working: ThreadCheckpoint,
  globalMessages: LlmMessageRecord[],
): ThreadCheckpoint {
  return {
    ...working,
    llmMessages: globalMessages,
    goalCreationMessages: working.llmMessages,
    goalCreationActive: checkpoint.goalCreationActive,
    goalCreationPaused: checkpoint.goalCreationPaused,
    goalCreationPausedInterrupt: checkpoint.goalCreationPausedInterrupt,
  };
}

export function withEmbeddedCheckpoint(
  checkpoint: ThreadCheckpoint,
  embedded: boolean,
): {
  working: ThreadCheckpoint;
  globalMessages: LlmMessageRecord[];
} {
  if (!embedded) {
    return { working: checkpoint, globalMessages: checkpoint.llmMessages };
  }
  return forkCheckpointForGoalCreation(checkpoint);
}

export function mergeEmbeddedCheckpoint(
  base: ThreadCheckpoint,
  working: ThreadCheckpoint,
  globalMessages: LlmMessageRecord[],
  embedded: boolean,
): ThreadCheckpoint {
  if (!embedded) return working;
  return mergeGoalCreationFork(base, working, globalMessages);
}

function extractSeedFromStartMessage(message?: string) {
  if (!message?.trim()) return undefined;
  const match = message.trim().match(/^开始创建学习目标[：:]\s*(.+)$/);
  return match?.[1]?.trim();
}

function parseDirectGoalCreationCommand(message?: string): {
  start: boolean;
  seed?: string;
} {
  if (!message?.trim()) return { start: false };
  const m = message.trim();
  if (/[?？]$/.test(m) || /^(如何|怎么|怎样|什么|能否|可以|有没有)/.test(m)) {
    return { start: false };
  }
  const patterns = [
    /^开始创建(学习)?目标(?:[：:]\s*(.+))?$/,
    /^创建(新)?(学习)?目标(?:[：:]\s*(.+))?$/,
    /^新建(学习)?目标(?:[：:]\s*(.+))?$/,
    /^(制定|生成|创建)(学习)?计划(?:[：:]\s*(.+))?$/,
  ];
  for (const pattern of patterns) {
    const match = m.match(pattern);
    if (match) {
      const seed = match[match.length - 1]?.trim();
      return { start: true, seed: seed || undefined };
    }
  }
  return { start: false };
}

export function resolveEmbeddedGoalCreationStart(
  message?: string,
  options?: { clientAction?: string; seedTopic?: string },
): { start: boolean; seed?: string } {
  if (!FEATURE_GOAL_CREATION) return { start: false };
  if (options?.clientAction === "start_goal_creation") {
    return {
      start: true,
      seed: options.seedTopic?.trim() || extractSeedFromStartMessage(message),
    };
  }
  if (isGoalCreationHowToQuestion(message)) return { start: false };
  if (isCasualChitchat(message)) return { start: false };
  const direct = parseDirectGoalCreationCommand(message);
  if (direct.start) return direct;
  return { start: false };
}

export type StartEmbeddedGoalCreationOptions = {
  send?: AgentRunContext["send"];
  /** The caller uploaded resources for this new run before resetting old goal state. */
  preservePendingDocuments?: boolean;
};

export type StartEmbeddedGoalCreationResult = {
  checkpoint: ThreadCheckpoint;
  reset: boolean;
};

export async function startEmbeddedGoalCreation(
  threadId: string,
  seed?: string,
  options: StartEmbeddedGoalCreationOptions = {},
): Promise<StartEmbeddedGoalCreationResult> {
  let checkpoint = await loadCheckpoint(threadId);
  const reset = hasGoalCreationProgress(checkpoint);
  if (reset && !options.preservePendingDocuments) {
    clearPendingGoalDocuments(threadId);
  }
  checkpoint = activateEmbeddedGoalCreation(checkpoint);
  if (seed?.trim()) {
    checkpoint.goalCreationMessages = [
      ...goalCreationMessagesFromCheckpoint(checkpoint),
      { role: "user", content: seed.trim() },
    ];
  }
  await saveCheckpoint(threadId, checkpoint);
  if (reset) {
    await appendAgentMessage(threadId, {
      role: "system",
      content: GOAL_CREATION_RESET_MESSAGE,
      uiPayload: { uiKind: GOAL_CREATION_RESET_UI_KIND },
    });
    if (options.send) {
      await options.send({
        type: "status",
        message: GOAL_CREATION_RESET_MESSAGE,
        phase: "goal_creation",
        reset: true,
      });
    }
  }
  return { checkpoint, reset };
}
