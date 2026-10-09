export type PlanningActivityCategory =
  | "thinking"
  | "research"
  | "synthesis"
  | "validation";

export type PlanningActivityEvent = {
  type: "planning_activity";
  id: string;
  sequence: number;
  category: PlanningActivityCategory;
  status: "active" | "complete";
  message: string;
  elapsedSeconds: number;
};

type PlanningActivitySpec = {
  id: string;
  category: PlanningActivityCategory;
  startedMessage: string;
  pulseMessages: string[];
  completedMessage: string;
  pulseIntervalMs?: number;
};

/**
 * Emits learner-safe progress while a long planning operation is awaiting an
 * LLM. Messages describe the operation, never provider reasoning tokens or
 * hidden chain-of-thought.
 */
export async function withPlanningActivity<T>(
  send: (event: PlanningActivityEvent) => Promise<void>,
  spec: PlanningActivitySpec,
  work: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  let sequence = 0;
  let pendingPulse: Promise<void> | null = null;
  const elapsedSeconds = () =>
    Math.max(0, Math.floor((Date.now() - startedAt) / 1_000));
  const event = (
    status: PlanningActivityEvent["status"],
    message: string,
  ): PlanningActivityEvent => ({
    type: "planning_activity",
    id: spec.id,
    sequence: sequence++,
    category: spec.category,
    status,
    message,
    elapsedSeconds: elapsedSeconds(),
  });

  await send(event("active", spec.startedMessage));
  const pulseMessages = spec.pulseMessages.filter((message) => message.trim());
  let pulseIndex = 0;
  const timer = pulseMessages.length
    ? setInterval(
        () => {
          if (pendingPulse) return;
          const message = pulseMessages[pulseIndex % pulseMessages.length]!;
          pulseIndex += 1;
          pendingPulse = send(event("active", message))
            // A heartbeat must never turn successful model work into a failure.
            .catch(() => undefined)
            .finally(() => {
              pendingPulse = null;
            });
        },
        Math.max(5_000, spec.pulseIntervalMs ?? 12_000),
      )
    : null;

  try {
    const result = await work();
    if (timer) clearInterval(timer);
    if (pendingPulse) await pendingPulse;
    await send(event("complete", spec.completedMessage));
    return result;
  } finally {
    if (timer) clearInterval(timer);
  }
}
