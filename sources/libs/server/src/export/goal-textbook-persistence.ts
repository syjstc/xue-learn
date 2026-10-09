import type { GoalTextbookReadRepository } from "../../../domain/src/index.js";

let configured: GoalTextbookReadRepository | null = null;
export function configureGoalTextbookPersistence(repository: GoalTextbookReadRepository): void {
  configured = repository;
}
export function requireGoalTextbookPersistence(): GoalTextbookReadRepository {
  if (!configured) throw new Error("Goal textbook persistence is not configured.");
  return configured;
}
