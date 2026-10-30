import type { z } from "zod";
import type { LearningSystemSubject } from "../../learning-systems/types.js";
import type { KnowledgeActivity } from "../../../../domain/src/index.js";

export type AgentThreadScope = "goal_creation" | "global" | "goal" | "unit";

export type MaterialFollowUpThreadContext = {
  kind: "material_follow_up";
  learningPosition?: import("../../../../domain/src/index.js").LearningPosition;
  activeVisitId?: string;
  goalId: string;
  unitId: string;
  anchor: import("../../domain/material-anchor.js").MaterialAnchor;
  anchorSnippet: string;
  contentRevision?: number;
  unitTitle?: string;
  goalTitle?: string;
};

export type AssistantConversationContext =
  { kind: "normal" } | MaterialFollowUpThreadContext;

export type AgentPageKind =
  | "home"
  | "onboarding"
  | "goals"
  | "spaces"
  | "space_dashboard"
  | "today"
  | "goal_dashboard"
  | "goal_map"
  | "goal_plan"
  | "unit"
  | "reviews"
  | "profile"
  | "settings"
  | "dev"
  | "unknown";

export type AgentPageContext = {
  learningPosition?: import("../../../../domain/src/index.js").LearningPosition;
  activeLearningVisitId?: string;
  pathname: string;
  search?: string;
  pageKind: AgentPageKind;
  /** Learner-facing label supplied by the client; never trusted for auth. */
  contextLabel?: string;
  goalId?: string;
  spaceId?: string;
  unitId?: string;
  focusUnitId?: string;
  /** IANA timezone from the browser, e.g. Asia/Shanghai */
  timezone?: string;
  frontendState?: {
    currentStep?: string;
    selectedText?: string;
  };
};

export type AgentMessageContextSnapshot = {
  pageKind: AgentPageKind;
  contextLabel?: string;
  goalId?: string;
  spaceId?: string;
  unitId?: string;
  focusUnitId?: string;
  currentStep?: string;
  selectedText?: string;
};

export type AgentSubagent = "intake" | "plan" | "decompose" | "global";

export type AgentPhase =
  | "parsing"
  | "discovering"
  | "collecting"
  | "scoping"
  | "confirming"
  | "generating_icon"
  | "generating_plan"
  | "reviewing_plan"
  | "decomposing"
  | "completed"
  | "idle";

export type AgentToolCallRecord = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type AgentInterrupt = {
  toolCallId: string;
  toolName: string;
  uiKind: string;
  args: Record<string, unknown>;
};

export type AgentRunContext = {
  userId: string;
  threadId: string;
  /** Groups LLM logs for one agent task (message + resumes), not the whole thread. */
  traceId: string;
  signal?: AbortSignal;
  send: (event: AgentSseEvent) => Promise<void>;
  /** Server-bound scope injected by Tool Capability, never model-authored. */
  toolSubject?: LearningSystemSubject;
};

export type AgentSseEvent =
  | { type: "message"; delta: string; role?: "assistant" }
  | { type: "thinking"; delta?: string }
  | {
      type: "reasoning_status";
      status: "requested" | "active" | "unsupported";
      provider: string;
    }
  | {
      type: "planning_activity";
      id: string;
      sequence: number;
      category: "thinking" | "research" | "synthesis" | "validation";
      status: "active" | "complete";
      message: string;
      elapsedSeconds: number;
      capabilityPath?: { moduleTitles: string[]; unitCount: number };
    }
  | {
      type: "planning_stage";
      stage:
        | "analyzing_goal"
        | "searching_web"
        | "reading_sources"
        | "cross_checking"
        | "researching_modules"
        | "sequencing_modules"
        | "revising_plan"
        | "validating_plan";
      message?: string;
    }
  | {
      type: "planning_outline";
      field: string;
      modeClarification: string;
      reusedSources: boolean;
      topicOverview?: string;
      whatYouWillLearn?: string[];
      prerequisitesAssumed?: string[];
      modules: Array<{
        moduleRef: string;
        title: string;
        objective: string;
        dependsOnPrevious: string;
        estimatedUnitCount?: number;
        scopeSize?: "compact" | "standard" | "large";
        progression?: string[];
      }>;
    }
  | {
      type: "research_query";
      query: string;
      current: number;
      total: number;
      scope: "goal" | "module";
      moduleRef?: string;
    }
  | {
      type: "module_research_progress";
      current: number;
      total: number;
      moduleRef?: string;
      moduleTitle?: string;
      status: "queued" | "researching" | "complete" | "warning";
      sourceCount?: number;
    }
  | { type: "planning_warning"; code: string; message: string }
  | { type: "knowledge_activity"; activity: KnowledgeActivity }
  | {
      type: "tool_ui";
      toolCallId: string;
      toolName: string;
      uiKind: string;
      args: Record<string, unknown>;
    }
  | { type: "interrupt"; toolCallId: string; toolName: string }
  | { type: "phase"; phase: AgentPhase; subagent?: AgentSubagent }
  | { type: "subagent"; name: AgentSubagent }
  | {
      type: "tool_call";
      toolCallId: string;
      toolName: string;
      status: "started" | "completed" | "error";
      args?: Record<string, unknown>;
      resultPreview?: string;
      error?: string;
    }
  | { type: "token"; delta: string }
  | { type: "status"; message: string; phase?: string; reset?: boolean }
  | { type: "progress"; current: number; total: number; message?: string }
  | { type: "map_partial"; map: unknown; pendingFields?: string[] }
  | { type: "micro_unit_partial"; microUnit: unknown; pendingFields?: string[] }
  | { type: "done"; [key: string]: unknown }
  | { type: "error"; message: string; code?: string }
  | { type: "cancelled"; message: string };

export type AgentToolDef<T extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  schema: T;
  capabilityUsage?: {
    type: "query_tool" | "action_tool" | "command_tool" | "builtin_tool";
    key: string;
    capabilityId: string;
    capabilityVersion: string;
    schemaVersion: number;
    toolSetKey?: string;
  };
  uiKind?: string;
  requiresHumanInput?: boolean;
  /**
   * Read-only semantic validation performed after schema parsing and before a
   * human-input card is persisted. Throwing returns the message to the model
   * as a repair request; it must never mutate application state.
   */
  validateHumanInput?: (
    args: z.infer<T>,
    ctx: AgentRunContext & { state: Record<string, unknown> },
  ) => Promise<void>;
  renderUi?: (
    args: z.infer<T>,
    result: unknown,
    ctx: AgentRunContext & { state: Record<string, unknown> },
  ) =>
    | {
        uiKind: string;
        args: Record<string, unknown>;
      }
    | null
    | undefined;
  handler: (
    args: z.infer<T>,
    ctx: AgentRunContext & { state: Record<string, unknown> },
  ) => Promise<unknown>;
};

export type LlmMessageRecord = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: AgentToolCallRecord[];
  /** Provider reasoning required to resume a thinking-mode tool-call turn. */
  reasoningContent?: string;
};
