export type AgentThreadScope = "goal_creation" | "global" | "goal" | "unit";

export type MaterialFollowUpThreadContext = {
  kind: "material_follow_up";
  learningPosition?: import("@xue-learn/core/domain").LearningPosition;
  activeVisitId?: string;
  goalId: string;
  unitId: string;
  anchor: import("@xue-learn/core/shared/domain/material-anchor").MaterialAnchor;
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
  | "goal_plan"
  | "unit"
  | "reviews"
  | "profile"
  | "settings"
  | "dev"
  | "unknown";

export type AgentPageContext = {
  learningPosition?: import("@xue-learn/core/domain").LearningPosition;
  activeLearningVisitId?: string;
  pathname: string;
  search?: string;
  pageKind: AgentPageKind;
  /** Learner-facing label for the context chip, never used for authorization. */
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

export type AgentToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type AgentMessageRecord = {
  id: string;
  role: string;
  content: string;
  toolCalls: AgentToolCall[];
  toolCallId?: string | null;
  uiPayload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type AgentThreadRecord = {
  id: string;
  scope: AgentThreadScope;
  scopeId?: string | null;
  conversationContext?: AssistantConversationContext;
  status: string;
  latestMessage?: {
    role: string;
    content: string;
    createdAt: string;
  } | null;
  createdAt: string;
  updatedAt: string;
};

export type PendingToolUi = {
  toolCallId: string;
  toolName: string;
  uiKind: string;
  args: Record<string, unknown>;
  /** Resume payload persisted on the matching role=tool message after the user responds. */
  submitted?: Record<string, unknown>;
};

export type ChatDisplayMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolUi?: PendingToolUi;
  streaming?: boolean;
  thinking?: boolean;
  thinkingContent?: string;
  knowledgeActivity?: import("@xue-learn/core/domain").KnowledgeActivity;
  contextSnapshot?: AgentMessageContextSnapshot;
};
