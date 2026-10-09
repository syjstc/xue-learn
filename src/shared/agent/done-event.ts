import type { AgentSseEvent } from "@/shared/agent/sse";

export function parseAgentDoneEvent(
  event: AgentSseEvent | null,
): { goalId?: string; navigateTo?: string } | null {
  if (!event || event.type !== "done") return null;
  const goalId = typeof event.goalId === "string" ? event.goalId : undefined;
  const navigateTo =
    typeof event.navigateTo === "string" ? event.navigateTo : undefined;
  if (!goalId && !navigateTo) return null;
  return { goalId, navigateTo };
}

export function agentDoneDestination(result: {
  goalId?: string;
  navigateTo?: string;
}): string | undefined {
  if (result.navigateTo) return result.navigateTo;
  if (result.goalId) return `/goals/${result.goalId}`;
  return undefined;
}
