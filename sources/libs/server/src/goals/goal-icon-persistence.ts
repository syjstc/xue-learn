import type { GoalIconRepository } from "../../../domain/src/index.js";

let configured: GoalIconRepository | undefined;

export function configureGoalIconPersistence(
  repository: GoalIconRepository | undefined,
): void {
  configured = repository;
}

export function getGoalIconPersistence(): GoalIconRepository {
  if (!configured) throw new Error("Goal-icon persistence is not configured");
  return configured;
}
