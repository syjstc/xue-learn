import { requireAgentConversationPersistence } from "../agents/core/checkpoint.js";
import {
  withPlanningActivity,
  type PlanningActivityCategory,
} from "../goals/planning-activity.js";

export async function emitGoalCreationProgress(
  sessionId: string | undefined,
  event: Record<string, unknown>,
): Promise<void> {
  const id = sessionId?.trim();
  if (!id) return;
  try {
    await requireAgentConversationPersistence().appendGoalCreationEvent(id, {
      type: String(event.type ?? "status"),
      payload: event,
    });
  } catch {
    // Progress is learner-facing telemetry; authoring must not fail closed on it.
  }
}

export async function withGoalCreationPlanningActivity<T>(
  sessionId: string | undefined,
  spec: {
    id: string;
    category: PlanningActivityCategory;
    startedMessage: string;
    pulseMessages: string[];
    completedMessage: string;
    pulseIntervalMs?: number;
  },
  work: () => Promise<T>,
): Promise<T> {
  if (!sessionId?.trim()) return work();
  return withPlanningActivity(
    async (event) => {
      await emitGoalCreationProgress(sessionId, event);
    },
    spec,
    work,
  );
}
