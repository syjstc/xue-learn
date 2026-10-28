import type {
  AgentConversationRepository,
  LearningGoalRepository,
} from "../../../../domain/src/index.js";

type AgentGoalCreationPersistence = Readonly<{
  goals: LearningGoalRepository;
  assistant: AgentConversationRepository;
}>;

let configured: AgentGoalCreationPersistence | undefined;

export function configureAgentGoalCreationPersistence(
  persistence: AgentGoalCreationPersistence | undefined,
): void {
  configured = persistence;
}

export function requireAgentGoalCreationPersistence(): AgentGoalCreationPersistence {
  if (!configured) {
    throw new Error("Agent goal-creation persistence is not configured");
  }
  return configured;
}
