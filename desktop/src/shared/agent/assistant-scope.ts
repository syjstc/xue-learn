import type { AgentPageContext, AgentThreadScope } from "./types.ts";

export type AssistantThreadBinding = {
  scope: AgentThreadScope;
  scopeId?: string;
};

/**
 * Select the narrowest durable text-thread scope available to this runtime.
 * Hosted keeps the existing global companion behavior until it advertises the
 * local text-thread contract; desktop-local binds the same shared surface to
 * the current owned unit or goal when those ids are present.
 */
export function resolveAssistantThreadBinding(
  pageContext: Pick<AgentPageContext, "goalId" | "unitId">,
  scopedThreadsSupported: boolean,
): AssistantThreadBinding {
  if (scopedThreadsSupported && pageContext.unitId) {
    return { scope: "unit", scopeId: pageContext.unitId };
  }
  if (scopedThreadsSupported && pageContext.goalId) {
    return { scope: "goal", scopeId: pageContext.goalId };
  }
  return { scope: "global" };
}
