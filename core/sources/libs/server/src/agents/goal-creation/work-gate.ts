import { requireAgentConversationPersistence } from "../core/checkpoint.js";

export async function goalCreationWorkGate(
  goalId: string,
): Promise<"run" | "stopped"> {
  return requireAgentConversationPersistence().goalCreationWorkGate(goalId);
}
