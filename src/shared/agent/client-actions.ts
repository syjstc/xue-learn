export type AgentClientAction =
  | "start_goal_creation"
  | "open_goal_creation"
  | "exit_goal_creation"
  | { type: "start_goal_creation"; topic?: string };

export type AgentClientActionButton = {
  kind?: "link" | "button" | "client";
  label?: string;
  href?: string;
  value?: unknown;
  variant?: "primary" | "secondary";
  clientAction?: "start_goal_creation" | "open_goal_creation";
};

export type GoalCreationClientRequest = {
  message: string;
  options: {
    clientAction: "start_goal_creation";
    seedTopic?: string;
  };
};

export function goalCreationRequestFromClientAction(
  action: AgentClientAction,
): GoalCreationClientRequest | null {
  const startsGoalCreation =
    action === "start_goal_creation" ||
    (typeof action === "object" && action.type === "start_goal_creation");
  if (!startsGoalCreation) return null;

  const seedTopic =
    typeof action === "object" ? action.topic?.trim() || undefined : undefined;
  return {
    message: seedTopic ? `创建学习目标：${seedTopic}` : "创建学习目标",
    options: {
      clientAction: "start_goal_creation",
      seedTopic,
    },
  };
}

export function resolveClientAction(
  action: AgentClientActionButton,
): AgentClientAction | null {
  if (action.kind !== "client") return null;
  if (action.clientAction === "start_goal_creation") {
    const topic =
      typeof action.value === "object" &&
      action.value &&
      typeof (action.value as { topic?: unknown }).topic === "string"
        ? (action.value as { topic: string }).topic.trim()
        : undefined;
    return topic ? { type: "start_goal_creation", topic } : "start_goal_creation";
  }
  if (action.clientAction === "open_goal_creation") {
    return "open_goal_creation";
  }
  if (action.value === "start_goal_creation") return "start_goal_creation";
  if (action.value === "open_goal_creation") return "open_goal_creation";
  return null;
}
