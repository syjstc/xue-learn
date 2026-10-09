import type { GoalIconMetadata, GoalIconRepository } from "../../../domain/src/index.js";
import {
  defaultGoalIconSvg,
  generateGoalIcon,
} from "../llm/generate-goal-icon.js";
import { runWithIsolatedLlmSpanAsync } from "../llm/trace-context.js";
import { getGoalIconPersistence } from "./goal-icon-persistence.js";

const inFlight = new Map<string, Promise<GoalIconMetadata | null>>();

/**
 * Ensure one owned goal has icon metadata. Model generation stays outside the
 * persistence transaction; the repository's conditional save is the only
 * hosted writer and fences concurrent generators.
 */
export async function ensureGoalIcon(
  userId: string,
  goalId: string,
  title?: string,
  repository?: GoalIconRepository,
): Promise<GoalIconMetadata | null> {
  const key = `${userId}:${goalId}`;
  const pending = inFlight.get(key);
  if (pending) return pending;

  const persistence = repository ?? getGoalIconPersistence();
  const operation = (async () => {
    const goal = await persistence.findOwned({ userId, goalId });
    if (!goal || goal.iconSvg) return goal;

    const label = title?.trim() || goal.title;
    let svg = defaultGoalIconSvg();
    let tint = "";

    try {
      const generated = await generateGoalIcon(label);
      svg = generated.svg;
      tint = generated.tint;
    } catch {
      /* keep fallback */
    }

    return persistence.saveOwnedIfEmpty({
      userId,
      goalId,
      iconSvg: svg,
      iconTint: tint,
    });
  })();
  const tracked = operation.finally(() => {
    if (inFlight.get(key) === tracked) inFlight.delete(key);
  });
  inFlight.set(key, tracked);
  return tracked;
}

export function scheduleGoalIconGeneration(
  userId: string,
  goalId: string,
  title?: string,
  repository?: GoalIconRepository,
): void {
  // This work starts after its caller has finished a separate LLM operation.
  // Keep the trace relationship, but do not let the icon run mutate that
  // operation's active span or terminal status.
  void runWithIsolatedLlmSpanAsync(() =>
    ensureGoalIcon(userId, goalId, title, repository),
  );
}
